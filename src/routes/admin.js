// Association / admin desk
const router = require('express').Router();
const { q } = require('../lib/db');
const { auth } = require('../lib/auth');
const { wrap, bad, int, clean, normalizePhone, HttpError } = require('../lib/util');
const { extendWeeks, subSettings, startSubscriptionsForAll } = require('../lib/subs');

router.use(auth('admin'));

router.get('/overview', wrap(async (req, res) => {
  const one = async (sql, p = []) => (await q(sql, p)).rows[0];
  res.json({
    drivers: await one(`SELECT count(*) FILTER (WHERE status='approved')::int AS approved,
        count(*) FILTER (WHERE status='pending')::int AS pending,
        count(*) FILTER (WHERE status='approved' AND online AND last_seen > now() - interval '2 minutes')::int AS online FROM drivers`),
    rides: await one(`SELECT count(*) FILTER (WHERE status IN ('requested','accepted','arrived','started'))::int AS live,
        count(*) FILTER (WHERE status='completed' AND (completed_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date)::int AS today,
        COALESCE(sum(fare) FILTER (WHERE status='completed' AND (completed_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date),0)::int AS value_today FROM rides`),
    intercity: await one(`SELECT count(*) FILTER (WHERE status IN ('scheduled','boarding'))::int AS upcoming,
        count(*) FILTER (WHERE status='departed')::int AS on_road FROM departures`),
    safety: await one(`SELECT (SELECT count(*) FROM sos_alerts WHERE NOT resolved)::int AS sos,
        (SELECT count(*) FROM complaints WHERE status='open')::int AS complaints`),
    payments: await one(`SELECT COALESCE(sum(amount) FILTER (WHERE status='success' AND (paid_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date),0)::int AS online_today,
        (SELECT COALESCE(sum(fare),0)::int FROM rides WHERE pay_method='paystack' AND payout_at IS NULL) AS owed_drivers FROM payments`),
    fares_missing: (await one(`SELECT count(*)::int AS n FROM fares f JOIN zones a ON a.id=f.zone_a JOIN zones b ON b.id=f.zone_b
        WHERE f.amount IS NULL AND a.active AND b.active`)).n
  });
}));

router.get('/drivers', wrap(async (req, res) => {
  const status = req.query.status;
  const rows = (await q(`SELECT u.id, u.name, u.phone, u.created_at, d.*, z.name AS zone_name, (d.sub_paid_until > now()) AS sub_active,
      (d.online AND d.last_seen > now() - interval '2 minutes') AS live
    FROM drivers d JOIN users u ON u.id=d.user_id LEFT JOIN zones z ON z.id=d.zone_id
    WHERE ($1::text IS NULL OR d.status=$1) ORDER BY u.created_at DESC LIMIT 200`, [status || null])).rows;
  res.json({ drivers: rows });
}));

async function suspend(userId) {
  await q(`UPDATE drivers SET status='suspended', online=false WHERE user_id=$1`, [userId]);
  await q(`UPDATE rides SET status='cancelled', cancelled_by='driver_suspended' WHERE driver_id=$1 AND status IN ('accepted','arrived')`, [userId]);
}

router.post('/drivers/:id/:action', wrap(async (req, res) => {
  const id = int(req.params.id);
  const d = (await q('SELECT * FROM drivers WHERE user_id=$1', [id])).rows[0];
  if (!d) throw new HttpError(404, 'Driver not found.');
  switch (req.params.action) {
    case 'approve': await q(`UPDATE drivers SET status='approved' WHERE user_id=$1`, [id]); break;
    case 'reject': await q(`UPDATE drivers SET status='rejected', online=false WHERE user_id=$1`, [id]); break;
    case 'suspend': await suspend(id); break;
    case 'reinstate': await q(`UPDATE drivers SET status='approved', strikes=0 WHERE user_id=$1`, [id]); break;
    case 'add-week': await extendWeeks(id, 1); break;  // cash paid to the association
    case 'strike': {
      const s = (await q('UPDATE drivers SET strikes=strikes+1 WHERE user_id=$1 RETURNING strikes', [id])).rows[0].strikes;
      if (s >= 3) await suspend(id);
      break;
    }
    default: throw new HttpError(404, 'Unknown action.');
  }
  res.json({ ok: true });
}));

router.get('/complaints', wrap(async (req, res) => {
  const rows = (await q(`SELECT c.*, p.name AS passenger_name, p.phone AS passenger_phone, du.name AS driver_name, d.plate, d.strikes
    FROM complaints c JOIN users p ON p.id=c.passenger_id LEFT JOIN users du ON du.id=c.driver_id LEFT JOIN drivers d ON d.user_id=c.driver_id
    ORDER BY (c.status='open') DESC, c.id DESC LIMIT 100`)).rows;
  res.json({ complaints: rows });
}));

router.post('/complaints/:id/resolve', wrap(async (req, res) => {
  const action = req.body?.action;
  if (!['strike', 'dismissed'].includes(action)) throw bad('Choose strike or dismiss.');
  const c = (await q(`UPDATE complaints SET status=$1 WHERE id=$2 AND status='open' RETURNING driver_id`, [action, int(req.params.id)])).rows[0];
  if (!c) throw bad('This complaint was already handled.');
  if (action === 'strike' && c.driver_id) {
    const s = (await q('UPDATE drivers SET strikes=strikes+1 WHERE user_id=$1 RETURNING strikes', [c.driver_id])).rows[0].strikes;
    if (s >= 3) await suspend(c.driver_id);
  }
  res.json({ ok: true });
}));

router.get('/sos', wrap(async (req, res) => {
  const rows = (await q(`SELECT s.*, u.name AS user_name, u.phone AS user_phone, u.emergency_phone,
      r.token, fz.name AS from_name, tz.name AS to_name, du.name AS driver_name, d.plate,
      b.ref AS booking_ref
    FROM sos_alerts s JOIN users u ON u.id=s.user_id
    LEFT JOIN rides r ON r.id=s.ride_id LEFT JOIN zones fz ON fz.id=r.from_zone LEFT JOIN zones tz ON tz.id=r.to_zone
    LEFT JOIN users du ON du.id=r.driver_id LEFT JOIN drivers d ON d.user_id=r.driver_id
    LEFT JOIN bookings b ON b.id=s.booking_id
    ORDER BY s.resolved, s.id DESC LIMIT 100`)).rows;
  res.json({ alerts: rows });
}));
router.post('/sos/:id/resolve', wrap(async (req, res) => {
  await q('UPDATE sos_alerts SET resolved=true WHERE id=$1', [int(req.params.id)]);
  res.json({ ok: true });
}));

router.get('/rides/live', wrap(async (req, res) => {
  const rows = (await q(`SELECT r.id, r.status, r.vehicle_type, r.service, r.fare, r.created_at, r.street_hail, r.token, fz.name AS from_name, tz.name AS to_name,
      p.name AS passenger_name, du.name AS driver_name, d.plate
    FROM rides r JOIN zones fz ON fz.id=r.from_zone JOIN zones tz ON tz.id=r.to_zone JOIN users p ON p.id=r.passenger_id
    LEFT JOIN users du ON du.id=r.driver_id LEFT JOIN drivers d ON d.user_id=r.driver_id
    WHERE r.status IN ('requested','accepted','arrived','started') ORDER BY r.id DESC`)).rows;
  res.json({ rides: rows });
}));

// ---- Fares (placeholders are NULL until set here) ----
router.get('/fares', wrap(async (req, res) => {
  const type = req.query.vehicle_type, from = int(req.query.zone);
  if (!['keke', 'okada', 'taxi'].includes(type) || !from) throw bad('Choose vehicle type and zone.');
  const rows = (await q(`SELECT f.zone_a, f.zone_b, f.amount, z.id AS other_id, z.name AS other_name
    FROM fares f JOIN zones z ON z.id = CASE WHEN f.zone_a=$2 THEN f.zone_b ELSE f.zone_a END
    WHERE f.vehicle_type=$1 AND (f.zone_a=$2 OR f.zone_b=$2) AND z.active ORDER BY z.sort, z.name`, [type, from])).rows;
  res.json({ fares: rows });
}));

router.put('/fares', wrap(async (req, res) => {
  const { vehicle_type, items } = req.body || {};
  if (!['keke', 'okada', 'taxi'].includes(vehicle_type) || !Array.isArray(items)) throw bad('Invalid fare update.');
  for (const it of items.slice(0, 500)) {
    const a = int(it.zone_a), b = int(it.zone_b);
    const amt = it.amount === '' || it.amount == null ? null : int(it.amount);
    if (!a || !b || (amt != null && (amt < 0 || amt > 1000000))) throw bad('Fares must be whole naira amounts.');
    await q(`UPDATE fares SET amount=$1 WHERE zone_a=$2 AND zone_b=$3 AND vehicle_type=$4`, [amt, Math.min(a, b), Math.max(a, b), vehicle_type]);
  }
  res.json({ ok: true });
}));

// ---- Zones ----
router.get('/zones', wrap(async (req, res) => {
  const zones = (await q(`SELECT z.*, (SELECT count(*) FROM fares f WHERE (f.zone_a=z.id OR f.zone_b=z.id) AND f.amount IS NOT NULL)::int AS fares_set
    FROM zones z ORDER BY z.active DESC, z.sort, z.name`)).rows;
  const last = (await q(`SELECT value FROM settings WHERE key='last_zone_sync'`)).rows[0];
  res.json({ zones, hale: !!process.env.HALE_API_URL, last_sync: last ? JSON.parse(last.value) : null });
}));
router.post('/zones/sync', wrap(async (req, res) => {
  if (!process.env.HALE_API_URL) throw bad('HALE_API_URL is not set, so there is nothing to sync from.');
  const { syncZones } = require('../lib/zonesync');
  try { res.json(await syncZones()); } catch (e) { throw bad('Sync failed: ' + e.message); }
}));
// Copy fares from one area to another (e.g. "Akiama" renamed to "Akiama Junction"); only fills fares not yet set
router.post('/zones/:id/copy-fares', wrap(async (req, res) => {
  const to = int(req.params.id), from = int(req.body?.from_zone);
  if (!to || !from || to === from) throw bad('Choose the area to copy fares from.');
  const r = await q(`WITH src AS (
      SELECT CASE WHEN f.zone_a=$1 THEN f.zone_b ELSE f.zone_a END AS other, f.vehicle_type, f.amount
      FROM fares f WHERE (f.zone_a=$1 OR f.zone_b=$1) AND f.amount IS NOT NULL)
    UPDATE fares t SET amount = src.amount FROM src
    WHERE t.vehicle_type = src.vehicle_type AND t.amount IS NULL
      AND t.zone_a = LEAST($2::int, CASE WHEN src.other=$1 THEN $2 ELSE src.other END)
      AND t.zone_b = GREATEST($2::int, CASE WHEN src.other=$1 THEN $2 ELSE src.other END)
    RETURNING t.zone_a`, [from, to]);
  res.json({ ok: true, copied: r.rowCount });
}));
router.post('/zones', wrap(async (req, res) => {
  const name = clean(req.body?.name, 60);
  if (!name) throw bad('Enter a neighbourhood name.');
  const z = (await q(`INSERT INTO zones(name, sort, source) VALUES($1, (SELECT COALESCE(max(sort),0)+1 FROM zones), 'manual')
      ON CONFLICT (name) DO UPDATE SET active=true RETURNING id`, [name])).rows[0];
  await q(`INSERT INTO fares(zone_a, zone_b, vehicle_type, amount)
      SELECT LEAST($1::int, z.id), GREATEST($1::int, z.id), t.v, NULL FROM zones z CROSS JOIN (VALUES ('keke'),('okada'),('taxi')) t(v)
      ON CONFLICT DO NOTHING`, [z.id]);
  res.json({ ok: true });
}));
router.post('/zones/:id/toggle', wrap(async (req, res) => {
  await q('UPDATE zones SET active = NOT active WHERE id=$1', [int(req.params.id)]);
  res.json({ ok: true });
}));

// ---- Intercity routes & departures ----
router.get('/routes', wrap(async (req, res) => res.json({ routes: (await q('SELECT * FROM intercity_routes ORDER BY id')).rows })));
router.put('/routes/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const money = (v) => (v === '' || v == null ? null : int(v));
  const pb = money(b.price_bus), ps = money(b.price_sienna);
  if ((b.price_bus !== '' && b.price_bus != null && pb == null) || (b.price_sienna !== '' && b.price_sienna != null && ps == null)) throw bad('Prices must be whole naira amounts.');
  const stops = clean(b.stops, 400);
  await q(`UPDATE intercity_routes SET price_bus=$1, price_sienna=$2, stops=COALESCE($3, stops), active=COALESCE($4, active) WHERE id=$5`,
    [pb, ps, stops, typeof b.active === 'boolean' ? b.active : null, int(req.params.id)]);
  res.json({ ok: true });
}));
router.get('/departures', wrap(async (req, res) => {
  const rows = (await q(`SELECT dp.*, rt.origin, rt.destination, u.name AS driver_name, d.plate,
      COALESCE((SELECT sum(seats) FROM bookings b WHERE b.departure_id=dp.id AND (b.status IN ('booked','boarded') OR (b.status='held' AND b.hold_until > now()))),0)::int AS seats_booked
    FROM departures dp JOIN intercity_routes rt ON rt.id=dp.route_id JOIN users u ON u.id=dp.driver_id JOIN drivers d ON d.user_id=dp.driver_id
    WHERE dp.status IN ('scheduled','boarding','departed') OR dp.depart_at > now() - interval '1 day'
    ORDER BY dp.depart_at DESC LIMIT 100`)).rows;
  res.json({ departures: rows });
}));

// ---- Payouts: fares paid online (Paystack) that the platform owes each driver ----
router.get('/payouts', wrap(async (req, res) => {
  const rows = (await q(`SELECT u.id, u.name, u.phone, d.plate, d.vehicle_type, d.bank_name, d.account_number, d.account_name, d.account_verified,
      count(r.id)::int AS trips, sum(r.fare)::int AS amount, min(r.completed_at) AS since
    FROM rides r JOIN users u ON u.id=r.driver_id JOIN drivers d ON d.user_id=u.id
    WHERE r.pay_method='paystack' AND r.payout_at IS NULL
    GROUP BY u.id, u.name, u.phone, d.plate, d.vehicle_type, d.bank_name, d.account_number, d.account_name, d.account_verified ORDER BY amount DESC`)).rows;
  const recent = (await q(`SELECT p.ref, p.kind, p.amount, p.status, p.channel, p.paid_at, p.created_at, u.name, u.phone
    FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 50`)).rows;
  res.json({ owed: rows, payments: recent });
}));
router.post('/payouts/:driverId', wrap(async (req, res) => {
  const r = (await q(`UPDATE rides SET payout_at=now() WHERE driver_id=$1 AND pay_method='paystack' AND payout_at IS NULL RETURNING fare`, [int(req.params.driverId)])).rows;
  res.json({ ok: true, trips: r.length, amount: r.reduce((a, x) => a + x.fare, 0) });
}));

// ---- Depots and their agents ----
router.get('/depots', wrap(async (req, res) => {
  const rows = (await q(`SELECT d.*, z.name AS zone_name,
      (SELECT json_agg(json_build_object('id',u.id,'name',u.name,'phone',u.phone)) FROM users u WHERE u.depot_id=d.id AND u.role='agent' AND u.deleted_at IS NULL) AS agents,
      (SELECT count(*) FROM packages p WHERE p.depot_id=d.id AND p.status IN ('at_depot','delivery_requested','returned'))::int AS waiting,
      (SELECT count(*) FROM packages p WHERE p.depot_id=d.id AND p.status IN ('assigned','out_for_delivery'))::int AS out,
      (SELECT count(*) FROM packages p WHERE p.depot_id=d.id AND p.status IN ('collected','delivered'))::int AS handed
    FROM depots d LEFT JOIN zones z ON z.id=d.zone_id ORDER BY d.id`)).rows;
  res.json({ depots: rows });
}));
router.post('/depots', wrap(async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80);
  if (!name) throw bad('Enter the depot name.');
  const zone = int(b.zone_id);
  if (!zone) throw bad('Choose the area the depot is in. Delivery fees are worked out from here.');
  const lat = b.lat === '' || b.lat == null ? null : Number(b.lat), lng = b.lng === '' || b.lng == null ? null : Number(b.lng);
  if ((lat != null && !Number.isFinite(lat)) || (lng != null && !Number.isFinite(lng))) throw bad('Location must be numbers.');
  const phone = b.phone ? normalizePhone(b.phone) : null;
  const fields = [name, zone, clean(b.address, 200), phone, lat, lng];
  const id = int(req.body?.id);
  if (id) await q(`UPDATE depots SET name=$1, zone_id=$2, address=$3, phone=$4, lat=$5, lng=$6, active=COALESCE($7, active) WHERE id=$8`, [...fields, typeof b.active === 'boolean' ? b.active : null, id]);
  else await q(`INSERT INTO depots(name, zone_id, address, phone, lat, lng) VALUES($1,$2,$3,$4,$5,$6)`, fields);
  res.json({ ok: true });
}));
// Make an existing account a depot agent (they sign up normally first)
router.post('/depots/:id/agents', wrap(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) throw bad('Enter the agent\'s phone number.');
  const u = (await q(`SELECT id, role FROM users WHERE phone=$1 AND deleted_at IS NULL`, [phone])).rows[0];
  if (!u) throw bad('No account uses this number. Ask the agent to sign up in the app first, then add them here.');
  if (u.role === 'admin') throw bad('This is an admin account.');
  if (u.role === 'driver') throw bad('This number is registered as a driver. Agents need their own customer account.');
  await q(`UPDATE users SET role='agent', depot_id=$1 WHERE id=$2`, [int(req.params.id), u.id]);
  res.json({ ok: true });
}));
router.delete('/depots/:id/agents/:uid', wrap(async (req, res) => {
  await q(`UPDATE users SET role='passenger', depot_id=NULL WHERE id=$1 AND depot_id=$2 AND role='agent'`, [int(req.params.uid), int(req.params.id)]);
  res.json({ ok: true });
}));

// ---- Settings ----
const EDITABLE = ['night_start_hour', 'night_end_hour', 'night_surcharge', 'intercity_open_hour', 'intercity_close_hour', 'safety_desk_phone', 'weekly_subscription', 'subscription_trial_days', 'parcel_fee', 'errand_fee', 'subscription_mode', 'campaign_end'];
router.get('/settings', wrap(async (req, res) => {
  const rows = (await q('SELECT key, value FROM settings')).rows;
  res.json({ settings: Object.fromEntries(rows.map(r => [r.key, r.value])) });
}));
router.put('/settings', wrap(async (req, res) => {
  const before = await subSettings();
  if (req.body?.subscription_mode === 'on') {
    const amt = Number(req.body.weekly_subscription ?? before.amount);
    if (!(amt > 0)) throw bad('Set the weekly subscription amount before switching subscriptions on.');
  }
  if ('subscription_mode' in (req.body || {}) && !['free', 'on'].includes(req.body.subscription_mode)) throw bad('Invalid subscription mode.');
  for (const k of EDITABLE) {
    if (k in (req.body || {})) {
      const v = req.body[k] === '' || req.body[k] == null ? null : String(req.body[k]).slice(0, 40);
      await q('INSERT INTO settings(key, value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
    }
  }
  let trialsStarted = 0;
  if (before.mode !== 'on' && req.body?.subscription_mode === 'on') trialsStarted = await startSubscriptionsForAll();
  res.json({ ok: true, trials_started: trialsStarted });
}));

module.exports = router;
