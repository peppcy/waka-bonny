const router = require('express').Router();
const { q } = require('../lib/db');
const { quote, getSettings } = require('../lib/fares');
const { wrap, int, bad, HttpError } = require('../lib/util');
const { rideTrack } = require('../lib/track');

router.get('/meta', wrap(async (req, res) => {
  const zones = (await q('SELECT id, name FROM zones WHERE active ORDER BY sort, name')).rows;
  const s = await getSettings();
  res.json({ zones, settings: {
    night_start_hour: s.night_start_hour, night_end_hour: s.night_end_hour, night_surcharge: s.night_surcharge,
    intercity_open_hour: s.intercity_open_hour, intercity_close_hour: s.intercity_close_hour,
    safety_desk_phone: s.safety_desk_phone
  }});
}));

router.get('/quote', wrap(async (req, res) => {
  const from = int(req.query.from), to = int(req.query.to), type = req.query.type;
  if (!from || !to || !['keke', 'okada', 'taxi'].includes(type)) throw bad('Choose pickup, destination and vehicle.');
  res.json(await quote(from, to, type));
}));

// Public trip-share link (no sign-in) — shows only what family needs
router.get('/share/:token', wrap(async (req, res) => {
  const r = (await q(`SELECT r.id, r.driver_id, r.pickup_lat, r.pickup_lng, r.pax_lat, r.pax_lng, r.pax_loc_at, r.status, r.vehicle_type, r.created_at, r.started_at, r.completed_at,
      fz.name AS from_name, tz.name AS to_name, r.pickup_note, r.dropoff_note,
      split_part(p.name,' ',1) AS passenger, du.name AS driver_name, d.plate, d.permit_no, d.vehicle_desc
    FROM rides r JOIN zones fz ON fz.id=r.from_zone JOIN zones tz ON tz.id=r.to_zone
    JOIN users p ON p.id=r.passenger_id
    LEFT JOIN users du ON du.id=r.driver_id LEFT JOIN drivers d ON d.user_id=r.driver_id
    WHERE r.token=$1`, [req.params.token])).rows[0];
  if (!r) throw new HttpError(404, 'This trip link is not valid.');
  const track = await rideTrack(r);
  delete r.id; delete r.driver_id; delete r.pickup_lat; delete r.pickup_lng; delete r.pax_lat; delete r.pax_lng; delete r.pax_loc_at;
  res.json({ ...r, track });
}));

// Rider/driver badge verification (QR on vehicle)
router.get('/badge/:code', wrap(async (req, res) => {
  const d = (await q(`SELECT u.name, d.vehicle_type, d.plate, d.permit_no, d.vehicle_desc, d.status, d.badge_code,
      (SELECT round(avg(rating)::numeric,1) FROM rides WHERE driver_id=u.id AND rating IS NOT NULL) AS rating,
      (SELECT count(*) FROM rides WHERE driver_id=u.id AND status='completed')::int AS trips
    FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.badge_code=$1`, [String(req.params.code).toUpperCase()])).rows[0];
  if (!d) throw new HttpError(404, 'No driver has this badge code. Do not board, and report it to the association.');
  res.json(d);
}));

module.exports = router;
