// Passenger side of in-island rides (keke, okada, taxi)
const router = require('express').Router();
const { q, tx } = require('../lib/db');
const { auth } = require('../lib/auth');
const { quote } = require('../lib/fares');
const { sendSms } = require('../lib/sms');
const crypto = require('crypto');
const { wrap, bad, int, clean, token, normalizePhone, HttpError } = require('../lib/util');
const { coord, rideTrack, addPoint } = require('../lib/track');

const TYPES = ['keke', 'okada', 'taxi'];
const ACTIVE = ['requested', 'accepted', 'arrived', 'started'];
const REQUEST_TIMEOUT_MIN = 5;

router.use(auth('passenger', 'admin'));

const RIDE_SELECT = `SELECT r.*, fz.name AS from_name, tz.name AS to_name,
    du.name AS driver_name, du.phone AS driver_phone, d.plate, d.permit_no, d.vehicle_desc, d.badge_code,
    d.bank_name AS driver_bank, d.account_number AS driver_account, d.account_name AS driver_account_name, d.account_verified AS driver_account_verified,
    (SELECT round(avg(rating)::numeric,1) FROM rides x WHERE x.driver_id=r.driver_id AND x.rating IS NOT NULL) AS driver_rating
  FROM rides r JOIN zones fz ON fz.id=r.from_zone JOIN zones tz ON tz.id=r.to_zone
  LEFT JOIN users du ON du.id=r.driver_id LEFT JOIN drivers d ON d.user_id=r.driver_id`;

async function mine(id, userId) {
  const r = (await q(`${RIDE_SELECT} WHERE r.id=$1 AND r.passenger_id=$2`, [id, userId])).rows[0];
  if (!r) throw new HttpError(404, 'Ride not found.');
  return r;
}

router.post('/', wrap(async (req, res) => {
  const b = req.body || {};
  const service = ['parcel', 'errand'].includes(b.service) ? b.service : 'ride';
  const from = int(b.from_zone), to = int(b.to_zone), type = b.vehicle_type;
  if (!from || !to) throw bad(service === 'ride' ? 'Choose your pickup and destination.' : 'Choose where the rider picks up and where to deliver.');
  if (!TYPES.includes(type)) throw bad('Choose keke, okada or taxi.');
  const active = await q(`SELECT 1 FROM rides WHERE passenger_id=$1 AND status = ANY($2)`, [req.user.id, ACTIVE]);
  if (active.rows[0]) throw bad('You already have a trip or delivery in progress.');

  let item = null, recName = null, recPhone = null, itemCost = null, deliveryCode = null;
  if (service !== 'ride') {
    item = clean(b.item_desc, 300);
    if (!item) throw bad(service === 'parcel' ? 'Describe the parcel (what it is and roughly how big).' : 'Describe the errand: what to buy or do, and where.');
    deliveryCode = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  }
  if (service === 'parcel') {
    recName = clean(b.recipient_name, 80); recPhone = normalizePhone(b.recipient_phone);
    if (!recName || !recPhone) throw bad("Enter the recipient's name and phone number.");
  }
  if (service === 'errand' && b.item_cost !== '' && b.item_cost != null) {
    itemCost = int(b.item_cost);
    if (itemCost == null || itemCost < 0 || itemCost > 500000) throw bad('Enter the estimated cost of the items in whole naira.');
  }
  const qt = await quote(from, to, type, service);
  if (qt.fare == null) throw bad('The fare for this route has not been set yet. Try another vehicle type or contact the association.');
  const pick = coord(b.pickup_lat, b.pickup_lng);
  const r = (await q(`INSERT INTO rides(token, passenger_id, vehicle_type, from_zone, to_zone, pickup_note, dropoff_note, fare, night, pickup_lat, pickup_lng,
        service, item_desc, recipient_name, recipient_phone, item_cost, delivery_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id, token`,
    [token(), req.user.id, type, from, to, clean(b.pickup_note, 120), clean(b.dropoff_note, 120), qt.fare, qt.night, pick && pick[0], pick && pick[1],
     service, item, recName, recPhone, itemCost, deliveryCode])).rows[0];
  if (service === 'parcel') {
    const link = `${(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')}/?t=${r.token}`;
    sendSms(recPhone, `Waka Bonny: ${req.user.name.split(' ')[0]} is sending you a parcel. Your delivery code is ${deliveryCode}. Give it to the rider ONLY after you receive the parcel. Track it: ${link}`, { soft: true });
  }
  res.json({ ride: await mine(r.id, req.user.id) });
}));

// Current ride, or a completed ride still waiting for payment confirmation
router.get('/active', wrap(async (req, res) => {
  await q(`UPDATE rides SET status='cancelled', cancelled_by='timeout'
           WHERE passenger_id=$1 AND status='requested' AND created_at < now() - ($2 || ' minutes')::interval`,
    [req.user.id, String(REQUEST_TIMEOUT_MIN)]);
  const r = (await q(`${RIDE_SELECT} WHERE r.passenger_id=$1
      AND (r.status = ANY($2) OR (r.status='completed' AND r.paid_at IS NULL)
           OR (r.status='completed' AND r.rating IS NULL AND r.pay_method='paystack' AND r.paid_at > now() - interval '3 hours')
           OR (r.status='cancelled' AND r.cancelled_by IN ('timeout','driver_suspended') AND r.created_at > now() - interval '10 minutes'))
      ORDER BY r.id DESC LIMIT 1`, [req.user.id, ACTIVE])).rows[0];
  res.json({ ride: r || null });
}));

router.get('/history', wrap(async (req, res) => {
  const rows = (await q(`${RIDE_SELECT} WHERE r.passenger_id=$1 ORDER BY r.id DESC LIMIT 20`, [req.user.id])).rows;
  res.json({ rides: rows });
}));

router.get('/:id/track', wrap(async (req, res) => {
  const r = await mine(int(req.params.id), req.user.id);
  res.json(await rideTrack(r));
}));

// Passenger's phone reports its GPS during the trip (primary tracking source)
router.post('/:id/location', wrap(async (req, res) => {
  const c = coord(req.body?.lat, req.body?.lng);
  if (!c) throw bad('Invalid location.');
  const r = (await q(`UPDATE rides SET pax_lat=$1, pax_lng=$2, pax_loc_at=now()
      WHERE id=$3 AND passenger_id=$4 AND status='started' AND service='ride' RETURNING id`, [c[0], c[1], int(req.params.id), req.user.id])).rows[0];
  if (r) await addPoint(r.id, c[0], c[1]);
  res.json({ ok: !!r });
}));

router.post('/:id/cancel', wrap(async (req, res) => {
  const r = await mine(int(req.params.id), req.user.id);
  if (!['requested', 'accepted', 'arrived'].includes(r.status)) throw bad('This ride can no longer be cancelled.');
  await q(`UPDATE rides SET status='cancelled', cancelled_by='passenger' WHERE id=$1`, [r.id]);
  res.json({ ok: true });
}));

// Dismiss a timed-out request notice
router.post('/:id/dismiss', wrap(async (req, res) => {
  await q(`UPDATE rides SET cancelled_by='timeout_seen' WHERE id=$1 AND passenger_id=$2 AND status='cancelled'`, [int(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

router.post('/:id/confirm', wrap(async (req, res) => {
  const r = await mine(int(req.params.id), req.user.id);
  if (r.status !== 'completed') throw bad('You can confirm payment once the trip has ended.');
  if (r.paid_at) throw bad('This trip is already paid.');
  const method = ['cash', 'transfer'].includes(req.body?.pay_method) ? req.body.pay_method : null;
  const rating = int(req.body?.rating);
  if (!method) throw bad('Choose how you paid.');
  if (!rating || rating < 1 || rating > 5) throw bad('Rate your ride from 1 to 5 stars.');
  await q(`UPDATE rides SET pay_method=$1, rating=$2, paid_at=now() WHERE id=$3`, [method, rating, r.id]);
  res.json({ ok: true });
}));

// Rating after an online (Paystack) payment
router.post('/:id/rate', wrap(async (req, res) => {
  const r = await mine(int(req.params.id), req.user.id);
  const rating = int(req.body?.rating);
  if (r.status !== 'completed') throw bad('You can rate once the trip has ended.');
  if (!rating || rating < 1 || rating > 5) throw bad('Rate from 1 to 5 stars.');
  await q('UPDATE rides SET rating=$1 WHERE id=$2', [rating, r.id]);
  res.json({ ok: true });
}));

router.post('/:id/sos', wrap(async (req, res) => {
  const r = await mine(int(req.params.id), req.user.id);
  await q(`INSERT INTO sos_alerts(ride_id, user_id, note) VALUES($1,$2,$3)`, [r.id, req.user.id, clean(req.body?.note, 300)]);
  res.json({ ok: true });
}));

router.post('/:id/complaint', wrap(async (req, res) => {
  const r = await mine(int(req.params.id), req.user.id);
  const text = clean(req.body?.text, 500);
  if (!text) throw bad('Describe what happened.');
  if (!r.driver_id) throw bad('No driver was assigned to this ride.');
  await q(`INSERT INTO complaints(ride_id, driver_id, passenger_id, text) VALUES($1,$2,$3,$4)`, [r.id, r.driver_id, req.user.id, text]);
  res.json({ ok: true });
}));

// Street hail: passenger scans the badge QR on a vehicle they flagged down
router.post('/hail', wrap(async (req, res) => {
  const b = req.body || {};
  const from = int(b.from_zone), to = int(b.to_zone);
  if (!from || !to) throw bad('Choose where you are and where you are going.');
  const out = await tx(async (c) => {
    const d = (await c.query(`SELECT * FROM drivers WHERE badge_code=$1 FOR UPDATE`, [String(b.badge_code || '').toUpperCase()])).rows[0];
    if (!d) throw bad('Badge code not recognised. Do not board this vehicle.');
    if (d.status !== 'approved') throw bad('This driver is not currently approved. Do not board this vehicle.');
    if (!TYPES.includes(d.vehicle_type)) throw bad('Buses and Siennas are booked under Bonny to Port Harcourt.');
    const busy = await c.query(`SELECT 1 FROM rides WHERE driver_id=$1 AND status IN ('accepted','arrived','started')`, [d.user_id]);
    if (busy.rows[0]) throw bad('This driver already has an active trip in the app.');
    const mineActive = await c.query(`SELECT 1 FROM rides WHERE passenger_id=$1 AND status = ANY($2)`, [req.user.id, ACTIVE]);
    if (mineActive.rows[0]) throw bad('You already have a ride in progress.');
    const qt = await quote(from, to, d.vehicle_type);
    if (qt.fare == null) throw bad('The fare for this route has not been set yet. Agree the fare with the driver.');
    return (await c.query(`INSERT INTO rides(token, passenger_id, driver_id, vehicle_type, from_zone, to_zone, fare, night, street_hail, status, accepted_at, started_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'started',now(),now()) RETURNING id`,
      [token(), req.user.id, d.user_id, d.vehicle_type, from, to, qt.fare, qt.night])).rows[0];
  });
  res.json({ ride: await mine(out.id, req.user.id) });
}));

module.exports = router;
