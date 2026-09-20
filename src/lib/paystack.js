// Paystack REST client. PAYSTACK_SECRET_KEY must be set (sk_test_... or sk_live_...).
const crypto = require('crypto');
const { HttpError } = require('./util');

const BASE = () => (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co').replace(/\/$/, '');
const key = () => process.env.PAYSTACK_SECRET_KEY;
const enabled = () => !!key();

async function call(method, path, body) {
  if (!enabled()) throw new HttpError(503, 'Online payment is not set up yet. Pay cash or by transfer.');
  const res = await fetch(BASE() + path, {
    method, headers: { Authorization: 'Bearer ' + key(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    console.error('Paystack error', path, res.status, data.message);
    throw new HttpError(502, 'Payment service error: ' + (data.message || res.status));
  }
  return data.data;
}

// Paystack needs an email; we use a stable per-user address because the app doesn't collect emails
const emailFor = (phone) => `${phone}@${process.env.PAYSTACK_EMAIL_DOMAIN || 'wakabonny.ng'}`;

const initialize = ({ phone, amountNaira, ref, callback, metadata, plan }) =>
  call('POST', '/transaction/initialize', {
    email: emailFor(phone), amount: amountNaira * 100, reference: ref, callback_url: callback, metadata,
    ...(plan ? { plan } : {}), channels: ['card', 'bank', 'ussd', 'bank_transfer', 'mobile_money']
  });
const verify = (ref) => call('GET', '/transaction/verify/' + encodeURIComponent(ref));
const createPlan = (amountNaira) => call('POST', '/plan', { name: `Waka Bonny weekly driver plan ₦${amountNaira}`, interval: 'weekly', amount: amountNaira * 100 });
const disableSubscription = (code, token) => call('POST', '/subscription/disable', { code, token });

function validSignature(rawBody, signature) {
  if (!key() || !rawBody || !signature) return false;
  const h = crypto.createHmac('sha512', key()).update(rawBody).digest('hex');
  return h.length === signature.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(signature));
}

module.exports = { enabled, initialize, verify, createPlan, disableSubscription, validSignature, emailFor };
