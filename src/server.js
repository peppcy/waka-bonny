require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { q } = require('./lib/db');

const app = express();
app.set('trust proxy', 1);
// Keep the raw body so the Paystack webhook signature can be checked
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
const origins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
if (origins.length) app.use(cors({ origin: origins }));

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  // Other sites (e.g. OpenStreetMap map tiles) see only our origin, never full page URLs.
  // OSM's tile policy blocks requests that send no Referer at all.
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/public', require('./routes/public'));
app.use('/api/rides', require('./routes/rides'));
app.use('/api/driver', require('./routes/driver'));
app.use('/api/intercity', require('./routes/intercity'));
app.use('/api/admin/users', require('./routes/users-admin'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/pay', require('./routes/pay'));
app.use('/api/depot', require('./routes/depot'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, file) {
    // The service worker and app shell must always be revalidated so updates reach phones straight away
    if (/(sw\.js|index\.html|app\.js|styles\.css)$/.test(file)) res.set('Cache-Control', 'no-cache');
    if (file.endsWith('.webmanifest')) res.set('Content-Type', 'application/manifest+json');
  }
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message, ...(err.banned ? { banned: true } : {}) });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
});

(async () => {
  // Apply schema on boot (all statements are IF NOT EXISTS)
  await q(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Waka Bonny running on :${port}`));
})().catch(e => { console.error('Startup failed:', e); process.exit(1); });
