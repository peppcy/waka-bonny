const { q } = require('./db');
const { lagosHour } = require('./util');

async function getSettings() {
  const { rows } = await q('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function isNight(s) {
  const start = Number(s.night_start_hour ?? 21), end = Number(s.night_end_hour ?? 6);
  const h = lagosHour();
  return start > end ? (h >= start || h < end) : (h >= start && h < end);
}

// Returns { fare, base, surcharge, night } — fare is null when admin has not set the price
async function quote(fromZone, toZone, type) {
  const a = Math.min(fromZone, toZone), b = Math.max(fromZone, toZone);
  const { rows } = await q('SELECT amount FROM fares WHERE zone_a=$1 AND zone_b=$2 AND vehicle_type=$3', [a, b, type]);
  const base = rows[0] ? rows[0].amount : null;
  const s = await getSettings();
  const night = isNight(s);
  const surcharge = night ? Number(s.night_surcharge || 0) : 0;
  return { base, surcharge, night, fare: base == null ? null : base + surcharge };
}

module.exports = { quote, getSettings };
