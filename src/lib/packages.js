// Depot packages: delivery fee quotes and recipient SMS
const crypto = require('crypto');
const { q } = require('./db');
const { getSettings } = require('./fares');
const { sendSms } = require('./sms');
const { code } = require('./util');

const newRef = () => 'P' + code(3);
const newToken = () => crypto.randomBytes(12).toString('base64url');
const newCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

// Delivery fee from the depot's area to the recipient's area: the parcel fare (okada, else keke, else taxi) + parcel fee
async function deliveryQuote(depotZone, toZone) {
  if (!depotZone || !toZone) return null;
  const a = Math.min(depotZone, toZone), b = Math.max(depotZone, toZone);
  const rows = (await q(`SELECT vehicle_type, amount FROM fares WHERE zone_a=$1 AND zone_b=$2 AND amount IS NOT NULL`, [a, b])).rows;
  const pick = ['okada', 'keke', 'taxi'].map(t => rows.find(r => r.vehicle_type === t)).find(Boolean);
  if (!pick) return null;
  const s = await getSettings();
  return pick.amount + Number(s.parcel_fee || 0);
}

const appUrl = (req) => (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');

function arrivalSms(req, p, depot) {
  const pay = p.charge > 0 ? ` Charge: ${naira(p.charge)}.` : '';
  return sendSms(p.recipient_phone,
    `Waka Bonny: ${p.recipient_name.split(' ')[0]}, your package ${p.ref}${p.description ? ` (${p.description.slice(0, 40)})` : ''} is at ${depot.name}.${pay} ` +
    `Pickup code: ${p.code}. Collect it, or get it delivered: ${appUrl(req)}/?p=${p.token}`, { soft: true });
}

module.exports = { newRef, newToken, newCode, deliveryQuote, arrivalSms, appUrl, naira };
