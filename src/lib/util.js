const crypto = require('crypto');

// Normalise Nigerian numbers to 234XXXXXXXXXX
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1);
  if (d.length === 10 && /^[789]/.test(d)) d = '234' + d;
  if (!/^234[789]\d{9}$/.test(d)) return null;
  return d;
}
const code = (bytes = 4) => crypto.randomBytes(bytes).toString('hex').toUpperCase();
const token = () => crypto.randomBytes(12).toString('base64url');

function lagosHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', hour12: false }).format(date)) % 24;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const clean = (s, max = 200) => (s == null ? null : String(s).trim().slice(0, max) || null);
const int = (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; };

module.exports = { normalizePhone, code, token, lagosHour, HttpError, bad, wrap, clean, int };
