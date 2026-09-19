// Live location for rides.
// Before pickup the vehicle position comes from the driver's phone.
// Once the trip starts, the passenger's phone (inside the vehicle) is the primary source;
// the driver's phone is the fallback when the passenger's goes quiet.
const { q } = require('./db');

const LIVE = ['accepted', 'arrived', 'started'];
const PAX_FRESH_MS = 30000;

function coord(lat, lng) {
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) return null;
  return [a, b];
}

const paxFresh = (ride) => ride.status === 'started' && ride.pax_loc_at && Date.now() - new Date(ride.pax_loc_at) < PAX_FRESH_MS;

// Adds a trail point unless it's within ~8 m of the last one
async function addPoint(rideId, lat, lng) {
  const last = (await q('SELECT lat, lng FROM ride_points WHERE ride_id=$1 ORDER BY id DESC LIMIT 1', [rideId])).rows[0];
  const moved = !last || Math.hypot((last.lat - lat) * 111320, (last.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180)) > 8;
  if (moved) await q('INSERT INTO ride_points(ride_id, lat, lng) VALUES($1,$2,$3)', [rideId, lat, lng]);
}

async function rideTrack(ride) {
  let vehicle = null;
  if (LIVE.includes(ride.status)) {
    if (paxFresh(ride)) {
      vehicle = { lat: ride.pax_lat, lng: ride.pax_lng, at: ride.pax_loc_at, source: 'passenger' };
    } else if (ride.driver_id) {
      const d = (await q('SELECT lat, lng, heading, loc_at FROM drivers WHERE user_id=$1', [ride.driver_id])).rows[0];
      if (d && d.lat != null) vehicle = { lat: d.lat, lng: d.lng, heading: d.heading, at: d.loc_at, source: 'driver' };
      // Passenger's last fix may still be newer than a stale driver fix
      if (ride.status === 'started' && ride.pax_loc_at && (!vehicle || new Date(ride.pax_loc_at) > new Date(vehicle.at)))
        vehicle = { lat: ride.pax_lat, lng: ride.pax_lng, at: ride.pax_loc_at, source: 'passenger' };
    }
  }
  const pts = (await q(`SELECT lat, lng FROM (SELECT id, lat, lng FROM ride_points WHERE ride_id=$1 ORDER BY id DESC LIMIT 1500) t ORDER BY id`, [ride.id])).rows;
  return {
    status: ride.status,
    vehicle,
    pickup: ride.pickup_lat != null ? { lat: ride.pickup_lat, lng: ride.pickup_lng } : null,
    trail: pts.map(p => [p.lat, p.lng])
  };
}

module.exports = { coord, rideTrack, addPoint, paxFresh, LIVE };
