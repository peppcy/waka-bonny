// Driver side of in-island rides (keke, okada, taxi)
const router = require('express').Router();
const { q } = require('../lib/db');
const { auth, driver } = require('../lib/auth');
const { wrap, bad, int, HttpError } = require('../lib/util');

const ISLAND = ['keke', 'okada', 'taxi'];
router.use(auth('driver'));

router.get('/status', driver({ allowPending: true }), wrap(async (req, res) => res.json({ driver: req.driver })));

router.use(driver({ types: ISLAND }));

const RIDE_SELECT = `SELECT r.*, fz.name AS from_name, tz.name AS to_name, p.name AS passenger_name, p.phone AS passenger_phone
  FROM rides r JOIN zones fz ON fz.id=r.from_zone JOIN zones tz ON tz.id=r.to_zone JOIN users p ON p.id=r.passenger_id`;

router.post('/online', wrap(async (req, res) => {
  const online = !!req.body?.online;
  const zone = int(req.body?.zone_id);
  if (online && !zone) throw bad('Choose the area you are in before going online.');
  await q('UPDATE drivers SET online=$1, zone_id=COALESCE($2, zone_id), last_seen=now() WHERE user_id=$3', [online, zone, req.user.id]);
  res.json({ ok: true });
}));

router.get('/active', wrap(async (req, res) => {
  const r = (await q(`${RIDE_SELECT} WHERE r.driver_id=$1 AND r.status IN ('accepted','arrived','started') ORDER BY r.id DESC LIMIT 1`, [req.user.id])).rows[0];
  res.json({ ride: r || null });
}));

router.get('/requests', wrap(async (req, res) => {
  await q('UPDATE drivers SET last_seen=now() WHERE user_id=$1', [req.user.id]);
  if (!req.driver.online) return res.json({ requests: [] });
  const busy = await q(`SELECT 1 FROM rides WHERE driver_id=$1 AND status IN ('accepted','arrived','started')`, [req.user.id]);
  if (busy.rows[0]) return res.json({ requests: [] });
  const rows = (await q(`SELECT r.id, r.fare, r.night, r.pickup_note, r.dropoff_note, r.created_at, fz.name AS from_name, tz.name AS to_name,
        split_part(p.name,' ',1) AS passenger_first, (r.from_zone = $2) AS nearby
      FROM rides r JOIN zones fz ON fz.id=r.from_zone JOIN zones tz ON tz.id=r.to_zone JOIN users p ON p.id=r.passenger_id
      WHERE r.status='requested' AND r.vehicle_type=$1 AND r.created_at > now() - interval '5 minutes'
      ORDER BY (r.from_zone = $2) DESC, r.created_at ASC LIMIT 10`, [req.driver.vehicle_type, req.driver.zone_id])).rows;
  res.json({ requests: rows });
}));

router.post('/rides/:id/accept', wrap(async (req, res) => {
  const busy = await q(`SELECT 1 FROM rides WHERE driver_id=$1 AND status IN ('accepted','arrived','started')`, [req.user.id]);
  if (busy.rows[0]) throw bad('Finish your current trip first.');
  // First driver to accept wins; the WHERE clause makes this atomic
  const r = (await q(`UPDATE rides SET driver_id=$1, status='accepted', accepted_at=now()
      WHERE id=$2 AND status='requested' AND vehicle_type=$3 RETURNING id`, [req.user.id, int(req.params.id), req.driver.vehicle_type])).rows[0];
  if (!r) throw bad('Another driver already took this ride.');
  res.json({ ride: (await q(`${RIDE_SELECT} WHERE r.id=$1`, [r.id])).rows[0] });
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
  const r = (await q(`UPDATE rides SET ${t.set} WHERE id=$1 AND driver_id=$2 AND status = ANY($3) RETURNING id`,
    [int(req.params.id), req.user.id, t.from])).rows[0];
  if (!r) throw bad('This ride cannot be updated right now. Refresh and try again.');
  res.json({ ok: true });
}));

router.get('/summary', wrap(async (req, res) => {
  const s = (await q(`SELECT COALESCE(sum(fare),0)::int AS earnings, count(*)::int AS trips,
      (SELECT round(avg(rating)::numeric,1) FROM rides WHERE driver_id=$1 AND rating IS NOT NULL) AS rating
    FROM rides WHERE driver_id=$1 AND status='completed'
      AND (completed_at AT TIME ZONE 'Africa/Lagos')::date = (now() AT TIME ZONE 'Africa/Lagos')::date`, [req.user.id])).rows[0];
  res.json(s);
}));

module.exports = router;
