// Depot agent: register arriving packages, hand them over at the depot, send them out on delivery runs, settle cash.
const router = require('express').Router();
const { q, tx } = require('../lib/db');
const { auth } = require('../lib/auth');
const { wrap, bad, int, clean, normalizePhone, HttpError } = require('../lib/util');
const P = require('../lib/packages');

router.use(auth('agent', 'admin'));

// Agents work for one depot; admins can act for any depot with ?depot=ID
router.use(wrap(async (req, res, next) => {
  const u = (await q('SELECT depot_id FROM users WHERE id=$1', [req.user.id])).rows[0];
  const id = req.user.role === 'admin' ? int(req.query.depot || req.body?.depot_id) || u.depot_id : u.depot_id;
  const d = id && (await q('SELECT * FROM depots WHERE id=$1', [id])).rows[0];
  if (!d) throw new HttpError(403, req.user.role === 'admin' ? 'Choose a depot.' : 'Your account is not linked to a depot. Ask the Waka Bonny team.');
  if (!d.active) throw new HttpError(403, 'This depot is not active.');
  req.depot = d;
  next();
}));

const PKG_SELECT = `SELECT p.*, z.name AS zone_name FROM packages p LEFT JOIN zones z ON z.id=p.zone_id`;
async function pkg(req) {
  const p = (await q(`${PKG_SELECT} WHERE p.id=$1 AND p.depot_id=$2`, [int(req.params.id), req.depot.id])).rows[0];
  if (!p) throw new HttpError(404, 'Package not found.');
  return p;
}

router.get('/me', wrap(async (req, res) => {
  const counts = (await q(`SELECT
      count(*) FILTER (WHERE status='at_depot')::int AS at_depot,
      count(*) FILTER (WHERE status='delivery_requested')::int AS delivery_requested,
      count(*) FILTER (WHERE status IN ('assigned','out_for_delivery'))::int AS out,
      count(*) FILTER (WHERE status='returned')::int AS returned,
      count(*) FILTER (WHERE status IN ('collected','delivered') AND (handed_at AT TIME ZONE 'Africa/Lagos')::date=(now() AT TIME ZONE 'Africa/Lagos')::date)::int AS done_today
    FROM packages WHERE depot_id=$1`, [req.depot.id])).rows[0];
  const cash = (await q(`SELECT COALESCE(sum(cash_due),0)::int AS due FROM runs WHERE depot_id=$1 AND status='done' AND remitted_at IS NULL`, [req.depot.id])).rows[0].due;
  res.json({ depot: req.depot, counts, cash_due_from_drivers: cash });
}));

// ---- Register packages ----
async function createOne(req, row) {
  const name = clean(row.recipient_name, 80), phone = normalizePhone(row.recipient_phone);
  if (!name) throw bad('Recipient name is missing.');
  if (!phone) throw bad(`Phone number "${row.recipient_phone || ''}" is not a valid Nigerian number.`);
  const charge = row.charge === '' || row.charge == null ? 0 : int(String(row.charge).replace(/[,₦\s]/g, ''));
  if (charge == null || charge < 0 || charge > 5000000) throw bad('Charge must be a whole naira amount.');
  const qty = int(row.qty) || 1;
  const p = (await q(`INSERT INTO packages(ref, token, depot_id, recipient_name, recipient_phone, description, qty, charge, code, created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [P.newRef(), P.newToken(), req.depot.id, name, phone, clean(row.description, 200), Math.min(Math.max(qty, 1), 999), charge, P.newCode(), req.user.id])).rows[0];
  P.arrivalSms(req, p, req.depot);
  return p;
}

router.post('/packages', wrap(async (req, res) => res.json({ package: await createOne(req, req.body || {}) })));

// Bulk: rows parsed by the app from a pasted list ("Name, Phone, Item, Charge")
router.post('/packages/bulk', wrap(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 300) : [];
  if (!rows.length) throw bad('Nothing to add.');
  const created = [], errors = [];
  for (const [i, row] of rows.entries()) {
    try { created.push(await createOne(req, row)); }
    catch (e) { errors.push({ line: row.line || i + 1, error: e.message }); }
  }
  res.json({ created: created.length, errors });
}));

router.get('/packages', wrap(async (req, res) => {
  const status = req.query.status;
  const search = clean(req.query.q, 60);
  const digits = search ? search.replace(/\D/g, '') : '';
  const phoneLike = digits.length >= 4 ? '%' + (digits.startsWith('0') ? digits.slice(1) : digits) + '%' : null;
  const rows = (await q(`${PKG_SELECT} WHERE p.depot_id=$1
      AND ($2::text IS NULL OR p.status = ANY(string_to_array($2, ',')))
      AND ($3::text IS NULL OR p.recipient_name ILIKE '%'||$3||'%' OR upper(p.ref)=upper($3) OR ($4::text IS NOT NULL AND p.recipient_phone LIKE $4))
      ORDER BY p.id DESC LIMIT 300`, [req.depot.id, status || null, search, phoneLike])).rows;
  rows.forEach(r => { delete r.code; delete r.token; });
  res.json({ packages: rows });
}));

router.put('/packages/:id', wrap(async (req, res) => {
  const p = await pkg(req);
  if (!['at_depot', 'delivery_requested', 'returned'].includes(p.status)) throw bad('This package is out for delivery or already handed over.');
  const b = req.body || {};
  const money = (v, cur) => v === undefined ? cur : v === '' || v == null ? null : int(String(v).replace(/[,₦\s]/g, ''));
  await q(`UPDATE packages SET description=COALESCE($1, description), charge=COALESCE($2, charge), delivery_fee=$3, updated_at=now() WHERE id=$4`,
    [clean(b.description, 200), money(b.charge, p.charge), money(b.delivery_fee, p.delivery_fee), p.id]);
  res.json({ ok: true });
}));

router.post('/packages/:id/resend', wrap(async (req, res) => {
  const p = await pkg(req);
  if (['collected', 'delivered'].includes(p.status)) throw bad('This package has already been handed over.');
  const sent = await P.arrivalSms(req, p, req.depot);
  res.json({ ok: true, sent });
}));

// Hand over at the depot: pickup code from the SMS, or ID checked with a written reason
router.post('/packages/:id/handover', wrap(async (req, res) => {
  const p = await pkg(req);
  if (!['at_depot', 'delivery_requested', 'returned'].includes(p.status)) throw bad(p.status === 'collected' || p.status === 'delivered' ? 'Already handed over.' : 'This package is out on a delivery run.');
  const given = String(req.body?.code || '').replace(/\D/g, '');
  const override = clean(req.body?.override_reason, 200);
  if (given) { if (given !== p.code) throw bad('Wrong pickup code. Check the SMS on the recipient\'s phone.'); }
  else if (!override) throw bad('Enter the pickup code, or check their ID and write why you are handing over without a code.');
  const method = ['cash', 'transfer', 'prepaid'].includes(req.body?.pay_method) ? req.body.pay_method : (p.charge > 0 ? null : 'prepaid');
  if (!method) throw bad('Choose how the charge was paid.');
  await q(`UPDATE packages SET status='collected', pay_method=$1, collected_amount=$2, handed_at=now(), handover_note=$3, updated_at=now() WHERE id=$4`,
    [method, method === 'prepaid' ? 0 : p.charge, override ? `No code: ${override} (by ${req.user.name})` : `Code checked by ${req.user.name}`, p.id]);
  res.json({ ok: true });
}));

// Agent books delivery for the recipient (e.g. they phoned in)
router.post('/packages/:id/delivery', wrap(async (req, res) => {
  const p = await pkg(req);
  if (!['at_depot', 'delivery_requested', 'returned'].includes(p.status)) throw bad('This package cannot be sent for delivery now.');
  const zone = int(req.body?.zone_id);
  if (!zone) throw bad('Choose the delivery area.');
  const fee = req.body?.delivery_fee !== undefined && req.body.delivery_fee !== '' ? int(req.body.delivery_fee) : await P.deliveryQuote(req.depot.zone_id, zone);
  if (fee == null) throw bad('No fare is set from this depot to that area yet. Enter a delivery fee.');
  await q(`UPDATE packages SET status='delivery_requested', zone_id=$1, address=COALESCE($2, address), delivery_fee=$3, updated_at=now() WHERE id=$4`,
    [zone, clean(req.body?.address, 200), fee, p.id]);
  res.json({ ok: true, delivery_fee: fee });
}));

router.post('/packages/:id/keep', wrap(async (req, res) => {
  const p = await pkg(req);
  if (!['delivery_requested', 'returned'].includes(p.status)) throw bad('Nothing to change.');
  await q(`UPDATE packages SET status='at_depot', run_id=NULL, updated_at=now() WHERE id=$1`, [p.id]);
  res.json({ ok: true });
}));

// ---- Delivery runs ----
router.post('/runs', wrap(async (req, res) => {
  const ids = (Array.isArray(req.body?.package_ids) ? req.body.package_ids : []).map(int).filter(Boolean);
  const type = ['keke', 'okada', 'taxi'].includes(req.body?.vehicle_type) ? req.body.vehicle_type : null;
  if (!ids.length) throw bad('Select the packages for this run.');
  if (!type) throw bad('Choose the vehicle type for this run.');
  if (ids.length > 40) throw bad('A run can carry at most 40 packages.');
  const run = await tx(async (c) => {
    const pk = (await c.query(`SELECT * FROM packages WHERE id = ANY($1) AND depot_id=$2 FOR UPDATE`, [ids, req.depot.id])).rows;
    if (pk.length !== ids.length) throw bad('Some packages were not found.');
    const gone = pk.find(p => ['collected', 'delivered', 'assigned', 'out_for_delivery'].includes(p.status));
    if (gone) throw bad(`${gone.ref} (${gone.recipient_name}) is ${gone.status === 'collected' || gone.status === 'delivered' ? 'already handed over' : 'already on another run'}.`);
    const bad1 = pk.find(p => p.status !== 'delivery_requested' || !p.zone_id || p.delivery_fee == null);
    if (bad1) throw bad(`${bad1.ref} (${bad1.recipient_name}) is not ready: it needs a delivery area and fee.`);
    const r = (await c.query(`INSERT INTO runs(depot_id, vehicle_type, fee_total, cash_due, created_by) VALUES($1,$2,$3,0,$4) RETURNING *`,
      [req.depot.id, type, pk.reduce((a, p) => a + p.delivery_fee, 0), req.user.id])).rows[0];
    await c.query(`UPDATE packages SET status='assigned', run_id=$1, updated_at=now() WHERE id = ANY($2)`, [r.id, ids]);
    return r;
  });
  res.json({ run });
}));

router.get('/runs', wrap(async (req, res) => {
  const runs = (await q(`SELECT r.*, u.name AS driver_name, u.phone AS driver_phone, d.plate,
      (SELECT json_agg(json_build_object('id',p.id,'ref',p.ref,'recipient_name',p.recipient_name,'status',p.status,'charge',p.charge,
          'delivery_fee',p.delivery_fee,'zone_name',z.name,'pay_method',p.pay_method,'fail_reason',p.fail_reason) ORDER BY p.id)
        FROM packages p LEFT JOIN zones z ON z.id=p.zone_id WHERE p.run_id=r.id) AS packages
    FROM runs r LEFT JOIN users u ON u.id=r.driver_id LEFT JOIN drivers d ON d.user_id=r.driver_id
    WHERE r.depot_id=$1 AND (r.status IN ('open','accepted','picked_up') OR r.remitted_at IS NULL OR r.created_at > now() - interval '3 days')
    ORDER BY r.id DESC LIMIT 50`, [req.depot.id])).rows;
  res.json({ runs });
}));

async function ownRun(req) {
  const r = (await q('SELECT * FROM runs WHERE id=$1 AND depot_id=$2', [int(req.params.id), req.depot.id])).rows[0];
  if (!r) throw new HttpError(404, 'Run not found.');
  return r;
}

router.post('/runs/:id/cancel', wrap(async (req, res) => {
  const r = await ownRun(req);
  if (!['open', 'accepted'].includes(r.status)) throw bad('This run has already been picked up. The driver must finish it.');
  await tx(async (c) => {
    await c.query(`UPDATE runs SET status='cancelled' WHERE id=$1`, [r.id]);
    await c.query(`UPDATE packages SET status='delivery_requested', run_id=NULL, updated_at=now() WHERE run_id=$1 AND status='assigned'`, [r.id]);
  });
  res.json({ ok: true });
}));

// Undelivered packages physically back at the depot
router.post('/runs/:id/returns', wrap(async (req, res) => {
  const r = await ownRun(req);
  if (r.status !== 'done') throw bad('The run is not finished yet.');
  const n = (await q(`UPDATE packages SET status='at_depot', run_id=NULL, updated_at=now() WHERE run_id=$1 AND status='returned' RETURNING id`, [r.id])).rowCount;
  await q(`UPDATE runs SET returns_received_at=now() WHERE id=$1`, [r.id]);
  res.json({ ok: true, returned: n });
}));

// Driver handed over the logistics charges they collected
router.post('/runs/:id/remit', wrap(async (req, res) => {
  const r = await ownRun(req);
  if (r.status !== 'done') throw bad('The run is not finished yet.');
  if (r.remitted_at) throw bad('Already marked as received.');
  await q(`UPDATE runs SET remitted_at=now(), remitted_by=$1 WHERE id=$2`, [req.user.id, r.id]);
  res.json({ ok: true });
}));

module.exports = router;
