// Distance helpers (Option A: nearest driver sees a job first)
function km(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some(v => v == null || !Number.isFinite(Number(v)))) return null;
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}
// Sort jobs: known distance first (closest first), then same-area jobs, then the rest by age
function byDistance(items) {
  return items.sort((a, b) => {
    const da = a.distance_km, db = b.distance_km;
    if (da != null && db != null) return da - db;
    if (da != null) return -1;
    if (db != null) return 1;
    if (a.nearby !== b.nearby) return a.nearby ? -1 : 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
}
module.exports = { km, byDistance };
