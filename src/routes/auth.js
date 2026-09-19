const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { q, tx } = require('../lib/db');
const { sign, auth } = require('../lib/auth');
const { normalizePhone, code, bad, wrap, clean, HttpError } = require('../lib/util');

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Wait 15 minutes and try again.' } });

const DRIVER_TYPES = ['keke', 'okada', 'taxi', 'bus', 'sienna'];

async function profile(userId) {
  const u = (await q('SELECT id, name, phone, role, emergency_phone FROM users WHERE id=$1', [userId])).rows[0];
  const d = (await q('SELECT vehicle_type, plate, permit_no, vehicle_desc, status, strikes, online, zone_id, badge_code FROM drivers WHERE user_id=$1', [userId])).rows[0];
  return { ...u, driver: d || null };
}

router.post('/register', limiter, wrap(async (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80);
  const phone = normalizePhone(b.phone);
  const pin = String(b.pin || '');
  const role = b.role === 'driver' ? 'driver' : 'passenger';
  if (!name) throw bad('Enter your full name.');
  if (!phone) throw bad('Enter a valid Nigerian phone number, for example 0803 123 4567.');
  if (!/^\d{4,6}$/.test(pin)) throw bad('Your PIN must be 4 to 6 digits.');
  const emergency = b.emergency_phone ? normalizePhone(b.emergency_phone) : null;
  if (b.emergency_phone && !emergency) throw bad('Enter a valid emergency contact number.');

  if (role === 'driver') {
    if (!DRIVER_TYPES.includes(b.vehicle_type)) throw bad('Choose your vehicle type.');
    if (!clean(b.plate)) throw bad('Enter your plate number.');
    if (!clean(b.permit_no)) throw bad('Enter your association or union permit number.');
  }
  const exists = await q('SELECT 1 FROM users WHERE phone=$1', [phone]);
  if (exists.rows[0]) throw bad('This phone number already has an account. Sign in instead.');

  const hash = await bcrypt.hash(pin, 10);
  const user = await tx(async (c) => {
    const u = (await c.query('INSERT INTO users(name, phone, pin_hash, role, emergency_phone) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [name, phone, hash, role, emergency])).rows[0];
    if (role === 'driver') {
      await c.query(`INSERT INTO drivers(user_id, vehicle_type, plate, permit_no, vehicle_desc, badge_code)
                     VALUES($1,$2,$3,$4,$5,$6)`,
        [u.id, b.vehicle_type, clean(b.plate, 20).toUpperCase(), clean(b.permit_no, 40).toUpperCase(), clean(b.vehicle_desc, 80), code(4)]);
    }
    return u;
  });
  res.json({ token: sign(user), user: await profile(user.id) });
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const pin = String(req.body?.pin || '');
  const u = phone && (await q('SELECT id, pin_hash FROM users WHERE phone=$1', [phone])).rows[0];
  if (!u || !(await bcrypt.compare(pin, u.pin_hash))) throw new HttpError(401, 'Phone number or PIN is incorrect.');
  res.json({ token: sign(u), user: await profile(u.id) });
}));

router.get('/me', auth(), wrap(async (req, res) => res.json({ user: await profile(req.user.id) })));

router.put('/me', auth(), wrap(async (req, res) => {
  const emergency = req.body?.emergency_phone ? normalizePhone(req.body.emergency_phone) : null;
  if (req.body?.emergency_phone && !emergency) throw bad('Enter a valid emergency contact number.');
  await q('UPDATE users SET emergency_phone=$1 WHERE id=$2', [emergency, req.user.id]);
  res.json({ user: await profile(req.user.id) });
}));

module.exports = router;
module.exports.profile = profile;
