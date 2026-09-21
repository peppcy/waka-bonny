const router = require('express').Router();
const { q } = require('../lib/db');
const { quote, getSettings } = require('../lib/fares');
const { wrap, int, bad, HttpError } = require('../lib/util');
const { rideTrack } = require('../lib/track');
const P = require('../lib/packages');
const rateLimit = require('express-rate-limit');
const pkgLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });

router.get('/meta', wrap(async (req, res) => {
  const zones = (await q('SELECT id, name FROM zones WHERE active ORDER BY sort, name')).rows;
  const s = await getSettings();
  res.json({ zones, settings: {
    night_start_hour: s.night_start_hour, night_end_hour: s.night_end_hour, night_surcharge: s.night_surcharge,
    intercity_open_hour: s.intercity_open_hour, intercity_close_hour: s.intercity_close_hour,
    parcel_fee: s.parcel_fee, errand_fee: s.errand_fee, online_payments: !!process.env.PAYSTACK_SECRET_KEY,
    safety_desk_phone: s.safety_desk_phone
  }});
}));

router.get('/quote', wrap(async (req, res) => {
  const from = int(req.query.from), to = int(req.query.to), type = req.query.type;
  if (!from || !to || !['keke', 'okada', 'taxi'].includes(type)) throw bad('Choose pickup, destination and vehicle.');
  const service = ['parcel', 'errand'].includes(req.query.service) ? req.query.service : 'ride';
  res.json(await quote(from, to, type, service));
}));

// Public trip-share link (no sign-in) — shows only what family needs
router.get('/share/:token', wrap(async (req, res) => {
  const r = (await q(`SELECT r.id, r.driver_id, r.service, r.pickup_lat, r.pickup_lng, r.pax_lat, r.pax_lng, r.pax_loc_at, r.status, r.vehicle_type, r.created_at, r.started_at, r.completed_at,
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

// ---- Recipient's package page (link in their SMS; the token is the secret) ----
async function pkgByToken(t) {
  const p = (await q(`SELECT p.*, z.name AS zone_name, d.name AS depot_name, d.address AS depot_address, d.phone AS depot_phone, d.zone_id AS depot_zone,
      d.lat AS depot_lat, d.lng AS depot_lng, r.status AS run_status, r.driver_id, du.name AS driver_name, du.phone AS driver_phone, dr.plate, dr.vehicle_type,
      dr.lat AS drv_lat, dr.lng AS drv_lng, dr.loc_at AS drv_at
    FROM packages p JOIN depots d ON d.id=p.depot_id LEFT JOIN zones z ON z.id=p.zone_id
    LEFT JOIN runs r ON r.id=p.run_id LEFT JOIN users du ON du.id=r.driver_id LEFT JOIN drivers dr ON dr.user_id=r.driver_id
    WHERE p.token=$1`, [String(t)])).rows[0];
  if (!p) throw new HttpError(404, 'This package link is not valid. Check the SMS or call the depot.');
  return p;
}
function publicView(p) {
  const onWay = p.status === 'out_for_delivery';
  return {
    ref: p.ref, recipient_name: p.recipient_name, description: p.description, qty: p.qty, charge: p.charge, delivery_fee: p.delivery_fee,
    status: p.status, zone_id: p.zone_id, zone_name: p.zone_name, address: p.address, code: p.code, fail_reason: p.fail_reason,
    depot: { name: p.depot_name, address: p.depot_address, phone: p.depot_phone },
    driver: p.driver_id && ['assigned', 'out_for_delivery'].includes(p.status) ? { name: p.driver_name, phone: onWay ? p.driver_phone : null, plate: p.plate, vehicle_type: p.vehicle_type } : null,
    track: onWay ? { vehicle: p.drv_lat != null ? { lat: p.drv_lat, lng: p.drv_lng, at: p.drv_at, source: 'driver' } : null,
      pickup: p.drop_lat != null ? { lat: p.drop_lat, lng: p.drop_lng } : null, trail: [] } : null
  };
}
router.get('/package/:token', pkgLimiter, wrap(async (req, res) => res.json(publicView(await pkgByToken(req.params.token)))));

router.get('/package/:token/quote', pkgLimiter, wrap(async (req, res) => {
  const p = await pkgByToken(req.params.token);
  res.json({ delivery_fee: await P.deliveryQuote(p.depot_zone, int(req.query.zone)) });
}));

router.post('/package/:token/deliver', pkgLimiter, wrap(async (req, res) => {
  const p = await pkgByToken(req.params.token);
  if (!['at_depot', 'delivery_requested', 'returned'].includes(p.status)) throw bad('This package is already on its way or handed over.');
  const zone = int(req.body?.zone_id);
  if (!zone) throw bad('Choose your area.');
  const address = String(req.body?.address || '').trim().slice(0, 200);
  if (!address) throw bad('Describe where to deliver: street, house or landmark.');
  const fee = await P.deliveryQuote(p.depot_zone, zone);
  if (fee == null) throw bad('Delivery to this area is not priced yet. Call the depot to arrange delivery.');
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  await q(`UPDATE packages SET status='delivery_requested', zone_id=$1, address=$2, delivery_fee=$3, drop_lat=$4, drop_lng=$5, updated_at=now() WHERE id=$6`,
    [zone, address, fee, ok ? lat : null, ok ? lng : null, p.id]);
  res.json(publicView(await pkgByToken(req.params.token)));
}));

router.post('/package/:token/collect', pkgLimiter, wrap(async (req, res) => {
  const p = await pkgByToken(req.params.token);
  if (p.status !== 'delivery_requested') throw bad(p.status === 'assigned' ? 'A driver has already been assigned. Call the depot to change this.' : 'Nothing to change.');
  await q(`UPDATE packages SET status='at_depot', updated_at=now() WHERE id=$1`, [p.id]);
  res.json(publicView(await pkgByToken(req.params.token)));
}));

module.exports = router;
