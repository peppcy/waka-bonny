const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { q, tx } = require('../lib/db');
const { sign, auth } = require('../lib/auth');
const { sendSms, provider } = require('../lib/sms');
const { normalizePhone, code, bad, wrap, clean, HttpError } = require('../lib/util');

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Wait 15 minutes and try again.' } });
const otpLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many code requests. Wait an hour and try again.' } });

const DRIVER_TYPES = ['keke', 'okada', 'taxi', 'bus', 'sienna'];
const OTP_TTL_MIN = 10, OTP_MAX_ATTEMPTS = 5;
const hashCode = (phone, c) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${phone}:${c}`).digest('hex');
const devMode = () => provider() === 'console' && process.env.NODE_ENV !== 'production';

async function profile(userId) {
  const u = (await q('SELECT id, name, phone, role, emergency_phone, phone_verified FROM users WHERE id=$1', [userId])).rows[0];
  const d = (await q(`SELECT vehicle_type, plate, permit_no, vehicle_desc, status, strikes, online, zone_id, badge_code,
      sub_paid_until, sub_auto FROM drivers WHERE user_id=$1`, [userId])).rows[0];
  return { ...u, driver: d || null };
}

// ---- Step 1: send a 6-digit code by SMS ----
router.post('/otp/request', otpLimiter, wrap(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const purpose = req.body?.purpose === 'reset' ? 'reset' : 'register';
  if (!phone) throw bad('Enter a valid Nigerian phone number, for example 0803 123 4567.');
  const exists = (await q('SELECT 1 FROM users WHERE phone=$1', [phone])).rows[0];
  if (purpose === 'register' && exists) throw bad('This number already has an account. Sign in, or use "Forgot PIN".');
  if (purpose === 'reset' && !exists) throw bad('No account uses this number. Create an account instead.');
  const recent = (await q(`SELECT created_at FROM otps WHERE phone=$1 AND purpose=$2 ORDER BY id DESC LIMIT 1`, [phone, purpose])).rows[0];
  if (recent && Date.now() - new Date(recent.created_at) < 60000) throw bad('Please wait a minute before asking for another code.');
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await q(`INSERT INTO otps(phone, purpose, code_hash, expires_at) VALUES($1,$2,$3, now() + interval '${OTP_TTL_MIN} minutes')`, [phone, purpose, hashCode(phone, otp)]);
  await sendSms(phone, `Your Waka Bonny code is ${otp}. It expires in ${OTP_TTL_MIN} minutes. Never share this code with anyone.`);
  res.json({ ok: true, ...(devMode() ? { dev_code: otp } : {}) });
}));

// ---- Step 2: check the code; returns a short-lived token proving the phone was verified ----
router.post('/otp/verify', limiter, wrap(async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const purpose = req.body?.purpose === 'reset' ? 'reset' : 'register';
  const c = String(req.body?.code || '').replace(/\D/g, '');
  if (!phone || c.length !== 6) throw bad('Enter the 6-digit code from the SMS.');
  const o = (await q(`SELECT * FROM otps WHERE phone=$1 AND purpose=$2 AND NOT used ORDER BY id DESC LIMIT 1`, [phone, purpose])).rows[0];
  if (!o || new Date(o.expires_at) < new Date()) throw bad('This code has expired. Ask for a new one.');
  if (o.attempts >= OTP_MAX_ATTEMPTS) throw bad('Too many wrong attempts. Ask for a new code.');
  const ok = crypto.timingSafeEqual(Buffer.from(o.code_hash), Buffer.from(hashCode(phone, c)));
  if (!ok) {
    await q('UPDATE otps SET attempts = attempts + 1 WHERE id=$1', [o.id]);
    throw bad(`That code is not correct. ${OTP_MAX_ATTEMPTS - o.attempts - 1} attempt(s) left.`);
  }
  await q('UPDATE otps SET used=true WHERE id=$1', [o.id]);
  const verify_token = jwt.sign({ phone, purpose, v: 1 }, process.env.JWT_SECRET, { expiresIn: '20m' });
  res.json({ verify_token });
}));

function readVerifyToken(t, purpose) {
  try {
    const p = jwt.verify(String(t || ''), process.env.JWT_SECRET);
    if (p.v !== 1 || p.purpose !== purpose) throw new Error();
    return p.phone;
  } catch { throw bad('Phone verification expired. Start again and request a new code.'); }
}

// ---- Step 3: create the account with a PIN ----
router.post('/register', limiter, wrap(async (req, res) => {
  const b = req.body || {};
  const phone = readVerifyToken(b.verify_token, 'register');
  const name = clean(b.name, 80);
  const pin = String(b.pin || '');
  const role = b.role === 'driver' ? 'driver' : 'passenger';
  if (!name) throw bad('Enter your full name.');
  if (!/^\d{4,6}$/.test(pin)) throw bad('Your PIN must be 4 to 6 digits.');
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw bad('Choose a PIN that is harder to guess (not 1111 or 1234).');
  if (b.pin_confirm != null && String(b.pin_confirm) !== pin) throw bad('The two PINs do not match.');
  const emergency = b.emergency_phone ? normalizePhone(b.emergency_phone) : null;
  if (b.emergency_phone && !emergency) throw bad('Enter a valid emergency contact number.');
  if (role === 'driver') {
    if (!DRIVER_TYPES.includes(b.vehicle_type)) throw bad('Choose your vehicle type.');
    if (!clean(b.plate)) throw bad('Enter your plate number.');
    if (!clean(b.permit_no)) throw bad('Enter your association or union permit number.');
  }
  if ((await q('SELECT 1 FROM users WHERE phone=$1', [phone])).rows[0]) throw bad('This phone number already has an account. Sign in instead.');
  const hash = await bcrypt.hash(pin, 10);
  const user = await tx(async (c) => {
    const u = (await c.query('INSERT INTO users(name, phone, pin_hash, role, emergency_phone, phone_verified) VALUES($1,$2,$3,$4,$5,true) RETURNING id',
      [name, phone, hash, role, emergency])).rows[0];
    if (role === 'driver') {
      await c.query(`INSERT INTO drivers(user_id, vehicle_type, plate, permit_no, vehicle_desc, badge_code) VALUES($1,$2,$3,$4,$5,$6)`,
        [u.id, b.vehicle_type, clean(b.plate, 20).toUpperCase(), clean(b.permit_no, 40).toUpperCase(), clean(b.vehicle_desc, 80), code(4)]);
    }
    return u;
  });
  res.json({ token: sign(user), user: await profile(user.id) });
}));

// ---- Forgot PIN: verified phone sets a new PIN ----
router.post('/reset-pin', limiter, wrap(async (req, res) => {
  const phone = readVerifyToken(req.body?.verify_token, 'reset');
  const pin = String(req.body?.pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw bad('Your PIN must be 4 to 6 digits.');
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw bad('Choose a PIN that is harder to guess (not 1111 or 1234).');
  const u = (await q('UPDATE users SET pin_hash=$1, phone_verified=true WHERE phone=$2 RETURNING id', [await bcrypt.hash(pin, 10), phone])).rows[0];
  if (!u) throw bad('Account not found.');
  res.json({ token: sign(u), user: await profile(u.id) });
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

// Change PIN while signed in
router.post('/change-pin', auth(), limiter, wrap(async (req, res) => {
  const u = (await q('SELECT pin_hash FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!(await bcrypt.compare(String(req.body?.current_pin || ''), u.pin_hash))) throw bad('Your current PIN is not correct.');
  const pin = String(req.body?.pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw bad('Your new PIN must be 4 to 6 digits.');
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw bad('Choose a PIN that is harder to guess (not 1111 or 1234).');
  await q('UPDATE users SET pin_hash=$1 WHERE id=$2', [await bcrypt.hash(pin, 10), req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.profile = profile;
