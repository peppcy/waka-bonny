// Driver side of in-island rides (keke, okada, taxi)
const router = require('express').Router();
const { q } = require('../lib/db');
const { auth, driver } = require('../lib/auth');
const { wrap, bad, int, HttpError } = require('../lib/util');
const { coord, addPoint, paxFresh } = require('../lib/track');
const { subState, requireActiveSub } = require('../lib/subs');

const ISLAND = ['keke', 'okada', 'taxi'];
router.use(auth('driver'));

router.get('/status', driver({ allowPending: true }), wrap(async (req, res) => res.json({ driver: req.driver })));

router.get('/subscription', driver({ allowPending: true }), wrap(async (req, res) => res.json(await subState(req.driver))));

// GPS from the driver's phone. Keke/okada/taxi and bus/Sienna drivers all report here.
router.post('/location', driver(), wrap(async (req, res) => {
  const c = coord(req.body?.lat, req.body?.lng);
  if (!c) throw bad('Invalid location.');
  const heading = Number.isFinite(Number(req.body?.heading)) ? Number(req.body.heading) : null;
  await q('UPDATE drivers SET lat=$1, lng=$2, heading=$3, loc_at=now(), last_seen=now() WHERE user_id=$4', [c[0], c[1], heading, req.user.id]);
  // Driver points only feed the trail when the passenger's phone isn't reporting
  const ride = (await q(`SELECT id, status, pax_loc_at FROM rides WHERE driver_id=$1 AND status='started' ORDER BY id DESC LIMIT 1`, [req.user.id])).rows[0];
  if (ride && !paxFresh(ride)) await addPoint(ride.id, c[0], c[1]);
  res.json({ ok: true });
}));

router.use(driver({ types: ISLAND }));

const RIDE_SELECT = `SELECT r.*, fz.name AS from_name, tz.name AS to_name, p.name AS passenger_name, p.phone AS passenger_phone
  FROM rides r JOIN zones fz ON fz.id=r.from_zone JOIN zones tz ON tz.id=r.to_zone JOIN users p ON p.id=r.passenger_id`;

router.post('/online', wrap(async (req, res) => {
  const online = !!req.body?.online;
  const zone = int(req.body?.zone_id);
  if (online && !zone) throw bad('Choose the area you are in before going online.');
  if (online) await requireActiveSub(req.driver);
  await q('UPDATE drivers SET online=$1, zone_id=COALESCE($2, zone_id), last_seen=now() WHERE user_id=$3', [online, zone, req.user.id]);
  res.json({ ok: true });
}));

const forDriver = (r) => { if (r) { r.has_code = !!r.delivery_code; delete r.delivery_code; delete r.token; } return r; };

router.get('/active', wrap(async (req, res) => {
  const r = (await q(`${RIDE_SELECT} WHERE r.driver_id=$1 AND r.status IN ('accepted','arrived','started') ORDER BY r.id DESC LIMIT 1`, [req.user.id])).rows[0];
  res.json({ ride: forDriver(r) || null });
}));

router.get('/requests', wrap(async (req, res) => {
  await q('UPDATE drivers SET last_seen=now() WHERE user_id=$1', [req.user.id]);
  if (!req.driver.online) return res.json({ requests: [] });
  const busy = await q(`SELECT 1 FROM rides WHERE driver_id=$1 AND status IN ('accepted','arrived','started')`, [req.user.id]);
  if (busy.rows[0]) return res.json({ requests: [] });
  const rows = (await q(`SELECT r.id, r.fare, r.night, r.pickup_note, r.dropoff_note, r.created_at, fz.name AS from_name, tz.name AS to_name,
        r.service, r.item_desc, r.item_cost,
        split_part(p.name,' ',1) AS passenger_first, (r.from_zone = $2) AS nearby
      FROM rides r JOIN zones fz ON fz.id=r.from_zone JOIN zones tz ON tz.id=r.to_zone JOIN users p ON p.id=r.passenger_id
      WHERE r.status='requested' AND r.vehicle_type=$1 AND r.created_at > now() - interval '5 minutes'
      ORDER BY (r.from_zone = $2) DESC, r.created_at ASC LIMIT 10`, [req.driver.vehicle_type, req.driver.zone_id])).rows;
  res.json({ requests: rows });
}));

router.post('/rides/:id/accept', wrap(async (req, res) => {
  const busy = await q(`SELECT 1 FROM rides WHERE driver_id=$1 AND status IN ('accepted','arrived','started')`, [req.user.id]);
  if (busy.rows[0]) throw bad('Finish your current trip first.');
  await requireActiveSub(req.driver);
  // First driver to accept wins; the WHERE clause makes this atomic
  const r = (await q(`UPDATE rides SET driver_id=$1, status='accepted', accepted_at=now()
      WHERE id=$2 AND status='requested' AND vehicle_type=$3 RETURNING id`, [req.user.id, int(req.params.id), req.driver.vehicle_type])).rows[0];
  if (!r) throw bad('Another driver already took this ride.');
  res.json({ ride: forDriver((await q(`${RIDE_SELECT} WHERE r.id=$1`, [r.id])).rows[0]) });
}));

const TRANSITIONS = {
  arrived: { from: ['accepted'], set: `status='arrived'` },
  start: { from: ['accepted', 'arrived'], set: `status='started', started_at=now()` },
  complete: { from: ['started'], set: `status='completed', completed_at=now()` },
  // Driver drops the job before pickup: it goes back to other drivers
  release: { from: ['accepted', 'arrived'], set: `status='requested', driver_id=NULL, accepted_at=NULL, created_at=now()` }
};
router.post('/rides/:id/:action', wrap(async (req, res) => {
  const t = TRANSITIONS[req.params.action];
  if (!t) throw new HttpError(404, 'Unknown action.');
  if (req.params.action === 'complete') {
    const r = (await q(`SELECT service, delivery_code FROM rides WHERE id=$1 AND driver_id=$2`, [int(req.params.id), req.user.id])).rows[0];
    if (r && r.delivery_code) {
      const given = String(req.body?.code || '').replace(/\D/g, '');
      if (given !== r.delivery_code) throw bad(r.service === 'parcel'
        ? 'Wrong delivery code. Ask the recipient for the 4-digit code in their SMS.'
        : 'Wrong delivery code. Ask the customer for the 4-digit code shown in their app.');
    }
  }
  const r = (await q(`UPDATE rides SET ${t.set} WHERE id=$1 AND driver_id=$2 AND status = ANY($3) RETURNING id`,
    [int(req.params.id), req.user.id, t.from])).rows[0];
  if (!r) throw bad('This ride cannot be updated right now. Refresh and try again.');
  res.json({ ok: true });
}));

router.get('/summary', wrap(async (req, res) => {
  const s = (await q(`SELECT COALESCE(sum(fare),0)::int AS earnings, count(*)::int AS trips,
      COALESCE(sum(fare) FILTER (WHERE pay_method='paystack'),0)::int AS online,
      (SELECT COALESCE(sum(fare),0)::int FROM rides WHERE driver_id=$1 AND pay_method='paystack' AND payout_at IS NULL) AS owed,
      (SELECT round(avg(rating)::numeric,1) FROM rides WHERE driver_id=$1 AND rating IS NOT NULL) AS rating
    FROM rides WHERE driver_id=$1 AND status='completed'
      AND (completed_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date`, [req.user.id])).rows[0];
  res.json(s);
}));

module.exports = router;
