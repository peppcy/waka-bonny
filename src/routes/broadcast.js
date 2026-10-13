// Send one SMS to a whole group from the Desk: drivers, agents or customers.
const router = require('express').Router();
const { q } = require('../lib/db');
const { auth } = require('../lib/auth');
const { sendSms, provider } = require('../lib/sms');
const { wrap, bad, int, clean, HttpError } = require('../lib/util');

router.use(auth('admin'));

// Each audience is a WHERE clause over users (+ drivers where needed)
const AUDIENCES = {
  drivers_all: { label: 'All drivers', sql: `u.role='driver'` },
  drivers_approved: { label: 'Approved drivers', sql: `u.role='driver' AND d.status='approved'` },
  drivers_pending: { label: 'Drivers waiting for verification', sql: `u.role='driver' AND d.status='pending'` },
  drivers_no_bank: { label: 'Approved drivers with no bank account', sql: `u.role='driver' AND d.status='approved' AND d.account_number IS NULL` },
  drivers_expired: { label: 'Drivers whose subscription has expired', sql: `u.role='driver' AND d.status='approved' AND d.sub_paid_until IS NOT NULL AND d.sub_paid_until < now()` },
  agents: { label: 'Depot agents', sql: `u.role='agent'` },
  customers: { label: 'Customers (passengers)', sql: `u.role='passenger'` },
  everyone: { label: 'Everyone with an account', sql: `u.role <> 'admin'` }
};
const recipientsSql = (key) => `SELECT u.id, u.name, u.phone FROM users u LEFT JOIN drivers d ON d.user_id=u.id
  WHERE u.deleted_at IS NULL AND u.banned_at IS NULL AND (${AUDIENCES[key].sql}) ORDER BY u.id`;

// One SMS is 160 plain characters; accents and emoji cut that to 70, so the Desk warns about cost
const segments = (text) => {
  const unicode = /[^\x00-\x7F]/.test(text);
  const per = unicode ? 70 : 160, multi = unicode ? 67 : 153;
  return text.length <= per ? 1 : Math.ceil(text.length / multi);
};

router.get('/', wrap(async (req, res) => {
  const counts = {};
  for (const [key, a] of Object.entries(AUDIENCES)) {
    counts[key] = { label: a.label, count: (await q(`SELECT count(*)::int n FROM (${recipientsSql(key)}) t`)).rows[0].n };
  }
  const history = (await q(`SELECT b.*, u.name AS admin_name FROM broadcasts b LEFT JOIN users u ON u.id=b.admin_id
    ORDER BY b.id DESC LIMIT 20`)).rows;
  res.json({ audiences: counts, history, sms_provider: provider(), live: provider() !== 'console' });
}));

router.post('/', wrap(async (req, res) => {
  const key = req.body?.audience;
  if (!AUDIENCES[key]) throw bad('Choose who the message goes to.');
  const message = clean(req.body?.message, 480);
  if (!message) throw bad('Write the message first.');
  if (message.length < 10) throw bad('That message is too short to be useful.');
  const people = (await q(recipientsSql(key))).rows;
  if (!people.length) throw bad('Nobody is in that group yet.');
  // The Desk shows the recipient count first; this guards against the list changing in between
  const expected = int(req.body?.expect_recipients);
  if (expected != null && Math.abs(expected - people.length) > Math.max(5, people.length * 0.2))
    throw bad(`That group now has ${people.length} people, not ${expected}. Check the number and send again.`);

  const b = (await q(`INSERT INTO broadcasts(admin_id, audience, message, recipients) VALUES($1,$2,$3,$4) RETURNING *`,
    [req.user.id, key, message, people.length])).rows[0];
  res.json({ broadcast: b, segments: segments(message) });

  // Sent in the background, a few at a time, so the Desk never waits on the SMS provider
  (async () => {
    let sent = 0, failed = 0;
    for (let i = 0; i < people.length; i += 5) {
      const batch = people.slice(i, i + 5);
      // sendSms returns false in test mode (nothing to deliver to) but only throws on a real
      // provider failure, so only a thrown error counts as failed.
      const out = await Promise.all(batch.map(p => sendSms(p.phone, message).then(() => true).catch(() => false)));
      out.forEach(delivered => delivered ? sent++ : failed++);
      await q(`UPDATE broadcasts SET sent=$1, failed=$2 WHERE id=$3`, [sent, failed, b.id]);
      if (i + 5 < people.length) await new Promise(r => setTimeout(r, 400));
    }
    await q(`UPDATE broadcasts SET status=$1, finished_at=now(), sent=$2, failed=$3 WHERE id=$4`,
      [failed && !sent ? 'failed' : 'done', sent, failed, b.id]);
  })().catch(e => console.error('Broadcast failed:', e));
}));

router.get('/:id', wrap(async (req, res) => {
  const b = (await q('SELECT * FROM broadcasts WHERE id=$1', [int(req.params.id)])).rows[0];
  if (!b) throw new HttpError(404, 'Message not found.');
  res.json({ broadcast: b });
}));

module.exports = router;
