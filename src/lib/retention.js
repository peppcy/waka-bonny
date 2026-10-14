// Deletes location data once it is older than the period in our Privacy Policy (12 months).
// Runs daily. Trip and payment records stay; only the map coordinates and trails go.
const { q } = require('./db');

const months = () => {
  const n = Number(process.env.RETENTION_MONTHS);
  return Number.isFinite(n) && n >= 1 && n <= 120 ? Math.round(n) : 12;
};

async function purge() {
  const m = String(months());
  const age = `now() - ($1 || ' months')::interval`;
  const out = {};
  out.trail_points = (await q(`DELETE FROM ride_points WHERE at < ${age}`, [m])).rowCount;
  out.ride_coordinates = (await q(`UPDATE rides SET pickup_lat=NULL, pickup_lng=NULL, pax_lat=NULL, pax_lng=NULL
      WHERE created_at < ${age} AND (pickup_lat IS NOT NULL OR pax_lat IS NOT NULL)`, [m])).rowCount;
  out.package_coordinates = (await q(`UPDATE packages SET drop_lat=NULL, drop_lng=NULL
      WHERE created_at < ${age} AND drop_lat IS NOT NULL`, [m])).rowCount;
  // Sign-in codes are useless once used or expired
  out.sign_in_codes = (await q(`DELETE FROM otps WHERE created_at < now() - interval '7 days'`)).rowCount;
  // Safety records: 3 years, as the policy says
  out.safety_alerts = (await q(`DELETE FROM sos_alerts WHERE created_at < now() - interval '3 years'`)).rowCount;
  out.complaints = (await q(`DELETE FROM complaints WHERE created_at < now() - interval '3 years'`)).rowCount;
  // Sent SMS history: 2 years
  out.message_history = (await q(`DELETE FROM broadcasts WHERE created_at < now() - interval '2 years'`)).rowCount;
  const total = Object.values(out).reduce((a, b) => a + b, 0);
  if (total) console.log('Data retention clean-up:', JSON.stringify(out));
  return { months: months(), ...out, total };
}

module.exports = { purge, months };
