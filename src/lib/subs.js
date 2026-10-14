// Weekly driver subscriptions. Only enforced when admin sets a weekly_subscription amount above 0.
const { q } = require('./db');
const { getSettings } = require('./fares');
const { HttpError } = require('./util');

// subscription_mode: 'free' = launch campaign (drivers never pay), 'on' = weekly subscription enforced
async function subSettings() {
  const s = await getSettings();
  return {
    mode: s.subscription_mode === 'on' ? 'on' : 'free',
    campaignEnd: s.campaign_end || null,
    amount: Number(s.weekly_subscription || 0),
    trialDays: Number(s.subscription_trial_days ?? 7)
  };
}

// Returns { required, amount, paid_until, active, auto }
async function subState(driverRow) {
  const { mode, campaignEnd, amount, trialDays } = await subSettings();
  if (mode !== 'on' || !(amount > 0)) return { required: false, campaign: mode !== 'on', campaign_end: campaignEnd, amount: 0, active: true, paid_until: driverRow.sub_paid_until, auto: driverRow.sub_auto };
  let until = driverRow.sub_paid_until;
  if (!until) {
    // First time a subscription applies to this driver: start their free trial
    until = (await q(`UPDATE drivers SET sub_paid_until = now() + ($1 || ' days')::interval WHERE user_id=$2 AND sub_paid_until IS NULL RETURNING sub_paid_until`,
      [String(trialDays), driverRow.user_id])).rows[0]?.sub_paid_until || new Date();
  }
  return { required: true, amount, paid_until: until, active: new Date(until) > new Date(), auto: driverRow.sub_auto };
}

async function requireActiveSub(driverRow) {
  const s = await subState(driverRow);
  if (!s.active) throw new HttpError(402, `Your weekly subscription (₦${s.amount.toLocaleString('en-NG')}) has expired. Renew it on your Work screen to take trips again.`);
  return s;
}

async function extendWeeks(userId, weeks = 1) {
  const r = (await q(`UPDATE drivers SET sub_paid_until = GREATEST(COALESCE(sub_paid_until, now()), now()) + ($1 || ' days')::interval
      WHERE user_id=$2 RETURNING sub_paid_until`, [String(7 * weeks), userId])).rows[0];
  return r?.sub_paid_until;
}

// Called when the owner switches from the free campaign to weekly subscriptions:
// every driver gets the free trial counted from today, so nobody is locked out suddenly.
async function startSubscriptionsForAll() {
  const { trialDays } = await subSettings();
  const r = await q(`UPDATE drivers SET sub_paid_until = now() + ($1 || ' days')::interval
      WHERE sub_paid_until IS NULL OR sub_paid_until < now() + ($1 || ' days')::interval RETURNING user_id`, [String(trialDays)]);
  return r.rowCount;
}

// Once a day: warn drivers whose week runs out in the next 2 days, and tell those
// whose week has just run out. sub_warned_at stops the same driver being told twice.
async function remindExpiring() {
  const { mode, amount } = await subSettings();
  if (mode !== 'on' || !(amount > 0)) return { soon: 0, expired: 0 };
  const push = require('./push');
  if (!push.enabled()) return { soon: 0, expired: 0 };
  const rows = (await q(`SELECT d.user_id, d.sub_paid_until, d.sub_auto, (d.sub_paid_until < now()) AS expired
      FROM drivers d JOIN users u ON u.id=d.user_id
      WHERE d.status='approved' AND u.deleted_at IS NULL AND u.banned_at IS NULL
        AND NOT d.sub_auto AND d.sub_paid_until IS NOT NULL
        AND d.sub_paid_until < now() + interval '2 days'
        AND (d.sub_warned_at IS NULL OR d.sub_warned_at < d.sub_paid_until - interval '2 days')`)).rows;
  const money = '₦' + amount.toLocaleString('en-NG');
  let soon = 0, expired = 0;
  for (const r of rows) {
    if (r.expired) { expired++; push.notify([r.user_id], { title: 'Your subscription has expired', body: `Renew your ${money} weekly subscription to go back online and take trips.`, url: '/?v=driver', tag: 'sub', sticky: true }); }
    else { soon++; push.notify([r.user_id], { title: 'Your week is almost up', body: `Renew your ${money} weekly subscription so you can keep taking trips.`, url: '/?v=driver', tag: 'sub' }); }
    await q('UPDATE drivers SET sub_warned_at=now() WHERE user_id=$1', [r.user_id]);
  }
  return { soon, expired };
}

module.exports = { subState, requireActiveSub, extendWeeks, subSettings, startSubscriptionsForAll, remindExpiring };
