// Excel downloads for the Desk.
const router = require('express').Router();
const { q } = require('../lib/db');
const { auth } = require('../lib/auth');
const { wrap, bad } = require('../lib/util');
const R = require('../lib/reports');

router.use(auth('admin'));

// What the Reports tab needs to draw its pickers
router.get('/', wrap(async (req, res) => {
  const depots = (await q('SELECT id, name FROM depots WHERE active ORDER BY name')).rows;
  const routes = (await q('SELECT id, origin, destination FROM intercity_routes WHERE active ORDER BY origin, destination')).rows;
  const first = (await q(`SELECT min(d)::date AS d FROM (
      SELECT min(created_at) d FROM rides UNION ALL SELECT min(created_at) FROM packages
      UNION ALL SELECT min(depart_at) FROM departures) t`)).rows[0].d;
  res.json({ depots, routes, first_activity: first });
}));

const KINDS = { rides: R.rides, drivers: R.drivers, packages: R.packages, manifests: R.manifests };

router.get('/:kind', wrap(async (req, res) => {
  const build = KINDS[req.params.kind];
  if (!build) throw bad('There is no such report.');
  const { buffer, name } = await build(req.query);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // The quoted form keeps the spaces in the file name intact
    'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store'
  });
  res.end(buffer);
}));

module.exports = router;
