// Weekly driver subscriptions. Only enforced when admin sets a weekly_subscription amount above 0.
const { q } = require('./db');
const { getSettings } = require('./fares');
const { HttpError } = require('./util');

async function subSettings() {
  const s = await getSettings();
  return { amount: Number(s.weekly_subscription || 0), trialDays: Number(s.subscription_trial_days ?? 7) };
}

// Returns { required, amount, paid_until, active, auto }
async function subState(driverRow) {
  const { amount, trialDays } = await subSettings();
  if (!(amount > 0)) return { required: false, amount: 0, active: true, paid_until: driverRow.sub_paid_until, auto: driverRow.sub_auto };
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

module.exports = { subState, requireActiveSub, extendWeeks, subSettings };
