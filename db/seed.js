// Idempotent: safe to run again after editing config/neighbourhoods.js or config/intercity.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, q } = require('../src/lib/db');
const { normalizePhone } = require('../src/lib/util');
const { syncZones } = require('../src/lib/zonesync');
const routes = require('../config/intercity');

(async () => {
  await q(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const z = await syncZones({ allowFallback: true });
  console.log(z.source === 'hale' ? `Loaded ${z.total} neighbourhoods from Hale (added ${z.added.length}, hidden ${z.hidden.length}).`
    : z.source === 'fallback' ? `Using config/neighbourhoods.js (${z.total} areas).` : 'Hale not reachable: kept the existing areas.');

  for (const r of routes) {
    await q(`INSERT INTO intercity_routes(origin, destination, stops) VALUES($1,$2,$3)
             ON CONFLICT (origin, destination) DO UPDATE SET stops=EXCLUDED.stops`,
      [r.origin, r.destination, r.stops.join(',')]);
  }

  const defaults = {
    night_start_hour: '21', night_end_hour: '6', night_surcharge: null,
    intercity_open_hour: '7', intercity_close_hour: '19',
    safety_desk_phone: null, weekly_subscription: null,
    subscription_trial_days: '7', parcel_fee: null, errand_fee: null,
    subscription_mode: 'free', campaign_end: null
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
  console.log(`Seeded ${routes.length} intercity routes.`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
