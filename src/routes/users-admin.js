// Platform owner: see customers and drivers, ban/unban, delete (anonymise) with optional phone block.
const router = require('express').Router();
const crypto = require('crypto');
const { q, tx } = require('../lib/db');
const { auth } = require('../lib/auth');
const { wrap, bad, int, clean, HttpError } = require('../lib/util');
const { phoneHash } = require('./auth');
const ps = require('../lib/paystack');

router.use(auth('admin'));

const log = (c, adminId, userId, action, reason) =>
  c.query('INSERT INTO admin_actions(admin_id, user_id, action, reason) VALUES($1,$2,$3,$4)', [adminId, userId, action, reason || null]);

async function target(req) {
  const u = (await q('SELECT * FROM users WHERE id=$1', [int(req.params.id)])).rows[0];
  if (!u || u.deleted_at) throw new HttpError(404, 'User not found.');
  if (u.id === req.user.id) throw bad("You can't do this to your own account.");
  if (u.role === 'admin') throw bad('Admin accounts cannot be banned or deleted here.');
  return u;
}

// List / search
router.get('/', wrap(async (req, res) => {
  const search = clean(req.query.q, 60);
  const role = ['passenger', 'driver', 'admin'].includes(req.query.role) ? req.query.role : null;
  const status = req.query.status;
  const digits = search ? search.replace(/\D/g, '') : '';
  const phoneLike = digits.length >= 4 ? '%' + (digits.startsWith('0') ? digits.slice(1) : digits) + '%' : null;
  const rows = (await q(`SELECT u.id, u.name, u.phone, u.role, u.created_at, u.last_seen_at, u.banned_at, u.ban_reason, u.phone_verified,
      d.vehicle_type, d.status AS driver_status, d.plate,
      (SELECT count(*) FROM rides r WHERE r.passenger_id=u.id)::int AS booked,
      (SELECT count(*) FROM rides r WHERE r.driver_id=u.id AND r.status='completed')::int AS driven,
      (SELECT count(*) FROM complaints c WHERE c.driver_id=u.id)::int AS complaints
    FROM users u LEFT JOIN drivers d ON d.user_id=u.id
    WHERE u.deleted_at IS NULL
      AND ($1::text IS NULL OR u.name ILIKE '%' || $1 || '%' OR ($2::text IS NOT NULL AND u.phone LIKE $2))
      AND ($3::text IS NULL OR u.role=$3)
      AND ($4::text IS NULL OR ($4='banned' AND u.banned_at IS NOT NULL) OR ($4='active' AND u.banned_at IS NULL))
    ORDER BY u.created_at DESC LIMIT 200`,
    [search, phoneLike, role, ['banned', 'active'].includes(status) ? status : null])).rows;
  const counts = (await q(`SELECT count(*) FILTER (WHERE role='passenger')::int AS passengers, count(*) FILTER (WHERE role='driver')::int AS drivers,
      count(*) FILTER (WHERE banned_at IS NOT NULL)::int AS banned FROM users WHERE deleted_at IS NULL`)).rows[0];
  res.json({ users: rows, counts });
}));

// Detail with recent activity and moderation history
router.get('/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const u = (await q(`SELECT u.id, u.name, u.phone, u.role, u.emergency_phone, u.created_at, u.last_seen_at, u.banned_at, u.ban_reason, u.phone_verified,
      d.vehicle_type, d.status AS driver_status, d.plate, d.permit_no, d.strikes, d.sub_paid_until
    FROM users u LEFT JOIN drivers d ON d.user_id=u.id WHERE u.id=$1 AND u.deleted_at IS NULL`, [id])).rows[0];
  if (!u) throw new HttpError(404, 'User not found.');
  const rides = (await q(`SELECT r.id, r.service, r.status, r.fare, r.created_at, r.vehicle_type, fz.name AS from_name, tz.name AS to_name,
      CASE WHEN r.driver_id=$1 THEN 'as driver' ELSE 'as customer' END AS as_role
    FROM rides r JOIN zones fz ON fz.id=r.from_zone JOIN zones tz ON tz.id=r.to_zone
    WHERE r.passenger_id=$1 OR r.driver_id=$1 ORDER BY r.id DESC LIMIT 15`, [id])).rows;
  const complaints = (await q(`SELECT c.text, c.status, c.created_at, CASE WHEN c.driver_id=$1 THEN 'against them' ELSE 'made by them' END AS kind
    FROM complaints c WHERE c.driver_id=$1 OR c.passenger_id=$1 ORDER BY c.id DESC LIMIT 10`, [id])).rows;
  const actions = (await q(`SELECT a.action, a.reason, a.created_at, ad.name AS admin_name FROM admin_actions a JOIN users ad ON ad.id=a.admin_id
    WHERE a.user_id=$1 ORDER BY a.id DESC LIMIT 20`, [id])).rows;
  const paid = (await q(`SELECT COALESCE(sum(amount) FILTER (WHERE status='success'),0)::int AS total FROM payments WHERE user_id=$1`, [id])).rows[0].total;
  res.json({ user: u, rides, complaints, actions, paid });
}));

router.post('/:id/ban', wrap(async (req, res) => {
  const u = await target(req);
  const reason = clean(req.body?.reason, 300);
  if (!reason) throw bad('Give a reason for the ban. The user sees it when they try to sign in.');
  await tx(async (c) => {
    await c.query('UPDATE users SET banned_at=now(), ban_reason=$1 WHERE id=$2', [reason, u.id]);
    await c.query('UPDATE drivers SET online=false WHERE user_id=$1', [u.id]);
    // Stop anything not yet under way; trips already started are left to finish safely
    await c.query(`UPDATE rides SET status='cancelled', cancelled_by='account_banned' WHERE passenger_id=$1 AND status IN ('requested','accepted','arrived')`, [u.id]);
    await c.query(`UPDATE rides SET status='requested', driver_id=NULL, accepted_at=NULL, created_at=now() WHERE driver_id=$1 AND status IN ('accepted','arrived')`, [u.id]);
    await log(c, req.user.id, u.id, 'ban', reason);
  });
  res.json({ ok: true });
}));

router.post('/:id/unban', wrap(async (req, res) => {
  const u = await target(req);
  if (!u.banned_at) throw bad('This account is not banned.');
  await tx(async (c) => {
    await c.query('UPDATE users SET banned_at=NULL, ban_reason=NULL WHERE id=$1', [u.id]);
    await log(c, req.user.id, u.id, 'unban', clean(req.body?.reason, 300));
  });
  res.json({ ok: true });
}));

// Permanent delete: personal data is wiped, records needed for payments and safety stay (anonymised).
router.post('/:id/delete', wrap(async (req, res) => {
  const u = await target(req);
  const reason = clean(req.body?.reason, 300);
  if (!reason) throw bad('Give a reason for deleting this account.');
  if (String(req.body?.confirm || '').trim().toUpperCase() !== 'DELETE') throw bad('Type DELETE to confirm.');
  const drv = (await q('SELECT sub_code, sub_email_token, sub_auto FROM drivers WHERE user_id=$1', [u.id])).rows[0];
  const out = await tx(async (c) => {
    const live = (await c.query(`SELECT count(*)::int n FROM rides WHERE (passenger_id=$1 OR driver_id=$1) AND status='started'`, [u.id])).rows[0].n;
    if (live) throw bad('This user is on a trip right now. Ban them now and delete after the trip ends.');
    await c.query(`UPDATE rides SET status='cancelled', cancelled_by='account_deleted' WHERE passenger_id=$1 AND status IN ('requested','accepted','arrived')`, [u.id]);
    await c.query(`UPDATE rides SET status='requested', driver_id=NULL, accepted_at=NULL, created_at=now() WHERE driver_id=$1 AND status IN ('accepted','arrived')`, [u.id]);
    // Their own bus/Sienna departures, and their unpaid seat bookings
    const deps = (await c.query(`UPDATE departures SET status='cancelled' WHERE driver_id=$1 AND status IN ('scheduled','boarding') RETURNING id`, [u.id])).rows.map(r => r.id);
    if (deps.length) await c.query(`UPDATE bookings SET status='cancelled' WHERE departure_id = ANY($1) AND status IN ('booked','held')`, [deps]);
    const paidSeats = (await c.query(`SELECT count(*)::int n FROM bookings b JOIN departures dp ON dp.id=b.departure_id
        WHERE (b.passenger_id=$1 OR dp.driver_id=$1) AND b.paid AND b.status IN ('booked','held','cancelled') AND dp.depart_at > now()`, [u.id])).rows[0].n;
    await c.query(`UPDATE bookings SET status='cancelled' WHERE passenger_id=$1 AND status IN ('booked','held') AND NOT paid`, [u.id]);
    // Anonymise personal data
    await c.query(`UPDATE bookings SET passenger_name='Deleted user', passenger_phone='deleted', nok_name='deleted', nok_phone='deleted' WHERE passenger_id=$1`, [u.id]);
    await c.query(`UPDATE rides SET recipient_name=CASE WHEN recipient_name IS NULL THEN NULL ELSE 'Deleted' END, recipient_phone=NULL,
        pickup_note=NULL, dropoff_note=NULL, pickup_lat=NULL, pickup_lng=NULL, pax_lat=NULL, pax_lng=NULL WHERE passenger_id=$1`, [u.id]);
    await c.query(`DELETE FROM ride_points WHERE ride_id IN (SELECT id FROM rides WHERE passenger_id=$1)`, [u.id]);
    await c.query(`UPDATE drivers SET status='rejected', online=false, lat=NULL, lng=NULL, plate='DELETED', permit_no='DELETED', vehicle_desc=NULL,
        badge_code=$2, sub_code=NULL, sub_email_token=NULL, sub_auto=false WHERE user_id=$1`, [u.id, 'X' + crypto.randomBytes(6).toString('hex').toUpperCase()]);
    await c.query('DELETE FROM otps WHERE phone=$1', [u.phone]);
    if (req.body?.block_phone) await c.query('INSERT INTO blocked_phones(phone_hash, reason) VALUES($1,$2) ON CONFLICT DO NOTHING', [phoneHash(u.phone), reason]);
    await c.query(`UPDATE users SET name='Deleted user', phone=$2, pin_hash='!', emergency_phone=NULL, deleted_at=now(),
        banned_at=COALESCE(banned_at, now()), ban_reason=$3 WHERE id=$1`, [u.id, `deleted-${u.id}-${crypto.randomBytes(4).toString('hex')}`, reason]);
    await log(c, req.user.id, u.id, req.body?.block_phone ? 'delete + block number' : 'delete', reason);
    return { paidSeats, subAuto: false };
  });
  // Stop Paystack charging a deleted driver's card every week
  if (drv && drv.sub_auto && drv.sub_code && drv.sub_email_token) {
    try { await ps.disableSubscription(drv.sub_code, drv.sub_email_token); } catch (e) { console.error('Could not cancel Paystack subscription for deleted user', u.id, e.message); out.subCancelFailed = true; }
  }
  res.json({ ok: true, ...out });
}));

module.exports = router;
