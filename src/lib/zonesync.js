// Keeps Waka Bonny's areas (fare zones) in line with Hale's neighbourhood list.
// Runs at deploy (seed), every 30 minutes, and from Desk → Fares & areas → "Sync from Hale now".
const { q } = require('./db');
const fallback = require('../../config/neighbourhoods');

const clean = (n) => String(n || '').replace(/\s+/g, ' ').trim();

// Accepts the common response shapes: {data:[...]}, {neighbourhoods:[...]}, [...]; items as strings or {name|title|label, city}
async function fetchHaleNames() {
  const base = (process.env.HALE_API_URL || '').replace(/\/$/, '');
  if (!base) return null;
  const path = process.env.HALE_NEIGHBOURHOODS_PATH || '/api/neighbourhoods';
  const res = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Hale returned ${res.status} for ${base + path}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.data || body.neighbourhoods || body.items || [];
  const city = (process.env.HALE_CITY || '').toLowerCase();
  const names = list
    .filter(n => typeof n === 'string' || n.is_active !== false)
    .filter(n => typeof n === 'string' || !city || !n.city || String(n.city).toLowerCase().includes(city))
    .map(n => clean(typeof n === 'string' ? n : n.name || n.title || n.label))
    .filter(Boolean);
  return [...new Map(names.map(n => [n.toLowerCase(), n])).values()];
}

async function addFarePlaceholders() {
  await q(`INSERT INTO fares(zone_a, zone_b, vehicle_type, amount)
           SELECT a.id, b.id, t.v, NULL FROM zones a JOIN zones b ON a.id <= b.id
           CROSS JOIN (VALUES ('keke'),('okada'),('taxi')) t(v) ON CONFLICT DO NOTHING`);
}

// Returns { source, added, reactivated, hidden, total }
async function syncZones({ allowFallback = false } = {}) {
  let names = null, source = 'hale';
  try { names = await fetchHaleNames(); }
  catch (e) { if (!allowFallback) throw e; console.warn('Hale neighbourhood sync failed:', e.message); }
  if (!names) {
    const existing = (await q('SELECT count(*)::int n FROM zones')).rows[0].n;
    if (existing || !allowFallback) return { source: 'none', added: [], reactivated: [], hidden: [], total: existing };
    names = fallback.map(clean); source = 'fallback';
  }
  if (source === 'hale' && names.length < 3) throw new Error(`Hale returned only ${names.length} neighbourhood(s); not syncing to avoid hiding areas by mistake.`);

  const added = [], reactivated = [];
  for (const [i, name] of names.entries()) {
    // Match case-insensitively so "hospital road" and "Hospital Road" are one area
    const ex = (await q('SELECT id, active, name FROM zones WHERE lower(name)=lower($1)', [name])).rows[0];
    if (!ex) { await q(`INSERT INTO zones(name, sort, source, active) VALUES($1,$2,'hale',true)`, [name, i]); added.push(name); }
    else {
      if (!ex.active) reactivated.push(name);
      await q(`UPDATE zones SET name=$1, sort=$2, active=true, source='hale' WHERE id=$3`, [name, i, ex.id]);
    }
  }
  // Hale-managed areas no longer on Hale's list are hidden (not deleted: past trips and fares stay)
  const hidden = source === 'hale'
    ? (await q(`UPDATE zones SET active=false WHERE source='hale' AND active AND lower(name) <> ALL($1::text[]) RETURNING name`,
        [names.map(n => n.toLowerCase())])).rows.map(r => r.name)
    : [];
  await addFarePlaceholders();
  const result = { source, added, reactivated, hidden, total: names.length, at: new Date().toISOString() };
  await q(`INSERT INTO settings(key, value) VALUES('last_zone_sync', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify(result)]);
  return result;
}

module.exports = { syncZones, fetchHaleNames, addFarePlaceholders };
