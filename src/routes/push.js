// A phone registers itself here so the app can alert it while it is closed.
const router = require('express').Router();
const { q } = require('../lib/db');
const { auth } = require('../lib/auth');
const { wrap, bad, clean } = require('../lib/util');
const push = require('../lib/push');

router.use(auth());

// What the app already knows about this phone
router.get('/', wrap(async (req, res) => {
  const { rows } = await q('SELECT count(*)::int n FROM push_subscriptions WHERE user_id=$1', [req.user.id]);
  res.json({ enabled: push.enabled(), key: push.publicKey(), devices: rows[0].n });
}));

router.post('/subscribe', wrap(async (req, res) => {
  if (!push.enabled()) throw bad('Alerts are not switched on for this app yet.');
  const s = req.body?.subscription || req.body;
  const endpoint = clean(s?.endpoint, 700);
  const p256dh = clean(s?.keys?.p256dh, 200);
  const authKey = clean(s?.keys?.auth, 100);
  if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !authKey) throw bad('That phone could not be registered for alerts.');
  const device = clean(req.body?.device || req.headers['user-agent'], 120);
  // One row per phone: if it was signed in as someone else before, it moves to this account
  await q(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, device)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
      device = EXCLUDED.device, failures = 0`,
    [req.user.id, endpoint, p256dh, authKey, device]);
  res.json({ ok: true });
}));

router.post('/unsubscribe', wrap(async (req, res) => {
  const endpoint = clean(req.body?.endpoint, 700);
  if (endpoint) await q('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [endpoint, req.user.id]);
  else await q('DELETE FROM push_subscriptions WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
}));

// Lets someone check the alert actually reaches their phone
router.post('/test', wrap(async (req, res) => {
  const r = await push.sendToUsers([req.user.id], {
    title: 'Waka Bonny alerts are on',
    body: 'This is what a Waka Bonny alert looks like.',
    url: '/', tag: 'test'
  });
  if (!r.sent) throw bad('No alert could be delivered to this phone. Switch alerts off and on again.');
  res.json({ ok: true, sent: r.sent });
}));

module.exports = router;
