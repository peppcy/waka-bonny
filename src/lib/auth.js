const jwt = require('jsonwebtoken');
const { q } = require('./db');
const { HttpError, wrap } = require('./util');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('JWT_SECRET is not set'); process.exit(1); }

// 403 with banned:true so the app can sign the user out and explain why
function bannedError(reason) {
  const e = new HttpError(403, 'Your account has been suspended' + (reason ? `: ${reason}` : '') + '. Contact the Waka Bonny team if you think this is a mistake.');
  e.banned = true;
  return e;
}

const sign = (user) => jwt.sign({ uid: user.id }, SECRET, { expiresIn: '30d' });

// auth() = any signed-in user; auth('admin') = only admins, etc.
const auth = (...roles) => wrap(async (req, res, next) => {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) throw new HttpError(401, 'Sign in to continue.');
  let payload;
  try { payload = jwt.verify(t, SECRET); } catch { throw new HttpError(401, 'Your session has expired. Sign in again.'); }
  const { rows } = await q(`UPDATE users SET last_seen_at=now() WHERE id=$1
      RETURNING id, name, phone, role, emergency_phone, banned_at, ban_reason, deleted_at`, [payload.uid]);
  if (!rows[0] || rows[0].deleted_at) throw new HttpError(401, 'Account not found.');
  if (rows[0].banned_at) throw bannedError(rows[0].ban_reason);
  if (roles.length && !roles.includes(rows[0].role)) throw new HttpError(403, 'You do not have access to this.');
  req.user = rows[0];
  next();
});

// Loads req.driver; requires approved status unless allowPending
const driver = ({ types, allowPending = false } = {}) => wrap(async (req, res, next) => {
  const { rows } = await q('SELECT * FROM drivers WHERE user_id=$1', [req.user.id]);
  const d = rows[0];
  if (!d) throw new HttpError(403, 'This account is not registered as a driver.');
  if (!allowPending && d.status !== 'approved') throw new HttpError(403, 'Your account is not approved yet.');
  if (types && !types.includes(d.vehicle_type)) throw new HttpError(403, 'This feature is not available for your vehicle type.');
  req.driver = d;
  next();
});

module.exports = { sign, auth, driver, bannedError };
