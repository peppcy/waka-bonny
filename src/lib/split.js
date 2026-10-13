// Paystack split payments: when a customer pays online, the driver's share goes straight to their
// bank account and the platform's commission to Cylan Metro. No manual payouts.
//
// On Paystack, a subaccount's `percentage_charge` is the share the MAIN (platform) account keeps;
// the rest settles to the subaccount's bank. `bearer` decides who pays Paystack's own transaction fee.
const { q } = require('./db');
const ps = require('./paystack');
const { getSettings } = require('./fares');

async function splitSettings() {
  const s = await getSettings();
  const pct = Number(s.platform_commission_pct || 0);
  return {
    pct: Math.min(Math.max(Number.isFinite(pct) ? pct : 0, 0), 100),
    // 'driver' = the driver's share covers Paystack's fee; 'platform' = Cylan Metro pays it
    bearer: s.paystack_fee_bearer === 'platform' ? 'platform' : 'driver'
  };
}

// Creates the driver's subaccount, or updates it when their bank account or the commission changed.
// Never throws: a split that can't be set up just means that driver is paid the old way.
async function ensureSubaccount(userId, { force = false } = {}) {
  if (!ps.enabled()) return null;
  const d = (await q(`SELECT d.*, u.name, u.phone FROM drivers d JOIN users u ON u.id=d.user_id WHERE d.user_id=$1`, [userId])).rows[0];
  if (!d || !d.account_number || !d.bank_code || !d.account_verified) return null;
  const { pct } = await splitSettings();
  if (d.subaccount_code && !force && Number(d.subaccount_pct) === pct) return d.subaccount_code;
  try {
    const args = { businessName: `${d.name} (${d.plate})`, bankCode: d.bank_code, accountNumber: d.account_number, percentage: pct, phone: d.phone };
    const out = d.subaccount_code ? await ps.updateSubaccount(d.subaccount_code, args) : await ps.createSubaccount(args);
    const code = out.subaccount_code || d.subaccount_code;
    await q(`UPDATE drivers SET subaccount_code=$1, subaccount_pct=$2, subaccount_at=now() WHERE user_id=$3`, [code, pct, userId]);
    return code;
  } catch (e) {
    console.error('Paystack subaccount setup failed for driver', userId, e.message);
    return null;
  }
}

// What to pass to Paystack for a payment that belongs to this driver
async function splitFor(driverId) {
  if (!driverId || !ps.enabled()) return null;
  const code = await ensureSubaccount(driverId);
  if (!code) return null;
  const { pct, bearer } = await splitSettings();
  return { subaccount: code, bearer: bearer === 'driver' ? 'subaccount' : 'account', pct };
}

// Called when the commission changes: bring every driver's subaccount in line
async function resyncAll() {
  const rows = (await q(`SELECT user_id FROM drivers WHERE subaccount_code IS NOT NULL`)).rows;
  let ok = 0;
  for (const r of rows) if (await ensureSubaccount(r.user_id, { force: true })) ok++;
  return { updated: ok, total: rows.length };
}

module.exports = { splitSettings, ensureSubaccount, splitFor, resyncAll };
