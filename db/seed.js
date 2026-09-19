// Idempotent: safe to run again after editing config/neighbourhoods.js or config/intercity.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, q } = require('../src/lib/db');
const { normalizePhone } = require('../src/lib/util');
const fallbackNeighbourhoods = require('../config/neighbourhoods');

// Pull the neighbourhood list from Hale so both apps use the same names.
// HALE_API_URL = Hale API base (e.g. https://api.haleapp.ng); HALE_CITY optionally filters by city.
async function loadNeighbourhoods() {
  const base = (process.env.HALE_API_URL || '').replace(/\/$/, '');
  if (!base) { console.log('HALE_API_URL not set: using config/neighbourhoods.js'); return fallbackNeighbourhoods; }
  const path = process.env.HALE_NEIGHBOURHOODS_PATH || '/api/neighbourhoods';
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`Hale returned ${res.status} for ${base + path}`);
  const { data } = await res.json();
  const city = (process.env.HALE_CITY || '').toLowerCase();
  const names = (data || [])
    .filter(n => !city || String(n.city || '').toLowerCase().includes(city))
    .map(n => String(n.name || '').trim()).filter(Boolean);
  if (!names.length) throw new Error('Hale returned no neighbourhoods. Check HALE_API_URL and HALE_CITY.');
  console.log(`Loaded ${names.length} neighbourhoods from Hale.`);
  return [...new Set(names)];
}
const routes = require('../config/intercity');

(async () => {
  const neighbourhoods = await loadNeighbourhoods();
  await q(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  for (const [i, name] of neighbourhoods.entries()) {
    await q('INSERT INTO zones(name, sort) VALUES($1,$2) ON CONFLICT (name) DO UPDATE SET sort=EXCLUDED.sort', [name, i]);
  }
  // Placeholder fares (amount NULL) for every zone pair and vehicle type
  await q(`INSERT INTO fares(zone_a, zone_b, vehicle_type, amount)
           SELECT a.id, b.id, t.v, NULL FROM zones a JOIN zones b ON a.id <= b.id
           CROSS JOIN (VALUES ('keke'),('okada'),('taxi')) t(v)
           ON CONFLICT DO NOTHING`);

  for (const r of routes) {
    await q(`INSERT INTO intercity_routes(origin, destination, stops) VALUES($1,$2,$3)
             ON CONFLICT (origin, destination) DO UPDATE SET stops=EXCLUDED.stops`,
      [r.origin, r.destination, r.stops.join(',')]);
  }

  const defaults = {
    night_start_hour: '21', night_end_hour: '6', night_surcharge: null,
    intercity_open_hour: '7', intercity_close_hour: '19',
    safety_desk_phone: null, weekly_subscription: null
  };
  for (const [k, v] of Object.entries(defaults)) {
    await q('INSERT INTO settings(key, value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }

  const phone = normalizePhone(process.env.ADMIN_PHONE);
  if (phone && process.env.ADMIN_PIN) {
    const hash = await bcrypt.hash(String(process.env.ADMIN_PIN), 10);
    await q(`INSERT INTO users(name, phone, pin_hash, role) VALUES($1,$2,$3,'admin')
             ON CONFLICT (phone) DO UPDATE SET role='admin'`, [process.env.ADMIN_NAME || 'Admin', phone, hash]);
    console.log('Admin account ready:', phone);
  }
  console.log(`Seeded ${neighbourhoods.length} zones and ${routes.length} intercity routes.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
