// Bonny <-> Port Harcourt buses and Siennas over the Bodo-Bonny road
const router = require('express').Router();
const { q, tx } = require('../lib/db');
const { auth, driver } = require('../lib/auth');
const { getSettings } = require('../lib/fares');
const { wrap, bad, int, clean, code, normalizePhone, lagosHour, HttpError } = require('../lib/util');

const SEATS = { bus: 18, sienna: 7 };
const DEP_SELECT = `SELECT dp.*, rt.origin, rt.destination, rt.stops, u.name AS driver_name, u.phone AS driver_phone,
    d.plate, d.permit_no, d.vehicle_desc,
    dp.seats_total - COALESCE((SELECT sum(seats) FROM bookings b WHERE b.departure_id=dp.id AND b.status IN ('booked','boarded')),0)::int AS seats_left
  FROM departures dp JOIN intercity_routes rt ON rt.id=dp.route_id
  JOIN users u ON u.id=dp.driver_id JOIN drivers d ON d.user_id=dp.driver_id`;

router.use(auth());

router.get('/routes', wrap(async (req, res) => {
  const rows = (await q('SELECT * FROM intercity_routes WHERE active ORDER BY id')).rows;
  res.json({ routes: rows });
}));

router.get('/departures', wrap(async (req, res) => {
  const route = int(req.query.route_id);
  if (!route) throw bad('Choose a route.');
  const rows = (await q(`${DEP_SELECT} WHERE dp.route_id=$1 AND dp.status IN ('scheduled','boarding')
      AND dp.depart_at > now() - interval '1 hour' ORDER BY dp.depart_at LIMIT 30`, [route])).rows;
  res.json({ departures: rows });
}));

// ---- Passenger bookings ----
router.post('/departures/:id/book', wrap(async (req, res) => {
  const b = req.body || {};
  const seats = int(b.seats) || 1;
  const name = clean(b.passenger_name, 80), nok = clean(b.nok_name, 80);
  const phone = normalizePhone(b.passenger_phone), nokPhone = normalizePhone(b.nok_phone);
  if (seats < 1 || seats > 6) throw bad('You can book 1 to 6 seats.');
  if (!name || !phone) throw bad('Enter the traveller\'s name and phone number for the manifest.');
  if (!nok || !nokPhone) throw bad('Enter a next of kin name and phone number. It is required on the manifest.');
  const out = await tx(async (c) => {
    const dp = (await c.query(`SELECT * FROM departures WHERE id=$1 FOR UPDATE`, [int(req.params.id)])).rows[0];
    if (!dp || !['scheduled', 'boarding'].includes(dp.status)) throw bad('This departure is no longer taking bookings.');
    const taken = (await c.query(`SELECT COALESCE(sum(seats),0)::int AS n FROM bookings WHERE departure_id=$1 AND status IN ('booked','boarded')`, [dp.id])).rows[0].n;
    if (taken + seats > dp.seats_total) throw bad(`Only ${dp.seats_total - taken} seat(s) left on this departure.`);
    return (await c.query(`INSERT INTO bookings(ref, departure_id, passenger_id, seats, passenger_name, passenger_phone, nok_name, nok_phone, drop_stop)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      ['WB' + code(3), dp.id, req.user.id, seats, name, phone, nok, nokPhone, clean(b.drop_stop, 60)])).rows[0];
  });
  res.json({ booking: out });
}));

router.get('/bookings/mine', wrap(async (req, res) => {
  const rows = (await q(`SELECT b.*, dp.depart_at, dp.price, dp.status AS departure_status, dp.vehicle_type,
      rt.origin, rt.destination, u.name AS driver_name, u.phone AS driver_phone, d.plate
    FROM bookings b JOIN departures dp ON dp.id=b.departure_id JOIN intercity_routes rt ON rt.id=dp.route_id
    JOIN users u ON u.id=dp.driver_id JOIN drivers d ON d.user_id=dp.driver_id
    WHERE b.passenger_id=$1 ORDER BY dp.depart_at DESC LIMIT 20`, [req.user.id])).rows;
  res.json({ bookings: rows });
}));

router.post('/bookings/:id/cancel', wrap(async (req, res) => {
  const r = (await q(`UPDATE bookings b SET status='cancelled' FROM departures dp
      WHERE b.id=$1 AND b.passenger_id=$2 AND b.status='booked' AND dp.id=b.departure_id AND dp.status IN ('scheduled','boarding')
      RETURNING b.id`, [int(req.params.id), req.user.id])).rows[0];
  if (!r) throw bad('This booking can no longer be cancelled.');
  res.json({ ok: true });
}));

router.post('/bookings/:id/sos', wrap(async (req, res) => {
  const b = (await q(`SELECT id FROM bookings WHERE id=$1 AND passenger_id=$2`, [int(req.params.id), req.user.id])).rows[0];
  if (!b) throw new HttpError(404, 'Booking not found.');
  await q(`INSERT INTO sos_alerts(booking_id, user_id, note) VALUES($1,$2,$3)`, [b.id, req.user.id, clean(req.body?.note, 300)]);
  res.json({ ok: true });
}));

// ---- Bus / Sienna drivers ----
const operator = driver({ types: ['bus', 'sienna'] });

router.post('/departures', operator, wrap(async (req, res) => {
  const b = req.body || {};
  const rt = (await q('SELECT * FROM intercity_routes WHERE id=$1 AND active', [int(b.route_id)])).rows[0];
  if (!rt) throw bad('Choose a route.');
  const price = req.driver.vehicle_type === 'bus' ? rt.price_bus : rt.price_sienna;
  if (price == null) throw bad('The fare for this route has not been set yet. Ask the admin to set it.');
  const when = new Date(b.depart_at);
  if (isNaN(when) || when < new Date(Date.now() - 5 * 60000)) throw bad('Choose a departure time in the future.');
  const s = await getSettings();
  const open = Number(s.intercity_open_hour), close = Number(s.intercity_close_hour);
  const h = lagosHour(when);
  if (s.intercity_open_hour && s.intercity_close_hour && (h < open || h >= close))
    throw bad(`Departures must be between ${open}:00 and ${close}:00 while the road hours rule applies.`);
  const seats = Math.min(int(b.seats_total) || SEATS[req.driver.vehicle_type], SEATS[req.driver.vehicle_type]);
  const row = (await q(`INSERT INTO departures(route_id, driver_id, vehicle_type, seats_total, depart_at, price)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [rt.id, req.user.id, req.driver.vehicle_type, seats, when, price])).rows[0];
  res.json({ departure: (await q(`${DEP_SELECT} WHERE dp.id=$1`, [row.id])).rows[0] });
}));

router.get('/departures/mine', operator, wrap(async (req, res) => {
  const rows = (await q(`${DEP_SELECT} WHERE dp.driver_id=$1 AND (dp.status IN ('scheduled','boarding','departed') OR dp.depart_at > now() - interval '1 day')
      ORDER BY dp.depart_at DESC LIMIT 20`, [req.user.id])).rows;
  res.json({ departures: rows });
}));

async function ownOrAdmin(req, depId) {
  const dp = (await q(`${DEP_SELECT} WHERE dp.id=$1`, [depId])).rows[0];
  if (!dp) throw new HttpError(404, 'Departure not found.');
  if (req.user.role !== 'admin' && dp.driver_id !== req.user.id) throw new HttpError(403, 'Not your departure.');
  return dp;
}

router.get('/departures/:id/manifest', wrap(async (req, res) => {
  const dp = await ownOrAdmin(req, int(req.params.id));
  const rows = (await q(`SELECT id, ref, seats, passenger_name, passenger_phone, nok_name, nok_phone, drop_stop, status
      FROM bookings WHERE departure_id=$1 AND status <> 'cancelled' ORDER BY id`, [dp.id])).rows;
  res.json({ departure: dp, manifest: rows });
}));

const DEP_FLOW = { boarding: ['scheduled'], departed: ['scheduled', 'boarding'], arrived: ['departed'], cancelled: ['scheduled', 'boarding'] };
router.post('/departures/:id/status', wrap(async (req, res) => {
  const dp = await ownOrAdmin(req, int(req.params.id));
  const next = req.body?.status;
  if (!DEP_FLOW[next] || !DEP_FLOW[next].includes(dp.status)) throw bad('That status change is not allowed.');
  await q('UPDATE departures SET status=$1 WHERE id=$2', [next, dp.id]);
  if (next === 'departed') await q(`UPDATE bookings SET status='no_show' WHERE departure_id=$1 AND status='booked'`, [dp.id]);
  if (next === 'cancelled') await q(`UPDATE bookings SET status='cancelled' WHERE departure_id=$1 AND status='booked'`, [dp.id]);
  res.json({ ok: true });
}));

router.post('/bookings/:id/board', wrap(async (req, res) => {
  const b = (await q('SELECT departure_id FROM bookings WHERE id=$1', [int(req.params.id)])).rows[0];
  if (!b) throw new HttpError(404, 'Booking not found.');
  await ownOrAdmin(req, b.departure_id);
  const next = req.body?.undo ? 'booked' : 'boarded';
  await q(`UPDATE bookings SET status=$1 WHERE id=$2 AND status IN ('booked','boarded')`, [next, int(req.params.id)]);
  res.json({ ok: true });
}));

module.exports = router;
