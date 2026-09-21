// Paystack payments: rides/deliveries, intercity seats, weekly driver subscriptions
const router = require('express').Router();
const { q } = require('../lib/db');
const { auth } = require('../lib/auth');
const ps = require('../lib/paystack');
const { applyPayment } = require('../lib/payments');
const { extendWeeks, subSettings } = require('../lib/subs');
const { getSettings } = require('../lib/fares');
const { wrap, bad, int, code, HttpError } = require('../lib/util');

// Waka Bonny customers use <phone>@PAYSTACK_EMAIL_DOMAIN. Events for any other address
// (e.g. Hale customers, forwarded from Hale's webhook) are ignored.
const DOMAIN = () => (process.env.PAYSTACK_EMAIL_DOMAIN || 'wakabonny.ng').toLowerCase();
function wakaPhone(email) {
  const [local, domain] = String(email || '').toLowerCase().split('@');
  return domain === DOMAIN() && /^234\d{10}$/.test(local) ? local : null;
}

const base = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// ---- Webhook (public, signature-checked). Set this URL in Paystack: https://YOUR-DOMAIN/api/pay/webhook
router.post('/webhook', wrap(async (req, res) => {
  if (!ps.validSignature(req.rawBody, req.get('x-paystack-signature'))) return res.status(401).end();
  res.sendStatus(200); // acknowledge fast; Paystack retries otherwise
  const { event, data } = req.body || {};
  try {
    if (event === 'charge.success') {
      const known = (await q('SELECT 1 FROM payments WHERE ref=$1', [data.reference])).rows[0];
      if (known) return void (await applyPayment(data.reference, data));
      // Recurring subscription charge created by Paystack (not by us): find the driver by customer email
      const phone = data.plan && wakaPhone(data.customer?.email);
      if (phone) {
        const u = (await q(`SELECT u.id FROM users u JOIN drivers d ON d.user_id=u.id WHERE u.phone=$1`, [phone])).rows[0];
        if (u) {
          const ins = (await q(`INSERT INTO payments(ref, user_id, kind, amount, status, channel, paid_at) VALUES($1,$2,'sub_auto',$3,'success',$4,now())
              ON CONFLICT (ref) DO NOTHING RETURNING id`, [data.reference, u.id, Math.round(data.amount / 100), data.channel || null])).rows[0];
          if (ins) { await extendWeeks(u.id, 1); await q('UPDATE drivers SET sub_auto=true WHERE user_id=$1', [u.id]); }
        }
      }
    } else if (event === 'subscription.create' && wakaPhone(data.customer?.email)) {
      const phone = wakaPhone(data.customer.email);
      await q(`UPDATE drivers d SET sub_code=$1, sub_email_token=$2, sub_auto=true FROM users u WHERE u.id=d.user_id AND u.phone=$3`,
        [data.subscription_code, data.email_token, phone]);
    } else if (['subscription.disable', 'subscription.not_renew'].includes(event) && wakaPhone(data.customer?.email)) {
      const phone = wakaPhone(data.customer.email);
      await q(`UPDATE drivers d SET sub_auto=false FROM users u WHERE u.id=d.user_id AND u.phone=$1`, [phone]);
    }
  } catch (e) { console.error('Webhook handling failed:', e); }
}));

router.use(auth());

router.get('/status', wrap(async (req, res) => res.json({ enabled: ps.enabled() })));

async function start(req, { kind, amount, rideId = null, bookingId = null, plan = null, label }) {
  if (!(amount > 0)) throw bad('Nothing to pay.');
  const ref = 'WB' + Date.now().toString(36).toUpperCase() + code(3);
  await q(`INSERT INTO payments(ref, user_id, kind, ride_id, booking_id, amount) VALUES($1,$2,$3,$4,$5,$6)`,
    [ref, req.user.id, kind, rideId, bookingId, amount]);
  const init = await ps.initialize({
    phone: req.user.phone, amountNaira: amount, ref, plan,
    callback: `${base(req)}/?pay=${ref}`,
    metadata: { kind, ride_id: rideId, booking_id: bookingId, user_id: req.user.id, custom_fields: [{ display_name: 'For', variable_name: 'for', value: label }] }
  });
  return { ref, authorization_url: init.authorization_url };
}

router.post('/ride/:id', wrap(async (req, res) => {
  const r = (await q('SELECT * FROM rides WHERE id=$1 AND passenger_id=$2', [int(req.params.id), req.user.id])).rows[0];
  if (!r) throw new HttpError(404, 'Trip not found.');
  if (r.status !== 'completed') throw bad('You can pay once the trip has ended.');
  if (r.paid_at) throw bad('This trip is already paid.');
  res.json(await start(req, { kind: 'ride', amount: r.fare, rideId: r.id, label: `Waka Bonny ${r.service} #${r.id}` }));
}));

router.post('/booking/:id', wrap(async (req, res) => {
  const b = (await q(`SELECT b.*, dp.price, dp.status AS dep_status FROM bookings b JOIN departures dp ON dp.id=b.departure_id
      WHERE b.id=$1 AND b.passenger_id=$2`, [int(req.params.id), req.user.id])).rows[0];
  if (!b) throw new HttpError(404, 'Booking not found.');
  if (b.paid) throw bad('This booking is already paid.');
  if (!['held', 'booked'].includes(b.status) || !['scheduled', 'boarding'].includes(b.dep_status)) throw bad('This booking can no longer be paid online.');
  if (b.status === 'held') await q(`UPDATE bookings SET hold_until = GREATEST(hold_until, now() + interval '15 minutes') WHERE id=$1`, [b.id]);
  res.json(await start(req, { kind: 'seat', amount: b.price * b.seats, bookingId: b.id, label: `Bonny-PH seats ${b.ref}` }));
}));

// Weekly subscription: mode "auto" = card charged every week by Paystack; "once" = pay one week (any channel)
router.post('/subscription', wrap(async (req, res) => {
  const d = (await q('SELECT * FROM drivers WHERE user_id=$1', [req.user.id])).rows[0];
  if (!d) throw bad('Only drivers have subscriptions.');
  const { amount, mode } = await subSettings();
  if (mode !== 'on' || !(amount > 0)) throw bad('No weekly fee is due: drivers use Waka Bonny free during the launch campaign.');
  if (req.body?.mode === 'auto') {
    if (d.sub_auto) throw bad('Automatic weekly payment is already on.');
    const s = await getSettings();
    let plan = s.paystack_plan_code;
    if (!plan || Number(s.paystack_plan_amount) !== amount) {
      plan = (await ps.createPlan(amount)).plan_code;
      await q(`INSERT INTO settings(key,value) VALUES('paystack_plan_code',$1),('paystack_plan_amount',$2)
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [plan, String(amount)]);
    }
    return res.json(await start(req, { kind: 'sub_auto', amount, plan, label: 'Weekly driver subscription (automatic)' }));
  }
  res.json(await start(req, { kind: 'sub_week', amount, label: 'Weekly driver subscription (1 week)' }));
}));

router.post('/subscription/cancel', wrap(async (req, res) => {
  const d = (await q('SELECT * FROM drivers WHERE user_id=$1', [req.user.id])).rows[0];
  if (!d?.sub_auto) throw bad('Automatic weekly payment is not on.');
  if (d.sub_code && d.sub_email_token) await ps.disableSubscription(d.sub_code, d.sub_email_token);
  await q('UPDATE drivers SET sub_auto=false WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));

// Called when Paystack sends the user back to the app (?pay=REF). The webhook applies it too; whichever is first wins.
router.get('/verify/:ref', wrap(async (req, res) => {
  const p = (await q('SELECT * FROM payments WHERE ref=$1 AND user_id=$2', [req.params.ref, req.user.id])).rows[0];
  if (!p) throw new HttpError(404, 'Payment not found.');
  if (p.status !== 'success') {
    const data = await ps.verify(p.ref);
    await applyPayment(p.ref, data);
  }
  const fresh = (await q('SELECT ref, kind, status, amount, ride_id, booking_id FROM payments WHERE id=$1', [p.id])).rows[0];
  res.json({ payment: fresh });
}));

module.exports = router;
