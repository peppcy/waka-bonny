// Live location helpers shared by passenger, share-link, admin and intercity views
const { q } = require('./db');

const LIVE = ['accepted', 'arrived', 'started'];

function coord(lat, lng) {
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) return null;
  return [a, b];
}

// Driver position is only exposed while the ride is live; the trail is kept for the record
async function rideTrack(ride) {
  let driver = null;
  if (ride.driver_id && LIVE.includes(ride.status)) {
    const d = (await q('SELECT lat, lng, heading, loc_at FROM drivers WHERE user_id=$1', [ride.driver_id])).rows[0];
    if (d && d.lat != null) driver = { lat: d.lat, lng: d.lng, heading: d.heading, at: d.loc_at };
  }
  const pts = (await q(`SELECT lat, lng FROM (SELECT id, lat, lng FROM ride_points WHERE ride_id=$1 ORDER BY id DESC LIMIT 1500) t ORDER BY id`, [ride.id])).rows;
  return {
    status: ride.status,
    driver,
    pickup: ride.pickup_lat != null ? { lat: ride.pickup_lat, lng: ride.pickup_lng } : null,
    trail: pts.map(p => [p.lat, p.lng])
  };
}

module.exports = { coord, rideTrack, LIVE };
