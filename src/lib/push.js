// Push notifications through the browser (Web Push / VAPID).
// Works in the installed app on Android, and on iPhone once the app is added to the Home Screen.
// Nothing here throws: a phone that has uninstalled the app or revoked permission is just dropped.
const webpush = require('web-push');
const { q } = require('./db');

let ready = false;
function init() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!ready) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@wakabonny.ng', pub, priv);
    ready = true;
  }
  return true;
}
const enabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

// payload: { title, body, url, tag, renotify }
async function sendToUsers(userIds, payload) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
  if (!ids.length || !init()) return { sent: 0, dropped: 0 };
  // A suspended or deleted account never gets an alert, whoever asked for one
  const subs = (await q(`SELECT s.* FROM push_subscriptions s JOIN users u ON u.id=s.user_id
    WHERE s.user_id = ANY($1) AND u.deleted_at IS NULL AND u.banned_at IS NULL`, [ids])).rows;
  if (!subs.length) return { sent: 0, dropped: 0 };
  const body = JSON.stringify({ icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', ...payload });
  let sent = 0, dropped = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 300, urgency: 'high' });
      sent++;
      await q('UPDATE push_subscriptions SET last_sent_at=now(), failures=0 WHERE id=$1', [s.id]);
    } catch (e) {
      const code = e.statusCode;
      if (code === 404 || code === 410) { await q('DELETE FROM push_subscriptions WHERE id=$1', [s.id]); dropped++; }
      else {
        // A temporary failure; drop the device after it has failed repeatedly
        const n = (await q('UPDATE push_subscriptions SET failures=failures+1 WHERE id=$1 RETURNING failures', [s.id])).rows[0];
        if (n && n.failures >= 10) { await q('DELETE FROM push_subscriptions WHERE id=$1', [s.id]); dropped++; }
        console.error('Push failed:', code || e.message);
      }
    }
  }));
  return { sent, dropped };
}

// Fire-and-forget: a notification must never slow down or break the thing that triggered it
const notify = (userIds, payload) => { sendToUsers(userIds, payload).catch(e => console.error('Push error:', e.message)); };

// Everyone who should hear about a safety alert
async function admins() {
  return (await q(`SELECT id FROM users WHERE role='admin' AND deleted_at IS NULL`)).rows.map(r => r.id);
}

// Online, approved drivers of a vehicle type who are free right now
async function freeDrivers(vehicleType) {
  return (await q(`SELECT d.user_id FROM drivers d JOIN users u ON u.id=d.user_id
    WHERE u.deleted_at IS NULL AND u.banned_at IS NULL
      AND d.status='approved' AND d.online AND d.vehicle_type=$1 AND d.last_seen > now() - interval '10 minutes'
      AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.driver_id=d.user_id AND r.status IN ('accepted','arrived','started'))
      AND NOT EXISTS (SELECT 1 FROM runs rn WHERE rn.driver_id=d.user_id AND rn.status IN ('accepted','picked_up'))`,
    [vehicleType])).rows.map(r => r.user_id);
}

// The staff of one depot
async function depotAgents(depotId) {
  return (await q(`SELECT id FROM users WHERE depot_id=$1 AND role='agent' AND deleted_at IS NULL`, [depotId])).rows.map(r => r.id);
}

module.exports = { enabled, publicKey, sendToUsers, notify, admins, freeDrivers, depotAgents };
