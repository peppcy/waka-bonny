// The four reports the Desk can download as Excel workbooks.
// Every figure comes from a query here; nothing is counted in the browser.
const { q } = require('./db');
const { workbook, fileName } = require('./xlsx');

const VEH = { keke: 'Keke', okada: 'Okada', taxi: 'Taxi', bus: 'Bus', sienna: 'Sienna' };
const SERVICE = { ride: 'Ride', parcel: 'Parcel', errand: 'Errand' };
const PAY = { cash: 'Cash', transfer: 'Transfer', paystack: 'Paid online' };
const PKG_STATUS = { at_depot: 'At depot', delivery_requested: 'Delivery requested', assigned: 'On a run',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', collected: 'Collected at depot', returned: 'Returned' };
const local = (p) => p && p.startsWith('234') ? '0' + p.slice(3) : (p || '');
const title = (s) => s ? s[0].toUpperCase() + s.slice(1) : '';

// Dates arrive as YYYY-MM-DD and mean whole days in Lagos, inclusive of the last one.
function range(from, to) {
  const d = /^\d{4}-\d{2}-\d{2}$/;
  if (!d.test(from || '') || !d.test(to || '')) throw Object.assign(new Error('Choose a start and end date.'), { status: 400 });
  if (from > to) throw Object.assign(new Error('The start date is after the end date.'), { status: 400 });
  return { from, to, label: from === to ? from : `${from} to ${to}` };
}
// Compares a timestamp against the Lagos calendar day, so a 00:30 Lagos trip lands on the right date
const DAY = (col) => `(${col} AT TIME ZONE 'Africa/Lagos')::date BETWEEN $1::date AND $2::date`;

// A short sheet that says what the reader is looking at
function aboutSheet(lines) {
  return {
    name: 'About',
    columns: [{ header: 'Item', key: 'k', width: 34, type: 'text' }, { header: 'Value', key: 'v', width: 60, type: 'wrap' }],
    rows: lines.map(([k, v]) => ({ k, v: v == null ? '' : String(v) }))
  };
}
const generated = () => new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' });

// ---------------------------------------------------------------- rides
async function rides({ from, to }) {
  const r = range(from, to);
  const trips = (await q(`SELECT rd.id, rd.created_at, rd.completed_at, rd.service, rd.vehicle_type,
      fz.name AS from_name, tz.name AS to_name, rd.pickup_note, rd.dropoff_note,
      p.name AS passenger, p.phone AS passenger_phone,
      du.name AS driver, du.phone AS driver_phone, d.plate,
      rd.fare, rd.night, rd.street_hail, rd.pay_method, rd.status, rd.cancelled_by, rd.rating,
      rd.item_desc, rd.recipient_name,
      EXTRACT(EPOCH FROM (rd.completed_at - rd.started_at))/60 AS minutes
    FROM rides rd
      JOIN zones fz ON fz.id=rd.from_zone JOIN zones tz ON tz.id=rd.to_zone
      JOIN users p ON p.id=rd.passenger_id
      LEFT JOIN users du ON du.id=rd.driver_id LEFT JOIN drivers d ON d.user_id=rd.driver_id
    WHERE ${DAY('rd.created_at')} ORDER BY rd.created_at`, [r.from, r.to])).rows;

  const daily = (await q(`SELECT (created_at AT TIME ZONE 'Africa/Lagos')::date AS day,
      count(*)::int AS requested,
      count(*) FILTER (WHERE status='completed')::int AS completed,
      count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
      COALESCE(sum(fare) FILTER (WHERE status='completed'),0)::int AS fares,
      COALESCE(sum(fare) FILTER (WHERE status='completed' AND pay_method='paystack'),0)::int AS online,
      COALESCE(sum(fare) FILTER (WHERE status='completed' AND pay_method IN ('cash','transfer')),0)::int AS offline,
      count(*) FILTER (WHERE status='completed' AND service='ride')::int AS ride_jobs,
      count(*) FILTER (WHERE status='completed' AND service='parcel')::int AS parcels,
      count(*) FILTER (WHERE status='completed' AND service='errand')::int AS errands
    FROM rides WHERE ${DAY('created_at')} GROUP BY 1 ORDER BY 1`, [r.from, r.to])).rows;

  const routes = (await q(`SELECT fz.name AS from_name, tz.name AS to_name, rd.vehicle_type,
      count(*)::int AS trips, COALESCE(sum(rd.fare),0)::int AS fares, round(avg(rd.fare))::int AS avg_fare
    FROM rides rd JOIN zones fz ON fz.id=rd.from_zone JOIN zones tz ON tz.id=rd.to_zone
    WHERE rd.status='completed' AND ${DAY('rd.created_at')}
    GROUP BY 1,2,3 ORDER BY trips DESC, fares DESC`, [r.from, r.to])).rows;

  const done = trips.filter(t => t.status === 'completed');
  const cancelled = trips.filter(t => t.status === 'cancelled');
  const rated = done.filter(t => t.rating);
  const money = done.reduce((a, t) => a + t.fare, 0);

  const sheets = [
    {
      name: 'Trips',
      columns: [
        { header: 'Trip #', key: 'id', width: 9, type: 'int' },
        { header: 'Requested', key: 'created_at', width: 19, type: 'datetime' },
        { header: 'Finished', key: 'completed_at', width: 19, type: 'datetime' },
        { header: 'Service', key: 'service_label', width: 11, type: 'text', total: 'label' },
        { header: 'Vehicle', key: 'vehicle_label', width: 10, type: 'text' },
        { header: 'From', key: 'from_name', width: 20, type: 'text' },
        { header: 'To', key: 'to_name', width: 20, type: 'text' },
        { header: 'Passenger', key: 'passenger', width: 20, type: 'text' },
        { header: 'Passenger phone', key: 'passenger_phone_local', width: 15, type: 'text' },
        { header: 'Driver', key: 'driver', width: 20, type: 'text' },
        { header: 'Plate', key: 'plate', width: 12, type: 'text' },
        { header: 'Fare', key: 'fare', width: 12, type: 'naira', total: 'sum' },
        { header: 'Payment', key: 'pay_label', width: 13, type: 'text' },
        { header: 'Status', key: 'status_label', width: 14, type: 'text' },
        { header: 'Minutes', key: 'minutes_r', width: 9, type: 'int', total: 'avg' },
        { header: 'Night', key: 'night', width: 7, type: 'bool' },
        { header: 'Street hail', key: 'street_hail', width: 10, type: 'bool' },
        { header: 'Rating', key: 'rating', width: 8, type: 'int', total: 'avg' },
        { header: 'Item / errand', key: 'item_desc', width: 28, type: 'wrap' },
        { header: 'Recipient', key: 'recipient_name', width: 18, type: 'text' },
        { header: 'Pickup note', key: 'pickup_note', width: 24, type: 'wrap' },
        { header: 'Drop-off note', key: 'dropoff_note', width: 24, type: 'wrap' }
      ],
      rows: trips.map(t => ({
        ...t,
        service_label: SERVICE[t.service] || t.service,
        vehicle_label: VEH[t.vehicle_type] || t.vehicle_type,
        passenger_phone_local: local(t.passenger_phone),
        pay_label: t.status === 'completed' ? (PAY[t.pay_method] || 'Not recorded') : '',
        status_label: t.status === 'cancelled' && t.cancelled_by ? `Cancelled (${t.cancelled_by})` : title(t.status),
        minutes_r: t.minutes == null ? null : Math.round(t.minutes)
      }))
    },
    {
      name: 'Day by day',
      columns: [
        { header: 'Date', key: 'day', width: 14, type: 'date', total: 'label' },
        { header: 'Requested', key: 'requested', width: 12, type: 'int', total: 'sum' },
        { header: 'Completed', key: 'completed', width: 12, type: 'int', total: 'sum' },
        { header: 'Cancelled', key: 'cancelled', width: 12, type: 'int', total: 'sum' },
        { header: 'Rides', key: 'ride_jobs', width: 10, type: 'int', total: 'sum' },
        { header: 'Parcels', key: 'parcels', width: 10, type: 'int', total: 'sum' },
        { header: 'Errands', key: 'errands', width: 10, type: 'int', total: 'sum' },
        { header: 'Fares', key: 'fares', width: 14, type: 'naira', total: 'sum' },
        { header: 'Paid online', key: 'online', width: 14, type: 'naira', total: 'sum' },
        { header: 'Cash / transfer', key: 'offline', width: 15, type: 'naira', total: 'sum' }
      ],
      rows: daily
    },
    {
      name: 'Busiest routes',
      columns: [
        { header: 'From', key: 'from_name', width: 22, type: 'text', total: 'label' },
        { header: 'To', key: 'to_name', width: 22, type: 'text' },
        { header: 'Vehicle', key: 'vehicle_label', width: 10, type: 'text' },
        { header: 'Trips', key: 'trips', width: 10, type: 'int', total: 'sum' },
        { header: 'Fares', key: 'fares', width: 14, type: 'naira', total: 'sum' },
        { header: 'Average fare', key: 'avg_fare', width: 14, type: 'naira' }
      ],
      rows: routes.map(x => ({ ...x, vehicle_label: VEH[x.vehicle_type] || x.vehicle_type }))
    },
    aboutSheet([
      ['Report', 'Rides and deliveries'],
      ['Period', r.label],
      ['Generated', generated() + ' (Lagos time)'],
      ['Trips requested', trips.length],
      ['Completed', done.length],
      ['Cancelled', cancelled.length],
      ['Total fares from completed trips', '₦' + money.toLocaleString('en-NG')],
      ['Average completed fare', done.length ? '₦' + Math.round(money / done.length).toLocaleString('en-NG') : '—'],
      ['Average rating', rated.length ? (rated.reduce((a, t) => a + t.rating, 0) / rated.length).toFixed(2) + ` (from ${rated.length} rated trip(s))` : 'No ratings yet'],
      ['Counted by', 'The day a trip was requested, in Lagos time.'],
      ['Fares', 'Totals cover completed trips only. A cancelled trip keeps its quoted fare in the Trips sheet but is excluded from every total.'],
      ['Minutes', 'From the driver starting the trip to ending it. Blank when a trip never started.']
    ])
  ];
  return { buffer: workbook(sheets, { title: 'Waka Bonny rides' }), name: fileName(['Waka Bonny rides', r.label]) };
}

// ---------------------------------------------------------------- driver earnings
async function drivers({ from, to }) {
  const r = range(from, to);
  const rows = (await q(`SELECT u.id, u.name, u.phone, d.vehicle_type, d.plate, d.permit_no, d.status, d.strikes,
      d.owner_type, d.owner_name, d.bank_name, d.account_number, d.account_name, d.account_verified,
      d.sub_paid_until, d.sub_auto, d.subaccount_code,
      (SELECT count(*) FROM rides x WHERE x.driver_id=u.id AND x.status='completed' AND ${DAY('x.completed_at')})::int AS trips,
      (SELECT COALESCE(sum(fare),0) FROM rides x WHERE x.driver_id=u.id AND x.status='completed' AND ${DAY('x.completed_at')})::int AS fares,
      (SELECT COALESCE(sum(fare),0) FROM rides x WHERE x.driver_id=u.id AND x.status='completed' AND x.pay_method='paystack' AND ${DAY('x.completed_at')})::int AS online,
      (SELECT COALESCE(sum(fare),0) FROM rides x WHERE x.driver_id=u.id AND x.status='completed' AND x.pay_method IN ('cash','transfer') AND ${DAY('x.completed_at')})::int AS offline,
      (SELECT COALESCE(sum(p.commission),0) FROM payments p WHERE p.driver_id=u.id AND p.status='success' AND ${DAY('p.paid_at')})::int AS commission,
      (SELECT COALESCE(sum(fare),0) FROM rides x WHERE x.driver_id=u.id AND x.status='completed' AND x.pay_method='paystack' AND x.payout_at IS NULL)::int AS owed_now,
      (SELECT COALESCE(sum(fee_total),0) FROM runs rn WHERE rn.driver_id=u.id AND rn.status='done' AND ${DAY('rn.done_at')})::int AS run_fees,
      (SELECT count(*) FROM runs rn WHERE rn.driver_id=u.id AND rn.status='done' AND ${DAY('rn.done_at')})::int AS runs_done,
      (SELECT COALESCE(sum(cash_due),0) FROM runs rn WHERE rn.driver_id=u.id AND rn.status='done' AND rn.remitted_at IS NULL)::int AS depot_cash_owed,
      (SELECT round(avg(rating)::numeric,2) FROM rides x WHERE x.driver_id=u.id AND x.rating IS NOT NULL) AS rating,
      (SELECT COALESCE(sum(amount),0) FROM payments p WHERE p.user_id=u.id AND p.kind IN ('sub_auto','sub_week') AND p.status='success' AND ${DAY('p.paid_at')})::int AS subs_paid
    FROM users u JOIN drivers d ON d.user_id=u.id
    WHERE u.deleted_at IS NULL ORDER BY 1`, [r.from, r.to])).rows;

  const active = rows.filter(x => x.trips || x.runs_done);
  const now = new Date();
  const subLabel = (x) => !x.sub_paid_until ? 'No subscription on record'
    : new Date(x.sub_paid_until) > now ? (x.sub_auto ? 'Active (automatic)' : 'Active') : 'Expired';

  const body = rows.map(x => ({
    ...x,
    phone_local: local(x.phone),
    vehicle_label: VEH[x.vehicle_type] || x.vehicle_type,
    status_label: title(x.status),
    owner_label: x.owner_type === 'self' ? 'Drives own vehicle' : (x.owner_name ? `Owner: ${x.owner_name}` : 'Vehicle owner'),
    total_earned: x.fares + x.run_fees,
    net_after_commission: x.fares + x.run_fees - x.commission,
    bank_label: x.bank_name ? `${x.bank_name}${x.account_verified ? '' : ' (not verified)'}` : 'No account added',
    split_label: x.subaccount_code ? 'Yes' : 'No',
    sub_label: subLabel(x),
    rating_n: x.rating == null ? null : Number(x.rating)
  }));

  const sheets = [
    {
      name: 'Earnings',
      columns: [
        { header: 'Driver', key: 'name', width: 22, type: 'text', total: 'label' },
        { header: 'Phone', key: 'phone_local', width: 14, type: 'text' },
        { header: 'Vehicle', key: 'vehicle_label', width: 10, type: 'text' },
        { header: 'Plate', key: 'plate', width: 12, type: 'text' },
        { header: 'Account status', key: 'status_label', width: 13, type: 'text' },
        { header: 'Trips', key: 'trips', width: 9, type: 'int', total: 'sum' },
        { header: 'Trip fares', key: 'fares', width: 14, type: 'naira', total: 'sum' },
        { header: 'Depot runs', key: 'runs_done', width: 11, type: 'int', total: 'sum' },
        { header: 'Run fees', key: 'run_fees', width: 13, type: 'naira', total: 'sum' },
        { header: 'Total earned', key: 'total_earned', width: 14, type: 'naira', total: 'sum' },
        { header: 'Paid online', key: 'online', width: 13, type: 'naira', total: 'sum' },
        { header: 'Cash / transfer', key: 'offline', width: 14, type: 'naira', total: 'sum' },
        { header: 'Commission to platform', key: 'commission', width: 16, type: 'naira', total: 'sum' },
        { header: 'Net after commission', key: 'net_after_commission', width: 16, type: 'naira', total: 'sum' },
        { header: 'Owed to driver now', key: 'owed_now', width: 15, type: 'naira', total: 'sum' },
        { header: 'Depot cash not handed in', key: 'depot_cash_owed', width: 17, type: 'naira', total: 'sum' },
        { header: 'Subscription paid', key: 'subs_paid', width: 14, type: 'naira', total: 'sum' },
        { header: 'Subscription', key: 'sub_label', width: 20, type: 'text' },
        { header: 'Rating', key: 'rating_n', width: 8, type: 'int', total: 'avg' },
        { header: 'Strikes', key: 'strikes', width: 8, type: 'int' },
        { header: 'Bank', key: 'bank_label', width: 24, type: 'text' },
        { header: 'Account number', key: 'account_number', width: 16, type: 'text' },
        { header: 'Account name', key: 'account_name', width: 24, type: 'text' },
        { header: 'Auto split', key: 'split_label', width: 11, type: 'text' },
        { header: 'Vehicle ownership', key: 'owner_label', width: 22, type: 'text' }
      ],
      rows: body
    },
    aboutSheet([
      ['Report', 'Driver earnings'],
      ['Period', r.label],
      ['Generated', generated() + ' (Lagos time)'],
      ['Drivers listed', rows.length],
      ['Drivers who worked in this period', active.length],
      ['Total earned by drivers', '₦' + body.reduce((a, x) => a + x.total_earned, 0).toLocaleString('en-NG')],
      ['Commission to the platform', '₦' + body.reduce((a, x) => a + x.commission, 0).toLocaleString('en-NG')],
      ['Counted by', 'The day a trip was completed, or a depot run finished, in Lagos time.'],
      ['Total earned', 'Trip fares plus depot run fees, before commission.'],
      ['Commission to platform', 'Taken automatically by Paystack out of fares paid online. Cash and transfer fares go straight to the driver, so no commission is taken on them.'],
      ['Owed to driver now', 'Online fares not yet paid out. This is a running figure, not limited to the period above.'],
      ['Depot cash not handed in', 'Package charges a driver collected in cash and has not yet handed to the depot. Also a running figure.'],
      ['Auto split', 'Yes means online fares reach this driver\'s bank automatically at the moment the customer pays. No means the money sits with the platform until you pay them.'],
      ['Every driver is listed', 'Including those who took no work in this period, so you can see who has gone quiet.']
    ])
  ];
  return { buffer: workbook(sheets, { title: 'Waka Bonny driver earnings' }), name: fileName(['Waka Bonny driver earnings', r.label]) };
}

// ---------------------------------------------------------------- depot packages
async function packages({ from, to, depot_id }) {
  const r = range(from, to);
  const depotId = depot_id ? Number(depot_id) : null;
  const only = depotId ? ' AND p.depot_id=$3' : '';
  const args = depotId ? [r.from, r.to, depotId] : [r.from, r.to];

  const pk = (await q(`SELECT p.ref, p.created_at, p.updated_at, p.handed_at, dp.name AS depot,
      p.recipient_name, p.recipient_phone, p.description, p.qty, p.charge, p.delivery_fee,
      z.name AS area, p.address, p.status, p.pay_method, p.collected_amount, p.fail_reason, p.handover_note,
      p.run_id, du.name AS driver, d.plate, ag.name AS registered_by
    FROM packages p JOIN depots dp ON dp.id=p.depot_id
      LEFT JOIN zones z ON z.id=p.zone_id
      LEFT JOIN runs rn ON rn.id=p.run_id
      LEFT JOIN users du ON du.id=rn.driver_id LEFT JOIN drivers d ON d.user_id=rn.driver_id
      LEFT JOIN users ag ON ag.id=p.created_by
    WHERE ${DAY('p.created_at')}${only} ORDER BY p.created_at`, args)).rows;

  const runOnly = depotId ? ' AND rn.depot_id=$3' : '';
  const runs = (await q(`SELECT rn.id, dp.name AS depot, rn.created_at, rn.done_at, rn.vehicle_type, rn.status,
      du.name AS driver, du.phone AS driver_phone, d.plate, rn.fee_total, rn.cash_due, rn.remitted_at,
      (SELECT count(*) FROM packages x WHERE x.run_id=rn.id)::int AS packages,
      (SELECT count(*) FROM packages x WHERE x.run_id=rn.id AND x.status='delivered')::int AS delivered,
      (SELECT count(*) FROM packages x WHERE x.run_id=rn.id AND x.status='returned')::int AS returned
    FROM runs rn JOIN depots dp ON dp.id=rn.depot_id
      LEFT JOIN users du ON du.id=rn.driver_id LEFT JOIN drivers d ON d.user_id=rn.driver_id
    WHERE ${DAY('rn.created_at')}${runOnly} ORDER BY rn.id`, args)).rows;

  const byDepot = (await q(`SELECT dp.name AS depot,
      count(*)::int AS registered,
      count(*) FILTER (WHERE p.status='collected')::int AS collected,
      count(*) FILTER (WHERE p.status='delivered')::int AS delivered,
      count(*) FILTER (WHERE p.status='returned')::int AS returned,
      count(*) FILTER (WHERE p.status IN ('at_depot','delivery_requested'))::int AS waiting,
      COALESCE(sum(p.charge),0)::int AS charges,
      COALESCE(sum(p.delivery_fee) FILTER (WHERE p.status='delivered'),0)::int AS delivery_fees
    FROM packages p JOIN depots dp ON dp.id=p.depot_id
    WHERE ${DAY('p.created_at')}${only} GROUP BY 1 ORDER BY 1`, args)).rows;

  const days = (d) => d == null ? null : d;
  const body = pk.map(x => ({
    ...x,
    recipient_phone_local: local(x.recipient_phone),
    status_label: PKG_STATUS[x.status] || x.status,
    pay_label: PAY[x.pay_method] || '',
    run_label: x.run_id ? '#' + x.run_id : '',
    days_waiting: x.handed_at
      ? Math.max(0, Math.round((new Date(x.handed_at) - new Date(x.created_at)) / 86400000))
      : ['at_depot', 'delivery_requested'].includes(x.status)
        ? Math.max(0, Math.round((Date.now() - new Date(x.created_at)) / 86400000)) : null
  }));

  const sheets = [
    {
      name: 'Packages',
      columns: [
        { header: 'Reference', key: 'ref', width: 12, type: 'text', total: 'label' },
        { header: 'Depot', key: 'depot', width: 18, type: 'text' },
        { header: 'Registered', key: 'created_at', width: 19, type: 'datetime' },
        { header: 'Recipient', key: 'recipient_name', width: 22, type: 'text' },
        { header: 'Phone', key: 'recipient_phone_local', width: 14, type: 'text' },
        { header: 'Item', key: 'description', width: 30, type: 'wrap' },
        { header: 'Qty', key: 'qty', width: 7, type: 'int', total: 'sum' },
        { header: 'Charge', key: 'charge', width: 13, type: 'naira', total: 'sum' },
        { header: 'Status', key: 'status_label', width: 18, type: 'text' },
        { header: 'Delivery area', key: 'area', width: 20, type: 'text' },
        { header: 'Address', key: 'address', width: 28, type: 'wrap' },
        { header: 'Delivery fee', key: 'delivery_fee', width: 13, type: 'naira', total: 'sum' },
        { header: 'Run', key: 'run_label', width: 8, type: 'text' },
        { header: 'Driver', key: 'driver', width: 20, type: 'text' },
        { header: 'Plate', key: 'plate', width: 12, type: 'text' },
        { header: 'Handed over', key: 'handed_at', width: 19, type: 'datetime' },
        { header: 'Days waiting', key: 'days_waiting', width: 11, type: 'int', total: 'avg' },
        { header: 'Paid by', key: 'pay_label', width: 12, type: 'text' },
        { header: 'Amount collected', key: 'collected_amount', width: 14, type: 'naira', total: 'sum' },
        { header: 'Registered by', key: 'registered_by', width: 18, type: 'text' },
        { header: 'Not delivered because', key: 'fail_reason', width: 26, type: 'wrap' },
        { header: 'Handover note', key: 'handover_note', width: 26, type: 'wrap' }
      ],
      rows: body
    },
    {
      name: 'Delivery runs',
      columns: [
        { header: 'Run', key: 'id', width: 8, type: 'int' },
        { header: 'Depot', key: 'depot', width: 18, type: 'text', total: 'label' },
        { header: 'Created', key: 'created_at', width: 19, type: 'datetime' },
        { header: 'Finished', key: 'done_at', width: 19, type: 'datetime' },
        { header: 'Driver', key: 'driver', width: 20, type: 'text' },
        { header: 'Phone', key: 'driver_phone_local', width: 14, type: 'text' },
        { header: 'Vehicle', key: 'vehicle_label', width: 10, type: 'text' },
        { header: 'Plate', key: 'plate', width: 12, type: 'text' },
        { header: 'Packages', key: 'packages', width: 10, type: 'int', total: 'sum' },
        { header: 'Delivered', key: 'delivered', width: 10, type: 'int', total: 'sum' },
        { header: 'Returned', key: 'returned', width: 10, type: 'int', total: 'sum' },
        { header: 'Delivery fees to driver', key: 'fee_total', width: 16, type: 'naira', total: 'sum' },
        { header: 'Cash due to depot', key: 'cash_due', width: 15, type: 'naira', total: 'sum' },
        { header: 'Cash handed in', key: 'remitted_label', width: 19, type: 'text' },
        { header: 'Status', key: 'status_label', width: 12, type: 'text' }
      ],
      rows: runs.map(x => ({
        ...x,
        driver_phone_local: local(x.driver_phone),
        vehicle_label: VEH[x.vehicle_type] || x.vehicle_type,
        status_label: x.status === 'done' ? 'Finished' : x.status === 'open' ? 'Waiting for a driver' : title(x.status.replace('_', ' ')),
        remitted_label: x.remitted_at ? new Date(x.remitted_at).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium' }) : (x.cash_due ? 'Not yet' : '—')
      }))
    },
    {
      name: 'By depot',
      columns: [
        { header: 'Depot', key: 'depot', width: 22, type: 'text', total: 'label' },
        { header: 'Registered', key: 'registered', width: 11, type: 'int', total: 'sum' },
        { header: 'Collected at depot', key: 'collected', width: 14, type: 'int', total: 'sum' },
        { header: 'Delivered', key: 'delivered', width: 11, type: 'int', total: 'sum' },
        { header: 'Returned', key: 'returned', width: 11, type: 'int', total: 'sum' },
        { header: 'Still waiting', key: 'waiting', width: 12, type: 'int', total: 'sum' },
        { header: 'Charges', key: 'charges', width: 14, type: 'naira', total: 'sum' },
        { header: 'Delivery fees earned', key: 'delivery_fees', width: 16, type: 'naira', total: 'sum' }
      ],
      rows: byDepot
    },
    aboutSheet([
      ['Report', 'Depot packages'],
      ['Period', r.label],
      ['Depot', depotId ? (byDepot[0] ? byDepot[0].depot : 'The depot you chose') : 'All depots'],
      ['Generated', generated() + ' (Lagos time)'],
      ['Packages registered', pk.length],
      ['Delivery runs created', runs.length],
      ['Counted by', 'The day a package was registered, or a run created, in Lagos time. A package registered before this period but delivered during it will not appear.'],
      ['Days waiting', 'Registration to handover. For a package still at the depot it counts to today, so the figure keeps rising until someone collects it.'],
      ['Charge', 'What the sender set for the recipient to pay. The delivery fee is separate and is what the driver earns.'],
      ['Cash due to depot', 'Charges a driver collected in cash on that run and must hand back to the depot.']
    ])
  ];
  return { buffer: workbook(sheets, { title: 'Waka Bonny depot packages' }), name: fileName(['Waka Bonny depot packages', r.label]) };
}

// ---------------------------------------------------------------- Port Harcourt manifests
async function manifests({ from, to, route_id }) {
  const r = range(from, to);
  const routeId = route_id ? Number(route_id) : null;
  const only = routeId ? ' AND dep.route_id=$3' : '';
  const args = routeId ? [r.from, r.to, routeId] : [r.from, r.to];

  const deps = (await q(`SELECT dep.id, dep.depart_at, dep.vehicle_type, dep.seats_total, dep.price, dep.status,
      rt.origin, rt.destination, u.name AS operator, u.phone AS operator_phone, d.plate, d.vehicle_desc,
      (SELECT COALESCE(sum(seats),0) FROM bookings b WHERE b.departure_id=dep.id AND b.status IN ('booked','boarded'))::int AS seats_taken,
      (SELECT COALESCE(sum(seats),0) FROM bookings b WHERE b.departure_id=dep.id AND b.status='boarded')::int AS seats_boarded,
      (SELECT COALESCE(sum(seats),0) FROM bookings b WHERE b.departure_id=dep.id AND b.status='no_show')::int AS seats_no_show,
      (SELECT COALESCE(sum(seats),0) FROM bookings b WHERE b.departure_id=dep.id AND b.status='cancelled')::int AS seats_cancelled,
      (SELECT COALESCE(sum(b.seats),0) FROM bookings b WHERE b.departure_id=dep.id AND b.status IN ('booked','boarded'))::int * dep.price AS revenue,
      (SELECT COALESCE(sum(b.seats),0) FROM bookings b WHERE b.departure_id=dep.id AND b.paid AND b.status IN ('booked','boarded'))::int * dep.price AS revenue_paid
    FROM departures dep JOIN intercity_routes rt ON rt.id=dep.route_id
      JOIN users u ON u.id=dep.driver_id LEFT JOIN drivers d ON d.user_id=dep.driver_id
    WHERE ${DAY('dep.depart_at')}${only} ORDER BY dep.depart_at`, args)).rows;

  const pax = (await q(`SELECT b.ref, dep.depart_at, rt.origin, rt.destination, dep.vehicle_type,
      u.name AS operator, d.plate, b.passenger_name, b.passenger_phone, b.seats, b.drop_stop,
      b.nok_name, b.nok_phone, b.status, b.paid, dep.price, b.created_at
    FROM bookings b JOIN departures dep ON dep.id=b.departure_id
      JOIN intercity_routes rt ON rt.id=dep.route_id
      JOIN users u ON u.id=dep.driver_id LEFT JOIN drivers d ON d.user_id=dep.driver_id
    WHERE ${DAY('dep.depart_at')}${only} AND b.status <> 'held'
    ORDER BY dep.depart_at, b.id`, args)).rows;

  const sheets = [
    {
      name: 'Departures',
      columns: [
        { header: 'Departure', key: 'depart_at', width: 20, type: 'datetime' },
        { header: 'Route', key: 'route', width: 26, type: 'text', total: 'label' },
        { header: 'Vehicle', key: 'vehicle_label', width: 10, type: 'text' },
        { header: 'Operator', key: 'operator', width: 22, type: 'text' },
        { header: 'Phone', key: 'operator_phone_local', width: 14, type: 'text' },
        { header: 'Plate', key: 'plate', width: 12, type: 'text' },
        { header: 'Seats', key: 'seats_total', width: 8, type: 'int', total: 'sum' },
        { header: 'Booked', key: 'seats_taken', width: 9, type: 'int', total: 'sum' },
        { header: 'Boarded', key: 'seats_boarded', width: 9, type: 'int', total: 'sum' },
        { header: 'No-show', key: 'seats_no_show', width: 9, type: 'int', total: 'sum' },
        { header: 'Cancelled', key: 'seats_cancelled', width: 10, type: 'int', total: 'sum' },
        { header: 'Empty seats', key: 'empty', width: 11, type: 'int', total: 'sum' },
        { header: 'Full', key: 'load', width: 9, type: 'pct', total: 'avg' },
        { header: 'Seat price', key: 'price', width: 12, type: 'naira' },
        { header: 'Seat revenue', key: 'revenue', width: 14, type: 'naira', total: 'sum' },
        { header: 'Of that, paid online', key: 'revenue_paid', width: 15, type: 'naira', total: 'sum' },
        { header: 'Status', key: 'status_label', width: 12, type: 'text' },
        { header: 'Vehicle description', key: 'vehicle_desc', width: 24, type: 'text' }
      ],
      rows: deps.map(x => ({
        ...x,
        route: `${x.origin} → ${x.destination}`,
        vehicle_label: VEH[x.vehicle_type] || x.vehicle_type,
        operator_phone_local: local(x.operator_phone),
        empty: Math.max(0, x.seats_total - x.seats_taken),
        load: x.seats_total ? x.seats_taken / x.seats_total : 0,
        status_label: title(x.status)
      }))
    },
    {
      name: 'Passenger manifest',
      columns: [
        { header: 'Departure', key: 'depart_at', width: 20, type: 'datetime' },
        { header: 'Route', key: 'route', width: 26, type: 'text', total: 'label' },
        { header: 'Operator', key: 'operator', width: 20, type: 'text' },
        { header: 'Plate', key: 'plate', width: 12, type: 'text' },
        { header: 'Booking', key: 'ref', width: 12, type: 'text' },
        { header: 'Passenger', key: 'passenger_name', width: 24, type: 'text' },
        { header: 'Phone', key: 'passenger_phone_local', width: 14, type: 'text' },
        { header: 'Seats', key: 'seats', width: 8, type: 'int', total: 'sum' },
        { header: 'Getting off at', key: 'drop_stop', width: 20, type: 'text' },
        { header: 'Next of kin', key: 'nok_name', width: 22, type: 'text' },
        { header: 'Next of kin phone', key: 'nok_phone_local', width: 15, type: 'text' },
        { header: 'Fare', key: 'fare', width: 12, type: 'naira', total: 'sum' },
        { header: 'Paid online', key: 'paid', width: 11, type: 'bool' },
        { header: 'Status', key: 'status_label', width: 11, type: 'text' },
        { header: 'Booked on', key: 'created_at', width: 19, type: 'datetime' }
      ],
      rows: pax.map(x => ({
        ...x,
        route: `${x.origin} → ${x.destination}`,
        passenger_phone_local: local(x.passenger_phone),
        nok_phone_local: local(x.nok_phone),
        fare: x.seats * x.price,
        status_label: x.status === 'no_show' ? 'No-show' : title(x.status)
      }))
    },
    aboutSheet([
      ['Report', 'Port Harcourt departures and manifests'],
      ['Period', r.label],
      ['Route', routeId ? (deps[0] ? `${deps[0].origin} → ${deps[0].destination}` : 'The route you chose') : 'All routes'],
      ['Generated', generated() + ' (Lagos time)'],
      ['Departures', deps.length],
      ['Seats booked', deps.reduce((a, x) => a + x.seats_taken, 0)],
      ['Seat revenue', '₦' + deps.reduce((a, x) => a + x.revenue, 0).toLocaleString('en-NG')],
      ['Counted by', 'The day the vehicle departs, in Lagos time, not the day the seat was booked.'],
      ['Seat revenue', 'Booked and boarded seats at the price set for that departure. Cancelled seats are excluded.'],
      ['Full', 'Booked seats as a share of the seats on the vehicle.'],
      ['Manifest', 'Carry a printed copy on every journey. Next of kin is collected for exactly this purpose.'],
      ['Seats on hold', 'Bookings still in the few-minute payment window are left out, since they are not confirmed travel.']
    ])
  ];
  return { buffer: workbook(sheets, { title: 'Waka Bonny Port Harcourt manifests' }), name: fileName(['Waka Bonny PH departures', r.label]) };
}

module.exports = { rides, drivers, packages, manifests };
