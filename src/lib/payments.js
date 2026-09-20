// Applies a successful Paystack payment exactly once (safe to call from both the callback check and the webhook)
const { q, tx } = require('./db');
const { extendWeeks } = require('./subs');

const HELD_OR_TAKEN = `(b.status IN ('booked','boarded') OR (b.status='held' AND b.hold_until > now()))`;

async function applyPayment(ref, ps) {
  const p = (await q('SELECT * FROM payments WHERE ref=$1', [ref])).rows[0];
  if (!p) return { ok: false, reason: 'unknown reference' };
  if (p.status === 'success') return { ok: true, payment: p, already: true };
  if (!ps || ps.status !== 'success') {
    if (ps && ['failed', 'reversed'].includes(ps.status)) await q(`UPDATE payments SET status='failed' WHERE id=$1 AND status='pending'`, [p.id]);
    return { ok: false, payment: p, reason: ps?.status || 'not paid' };
  }
  if (Number(ps.amount) < p.amount * 100) { console.error('Paystack amount mismatch', ref, ps.amount, p.amount); return { ok: false, payment: p, reason: 'amount mismatch' }; }

  // Mark the payment first; the WHERE clause makes concurrent callers no-ops
  const won = (await q(`UPDATE payments SET status='success', paid_at=now(), channel=$2 WHERE id=$1 AND status<>'success' RETURNING id`, [p.id, ps.channel || null])).rows[0];
  if (!won) return { ok: true, payment: p, already: true };

  if (p.kind === 'ride') {
    await q(`UPDATE rides SET pay_method='paystack', paid_at=now() WHERE id=$1 AND paid_at IS NULL`, [p.ride_id]);
  } else if (p.kind === 'seat') {
    await tx(async (c) => {
      const b = (await c.query('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [p.booking_id])).rows[0];
      if (!b) return;
      if (['held', 'booked', 'boarded'].includes(b.status)) {
        await c.query(`UPDATE bookings SET paid=true, status=CASE WHEN status='held' THEN 'booked' ELSE status END, hold_until=NULL WHERE id=$1`, [b.id]);
      } else {
        // Hold expired before payment finished: re-book if seats remain, otherwise flag for refund
        const dp = (await c.query('SELECT * FROM departures WHERE id=$1 FOR UPDATE', [b.departure_id])).rows[0];
        const taken = (await c.query(`SELECT COALESCE(sum(seats),0)::int n FROM bookings b WHERE b.departure_id=$1 AND ${HELD_OR_TAKEN}`, [b.departure_id])).rows[0].n;
        if (dp && ['scheduled', 'boarding'].includes(dp.status) && taken + b.seats <= dp.seats_total)
          await c.query(`UPDATE bookings SET paid=true, status='booked', hold_until=NULL WHERE id=$1`, [b.id]);
        else { await c.query(`UPDATE bookings SET paid=true WHERE id=$1`, [b.id]); console.error('REFUND NEEDED: paid booking could not be seated', b.ref); }
      }
    });
  } else if (p.kind === 'sub_week') {
    await extendWeeks(p.user_id, 1);
  } else if (p.kind === 'sub_auto') {
    await extendWeeks(p.user_id, 1);
    await q('UPDATE drivers SET sub_auto=true WHERE user_id=$1', [p.user_id]);
  }
  return { ok: true, payment: p };
}

module.exports = { applyPayment, HELD_OR_TAKEN };
