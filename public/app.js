/* Waka Bonny frontend — vanilla JS, no build step */
(() => {
'use strict';
const API = (window.WAKA_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');

// ---------- helpers ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const naira = (n) => n == null ? '—' : '₦' + Number(n).toLocaleString('en-NG');
const fmtTime = (d) => new Date(d).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtClock = (d) => new Date(d).toLocaleTimeString('en-NG', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' });
const localPhone = (p) => p && p.startsWith('234') ? '0' + p.slice(3) : (p || '');
const initials = (n) => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const VEH = { keke: 'Keke', okada: 'Okada', taxi: 'Taxi', bus: 'Bus', sienna: 'Sienna' };
const VEH_ICON = { keke: '🛺', okada: '🏍️', taxi: '🚕', bus: '🚌', sienna: '🚐' };

const S = {
  token: localStorage.getItem('waka_token'),
  user: null,
  meta: { zones: [], settings: {} },
  view: null,
  form: JSON.parse(localStorage.getItem('waka_form') || '{}'),
  poll: null
};

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && S.token) headers.Authorization = 'Bearer ' + S.token;
  let res;
  try {
    res = await fetch(API + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('No connection. Check your network and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth && S.token) { signOut(false); throw new Error(data.error || 'Sign in again.'); }
  if (res.status === 403 && data.banned) { if (S.token) signOut(false); S.bannedMsg = data.error; if (S.view === 'auth') viewAuth(); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3800);
}
const fail = (e) => toast(e.message || String(e), true);

function sheet(html, wide = false) {
  const s = $('#sheet'); s.innerHTML = html; s.classList.toggle('wide', wide);
  $('#modal').classList.add('show'); $('#modal').setAttribute('aria-hidden', 'false');
  const f = s.querySelector('input,select,textarea,button'); if (f) f.focus();
  return s;
}
function closeSheet() { if (S.sheetCleanup) { try { S.sheetCleanup(); } catch {} S.sheetCleanup = null; } $('#modal').classList.remove('show'); $('#modal').setAttribute('aria-hidden', 'true'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function poll(fn, ms = 4000) { stopPoll(); S.poll = setInterval(() => { if (!document.hidden) fn().catch(() => {}); }, ms); }
function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = null; }

function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn._label = btn.textContent; btn.textContent = 'Please wait…'; } else if (btn._label != null) { btn.textContent = btn._label; btn._label = null; } }
async function act(btn, fn) { busy(btn, true); try { await fn(); } catch (e) { fail(e); } finally { busy(btn, false); } }

const zoneOptions = (sel, placeholder = 'Choose area') =>
  `<option value="">${placeholder}</option>` + S.meta.zones.map(z => `<option value="${z.id}" ${String(z.id) === String(sel) ? 'selected' : ''}>${esc(z.name)}</option>`).join('');
// ---------- Area search field (type to search, tap a suggestion) ----------
// Renders a text box plus a hidden input holding the area id, so code can read $('#id').value
// and listen with $('#id').onchange exactly as with a <select>.
const normArea = (t) => String(t || '').toLowerCase().replace(/[.,'’\-]/g, ' ').replace(/\s+/g, ' ').trim();
function zoneField(id, sel, name = '', placeholder = 'Start typing an area…') {
  const z = S.meta.zones.find(x => String(x.id) === String(sel));
  return `<div class="zp"><input type="text" class="zp-in" data-for="${id}" value="${esc(z ? z.name : '')}" placeholder="${esc(placeholder)}"
      autocomplete="off" autocapitalize="words" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-list">
    <input type="hidden" id="${id}" ${name ? `name="${name}"` : ''} value="${z ? z.id : ''}">
    <div class="zp-list" id="${id}-list" role="listbox" hidden></div></div>`;
}
function matchAreas(text) {
  const qn = normArea(text); if (!qn) return [];
  const words = qn.split(' ');
  return S.meta.zones.map(z => {
    const n = normArea(z.name);
    if (!words.every(w => n.includes(w))) return null;
    const score = n.startsWith(qn) ? 0 : n.split(' ').some(w => w.startsWith(words[0])) ? 1 : 2;
    return { z, score };
  }).filter(Boolean).sort((a, b) => a.score - b.score || a.z.name.localeCompare(b.z.name)).slice(0, 8).map(x => x.z);
}
function zpSet(inp, z) {
  const hid = document.getElementById(inp.dataset.for);
  const changed = hid.value !== (z ? String(z.id) : '');
  hid.value = z ? z.id : ''; inp.value = z ? z.name : inp.value;
  inp.classList.toggle('zp-bad', !z && !!inp.value.trim());
  if (changed) hid.dispatchEvent(new Event('change', { bubbles: true }));
}
function zpShow(inp) {
  const list = document.getElementById(inp.dataset.for + '-list');
  const items = matchAreas(inp.value);
  inp._items = items; inp._hi = 0;
  if (!inp.value.trim()) { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); return; }
  const hl = (name) => { let out = esc(name); normArea(inp.value).split(' ').filter(Boolean).forEach(w => { out = out.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i'), '<b>$1</b>'); }); return out; };
  list.innerHTML = items.length
    ? items.map((z, i) => `<div class="zp-opt${i === 0 ? ' on' : ''}" role="option" data-zid="${z.id}" aria-selected="${i === 0}">${hl(z.name)}</div>`).join('')
    : '<div class="zp-none">No matching area. Check the spelling, or pick the nearest area.</div>';
  list.hidden = false; inp.setAttribute('aria-expanded', 'true');
}
function zpHide(inp) { const l = document.getElementById(inp.dataset.for + '-list'); if (l) l.hidden = true; inp.setAttribute('aria-expanded', 'false'); }
// On phones, lift the field to the top so the keyboard doesn't cover the suggestions
document.addEventListener('focusin', (e) => {
  const inp = e.target.closest && e.target.closest('.zp-in'); if (!inp || window.innerWidth > 760) return;
  setTimeout(() => { if (document.activeElement !== inp) return; const y = inp.getBoundingClientRect().top + window.scrollY - 80; window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); }, 300);
});
document.addEventListener('input', (e) => { const inp = e.target.closest('.zp-in'); if (!inp) return; inp.classList.remove('zp-bad'); zpShow(inp); });
document.addEventListener('keydown', (e) => {
  const inp = e.target.closest('.zp-in'); if (!inp) return;
  const list = document.getElementById(inp.dataset.for + '-list'); const items = inp._items || [];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (list.hidden) zpShow(inp); if (!items.length) return;
    e.preventDefault(); inp._hi = (inp._hi + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    [...list.children].forEach((c, i) => { c.classList.toggle('on', i === inp._hi); c.setAttribute('aria-selected', i === inp._hi); });
  } else if (e.key === 'Enter') {
    if (!list.hidden && items.length) { e.preventDefault(); zpSet(inp, items[inp._hi || 0]); zpHide(inp); }
  } else if (e.key === 'Escape') zpHide(inp);
});
// Keep focus in the text box while a suggestion is pressed, then pick it on click.
// Selecting on click (not on press) stops the tap "falling through" to a button under the list.
document.addEventListener('pointerdown', (e) => { if (e.target.closest('.zp-list')) e.preventDefault(); });
document.addEventListener('click', (e) => {
  const opt = e.target.closest('.zp-opt'); if (!opt) return;
  e.preventDefault(); e.stopPropagation();
  const inp = opt.closest('.zp').querySelector('.zp-in');
  zpSet(inp, S.meta.zones.find(z => String(z.id) === opt.dataset.zid)); zpHide(inp);
}, true);
document.addEventListener('focusout', (e) => {
  const inp = e.target.closest && e.target.closest('.zp-in'); if (!inp) return;
  setTimeout(() => {
    zpHide(inp);
    const t = normArea(inp.value);
    const exact = S.meta.zones.find(z => normArea(z.name) === t);
    const only = !exact && t && matchAreas(inp.value).length === 1 ? matchAreas(inp.value)[0] : null;
    zpSet(inp, exact || only || null);
    if (!t) inp.classList.remove('zp-bad');
  }, 120);
});

const saveForm = () => localStorage.setItem('waka_form', JSON.stringify(S.form));

// ---------- view cleanup (maps, GPS watchers, timers) ----------
S.cleanups = [];
function resetView() { S.cleanups.forEach(f => { try { f(); } catch {} }); S.cleanups = []; }
const onReset = (f) => S.cleanups.push(f);

// ---------- live map ----------
const BONNY = [4.4380, 7.1650];
const agoText = (t) => { if (!t) return ''; const s = Math.max(0, Math.round((Date.now() - new Date(t)) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };

// Creates a Leaflet map in `el`. update(track) moves the vehicle, draws the trail and pickup.

// Base maps. Satellite (Esri World Imagery, no key needed) shows Bonny's buildings and roads far better than
// OpenStreetMap, which has little street data for the island. The choice is remembered on the phone.
function baseLayers() {
  const esri = (svc) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
  const satellite = L.layerGroup([
    L.tileLayer(esri('World_Imagery'), { maxNativeZoom: 18, maxZoom: 20, attribution: 'Imagery © Esri, Maxar' }),
    L.tileLayer(esri('Reference/World_Transportation'), { maxNativeZoom: 18, maxZoom: 20, opacity: .9 }),
    L.tileLayer(esri('Reference/World_Boundaries_and_Places'), { maxNativeZoom: 18, maxZoom: 20 })
  ]);
  const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 20, attribution: '© OpenStreetMap contributors', referrerPolicy: 'strict-origin-when-cross-origin' });
  return { 'Streets': streets, 'Satellite': satellite };
}

// selfVehicle: this phone is inside the vehicle (passenger during the trip), so its own GPS moves the vehicle icon.
function liveMap(el, metaEl, { icon = '🛺', showMe = true, selfVehicle = false, onFix = null, onGpsError = null } = {}) {
  if (!window.L) { el.innerHTML = '<p class="muted small" style="padding:1rem">Map could not load. Check your connection.</p>'; return { update() {}, me() {}, destroy() {} }; }
  // World map: users anywhere (Bonny, Port Harcourt, Lagos, abroad) see their real position.
  const m = L.map(el, { zoomControl: true, minZoom: 2, maxZoom: 20, zoomSnap: 0.5, tap: true, worldCopyJump: true }).setView(BONNY, 14);
  el._wakaMap = m;
  const layers = baseLayers();
  let saved = null; try { saved = localStorage.getItem('waka_map'); } catch {}
  (layers[saved] || layers.Streets).addTo(m);
  L.control.layers(layers, null, { position: 'topright', collapsed: true }).addTo(m);
  m.on('baselayerchange', (e) => { try { localStorage.setItem('waka_map', e.name); } catch {} });

  let veh = null, meDot = null, accCircle = null, pick = null, line = null, last = null, source = null, selfAt = 0, dead = false;
  let centred = false;      // the map centres itself once, then never changes the user's zoom
  let follow = true;        // follow the vehicle (panning only, zoom untouched) until the user drags away
  let touchAt = 0;          // don't move the map while the user's fingers are on it
  const busy = () => Date.now() - touchAt < 2500 || m._animatingZoom;
  ['touchstart', 'mousedown', 'wheel', 'touchmove'].forEach(ev => el.addEventListener(ev, () => { touchAt = Date.now(); }, { passive: true }));
  m.on('dragstart', () => { follow = false; renderMeta(); });

  const vIcon = L.divIcon({ className: '', html: `<div class="vi">${icon}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] });
  const pIcon = L.divIcon({ className: '', html: '<div class="pin">📍</div>', iconSize: [28, 28], iconAnchor: [14, 28] });

  function centreOnce() {
    if (centred) return;
    const pts = [veh, pick, meDot].filter(Boolean).map(x => x.getLatLng());
    if (!pts.length) return;
    centred = true;
    if (pts.length > 1) m.fitBounds(pts, { padding: [50, 50], maxZoom: 17 }); else m.setView(pts[0], 17);
  }
  function followTo(ll) { if (centred && follow && !busy()) m.panTo(ll, { animate: true, duration: 0.6 }); }

  const api = {
    map: m,
    update(t) {
      if (!t || dead) return;
      if (t.pickup && !pick) pick = L.marker([t.pickup.lat, t.pickup.lng], { icon: pIcon, title: 'Pickup' }).addTo(m);
      if (t.trail && t.trail.length > 1) { if (line) line.setLatLngs(t.trail); else line = L.polyline(t.trail, { color: '#F2C230', weight: 6, opacity: .9 }).addTo(m); }
      // This phone's own fix wins over the server's copy while it's fresh (it's instant and it's the same vehicle)
      const selfFresh = selfVehicle && Date.now() - selfAt < 20000;
      const v = selfFresh ? null : t.vehicle;
      if (v) {
        const ll = [v.lat, v.lng];
        if (veh) veh.setLatLng(ll); else veh = L.marker(ll, { icon: vIcon, title: 'Vehicle', zIndexOffset: 1000 }).addTo(m);
        last = v.at; source = v.source;
        followTo(ll);
      }
      centreOnce();
      renderMeta();
    },
    me(lat, lng, acc) {
      if (dead) return;
      const ll = [lat, lng];
      if (selfVehicle) {
        selfAt = Date.now(); last = new Date().toISOString(); source = 'you';
        if (veh) veh.setLatLng(ll); else veh = L.marker(ll, { icon: vIcon, title: 'You (in the vehicle)', zIndexOffset: 1000 }).addTo(m);
        centreOnce(); followTo(ll); renderMeta(); return;
      }
      // Pale circle = GPS accuracy (the phone is somewhere inside it); blue dot = best estimate
      if (acc != null && acc < 5000) { if (accCircle) accCircle.setLatLng(ll).setRadius(acc); else accCircle = L.circle(ll, { radius: acc, color: '#1E73E8', weight: 1, fillColor: '#1E73E8', fillOpacity: .12, interactive: false }).addTo(m); }
      if (meDot) meDot.setLatLng(ll);
      else meDot = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#1E73E8', fillOpacity: 1 }).addTo(m).bindTooltip('You are here');
      centreOnce();
    },
    recenter() {
      if (dead) return;
      follow = true; touchAt = 0;
      const target = veh || meDot || pick;
      if (target) m.setView(target.getLatLng(), Math.max(m.getZoom(), 16));
      renderMeta();
    }
  };

  // Full-screen toggle: the map fills the phone screen, handy while watching a trip
  let full = false;
  function setFull(on) {
    full = on; el.classList.toggle('map-full', on); document.body.classList.toggle('map-open', on);
    closeBtn.hidden = !on;
    setTimeout(() => { if (!dead) m.invalidateSize(); }, 200);
  }
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button'; closeBtn.className = 'map-close'; closeBtn.textContent = 'Close map'; closeBtn.hidden = true;
  closeBtn.onclick = () => setFull(false);
  el.appendChild(closeBtn);
  L.DomEvent.disableClickPropagation(closeBtn);

  function renderMeta() {
    if (!metaEl || dead) return;
    const src = { you: "your phone's GPS", passenger: "passenger's phone", driver: "driver's phone" }[source] || '';
    const status = !last ? '<span>Waiting for GPS…</span>'
      : (Date.now() - new Date(last) > 60000 ? '<span class="stale">● GPS not updating</span>' : '<span class="live">● Live</span>');
    metaEl.innerHTML = `${status}<span>${last ? (src ? src + ' · ' : '') + agoText(last) : ''}</span>
      <span class="map-btns">${follow ? '' : '<button class="link" type="button" data-mb="recenter">Recenter</button>'}<button class="link" type="button" data-mb="full">Full screen</button></span>`;
    metaEl.querySelectorAll('[data-mb]').forEach(b => b.onclick = () => (b.dataset.mb === 'full' ? setFull(true) : api.recenter()));
  }
  renderMeta();
  const tick = setInterval(renderMeta, 5000);

  let watch = null;
  if ((showMe || selfVehicle) && navigator.geolocation) watch = navigator.geolocation.watchPosition(
    p => { api.me(p.coords.latitude, p.coords.longitude, p.coords.accuracy); if (onFix) onFix(p.coords); },
    e => { if (onGpsError) onGpsError(e); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
  setTimeout(() => { if (!dead) m.invalidateSize(); }, 150);
  api.destroy = () => { if (dead) return; dead = true; if (full) setFull(false); clearInterval(tick); if (watch != null) navigator.geolocation.clearWatch(watch); m.stop(); m.remove(); };
  return api;
}

// One-off position for the pickup point (resolves null if unavailable)
function getPos(timeout = 7000) {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res(null), { enableHighAccuracy: true, timeout, maximumAge: 30000 });
  });
}

// ---------- driver GPS sender ----------
// Keeps sending the driver's position while they're online or on a trip. Screen is kept awake during trips.
const GPS = {
  watch: null, timer: null, coords: null, sentAt: 0, every: 15000, error: null, wake: null,
  start(every) {
    this.every = every;
    if (!navigator.geolocation) { this.error = 'This phone can\'t share its location.'; this.note(); return; }
    if (this.watch == null) {
      this.watch = navigator.geolocation.watchPosition(p => { this.error = null; this.coords = p.coords; this.send(); this.note(); },
        e => { this.error = e.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings, otherwise passengers can\'t see you on the map.' : 'Can\'t get your GPS position. Check location is switched on.'; this.note(); },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 });
    }
    clearInterval(this.timer);
    this.timer = setInterval(() => this.send(true), every);
  },
  stop() { if (this.watch != null) navigator.geolocation.clearWatch(this.watch); this.watch = null; clearInterval(this.timer); this.timer = null; this.keepAwake(false); },
  send(force) {
    if (!this.coords) return;
    if (!force && Date.now() - this.sentAt < Math.min(this.every, 4000)) return;
    this.sentAt = Date.now();
    const c = this.coords;
    api('/driver/location', { method: 'POST', body: { lat: c.latitude, lng: c.longitude, heading: c.heading } }).catch(() => {});
  },
  async keepAwake(on) {
    try {
      if (on && !this.wake && navigator.wakeLock) { this.wake = await navigator.wakeLock.request('screen'); this.wake.addEventListener('release', () => { this.wake = null; }); }
      if (!on && this.wake) { await this.wake.release(); this.wake = null; }
    } catch {}
  },
  note() {
    const el = $('#gpsNote'); if (!el) return;
    el.className = 'notice gps-note ' + (this.error ? 'bad' : '');
    el.textContent = this.error || (this.coords ? '📡 Sharing your live location with passengers.' : '📡 Getting your GPS position…');
  }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden && GPS.timer && GPS.every <= 5000) GPS.keepAwake(true); });

// ---------- navigation ----------
const NAV_ICON = { ride: '🛺', intercity: '🚌', trips: '🧾', account: '👤', driver: '🧭', admin: '📊', depot: '🏬' };
function nav(items) {
  document.body.classList.toggle('has-tabs', items.length > 0);
  $('#nav').innerHTML = items.map(([k, label]) => `<button data-nav="${k}" ${S.view === k ? 'aria-current="page"' : ''}><span class="ni" aria-hidden="true">${NAV_ICON[k] || '•'}</span><span class="nl">${label}</span></button>`).join('');
  $$('#nav [data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
}
function menuFor() {
  const u = S.user;
  if (!u) return [];
  if (u.role === 'admin') return [['admin', 'Desk'], ['account', 'Account']];
  if (u.role === 'driver') return [['driver', 'Work'], ['account', 'Account']];
  if (u.role === 'agent') return [['depot', 'Depot'], ['account', 'Account']];
  return [['ride', 'Book'], ['intercity', 'Bonny ⇄ PH'], ['trips', 'History'], ['account', 'Account']];
}
function go(view, push = true) {
  stopPoll(); closeSheet(); resetView();
  S.view = view;
  try { sessionStorage.setItem('waka_view', view); } catch {}
  if (push) history.replaceState(null, '', '/');
  app.classList.toggle('wide', view === 'admin');
  nav(menuFor());
  const V = { auth: viewAuth, ride: viewRide, intercity: viewIntercity, trips: viewTrips, account: viewAccount, driver: viewDriver, admin: viewAdmin, depot: viewDepot };
  (V[view] || viewAuth)().catch(fail);
}
function home() {
  const u = S.user;
  if (!u) return go('auth');
  // Return to the tab the user was on before a refresh, if their role allows it
  let saved = null; try { saved = sessionStorage.getItem('waka_view'); } catch {}
  if (saved && menuFor().some(([k]) => k === saved)) return go(saved);
  go(u.role === 'admin' ? 'admin' : u.role === 'driver' ? 'driver' : u.role === 'agent' ? 'depot' : 'ride');
}
function signOut(msg = true) {
  GPS.stop(); S.auth = null;
  S.token = null; S.user = null; localStorage.removeItem('waka_token'); try { sessionStorage.removeItem('waka_view'); } catch {}
  if (msg) toast('Signed out.');
  go('auth');
}

// ---------- auth ----------
async function viewAuth() {
  // mode: login | register | reset. step (register/reset): phone -> code -> details
  const A = S.auth = S.auth || { mode: 'login', step: 'phone', role: 'passenger' };
  const title = { login: 'Sign in', register: 'Create account', reset: 'Reset your PIN' }[A.mode];
  const codeStep = `
    <p class="small">We sent a 6-digit code to <b>${esc(localPhone(A.phone))}</b>.</p>
    <label class="field"><span class="label">Code from SMS</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" required></label>
    ${A.devCode ? `<p class="notice warn small">Test mode (SMS not connected): your code is <b>${esc(A.devCode)}</b></p>` : ''}
    <button class="btn" type="submit">Verify code</button>
    <div class="row"><button class="link" type="button" id="resend">Send the code again</button><button class="link" type="button" id="changeNo" style="text-align:right">Change number</button></div>`;
  const pinFields = (label) => `
    <div class="row"><label class="field"><span class="label">${label}</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" maxlength="6" required></label>
    <label class="field"><span class="label">Repeat PIN</span><input name="pin_confirm" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="new-password" maxlength="6" required></label></div>
    <p class="muted small">4 to 6 digits. Avoid 1234, 0000 or your birth year. You'll use this PIN to sign in.</p>`;
  let body = '';
  if (A.mode === 'login') {
    body = `<label class="field"><span class="label">Phone number</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0803 123 4567" value="${esc(A.phone ? localPhone(A.phone) : '')}" required></label>
      <label class="field"><span class="label">PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" maxlength="6" required></label>
      <button class="btn" type="submit">Sign in</button>
      <button class="link" type="button" id="forgot">Forgot your PIN?</button>`;
  } else if (A.step === 'phone') {
    body = `<label class="field"><span class="label">Your phone number</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0803 123 4567" value="${esc(A.phone ? localPhone(A.phone) : '')}" required></label>
      <p class="muted small">We'll send a code by SMS to confirm this number is yours.</p>
      <button class="btn" type="submit">Send code</button>`;
  } else if (A.step === 'code') {
    body = codeStep;
  } else if (A.mode === 'reset') {
    body = `${pinFields('New PIN')}<button class="btn" type="submit">Save new PIN</button>`;
  } else {
    const role = A.role;
    body = `<p class="notice small">✔ ${esc(localPhone(A.phone))} verified</p>
      <div class="field"><span class="label">I want to</span>
        <div class="row">
          <button type="button" class="chip" data-r="passenger" aria-pressed="${role === 'passenger'}">Book rides and deliveries<small>Passenger</small></button>
          <button type="button" class="chip" data-r="driver" aria-pressed="${role === 'driver'}">Drive or own a vehicle<small>Keke, okada, taxi, bus, Sienna</small></button>
        </div></div>
      <label class="field"><span class="label">Full name</span><input name="name" autocomplete="name" value="${esc(A.name || '')}" required></label>
      ${pinFields('Create a PIN')}
      <label class="field"><span class="label">Emergency contact phone (optional)</span><input name="emergency_phone" type="tel" inputmode="tel" placeholder="Family member's number"></label>
      ${role === 'driver' ? `
        <label class="field"><span class="label">Vehicle type</span><select name="vehicle_type" required>
          <option value="">Choose vehicle</option>${Object.entries(VEH).map(([k, v]) => `<option value="${k}">${VEH_ICON[k]} ${v}</option>`).join('')}</select></label>
        <div class="row">
          <label class="field"><span class="label">Plate number</span><input name="plate" required></label>
          <label class="field"><span class="label">Association / union permit no.</span><input name="permit_no" required></label>
        </div>
        <label class="field"><span class="label">Vehicle description</span><input name="vehicle_desc" placeholder="e.g. Yellow Bajaj keke"></label>
        <div class="field"><span class="label">Who owns this vehicle?</span><div class="row">
          <button type="button" class="chip" data-own="self" aria-pressed="${(A.own || 'self') === 'self'}">I own it</button>
          <button type="button" class="chip" data-own="other" aria-pressed="${A.own === 'other'}">I drive for an owner</button></div></div>
        ${A.own === 'other' ? `<div class="row"><label class="field"><span class="label">Owner's name</span><input name="owner_name" required></label>
          <label class="field"><span class="label">Owner's phone</span><input name="owner_phone" type="tel" inputmode="tel" required></label></div>` : ''}
        <p class="notice small">🎉 <b>Free for drivers during our launch.</b> No weekly fee. After signing up, visit the association desk with your ID and vehicle papers; you can take trips once you're verified.</p>` : ''}
      <button class="btn" type="submit">Create account</button>`;
  }
  app.innerHTML = `
    <section class="hero"><h1>Rides and deliveries you can trust on Bonny Island.</h1>
      <p>Verified keke, okada and taxi riders at fixed fares, parcels and errands, plus bus and Sienna seats to Port Harcourt.</p></section>
    <div class="seg" role="group" aria-label="Sign in or create account">
      <button data-m="login" aria-pressed="${A.mode === 'login'}">Sign in</button>
      <button data-m="register" aria-pressed="${A.mode !== 'login'}">Create account</button>
    </div>
    ${S.bannedMsg ? `<div class="notice bad">${esc(S.bannedMsg)}</div>` : ''}
    <form id="authForm" class="card" novalidate><h2>${title}</h2>${body}</form>`;
  const reset = (mode) => { S.auth = { mode, step: 'phone', role: A.role }; viewAuth(); };
  $$('[data-m]').forEach(b => b.onclick = () => reset(b.dataset.m));
  $$('[data-r]').forEach(b => b.onclick = () => { A.name = $('input[name=name]')?.value; A.role = b.dataset.r; viewAuth(); });
  $$('[data-own]').forEach(b => b.onclick = () => {
    // keep what was typed while switching ownership
    const keep = Object.fromEntries(new FormData($('#authForm'))); A.own = b.dataset.own; A.name = keep.name;
    viewAuth().then(() => { for (const [k, v] of Object.entries(keep)) { const el = $(`#authForm [name="${k}"]`); if (el && !['owner_name', 'owner_phone'].includes(k)) el.value = v; } });
  });
  if ($('#forgot')) $('#forgot').onclick = () => { const ph = $('input[name=phone]').value; S.auth = { mode: 'reset', step: 'phone', role: 'passenger' }; viewAuth().then(() => { $('input[name=phone]').value = ph; }); };
  const sendCode = async () => {
    const out = await api('/auth/otp/request', { method: 'POST', auth: false, body: { phone: A.phone, purpose: A.mode === 'reset' ? 'reset' : 'register' } });
    A.devCode = out.dev_code || null; A.step = 'code'; viewAuth(); toast('Code sent by SMS.');
  };
  if ($('#resend')) $('#resend').onclick = (e) => act(e.target, sendCode);
  if ($('#changeNo')) $('#changeNo').onclick = () => { A.step = 'phone'; viewAuth(); };
  const signedIn = (out, msg) => {
    S.token = out.token; S.user = out.user; localStorage.setItem('waka_token', out.token); S.auth = null; S.bannedMsg = null;
    toast(msg); afterSignIn();
  };
  $('#authForm').onsubmit = (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    act(e.submitter, async () => {
      if (A.mode === 'login') {
        const out = await api('/auth/login', { method: 'POST', body: b, auth: false });
        return signedIn(out, `Welcome back, ${out.user.name.split(' ')[0]}.`);
      }
      if (A.step === 'phone') { A.phone = b.phone; return sendCode(); }
      if (A.step === 'code') {
        const v = await api('/auth/otp/verify', { method: 'POST', auth: false, body: { phone: A.phone, code: b.code, purpose: A.mode === 'reset' ? 'reset' : 'register' } });
        A.verify = v.verify_token; A.step = 'details'; A.devCode = null; return viewAuth();
      }
      if (b.pin !== b.pin_confirm) throw new Error('The two PINs do not match.');
      if (A.mode === 'reset') {
        const out = await api('/auth/reset-pin', { method: 'POST', auth: false, body: { verify_token: A.verify, pin: b.pin } });
        return signedIn(out, 'PIN changed. You are signed in.');
      }
      const out = await api('/auth/register', { method: 'POST', auth: false, body: { ...b, role: A.role, owner_type: A.own || 'self', verify_token: A.verify } });
      signedIn(out, 'Account created.');
    });
  };
}

function afterSignIn() {
  const p = new URLSearchParams(location.search);
  if (p.get('badge')) return viewBadge(p.get('badge'));
  home();
}

// ---------- passenger: island rides ----------
async function viewRide() {
  const { ride } = await api('/rides/active');
  if (ride) return renderActive(ride);
  renderRideForm();
}

const SERVICE = {
  ride: { label: 'Ride', icon: '🛺' },
  parcel: { label: 'Parcel', icon: '📦' },
  errand: { label: 'Errand', icon: '🛍️' }
};
const SVC_NOUN = { ride: 'ride', parcel: 'parcel delivery', errand: 'errand' };

function renderRideForm() {
  resetView();
  const f = S.form; f.type = f.type || 'keke'; f.service = f.service || 'ride';
  const svc = f.service, s = S.meta.settings;
  const txt = {
    ride: ['Where are you going?', 'Pickup area', 'Pickup landmark (helps the driver find you)', 'Destination area', 'Drop-off landmark (optional)'],
    parcel: ['Send a parcel', 'Collect the parcel from (area)', 'Collection landmark', 'Deliver to (area)', 'Delivery landmark or address'],
    errand: ['Send a rider on an errand', 'Where the rider should go (area)', 'Shop, market or place', 'Bring it to me at (area)', 'Your landmark or address']
  }[svc];
  app.innerHTML = `
    <div class="seg" role="group" aria-label="What do you need?">${Object.entries(SERVICE).map(([k, v]) => `<button data-svc="${k}" aria-pressed="${svc === k}">${v.icon} ${v.label}</button>`).join('')}</div>
    <h1>${txt[0]}</h1>
    ${svc === 'parcel' ? '<p class="muted small">The recipient gets an SMS with a 4-digit delivery code. The rider can only complete the delivery with that code.</p>' : ''}
    ${svc === 'errand' ? '<p class="muted small">A verified rider buys or collects what you need and brings it to you. You pay the item cost to the rider when it arrives, plus the errand fare.</p>' : ''}
    <div id="pickMap" class="map map-sm" role="region" aria-label="Your location"></div>
    <div id="pickMeta" class="map-meta"></div>
    <div class="card">
      ${svc === 'errand' ? `<label class="field"><span class="label">What should the rider buy or do?</span><textarea id="item" maxlength="300" placeholder="e.g. Buy 2 bags of pure water and a loaf of bread">${esc(f.item || '')}</textarea></label>
        <label class="field"><span class="label">Estimated cost of items (₦, optional)</span><input id="cost" type="number" min="0" step="50" inputmode="numeric" value="${esc(f.cost || '')}"></label>` : ''}
      <label class="field"><span class="label">${txt[1]}</span>${zoneField('from', f.from)}</label>
      <label class="field"><span class="label">${txt[2]}</span><input id="pickup" value="${esc(f.pickup || '')}" placeholder="${svc === 'errand' ? 'e.g. Bonny main market' : 'e.g. Opposite the church gate'}"></label>
      <label class="field"><span class="label">${txt[3]}</span>${zoneField('to', f.to)}</label>
      <label class="field"><span class="label">${txt[4]}</span><input id="dropoff" value="${esc(f.dropoff || '')}"></label>
      ${svc === 'parcel' ? `<label class="field"><span class="label">What are you sending?</span><input id="item" maxlength="300" value="${esc(f.item || '')}" placeholder="e.g. Small shoe box, documents"></label>
        <div class="row"><label class="field"><span class="label">Recipient's name</span><input id="recName" value="${esc(f.recName || '')}"></label>
        <label class="field"><span class="label">Recipient's phone</span><input id="recPhone" type="tel" inputmode="tel" value="${esc(f.recPhone || '')}"></label></div>` : ''}
    </div>
    <div class="row">
      ${['keke', 'okada', 'taxi'].map(t => `<button class="chip" data-type="${t}" aria-pressed="${f.type === t}">${VEH_ICON[t]} ${VEH[t]}<small>${svc !== 'ride' ? (t === 'okada' ? 'Fastest, small items' : t === 'keke' ? 'Bigger items' : 'Large or fragile') : t === 'keke' ? 'Up to 3' : t === 'okada' ? '1 person' : 'Up to 4, AC'}</small></button>`).join('')}
    </div>
    <div id="quote"></div>
    <button class="btn" id="request" disabled>${svc === 'ride' ? `Request ${VEH[f.type].toLowerCase()}` : svc === 'parcel' ? 'Send parcel' : 'Book errand'}</button>
    ${svc === 'ride' ? '<button class="link" id="haveBadge">Flagged one down? Enter the badge code on the vehicle</button>' : ''}
    ${s.night_surcharge ? `<p class="muted small">Night trips (${s.night_start_hour}:00 to ${s.night_end_hour}:00) include a ${naira(s.night_surcharge)} surcharge.</p>` : ''}`;
  const val = (id) => $('#' + id) ? $('#' + id).value : undefined;
  const upd = () => {
    f.from = val('from'); f.to = val('to'); f.pickup = val('pickup'); f.dropoff = val('dropoff');
    if ($('#item')) f.item = val('item'); if ($('#recName')) f.recName = val('recName'); if ($('#recPhone')) f.recPhone = val('recPhone'); if ($('#cost')) f.cost = val('cost');
    saveForm();
  };
  ['#from', '#to'].forEach(x => $(x).onchange = () => { upd(); loadQuote(); });
  $$('#pickup,#dropoff,#item,#recName,#recPhone,#cost').forEach(x => x.oninput = upd);
  $$('[data-type]').forEach(b => b.onclick = () => { upd(); f.type = b.dataset.type; saveForm(); renderRideForm(); });
  $$('[data-svc]').forEach(b => b.onclick = () => { upd(); f.service = b.dataset.svc; saveForm(); renderRideForm(); });
  if ($('#haveBadge')) $('#haveBadge').onclick = () => askBadge();

  // Map: your live location (blue dot). For rides and parcels, a draggable 📍 pin marks the exact pickup spot.
  const usePin = svc !== 'errand';
  let pin = null, lastFix = null;
  const meta = $('#pickMeta');
  const setMeta = (gpsMsg) => {
    meta.innerHTML = `<span>${gpsMsg || (lastFix ? '<span class="live">● Your location is live</span>' : 'Finding your location…')}</span>
      ${usePin ? '<span>Drag 📍 to your exact pickup spot</span>' : ''}<button class="link" type="button" id="toMe">My location</button>`;
    $('#toMe').onclick = () => { if (lastFix) { lm.map.setView([lastFix.latitude, lastFix.longitude], Math.max(lm.map.getZoom(), 17)); if (pin) { pin.setLatLng([lastFix.latitude, lastFix.longitude]); savePin(); } } };
  };
  const savePin = () => { const ll = pin.getLatLng(); f.pickLat = ll.lat; f.pickLng = ll.lng; f.pickAt = Date.now(); saveForm(); };
  const placePin = (ll) => {
    if (!usePin || pin || !window.L) return;
    pin = L.marker(ll, { draggable: true, autoPan: true, title: 'Pickup point',
      icon: L.divIcon({ className: '', html: '<div class="pin">📍</div>', iconSize: [28, 28], iconAnchor: [14, 28] }) }).addTo(lm.map);
    pin.on('dragend', savePin); savePin();
  };
  const lm = liveMap($('#pickMap'), null, {
    onFix: (c) => { const first = !lastFix; lastFix = c; if (first) { placePin([c.latitude, c.longitude]); setMeta(); } },
    onGpsError: (e) => { if (lastFix) return; setMeta(e.code === 1 ? '<span class="stale">Location blocked: allow it to show where you are</span>' : '<span class="stale">GPS not available yet</span>'); placePin(BONNY); }
  });
  onReset(() => lm.destroy && lm.destroy());
  setMeta();

  $('#request').onclick = (e) => act(e.target, async () => {
    upd();
    let lat = pin ? pin.getLatLng().lat : null, lng = pin ? pin.getLatLng().lng : null;
    if (lat == null && usePin) { const pos = await getPos(); if (pos) { lat = pos.latitude; lng = pos.longitude; } }
    await api('/rides', { method: 'POST', body: {
      service: svc, from_zone: f.from, to_zone: f.to, vehicle_type: f.type, pickup_note: f.pickup, dropoff_note: f.dropoff,
      pickup_lat: lat, pickup_lng: lng, item_desc: f.item, recipient_name: f.recName, recipient_phone: f.recPhone, item_cost: f.cost } });
    viewRide();
  });
  loadQuote();
}

async function loadQuote() {
  const f = S.form, box = $('#quote'), btn = $('#request');
  if (!box) return;
  if (!f.from || !f.to) { box.innerHTML = ''; btn.disabled = true; return; }
  try {
    const qt = await api(`/public/quote?from=${f.from}&to=${f.to}&type=${f.type}&service=${f.service || 'ride'}`, { auth: false });
    if (qt.fare == null) {
      box.innerHTML = `<div class="ticket unset"><div><small>Fare</small><span class="amt">Not set</span></div><div class="small">The association hasn't set this ${VEH[f.type].toLowerCase()} fare yet.</div></div>`;
      btn.disabled = true;
    } else {
      const parts = [qt.serviceFee ? `Includes ${naira(qt.serviceFee)} ${f.service} fee` : '', qt.night && qt.surcharge ? 'Includes night surcharge' : ''].filter(Boolean);
      box.innerHTML = `<div class="ticket"><div><small>Fixed fare, no haggling</small><span class="amt">${naira(qt.fare)}</span></div>
        <div style="text-align:right"><small>${parts.join(' · ') || 'Standard fare'}</small><small>${S.meta.settings.online_payments ? 'Pay online, cash or transfer' : 'Pay cash or transfer'}</small></div></div>
        ${f.service === 'errand' && f.cost ? `<p class="muted small">Plus about ${naira(f.cost)} for the items, paid to the rider on delivery.</p>` : ''}`;
      btn.disabled = false;
    }
  } catch (e) { fail(e); }
}

function driverCard(r) {
  return `<div class="card">
    <div class="person"><div class="avatar">${esc(initials(r.driver_name))}</div>
      <div><h3>${esc(r.driver_name)}</h3><div class="verified">✔ Verified by the association</div>
      <div class="muted small">${r.driver_rating ? '★ ' + esc(r.driver_rating) : 'New driver'}</div></div></div>
    <dl class="kv"><dt>Vehicle</dt><dd>${VEH_ICON[r.vehicle_type]} ${esc(r.vehicle_desc || VEH[r.vehicle_type])}</dd>
      <dt>Plate</dt><dd>${esc(r.plate)}</dd><dt>Permit</dt><dd>${esc(r.permit_no)}</dd></dl></div>`;
}

const MAP_BLOCK = '<p id="paxGps" class="notice warn small" hidden></p><div id="map" class="map" role="region" aria-label="Live map"></div><div id="mapMeta" class="map-meta"></div>';
function renderActive(r) {
  resetView();
  const svc = r.service || 'ride';
  const route = `${esc(r.from_name)} to ${esc(r.to_name)}`;
  const who = r.driver_name ? esc(r.driver_name.split(' ')[0]) : '';
  const riderWord = svc === 'ride' ? 'driver' : 'rider';
  const codeCard = r.delivery_code ? `<div class="card code-card"><span class="label">Delivery code</span><div class="code">${esc(r.delivery_code)}</div>
      <p class="small muted">${svc === 'parcel'
        ? `${esc(r.recipient_name)} got this code by SMS. The rider needs it to finish the delivery. If the SMS didn't arrive, call them and share it.`
        : 'Give this code to the rider only after you receive your items.'}</p></div>` : '';
  const jobCard = svc !== 'ride' ? `<div class="card"><dl class="kv">
      <dt>${svc === 'parcel' ? 'Parcel' : 'Errand'}</dt><dd>${esc(r.item_desc)}</dd>
      ${svc === 'parcel' ? `<dt>Recipient</dt><dd>${esc(r.recipient_name)}, ${esc(localPhone(r.recipient_phone))}</dd>` : ''}
      ${r.item_cost ? `<dt>Items (cash)</dt><dd>about ${naira(r.item_cost)}</dd>` : ''}
      <dt>Fare</dt><dd>${naira(r.fare)}</dd></dl></div>` : '';
  let html = '';
  if (r.status === 'cancelled') {
    html = `<div class="center" style="padding-top:2rem"><h2>${r.cancelled_by === 'timeout' ? `No ${riderWord} accepted in time` : `Your ${riderWord} is no longer available`}</h2>
      <p class="muted" style="margin-top:.5rem">${route}. Try again, or choose a different vehicle type.</p></div>
      <button class="btn" data-a="dismiss">Try again</button>`;
  } else if (r.status === 'requested') {
    html = `<div class="center"><div class="pulse"></div><h2>Finding a verified ${VEH[r.vehicle_type].toLowerCase()} ${riderWord}</h2>
      <p class="muted" style="margin-top:.4rem">${SERVICE[svc].icon} ${svc === 'ride' ? '' : SVC_NOUN[svc] + ', '}${route}. Fare ${naira(r.fare)}.</p></div>
      ${codeCard}${jobCard}
      <button class="btn ghost" data-a="cancel">Cancel request</button>`;
  } else if (r.status === 'accepted' || r.status === 'arrived') {
    const head = svc === 'ride'
      ? (r.status === 'arrived' ? `${who} has arrived` : `${who} is on the way`)
      : svc === 'parcel' ? (r.status === 'arrived' ? `${who} is here to collect the parcel` : `${who} is coming to collect your parcel`)
      : (r.status === 'arrived' ? `${who} is at ${esc(r.pickup_note || r.from_name)}` : `${who} is heading to ${esc(r.pickup_note || r.from_name)}`);
    html = `<h2>${head}</h2>
      ${r.status === 'arrived' && svc !== 'errand' ? `<p class="notice">Check the plate matches: <b>${esc(r.plate)}</b></p>` : ''}
      ${MAP_BLOCK}
      ${codeCard}${jobCard}
      ${driverCard(r)}
      ${svc === 'ride' ? `<div class="ticket"><div><small>Fixed fare</small><span class="amt">${naira(r.fare)}</span></div><div style="text-align:right"><small>${route}</small></div></div>` : ''}
      <div class="row"><a class="btn ghost" href="tel:+${esc(r.driver_phone)}">Call ${riderWord}</a><button class="btn ghost" data-a="share">Share ${svc === 'ride' ? 'trip' : 'tracking'}</button></div>
      <button class="link" data-a="cancel">Cancel ${svc === 'ride' ? 'ride' : SVC_NOUN[svc]}</button>`;
  } else if (r.status === 'started') {
    const head = svc === 'ride' ? `On the way to ${esc(r.to_name)}` : svc === 'parcel' ? `Parcel on the way to ${esc(r.recipient_name)}` : 'Your items are on the way';
    html = `<h2>${head}</h2>
      <p class="muted">${svc === 'ride' ? `With ${esc(r.driver_name)}, ${esc(r.plate)}. This trip is being recorded.` : `${esc(r.driver_name)}, ${esc(r.plate)}. Follow the ${riderWord} live on the map.`}</p>
      ${MAP_BLOCK}
      <div class="row"><button class="btn ghost" data-a="share">Share ${svc === 'ride' ? 'trip' : 'tracking'}</button>${svc === 'ride' ? '<button class="btn danger" data-a="sos">SOS</button>' : `<a class="btn ghost" href="tel:+${esc(r.driver_phone)}">Call rider</a>`}</div>
      ${codeCard}${jobCard}
      ${driverCard(r)}`;
  } else if (r.status === 'completed') {
    return renderPayRate(r);
  }
  app.innerHTML = html;
  bindRideActions(r);
  let lm = null;
  if ($('#map')) {
    // Passenger phone is the tracker only when the passenger is inside the vehicle (rides). Deliveries follow the rider's phone.
    const onTrip = r.status === 'started' && svc === 'ride';
    let fix = null, sentAt = 0, gotFix = false;
    const send = (force) => {
      if (!fix || (!force && Date.now() - sentAt < 5000)) return;
      sentAt = Date.now();
      api(`/rides/${r.id}/location`, { method: 'POST', body: { lat: fix.latitude, lng: fix.longitude } }).catch(() => {});
    };
    lm = liveMap($('#map'), $('#mapMeta'), {
      icon: VEH_ICON[r.vehicle_type], selfVehicle: onTrip,
      onFix: (c) => { gotFix = true; const n = $('#paxGps'); if (n) n.hidden = true; if (onTrip) { fix = c; send(); } },
      onGpsError: (e) => { const n = $('#paxGps'); if (!n || (e.code !== 1 && gotFix)) return; n.hidden = false; n.textContent = e.code === 1
        ? "Location is blocked on this phone. Allow location for this site to see where you are on the map."
        : "Can't get your GPS right now."; }
    });
    onReset(() => lm.destroy && lm.destroy());
    if (onTrip) {
      const keep = setInterval(() => send(true), 10000);
      GPS.keepAwake(true);
      onReset(() => { clearInterval(keep); GPS.keepAwake(false); });
    }
    api(`/rides/${r.id}/track`).then(t => lm.update(t)).catch(() => {});
  }
  if (['requested', 'accepted', 'arrived', 'started'].includes(r.status)) {
    const key = r.status;
    poll(async () => {
      const { ride } = await api('/rides/active');
      if (!ride || ride.status !== key || ride.id !== r.id) return viewRide();
      if (lm) lm.update(await api(`/rides/${r.id}/track`));
    });
  } else stopPoll();
}

// Trip finished: pay (online, cash or transfer) and rate. After an online payment only the rating remains.
function renderPayRate(r) {
  stopPoll();
  const svc = r.service || 'ride';
  const who = esc((r.driver_name || '').split(' ')[0]);
  const title = { ride: "You've arrived", parcel: 'Parcel delivered', errand: 'Errand complete' }[svc];
  const online = S.meta.settings.online_payments;
  let pay = 'cash', stars = 0;
  const stars5 = `<div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`).join('')}</div>`;
  if (r.paid_at) {
    app.innerHTML = `<h2>${title}</h2><p class="notice">✔ ${naira(r.fare)} paid online. Thank you.</p>
      <span class="label">Rate ${who}</span>${stars5}
      <button class="btn" id="rate" disabled>Submit rating</button>
      <button class="link" data-a="complain">Report a problem</button>`;
  } else {
    app.innerHTML = `<h2>${title}</h2>
      <div class="ticket"><div><small>Fare for ${who}</small><span class="amt">${naira(r.fare)}</span></div><div style="text-align:right"><small>${esc(r.from_name)} to ${esc(r.to_name)}</small></div></div>
      ${svc === 'errand' && r.item_cost ? `<p class="notice warn small">Also pay the rider for the items (about ${naira(r.item_cost)}) in cash, against the receipt.</p>` : ''}
      ${online ? `<button class="btn keke" id="payOnline">Pay ${naira(r.fare)} online (card, bank, USSD)</button><div class="or"><span>or pay the ${svc === 'ride' ? 'driver' : 'rider'} directly</span></div>` : ''}
      <div class="row"><button class="chip" data-pay="cash" aria-pressed="true">Cash<small>Handed over</small></button><button class="chip" data-pay="transfer" aria-pressed="false">Transfer<small>To their account</small></button></div>
      <div id="xfer" hidden>${transferCard(r, r.fare, (r.driver_name || '').split(' ')[0])}</div>
      <span class="label">Rate ${who}</span>${stars5}
      <button class="btn" id="confirm" disabled>Confirm payment</button>
      <button class="link" data-a="complain">Report a problem</button>`;
  }
  $$('[data-pay]').forEach(b => b.onclick = () => { pay = b.dataset.pay; $$('[data-pay]').forEach(x => x.setAttribute('aria-pressed', x === b)); if ($('#xfer')) $('#xfer').hidden = pay !== 'transfer'; });
  $$('[data-star]').forEach(b => b.onclick = () => { stars = +b.dataset.star; $$('[data-star]').forEach(x => x.classList.toggle('on', +x.dataset.star <= stars)); ($('#confirm') || $('#rate')).disabled = false; });
  const done = (msg) => { toast(msg); Object.assign(S.form, { pickup: '', dropoff: '', item: '', recName: '', recPhone: '', cost: '' }); saveForm(); viewRide(); };
  if ($('#confirm')) $('#confirm').onclick = (e) => act(e.target, async () => { await api(`/rides/${r.id}/confirm`, { method: 'POST', body: { pay_method: pay, rating: stars } }); done('Payment confirmed. Thank you.'); });
  if ($('#rate')) $('#rate').onclick = (e) => act(e.target, async () => { await api(`/rides/${r.id}/rate`, { method: 'POST', body: { rating: stars } }); done('Thanks for rating.'); });
  if ($('#payOnline')) $('#payOnline').onclick = (e) => act(e.target, async () => payRedirect(`/pay/ride/${r.id}`));
  bindRideActions(r);
}

// Starts a Paystack checkout and sends the browser to it; Paystack returns to /?pay=REF
async function payRedirect(path, body) {
  const out = await api(path, { method: 'POST', body });
  sessionStorage.setItem('waka_pay_ref', out.ref);
  location.href = out.authorization_url;
  await new Promise(() => {}); // keep the button in its busy state while the page changes
}

async function handlePayReturn(ref) {
  history.replaceState(null, '', '/');
  app.innerHTML = '<div class="center" style="padding-top:3rem"><div class="pulse"></div><h2>Confirming your payment…</h2></div>';
  let p = null;
  for (let i = 0; i < 4; i++) {
    try { p = (await api('/pay/verify/' + encodeURIComponent(ref))).payment; } catch (e) { fail(e); break; }
    if (p.status === 'success') break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (p && p.status === 'success') toast({ ride: 'Payment received. Thank you.', seat: 'Seats paid and confirmed.', sub_week: 'Subscription renewed for 1 week.', sub_auto: 'Automatic weekly payment is on.' }[p.kind] || 'Payment received.');
  else toast('Payment was not completed. You can try again.', true);
  const dest = p && p.kind === 'seat' ? 'intercity' : p && p.kind.startsWith('sub') ? 'driver' : null;
  if (dest && menuFor().some(([k]) => k === dest)) go(dest); else home();
}

function bindRideActions(r) {
  $$('[data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'cancel') return act(b, async () => { await api(`/rides/${r.id}/cancel`, { method: 'POST' }); toast('Ride cancelled.'); viewRide(); });
    if (a === 'dismiss') return act(b, async () => { await api(`/rides/${r.id}/dismiss`, { method: 'POST' }); viewRide(); });
    if (a === 'share') return shareTrip(r);
    if (a === 'sos') return sosSheet(`/rides/${r.id}/sos`);
    if (a === 'complain') return complainSheet(r.id);
  });
}

function shareTrip(r) {
  const url = `${location.origin}/?t=${encodeURIComponent(r.token)}`;
  const text = `I'm on a Waka Bonny ${VEH[r.vehicle_type].toLowerCase()} from ${r.from_name} to ${r.to_name}. Driver: ${r.driver_name}, plate ${r.plate}, permit ${r.permit_no}. Follow the trip: ${url}`;
  sheet(`<h3>Share this trip</h3><div class="card small">${esc(text)}</div>
    <a class="btn keke" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Send on WhatsApp</a>
    <a class="btn ghost" href="sms:?&body=${encodeURIComponent(text)}">Send by SMS</a>
    <button class="btn ghost" id="copyLink">Copy link</button><button class="link" id="closeS">Close</button>`);
  $('#copyLink').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Trip details copied.'); } catch { toast('Copy failed. Select the text above instead.', true); } };
  $('#closeS').onclick = closeSheet;
}

function sosSheet(path) {
  const s = S.meta.settings;
  sheet(`<h3>Send an SOS?</h3><p class="muted">Your trip details go to the association safety desk straight away.</p>
    <label class="field"><span class="label">What's happening? (optional)</span><input id="sosNote"></label>
    <button class="btn danger" id="sendSos">Send SOS</button>
    ${s.safety_desk_phone ? `<a class="btn ghost" href="tel:+${esc(s.safety_desk_phone)}">Call the safety desk</a>` : ''}
    ${S.user.emergency_phone ? `<a class="btn ghost" href="tel:+${esc(S.user.emergency_phone)}">Call my emergency contact</a>` : ''}
    <button class="link" id="closeS">Cancel</button>`);
  $('#sendSos').onclick = (e) => act(e.target, async () => { await api(path, { method: 'POST', body: { note: $('#sosNote').value } }); closeSheet(); toast('SOS sent to the safety desk.'); });
  $('#closeS').onclick = closeSheet;
}

function complainSheet(rideId) {
  sheet(`<h3>Report a problem</h3><p class="muted small">The association reviews every report. Repeated problems lead to strikes and suspension.</p>
    <label class="field"><span class="label">What happened?</span><textarea id="cText" maxlength="500"></textarea></label>
    <button class="btn" id="sendC">Send report</button><button class="link" id="closeS">Cancel</button>`);
  $('#sendC').onclick = (e) => act(e.target, async () => { await api(`/rides/${rideId}/complaint`, { method: 'POST', body: { text: $('#cText').value } }); closeSheet(); toast('Report sent to the association.'); });
  $('#closeS').onclick = closeSheet;
}

function askBadge() {
  sheet(`<h3>Check a driver's badge</h3><p class="muted small">Scan the QR code on the vehicle with your phone camera, or type the code printed under it.</p>
    <label class="field"><span class="label">Badge code</span><input id="bcode" autocapitalize="characters" maxlength="8"></label>
    <button class="btn" id="checkB">Check driver</button><button class="link" id="closeS">Cancel</button>`);
  $('#checkB').onclick = () => { const c = $('#bcode').value.trim(); if (c) { closeSheet(); viewBadge(c); } };
  $('#closeS').onclick = closeSheet;
}

// Public badge check (QR on vehicle -> /?badge=CODE)
async function viewBadge(codeValue) {
  stopPoll(); S.view = 'badge'; nav(menuFor());
  app.innerHTML = '<p class="muted">Checking badge…</p>';
  let d;
  try { d = await api('/public/badge/' + encodeURIComponent(codeValue), { auth: false }); }
  catch (e) { app.innerHTML = `<div class="notice bad">${esc(e.message)}</div><button class="btn ghost" id="back">Back</button>`; $('#back').onclick = home; return; }
  const ok = d.status === 'approved';
  const island = ['keke', 'okada', 'taxi'].includes(d.vehicle_type);
  const f = S.form;
  app.innerHTML = `
    <h1>${ok ? 'Verified driver' : 'Not verified'}</h1>
    ${ok ? '' : `<div class="notice bad">This driver is ${esc(d.status)}. Do not board. Report the vehicle to the association.</div>`}
    <div class="card"><div class="person"><div class="avatar">${esc(initials(d.name))}</div>
      <div><h3>${esc(d.name)}</h3>${ok ? '<div class="verified">✔ Verified by the association</div>' : ''}
      <div class="muted small">${d.rating ? '★ ' + esc(d.rating) + ' from ' : ''}${d.trips} completed trips</div></div></div>
      <dl class="kv"><dt>Vehicle</dt><dd>${VEH_ICON[d.vehicle_type]} ${esc(d.vehicle_desc || VEH[d.vehicle_type])}</dd><dt>Plate</dt><dd>${esc(d.plate)}</dd><dt>Permit</dt><dd>${esc(d.permit_no)}</dd></dl></div>
    ${ok && island ? (S.user && S.user.role === 'passenger' ? `
      <div class="card"><h3>Record this trip</h3><p class="muted small">Your trip will be logged with this driver, and you can share it and use SOS.</p>
        <label class="field"><span class="label">Where are you now?</span>${zoneField('hf', f.from)}</label>
        <label class="field"><span class="label">Where are you going?</span>${zoneField('ht', f.to)}</label>
        <button class="btn" id="hail">Start recorded trip</button></div>` :
      S.user ? '' : `<button class="btn" id="signin">Sign in to record this trip</button>`) : ''}
    <button class="btn ghost" id="back">Back</button>`;
  $('#back').onclick = () => { history.replaceState(null, '', '/'); home(); };
  if ($('#signin')) $('#signin').onclick = () => go('auth', false);
  if ($('#hail')) $('#hail').onclick = (e) => act(e.target, async () => {
    await api('/rides/hail', { method: 'POST', body: { badge_code: d.badge_code, from_zone: $('#hf').value, to_zone: $('#ht').value } });
    history.replaceState(null, '', '/'); toast('Trip started and recorded.'); go('ride');
  });
}

// Public trip share (/?t=TOKEN)
async function viewShare(tok) {
  S.view = 'share'; nav([]);
  const render = async () => {
    const r = await api('/public/share/' + encodeURIComponent(tok), { auth: false });
    const label = { requested: 'Looking for a driver', accepted: 'Driver on the way to pickup', arrived: 'Driver at pickup', started: 'On the trip now', completed: 'Arrived safely', cancelled: 'Trip cancelled' }[r.status];
    const head = `<h1>${esc(r.passenger)}'s trip</h1>
      <div class="notice ${r.status === 'started' ? 'warn' : ''}"><b>${label}</b>${r.completed_at ? ' at ' + fmtClock(r.completed_at) : r.started_at ? ', started ' + fmtClock(r.started_at) : ''}</div>`;
    if (shareMap) { $('#shareHead').innerHTML = head; shareMap.update(r.track); if (['completed', 'cancelled'].includes(r.status)) stopPoll(); return; }
    app.innerHTML = `<div id="shareHead">${head}</div>
      ${MAP_BLOCK}
      <div class="card"><dl class="kv"><dt>From</dt><dd>${esc(r.from_name)}${r.pickup_note ? ', ' + esc(r.pickup_note) : ''}</dd>
        <dt>To</dt><dd>${esc(r.to_name)}${r.dropoff_note ? ', ' + esc(r.dropoff_note) : ''}</dd>
        ${r.driver_name ? `<dt>Driver</dt><dd>${esc(r.driver_name)}</dd><dt>Vehicle</dt><dd>${VEH_ICON[r.vehicle_type]} ${esc(r.vehicle_desc || VEH[r.vehicle_type])}</dd><dt>Plate</dt><dd>${esc(r.plate)}</dd><dt>Permit</dt><dd>${esc(r.permit_no)}</dd>` : ''}</dl></div>
      <p class="muted small">This page updates automatically.</p>`;
    shareMap = liveMap($('#map'), $('#mapMeta'), { icon: VEH_ICON[r.vehicle_type], showMe: false });
    onReset(() => shareMap.destroy && shareMap.destroy());
    shareMap.update(r.track);
    if (['completed', 'cancelled'].includes(r.status)) stopPoll();
  };
  let shareMap = null;
  try { await render(); poll(render, 5000); } catch (e) { app.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
}

// ---------- passenger: Bonny <-> Port Harcourt ----------
async function viewIntercity() {
  const [{ routes }, { bookings }] = await Promise.all([api('/intercity/routes'), api('/intercity/bookings/mine')]);
  S.icRoute = S.icRoute || routes[0]?.id;
  const route = routes.find(r => r.id === S.icRoute) || routes[0];
  const s = S.meta.settings;
  const { departures } = route ? await api('/intercity/departures?route_id=' + route.id) : { departures: [] };
  const upcoming = bookings.filter(b => !['cancelled', 'no_show'].includes(b.status) && ['scheduled', 'boarding', 'departed'].includes(b.departure_status));
  app.innerHTML = `
    <h1>Bonny ⇄ Port Harcourt</h1>
    <p class="muted">Book a seat on a registered bus or Sienna over the Bodo-Bonny road. Every booking goes on the driver's manifest.</p>
    <div class="seg" role="group" aria-label="Direction">${routes.map(r => `<button data-route="${r.id}" aria-pressed="${route && r.id === route.id}">${esc(r.origin.replace(' (Abali Park)', ''))} to ${esc(r.destination.replace(' (Abali Park)', ''))}</button>`).join('')}</div>
    ${s.intercity_open_hour && s.intercity_close_hour ? `<p class="notice small">Departures run between ${esc(s.intercity_open_hour)}:00 and ${esc(s.intercity_close_hour)}:00.</p>` : ''}
    ${upcoming.length ? `<h2>Your seats</h2><div class="list">${upcoming.map(b => `
      <div class="card"><div class="row" style="align-items:center"><div><h3>${esc(b.origin)} to ${esc(b.destination)}</h3><div class="muted small">${fmtTime(b.depart_at)}, ${VEH[b.vehicle_type]} ${esc(b.plate)}</div></div>
        <span class="tag ${b.departure_status === 'departed' || b.status === 'held' ? 'warn' : ''}" style="flex:0 0 auto">${b.status === 'held' ? 'Awaiting payment' : b.departure_status === 'departed' ? 'On the road' : b.departure_status === 'boarding' ? 'Boarding' : 'Booked'}</span></div>
        ${b.status === 'held' ? `<p class="notice warn small">Seats held until ${fmtClock(b.hold_until)} while you pay. Unpaid holds are released automatically.</p>` : ''}
        <dl class="kv"><dt>Booking ref</dt><dd>${esc(b.ref)}</dd><dt>Seats</dt><dd>${b.seats}</dd><dt>Fare</dt><dd>${naira(b.price * b.seats)}${b.paid ? ' · <b>paid online ✔</b>' : ', pay at the park'}</dd><dt>Driver</dt><dd>${esc(b.driver_name)}, <a href="tel:+${esc(b.driver_phone)}">${esc(localPhone(b.driver_phone))}</a></dd></dl>
        ${!b.paid && b.status === 'booked' && b.driver_account ? `<details class="small"><summary>Pay the driver by transfer</summary>${transferCard(b, b.price * b.seats, b.driver_name.split(' ')[0])}</details>` : ''}
        ${!b.paid && ['held', 'booked'].includes(b.status) && S.meta.settings.online_payments && ['scheduled', 'boarding'].includes(b.departure_status) ? `<button class="btn keke sm" data-payb="${b.id}">Pay ${naira(b.price * b.seats)} online now</button>` : ''}
        <div class="row">${['boarding', 'departed'].includes(b.departure_status) ? `<button class="btn sm" data-trackb="${b.id}" data-veh="${b.vehicle_type}">Track vehicle</button>` : ''}${b.departure_status === 'departed' ? `<button class="btn danger sm" data-sos="${b.id}">SOS</button>` : b.paid ? '<span class="muted small">Paid online. To change or cancel, call the driver or the association desk.</span>' : `<button class="btn ghost sm" data-cancelb="${b.id}">Cancel booking</button>`}</div></div>`).join('')}</div>` : ''}
    <h2>Next departures</h2>
    <div class="list">${departures.length ? departures.map(d => `
      <div class="item"><div><b>${fmtTime(d.depart_at)}</b><div class="muted small">${VEH_ICON[d.vehicle_type]} ${VEH[d.vehicle_type]}, ${esc(d.plate)} · ${d.seats_left} of ${d.seats_total} seats left${d.status === 'boarding' ? ' · Boarding now' : ''}</div></div>
        <div class="acts"><b>${naira(d.price)}</b><button class="btn sm" data-book="${d.id}" ${d.seats_left < 1 ? 'disabled' : ''}>${d.seats_left < 1 ? 'Full' : 'Book'}</button></div></div>`).join('')
      : `<p class="muted">No departures listed yet for this direction. Check back soon, or ask at the park.</p>`}</div>`;
  $$('[data-route]').forEach(b => b.onclick = () => { S.icRoute = +b.dataset.route; viewIntercity().catch(fail); });
  $$('[data-book]').forEach(b => b.onclick = () => bookSheet(departures.find(d => d.id === +b.dataset.book)));
  $$('[data-cancelb]').forEach(b => b.onclick = () => act(b, async () => { await api(`/intercity/bookings/${b.dataset.cancelb}/cancel`, { method: 'POST' }); toast('Booking cancelled.'); viewIntercity(); }));
  $$('[data-sos]').forEach(b => b.onclick = () => sosSheet(`/intercity/bookings/${b.dataset.sos}/sos`));
  $$('[data-trackb]').forEach(b => b.onclick = () => trackBookingSheet(b.dataset.trackb, b.dataset.veh));
  $$('[data-payb]').forEach(b => b.onclick = () => act(b, () => payRedirect(`/pay/booking/${b.dataset.payb}`)));
  poll(() => ($('#modal').classList.contains('show') ? Promise.resolve() : viewIntercity()), 30000);
}

function trackBookingSheet(id, veh) {
  sheet(`<h3>Where's my ${VEH[veh] ? VEH[veh].toLowerCase() : 'vehicle'}?</h3>${MAP_BLOCK}<button class="btn ghost" id="closeS">Close</button>`, true);
  const lm = liveMap($('#map'), $('#mapMeta'), { icon: VEH_ICON[veh] || '🚐' });
  const load = () => api(`/intercity/bookings/${id}/track`).then(t => lm.update(t)).catch(() => {});
  load(); const timer = setInterval(load, 5000);
  S.sheetCleanup = () => { clearInterval(timer); lm.destroy && lm.destroy(); };
  $('#closeS').onclick = closeSheet;
}

function bookSheet(d) {
  const stops = (d.stops || '').split(',').filter(Boolean);
  const u = S.user;
  sheet(`<h3>Book ${VEH[d.vehicle_type].toLowerCase()} seats</h3>
    <p class="muted small">${esc(d.origin)} to ${esc(d.destination)}, ${fmtTime(d.depart_at)}. ${naira(d.price)} per seat, paid at the park.</p>
    <form id="bk" class="list">
      <label class="field"><span class="label">Seats</span><select name="seats">${Array.from({ length: Math.min(6, d.seats_left) }, (_, i) => `<option>${i + 1}</option>`).join('')}</select></label>
      <label class="field"><span class="label">Traveller name (for the manifest)</span><input name="passenger_name" value="${esc(u.name)}" required></label>
      <label class="field"><span class="label">Traveller phone</span><input name="passenger_phone" type="tel" value="${esc(localPhone(u.phone))}" required></label>
      <div class="row"><label class="field"><span class="label">Next of kin name</span><input name="nok_name" required></label>
        <label class="field"><span class="label">Next of kin phone</span><input name="nok_phone" type="tel" value="${esc(localPhone(u.emergency_phone))}" required></label></div>
      ${stops.length ? `<label class="field"><span class="label">Getting off at</span><select name="drop_stop">${stops.map((s, i) => `<option ${i === stops.length - 1 ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : ''}
      ${S.meta.settings.online_payments ? `<div class="field"><span class="label">Payment</span><div class="row">
        <button type="button" class="chip" data-bpay="online" aria-pressed="true">Pay now online<small>Card, bank, USSD</small></button>
        <button type="button" class="chip" data-bpay="park" aria-pressed="false">Pay at the park<small>Cash to the driver</small></button></div></div>` : ''}
      <button class="btn" type="submit">Book seats</button></form>
    <button class="link" id="closeS">Cancel</button>`);
  $('#closeS').onclick = closeSheet;
  let bpay = S.meta.settings.online_payments ? 'online' : 'park';
  $$('[data-bpay]').forEach(b => b.onclick = () => { bpay = b.dataset.bpay; $$('[data-bpay]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $('#bk').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => {
    const { booking } = await api(`/intercity/departures/${d.id}/book`, { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), pay: bpay } });
    if (bpay === 'online') return payRedirect(`/pay/booking/${booking.id}`);
    closeSheet(); toast(`Booked. Your reference is ${booking.ref}.`); viewIntercity();
  }); };
}

// ---------- passenger: history & account ----------
async function viewTrips() {
  const { rides } = await api('/rides/history');
  app.innerHTML = `<h1>History</h1>
    <div class="list">${rides.length ? rides.map(r => `<div class="item"><div><b>${esc(r.from_name)} to ${esc(r.to_name)}</b>
      <div class="muted small">${SERVICE[r.service || 'ride'].icon} ${fmtTime(r.created_at)} · ${VEH[r.vehicle_type]}${r.pay_method === 'paystack' ? ' · paid online' : ''}${r.driver_name ? ' · ' + esc(r.driver_name) : ''}${r.street_hail ? ' · Street hail' : ''}</div></div>
      <div class="acts"><b>${naira(r.fare)}</b><span class="tag ${r.status === 'completed' ? 'ok' : r.status === 'cancelled' ? '' : 'warn'}">${esc(r.status)}</span>
      ${r.status === 'completed' && r.driver_id ? `<button class="btn ghost sm" data-c="${r.id}">Report</button>` : ''}</div></div>`).join('')
      : `<p class="muted">No trips yet. Book your first ride from the Ride tab.</p>`}</div>`;
  $$('[data-c]').forEach(b => b.onclick = () => complainSheet(b.dataset.c));
}

async function viewAccount() {
  const u = S.user;
  app.innerHTML = `<h1>Account</h1>
    <div class="card"><dl class="kv"><dt>Name</dt><dd>${esc(u.name)}</dd><dt>Phone</dt><dd>${esc(localPhone(u.phone))}</dd><dt>Account</dt><dd>${esc(u.role)}</dd></dl></div>
    <form id="acc" class="card"><label class="field"><span class="label">Emergency contact phone</span><input name="emergency_phone" type="tel" value="${esc(localPhone(u.emergency_phone))}"></label>
      <p class="muted small">We show this number on the SOS screen and prefill it as next of kin for Port Harcourt trips.</p>
      <button class="btn" type="submit">Save emergency contact</button></form>
    <form id="cpin" class="card"><h3>Change PIN</h3>
      <label class="field"><span class="label">Current PIN</span><input name="current_pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" required></label>
      <div class="row"><label class="field"><span class="label">New PIN</span><input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></label>
      <label class="field"><span class="label">Repeat new PIN</span><input name="pin_confirm" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></label></div>
      <button class="btn ghost" type="submit">Change PIN</button></form>
    <button class="btn ghost" id="out">Sign out</button>`;
  $('#cpin').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => { const b = Object.fromEntries(new FormData(e.target)); if (b.pin !== b.pin_confirm) throw new Error('The two new PINs do not match.'); await api('/auth/change-pin', { method: 'POST', body: b }); e.target.reset(); toast('PIN changed.'); }); };
  $('#acc').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => { const out = await api('/auth/me', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); S.user = out.user; toast('Emergency contact saved.'); }); };
  $('#out').onclick = () => signOut();
}

// ---------- driver ----------
async function viewDriver() {
  const { user } = await api('/auth/me'); S.user = user;
  const d = user.driver;
  if (!d) { app.innerHTML = '<p>This account has no driver profile.</p>'; return; }
  if (d.status !== 'approved') {
    GPS.stop();
    const msg = { pending: ['Waiting for verification', 'Visit the association desk with your ID, vehicle papers and permit. Once you are approved you can start taking trips.'],
      rejected: ['Application not approved', 'Contact the association desk to find out why and what to bring.'],
      suspended: ['Account suspended', `You have ${d.strikes} strike(s). Contact the association desk to discuss reinstatement.`] }[d.status];
    app.innerHTML = `<div class="card"><h2>${msg[0]}</h2><p class="muted">${msg[1]}</p>
      <dl class="kv"><dt>Vehicle</dt><dd>${VEH_ICON[d.vehicle_type]} ${VEH[d.vehicle_type]}</dd><dt>Plate</dt><dd>${esc(d.plate)}</dd><dt>Permit</dt><dd>${esc(d.permit_no)}</dd></dl></div>
      ${d.status === 'pending' ? bankCard((await api('/driver/bank')).bank) : ''}
      <button class="btn ghost" id="refresh">Check again</button>`;
    bindBank();
    $('#refresh').onclick = () => viewDriver().catch(fail);
    return;
  }
  if (['bus', 'sienna'].includes(d.vehicle_type)) return viewOperator(d);
  return viewIslandDriver(d);
}

// Weekly subscription card shown to approved drivers when subscriptions are switched on
function subCard(sub) {
  if (sub && sub.campaign) return `<div class="card campaign"><h3>🎉 Free during our launch campaign</h3>
    <p class="small">No weekly fee for drivers${sub.campaign_end ? ` until ${esc(sub.campaign_end)}` : ''}. Go online, take trips and deliveries, and keep every naira you earn.</p></div>`;
  if (!sub || !sub.required) return '';
  const online = S.meta.settings.online_payments;
  const until = sub.paid_until ? fmtTime(sub.paid_until) : '';
  const btns = online ? `<div class="row" style="flex-wrap:wrap">
      ${sub.auto ? '<button class="btn ghost sm" data-sub="cancel">Stop automatic payment</button>' : `<button class="btn sm" data-sub="auto">Pay weekly automatically (card)</button>`}
      <button class="btn ghost sm" data-sub="once">Pay 1 week (${naira(sub.amount)})</button></div>`
    : '<p class="small">Pay the association desk in cash; they will renew your week.</p>';
  if (!sub.active) return `<div class="notice bad"><b>Subscription expired.</b> Renew your ${naira(sub.amount)} weekly subscription to go online and take trips.</div>${btns}`;
  return `<div class="card"><div class="row" style="align-items:center"><h3>Weekly subscription</h3><span class="tag ok" style="flex:0 0 auto">Active</span></div>
    <p class="small muted">Paid until ${until}${sub.auto ? '. Renews automatically every week.' : '.'}</p>${btns}</div>`;
}
// Driver's bank account, shown to their customers who choose to pay by transfer
function bankCard(bank) {
  if (!bank) return `<div class="card"><h3>🏦 Add your bank account</h3>
    <p class="small muted">Customers who pay by transfer will see your account number, so the money goes straight to you. Online fares are also paid out here.</p>
    <button class="btn sm" data-bank="edit">Add account number</button></div>`;
  return `<div class="card"><div class="row" style="align-items:center"><h3>🏦 Your bank account</h3>
      <span class="tag ${bank.verified ? 'ok' : 'warn'}" style="flex:0 0 auto">${bank.verified ? '✔ Verified' : 'Not verified'}</span></div>
    <p class="small"><b>${esc(bank.account_name)}</b><br>${esc(bank.bank_name)} · ${esc(bank.account_number)}</p>
    <div class="row"><button class="btn ghost sm" data-bank="edit">Change</button><button class="btn ghost sm" data-bank="remove">Remove</button></div></div>`;
}
function bindBank() {
  $$('[data-bank]').forEach(b => b.onclick = () => {
    if (b.dataset.bank === 'remove') {
      if (!confirm('Remove your bank account? Customers will no longer see it for transfers.')) return;
      return act(b, async () => { await api('/driver/bank', { method: 'DELETE' }); toast('Bank account removed.'); viewDriver(); });
    }
    bankSheet().catch(fail);
  });
}
async function bankSheet() {
  const [{ banks, verify }, { bank }] = await Promise.all([api('/driver/banks'), api('/driver/bank')]);
  sheet(`<h3>Your bank account</h3>
    <p class="muted small">${verify ? 'We check the number with your bank and show the account name, so customers can be sure the money reaches you.' : 'Enter the details exactly as your bank shows them.'}</p>
    <form id="bankF" class="list">
      ${verify ? `<label class="field"><span class="label">Bank</span><select name="bank_code" required><option value="">Choose your bank</option>
          ${banks.map(k => `<option value="${esc(k.code)}" ${bank && bank.bank_code === k.code ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></label>`
        : `<label class="field"><span class="label">Bank name</span><input name="bank_name" value="${esc(bank?.bank_name || '')}" required></label>`}
      <label class="field"><span class="label">Account number (10 digits)</span><input name="account_number" inputmode="numeric" pattern="[0-9]*" maxlength="10" value="${esc(bank?.account_number || '')}" required></label>
      ${verify ? '' : `<label class="field"><span class="label">Account name</span><input name="account_name" value="${esc(bank?.account_name || '')}" required></label>`}
      <button class="btn" type="submit">${verify ? 'Check and save' : 'Save'}</button></form>
    <button class="link" id="closeS">Cancel</button>`);
  $('#closeS').onclick = closeSheet;
  $('#bankF').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => {
    const body = Object.fromEntries(new FormData(e.target));
    if (verify) body.bank_name = e.target.bank_code.selectedOptions[0]?.textContent;
    const { bank: saved } = await api('/driver/bank', { method: 'PUT', body });
    closeSheet(); toast(saved.verified ? `Verified: ${saved.account_name}` : 'Bank account saved.'); viewDriver();
  }); };
}

// Transfer details shown to a customer for their own driver
function transferCard(bank, amount, who) {
  if (!bank || !bank.driver_account) return `<p class="muted small">${esc(who)} hasn't added a bank account yet. Ask them for their details before transferring.</p>`;
  return `<div class="card bank-card"><span class="label">Transfer ${amount ? naira(amount) + ' ' : ''}to ${esc(who)}</span>
    <div class="acct">${esc(bank.driver_account)}</div>
    <p class="small"><b>${esc(bank.driver_account_name)}</b> · ${esc(bank.driver_bank)} ${bank.driver_account_verified ? '<span class="tag ok">✔ name checked with bank</span>' : '<span class="tag warn">not verified</span>'}</p>
    <button class="btn ghost sm" type="button" data-copy="${esc(bank.driver_account)}">Copy account number</button></div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); toast('Account number copied.'); } catch { toast('Copy failed. Select the number instead.', true); }
});

function bindSub() {
  $$('[data-sub]').forEach(b => b.onclick = () => act(b, async () => {
    if (b.dataset.sub === 'cancel') { await api('/pay/subscription/cancel', { method: 'POST' }); toast('Automatic weekly payment stopped.'); return viewDriver(); }
    await payRedirect('/pay/subscription', { mode: b.dataset.sub });
  }));
}

async function viewIslandDriver(d) {
  resetView();
  const [sum, { ride }, sub, { bank }, { run }] = await Promise.all([api('/driver/summary'), api('/driver/active'), api('/driver/subscription'), api('/driver/bank'), api('/driver/run')]);
  if (run) return renderRun(d, run, sum);
  // GPS: every 4s on a job (screen kept awake), every 15s while waiting online, off when offline
  if (ride) { GPS.start(4000); GPS.keepAwake(true); }
  else if (d.online) { GPS.start(15000); GPS.keepAwake(false); }
  else GPS.stop();
  let body = '';
  if (ride) {
    const svc = ride.service || 'ride';
    const cust = esc(ride.passenger_name.split(' ')[0]);
    const startLbl = svc === 'ride' ? 'Passenger on board, start trip' : svc === 'parcel' ? 'Parcel collected, start delivery' : 'Items bought, start delivery';
    const endLbl = svc === 'ride' ? `End trip and collect ${naira(ride.fare)}` : `Delivered: enter the code`;
    const nextBtn = ride.status === 'accepted'
      ? `<button class="btn ghost" data-t="arrived">I've arrived at ${svc === 'errand' ? 'the shop' : 'pickup'}</button><button class="btn" data-t="start">${startLbl}</button><button class="link" data-t="release">I can't do this job</button>`
      : ride.status === 'arrived' ? `<button class="btn" data-t="start">${startLbl}</button><button class="link" data-t="release">${svc === 'ride' ? "Passenger didn't show up" : "I can't do this job"}</button>`
      : `<button class="btn keke" data-t="complete">${endLbl}</button>`;
    const head = ride.status === 'started'
      ? (svc === 'ride' ? `Heading to ${esc(ride.to_name)}` : `Deliver to ${svc === 'parcel' ? esc(ride.recipient_name) : cust} at ${esc(ride.to_name)}`)
      : (svc === 'ride' ? `Pick up ${cust} at ${esc(ride.from_name)}` : svc === 'parcel' ? `Collect a parcel from ${cust} at ${esc(ride.from_name)}` : `Errand for ${cust}: go to ${esc(ride.pickup_note || ride.from_name)}`);
    body = `<h2>${SERVICE[svc].icon} ${head}</h2>
      <div class="card"><dl class="kv">
        <dt>${svc === 'ride' ? 'Passenger' : 'Customer'}</dt><dd>${esc(ride.passenger_name)}</dd>
        ${svc !== 'ride' ? `<dt>${svc === 'parcel' ? 'Parcel' : 'Task'}</dt><dd>${esc(ride.item_desc)}</dd>` : ''}
        ${ride.item_cost ? `<dt>Items</dt><dd>about ${naira(ride.item_cost)}: you pay, the customer refunds you in cash</dd>` : ''}
        <dt>${svc === 'errand' ? 'Go to' : 'Pickup'}</dt><dd>${esc(ride.from_name)}${ride.pickup_note ? ', ' + esc(ride.pickup_note) : ''}</dd>
        <dt>${svc === 'ride' ? 'Drop-off' : 'Deliver to'}</dt><dd>${svc === 'parcel' ? esc(ride.recipient_name) + ', ' : ''}${esc(ride.to_name)}${ride.dropoff_note ? ', ' + esc(ride.dropoff_note) : ''}</dd>
        <dt>Fare</dt><dd>${naira(ride.fare)}${ride.pay_method === 'paystack' ? ' (paid online)' : ''}</dd></dl>
        <div class="row" style="flex-wrap:wrap"><a class="btn ghost" href="tel:+${esc(ride.passenger_phone)}">Call ${svc === 'ride' ? 'passenger' : 'customer'}</a>
        ${svc === 'parcel' ? `<a class="btn ghost" href="tel:+${esc(ride.recipient_phone)}">Call recipient</a>` : ''}</div>
        ${ride.pickup_lat != null && ride.status !== 'started' ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${ride.pickup_lat},${ride.pickup_lng}">Navigate to pickup</a>` : ''}</div>
      ${MAP_BLOCK}
      <p class="muted small">Keep this screen open during the job so the customer can follow you on the map.</p>
      ${nextBtn}`;
  } else if (d.online) {
    body = `<h2>Requests</h2><div id="reqs" class="list"><p class="muted">Looking for requests…</p></div>
      <div id="map" class="map map-sm" role="region" aria-label="Your location"></div><div id="mapMeta" class="map-meta"></div>`;
  } else {
    body = `<p class="muted">Go online to receive ride, parcel and errand requests near you.</p>
      <div id="map" class="map map-sm" role="region" aria-label="Your location"></div><div id="mapMeta" class="map-meta"></div>`;
  }
  app.innerHTML = `
    ${ride || d.online ? '<div id="gpsNote" class="notice gps-note"></div>' : ''}
    ${subCard(sub)}
    <div class="toggle ${d.online ? 'on' : 'off'}"><span>${d.online ? "You're online" : "You're offline"}</span>
      <button class="switch" role="switch" aria-checked="${d.online}" aria-label="Online" id="onl"></button></div>
    <label class="field"><span class="label">Area you're in now</span>${zoneField('zone', d.zone_id)}</label>
    <div class="stats"><div class="stat"><b>${naira(sum.earnings)}</b><span>Fares today</span></div><div class="stat"><b>${sum.trips}</b><span>Jobs today</span></div>
      <div class="stat"><b>${sum.rating ?? '—'}</b><span>Your rating</span></div>${sum.owed ? `<div class="stat"><b>${naira(sum.owed)}</b><span>Paid online, due to you</span></div>` : ''}
      ${sum.owes_depots ? `<div class="stat"><b>${naira(sum.owes_depots)}</b><span>Charges to hand to depot</span></div>` : ''}</div>
    ${body}
    ${ride ? '' : bankCard(bank)}
    <button class="link" id="badge">Show my QR badge</button>`;
  bindSub(); bindBank();
  $('#onl').onclick = (e) => act(e.target, async () => { await api('/driver/online', { method: 'POST', body: { online: !d.online, zone_id: $('#zone').value } }); viewDriver(); });
  $('#zone').onchange = () => api('/driver/online', { method: 'POST', body: { online: d.online, zone_id: $('#zone').value } }).then(() => toast('Area updated.')).catch(fail);
  $('#badge').onclick = () => badgeSheet(d);
  GPS.note();
  if ($('#map')) {
    // Your own location (blue dot); on a job, also the pickup pin
    const lm = liveMap($('#map'), null, { icon: VEH_ICON[d.vehicle_type] });
    onReset(() => lm.destroy && lm.destroy());
    if (ride && ride.pickup_lat != null && ride.status !== 'started') lm.update({ pickup: { lat: ride.pickup_lat, lng: ride.pickup_lng } });
  }
  $$('[data-t]').forEach(b => b.onclick = () => {
    if (b.dataset.t === 'complete' && ride.has_code) return deliveryCodeSheet(ride);
    act(b, async () => {
      await api(`/driver/rides/${ride.id}/${b.dataset.t}`, { method: 'POST' });
      if (b.dataset.t === 'complete') toast(ride.pay_method === 'paystack' ? 'Trip complete. Already paid online.' : `Trip complete. Collect ${naira(ride.fare)}.`);
      viewDriver();
    });
  });
  if (ride) {
    poll(async () => { const { ride: r } = await api('/driver/active'); if (!r || r.status !== ride.status) viewDriver(); }, 6000);
  } else if (d.online) {
    const load = async () => {
      const { requests, runs = [] } = await api('/driver/requests');
      const box = $('#reqs'); if (!box) return;
      const away = (r) => r.distance_km != null ? `📍 ${r.distance_km < 1 ? Math.round(r.distance_km * 1000) + ' m' : r.distance_km + ' km'} away` : (r.nearby ? 'In your area' : '');
      const runHtml = runs.map(r => `<div class="card run-card"><div class="row" style="align-items:center"><span class="tag warn" style="flex:0 0 auto">📦 Depot run</span><span class="small muted" style="text-align:right">${away(r)}</span></div>
          <div class="ticket"><div><small>You earn</small><span class="amt">${naira(r.fee_total)}</span></div><div style="text-align:right"><small>${r.packages} package(s)</small><small>from ${esc(r.depot_name)}</small></div></div>
          <p class="small">Deliver to: ${esc(r.areas || '')}. Collect each recipient's logistics charge and hand it to the depot at the end.</p>
          <button class="btn" data-run="${r.id}">Accept run</button></div>`).join('');
      box.innerHTML = runHtml + (requests.length ? requests.map(r => {
        const svc = r.service || 'ride';
        return `<div class="card"><div class="row" style="align-items:center"><span class="tag ${svc === 'ride' ? '' : 'warn'}" style="flex:0 0 auto">${SERVICE[svc].icon} ${SERVICE[svc].label}</span><span class="small muted" style="text-align:right">${away(r)}</span></div>
          <div class="ticket"><div><small>Fixed fare</small><span class="amt">${naira(r.fare)}</span></div>
          <div style="text-align:right"><small>${esc(r.from_name)}</small><small>to ${esc(r.to_name)}</small></div></div>
          ${svc !== 'ride' ? `<p class="small"><b>${svc === 'parcel' ? 'Parcel' : 'Task'}:</b> ${esc(r.item_desc)}</p>` : ''}
          ${r.item_cost ? `<p class="small">You pay about ${naira(r.item_cost)} for the items; the customer refunds you in cash on delivery.</p>` : ''}
          ${r.pickup_note ? `<p class="small">${svc === 'errand' ? 'Go to' : 'Pickup'}: ${esc(r.pickup_note)}</p>` : ''}
          <button class="btn" data-acc="${r.id}">Accept ${svc === 'ride' ? 'ride' : SERVICE[svc].label.toLowerCase()} for ${esc(r.passenger_first)}</button></div>`;
      }).join('') : (runs.length ? '' : `<p class="muted">No requests right now. Stay near busy spots like the jetty and market.</p>`));
      $$('[data-run]').forEach(b => b.onclick = () => act(b, async () => { await api(`/driver/runs/${b.dataset.run}/accept`, { method: 'POST' }); toast('Run accepted. Go to the depot to collect the packages.'); viewDriver(); }));
      $$('[data-acc]').forEach(b => b.onclick = () => act(b, async () => { await api(`/driver/rides/${b.dataset.acc}/accept`, { method: 'POST' }); toast('Accepted. Head to the pickup.'); viewDriver(); }));
    };
    await load(); poll(load, 4000);
  }
}

function deliveryCodeSheet(ride) {
  sheet(`<h3>Enter the delivery code</h3>
    <p class="muted small">${ride.service === 'parcel' ? `Ask ${esc(ride.recipient_name)} for the 4-digit code in their SMS.` : `Ask ${esc(ride.passenger_name.split(' ')[0])} for the 4-digit code shown in their app.`} Only enter it after handing over.</p>
    <label class="field"><span class="label">Delivery code</span><input id="dcode" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" class="code-input"></label>
    <button class="btn keke" id="dsub">Confirm delivery</button><button class="link" id="closeS">Cancel</button>`);
  $('#closeS').onclick = closeSheet;
  $('#dsub').onclick = (e) => act(e.target, async () => {
    await api(`/driver/rides/${ride.id}/complete`, { method: 'POST', body: { code: $('#dcode').value } });
    closeSheet(); toast(ride.pay_method === 'paystack' ? 'Delivered. Fare already paid online.' : `Delivered. Collect ${naira(ride.fare)}${ride.item_cost ? ' plus the item cost' : ''}.`); viewDriver();
  });
}

function badgeSheet(d) {
  const url = `${location.origin}/?badge=${d.badge_code}`;
  sheet(`<div class="print-only center"><h2>Waka Bonny verified driver</h2></div>
    <h3 class="no-print">Your QR badge</h3>
    <p class="muted small no-print">Print this and fix it where passengers can see it. Anyone who scans it sees your verified details and can record the trip.</p>
    <div class="qrbox" id="qr"></div><div class="code">${esc(d.badge_code)}</div>
    <p class="center small">${esc(S.user.name)} · ${esc(d.plate)} · Permit ${esc(d.permit_no)}</p>
    <button class="btn no-print" id="pr">Print badge</button><button class="link no-print" id="closeS">Close</button>`);
  if (window.QRCode) new QRCode($('#qr'), { text: url, width: 200, height: 200 }); else $('#qr').textContent = url;
  $('#pr').onclick = () => window.print();
  $('#closeS').onclick = closeSheet;
}

// ---------- bus / Sienna operator ----------
async function viewOperator(d) {
  resetView();
  const [{ routes }, { departures }, sub, { bank }] = await Promise.all([api('/intercity/routes'), api('/intercity/departures/mine'), api('/driver/subscription'), api('/driver/bank')]);
  const onRoad = departures.some(x => ['boarding', 'departed'].includes(x.status));
  if (onRoad) { GPS.start(5000); GPS.keepAwake(true); } else GPS.stop();
  const cap = d.vehicle_type === 'bus' ? 18 : 7;
  const s = S.meta.settings;
  app.innerHTML = `
    <h1>${VEH_ICON[d.vehicle_type]} Your departures</h1>
    ${subCard(sub)}
    ${bankCard(bank)}
    ${onRoad ? '<div id="gpsNote" class="notice gps-note"></div><p class="muted small">Keep this screen open while driving so booked passengers can track the vehicle.</p>' : ''}
    <form id="newDep" class="card"><h3>Add a departure</h3>
      <label class="field"><span class="label">Route</span><select name="route_id" required>${routes.map(r => `<option value="${r.id}">${esc(r.origin)} to ${esc(r.destination)} (${naira(d.vehicle_type === 'bus' ? r.price_bus : r.price_sienna)})</option>`).join('')}</select></label>
      <div class="row"><label class="field"><span class="label">Departure time</span><input name="depart_at" type="datetime-local" required></label>
        <label class="field"><span class="label">Seats for sale</span><input name="seats_total" type="number" min="1" max="${cap}" value="${cap}"></label></div>
      ${s.intercity_open_hour ? `<p class="muted small">Departures between ${esc(s.intercity_open_hour)}:00 and ${esc(s.intercity_close_hour)}:00 only.</p>` : ''}
      <button class="btn" type="submit">Publish departure</button></form>
    <div class="list">${departures.length ? departures.map(dp => `
      <div class="card"><div class="row" style="align-items:center"><div><h3>${esc(dp.origin)} to ${esc(dp.destination)}</h3><div class="muted small">${fmtTime(dp.depart_at)} · ${dp.seats_total - dp.seats_left} of ${dp.seats_total} seats booked · ${naira(dp.price)}</div></div>
        <span class="tag ${dp.status === 'departed' ? 'warn' : dp.status === 'arrived' ? 'ok' : ''}" style="flex:0 0 auto">${esc(dp.status)}</span></div>
        <div class="row" style="flex-wrap:wrap">
          <button class="btn ghost sm" data-man="${dp.id}">Manifest</button>
          ${dp.status === 'scheduled' ? `<button class="btn sm" data-st="boarding" data-id="${dp.id}">Start boarding</button>` : ''}
          ${['scheduled', 'boarding'].includes(dp.status) ? `<button class="btn keke sm" data-st="departed" data-id="${dp.id}">Depart now</button><button class="btn ghost sm" data-st="cancelled" data-id="${dp.id}">Cancel</button>` : ''}
          ${dp.status === 'departed' ? `<button class="btn sm" data-st="arrived" data-id="${dp.id}">Mark arrived</button>` : ''}
        </div></div>`).join('') : '<p class="muted">No departures yet. Add your next trip above so passengers can book seats.</p>'}</div>`;
  $('#newDep').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => {
    const b = Object.fromEntries(new FormData(e.target));
    b.depart_at = new Date(b.depart_at).toISOString();
    await api('/intercity/departures', { method: 'POST', body: b }); toast('Departure published. Passengers can now book.'); viewDriver();
  }); };
  $$('[data-st]').forEach(b => b.onclick = () => {
    const confirmMsg = { departed: 'Depart now? Unboarded bookings will be marked as no-shows.', cancelled: 'Cancel this departure? All bookings will be cancelled.' }[b.dataset.st];
    if (confirmMsg && !confirm(confirmMsg)) return;
    act(b, async () => { await api(`/intercity/departures/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.st } }); viewDriver(); });
  });
  $$('[data-man]').forEach(b => b.onclick = () => manifestSheet(+b.dataset.man));
  bindSub(); bindBank();
  GPS.note();
  poll(() => ($('#modal').classList.contains('show') ? Promise.resolve() : viewDriver()), 20000);
}

async function manifestSheet(id) {
  const { departure: dp, manifest } = await api(`/intercity/departures/${id}/manifest`);
  const canBoard = ['scheduled', 'boarding'].includes(dp.status);
  const seats = manifest.reduce((n, m) => n + m.seats, 0);
  sheet(`<h3>Passenger manifest</h3>
    <p class="small"><b>${esc(dp.origin)} to ${esc(dp.destination)}</b>, ${fmtTime(dp.depart_at)}<br>
    ${VEH[dp.vehicle_type]} ${esc(dp.plate)} · Driver ${esc(dp.driver_name)} (${esc(localPhone(dp.driver_phone))}) · Permit ${esc(dp.permit_no)}<br>${seats} of ${dp.seats_total} seats booked</p>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Ref</th><th>Traveller</th><th>Phone</th><th>Next of kin</th><th>Seats</th><th>Stop</th><th>Status</th><th class="no-print"></th></tr></thead><tbody>
    ${manifest.map((m, i) => `<tr><td>${i + 1}</td><td>${esc(m.ref)}</td><td>${esc(m.passenger_name)}</td><td>${esc(localPhone(m.passenger_phone))}</td>
      <td>${esc(m.nok_name)}<br>${esc(localPhone(m.nok_phone))}</td><td>${m.seats}</td><td>${esc(m.drop_stop || '')}</td><td>${m.status === 'held' ? 'awaiting payment' : esc(m.status)}${m.paid ? ' · <b>paid online</b>' : ''}</td>
      <td class="no-print">${canBoard && ['booked', 'boarded'].includes(m.status) ? `<button class="btn sm ${m.status === 'boarded' ? 'ghost' : ''}" data-board="${m.id}" data-undo="${m.status === 'boarded'}">${m.status === 'boarded' ? 'Undo' : 'Boarded'}</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="9" class="muted">No bookings yet.</td></tr>'}
    </tbody></table></div>
    <div class="row no-print"><button class="btn" id="pr">Print manifest</button><button class="btn ghost" id="closeS">Close</button></div>`, true);
  $('#pr').onclick = () => window.print();
  $('#closeS').onclick = closeSheet;
  $$('[data-board]').forEach(b => b.onclick = () => act(b, async () => {
    await api(`/intercity/bookings/${b.dataset.board}/board`, { method: 'POST', body: { undo: b.dataset.undo === 'true' } });
    manifestSheet(id);
  }));
}

// ======================= DEPOT AGENT =======================
const PKG_STATUS = {
  at_depot: ['At depot', ''], delivery_requested: ['Delivery requested', 'warn'], assigned: ['On a run', 'warn'],
  out_for_delivery: ['Out for delivery', 'warn'], delivered: ['Delivered', 'ok'], collected: ['Collected', 'ok'], returned: ['Returned', 'bad']
};
const pkgTag = (st) => `<span class="tag ${PKG_STATUS[st][1]}">${PKG_STATUS[st][0]}</span>`;
const DEPOT_TABS = [['add', 'Register'], ['collect', 'Hand over'], ['deliver', 'Deliveries'], ['runs', 'Runs']];

async function viewDepot() {
  resetView();
  S.depotTab = S.depotTab || 'add';
  const me = await api('/depot/me');
  const c = me.counts;
  app.innerHTML = `<h1>🏬 ${esc(me.depot.name)}</h1>
    <div class="stats"><div class="stat"><b>${c.at_depot}</b><span>Waiting at depot</span></div><div class="stat"><b>${c.delivery_requested}</b><span>Want delivery</span></div>
      <div class="stat"><b>${c.out}</b><span>Out on runs</span></div><div class="stat"><b>${c.done_today}</b><span>Handed over today</span></div>
      ${me.cash_due_from_drivers ? `<div class="stat"><b>${naira(me.cash_due_from_drivers)}</b><span>Cash due from drivers</span></div>` : ''}
      ${c.returned ? `<div class="stat"><b>${c.returned}</b><span>Returned, not checked in</span></div>` : ''}</div>
    <div class="seg" role="tablist">${DEPOT_TABS.map(([k, l]) => `<button data-dt="${k}" aria-pressed="${S.depotTab === k}">${l}</button>`).join('')}</div>
    <div id="dtab" class="list"></div>`;
  $$('[data-dt]').forEach(b => b.onclick = () => { S.depotTab = b.dataset.dt; stopPoll(); viewDepot().catch(fail); });
  const T = { add: dpAdd, collect: dpCollect, deliver: dpDeliver, runs: dpRuns };
  await T[S.depotTab]($('#dtab'), me);
}

// Parse pasted lines: "Name, Phone, Item, Charge" (commas or tabs, e.g. copied from Excel)
function parseBulk(text) {
  return text.split(/\r?\n/).map((l, i) => ({ l: l.trim(), i })).filter(x => x.l && !/^name\b/i.test(x.l)).map(({ l, i }) => {
    const c = l.split(/\t|,(?![^"]*"(?:[^"]*"[^"]*")*[^"]*$)|;/).map(x => x.replace(/^"|"$/g, '').trim());
    const phoneIdx = c.findIndex(x => /^\+?\d[\d\s-]{9,}$/.test(x));
    const name = c[0], phone = phoneIdx >= 0 ? c[phoneIdx] : c[1];
    const rest = c.filter((_, k) => k !== 0 && k !== (phoneIdx >= 0 ? phoneIdx : 1));
    const last = rest[rest.length - 1] || '';
    const isMoney = /^₦?\s?[\d,]+$/.test(last);
    return { line: i + 1, recipient_name: name, recipient_phone: phone, description: (isMoney ? rest.slice(0, -1) : rest).join(', '), charge: isMoney ? last : '0' };
  });
}

async function dpAdd(el) {
  const { packages } = await api('/depot/packages?status=at_depot,delivery_requested,returned');
  el.innerHTML = `
    <form id="p1" class="card"><h3>Register a package</h3>
      <div class="row"><label class="field"><span class="label">Recipient's name (as on the package)</span><input name="recipient_name" required></label>
        <label class="field"><span class="label">Recipient's phone</span><input name="recipient_phone" type="tel" inputmode="tel" required></label></div>
      <label class="field"><span class="label">What is it?</span><input name="description" placeholder="e.g. Carton of noodles, 2 bags of rice"></label>
      <div class="row"><label class="field"><span class="label">Logistics charge (₦)</span><input name="charge" inputmode="numeric" placeholder="0 if already paid"></label>
        <label class="field"><span class="label">Number of items</span><input name="qty" type="number" min="1" value="1"></label></div>
      <button class="btn" type="submit">Register and send SMS</button></form>
    <details class="card"><summary>Register many at once (paste a list)</summary>
      <p class="muted small">One package per line: <b>Name, Phone, Item, Charge</b>. You can copy rows straight from Excel or WhatsApp.</p>
      <textarea id="bulkText" rows="6" placeholder="Ibim George, 08031234567, Carton of noodles, 2500&#10;Mina Jumbo, 08051234567, Bag of rice, 3000"></textarea>
      <p id="bulkPrev" class="small muted"></p>
      <button class="btn" id="bulkGo" disabled>Register all</button><div id="bulkErr"></div></details>
    <h2>Waiting at the depot (${packages.length})</h2>
    <div class="list">${packages.map(p => `<div class="item"><div><b>${esc(p.recipient_name)}</b> · ${esc(localPhone(p.recipient_phone))}<div class="muted small">${esc(p.ref)} · ${esc(p.description || '')}${p.qty > 1 ? ' ×' + p.qty : ''} · ${naira(p.charge)} · ${fmtTime(p.created_at)}</div></div>
      <div class="acts">${pkgTag(p.status)}<button class="btn ghost sm" data-resend="${p.id}">Resend SMS</button></div></div>`).join('') || '<p class="muted">No packages waiting.</p>'}</div>`;
  $('#p1').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => {
    const { package: p } = await api('/depot/packages', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast(`${p.ref} registered. SMS sent to ${p.recipient_name.split(' ')[0]}.`); e.target.reset(); viewDepot();
  }); };
  const prev = () => { const rows = parseBulk($('#bulkText').value); $('#bulkPrev').textContent = rows.length ? `${rows.length} package(s) ready. First: ${rows[0].recipient_name}, ${rows[0].recipient_phone}, ${rows[0].description || '—'}, ₦${rows[0].charge}` : ''; $('#bulkGo').disabled = !rows.length; };
  $('#bulkText').oninput = prev;
  $('#bulkGo').onclick = (e) => act(e.target, async () => {
    const out = await api('/depot/packages/bulk', { method: 'POST', body: { rows: parseBulk($('#bulkText').value) } });
    toast(`${out.created} package(s) registered and SMS sent.`);
    if (out.errors.length) { $('#bulkErr').innerHTML = `<div class="notice bad small"><b>Not added:</b><br>${out.errors.map(x => `Line ${x.line}: ${esc(x.error)}`).join('<br>')}</div>`; $('#bulkText').value = ''; prev(); }
    else viewDepot();
  });
  $$('[data-resend]', el).forEach(b => b.onclick = () => act(b, async () => { const r = await api(`/depot/packages/${b.dataset.resend}/resend`, { method: 'POST' }); toast(r.sent ? 'SMS sent again.' : 'SMS queued (check SMS settings).'); }));
}

async function dpCollect(el) {
  el.innerHTML = `<form id="cs" class="row" style="align-items:end"><label class="field" style="flex:1"><span class="label">Recipient's name, phone or package ref</span><input name="q" value="${esc(S.collectQ || '')}" autofocus></label>
      <button class="btn" style="flex:0 0 auto;width:auto" type="submit">Find</button></form><div id="cres" class="list"></div>`;
  const find = async () => {
    const term = S.collectQ || '';
    if (!term) { $('#cres').innerHTML = '<p class="muted">Search for the person collecting. Ask for the pickup code from their SMS.</p>'; return; }
    const { packages } = await api('/depot/packages?q=' + encodeURIComponent(term));
    $('#cres').innerHTML = packages.map(p => `<div class="item"><div><b>${esc(p.recipient_name)}</b> · ${esc(localPhone(p.recipient_phone))}
        <div class="muted small">${esc(p.ref)} · ${esc(p.description || '')} · charge ${naira(p.charge)}</div></div>
        <div class="acts">${pkgTag(p.status)}${['at_depot', 'delivery_requested', 'returned'].includes(p.status) ? `<button class="btn sm" data-hand="${p.id}">Hand over</button><button class="btn ghost sm" data-book="${p.id}">Deliver</button>` : ''}</div></div>`).join('') || '<p class="muted">No package matches.</p>';
    $$('[data-hand]', el).forEach(b => b.onclick = () => handoverSheet(packages.find(p => p.id === +b.dataset.hand), find));
    $$('[data-book]', el).forEach(b => b.onclick = () => bookDeliverySheet(packages.find(p => p.id === +b.dataset.book), find));
  };
  $('#cs').onsubmit = (e) => { e.preventDefault(); S.collectQ = new FormData(e.target).get('q').trim(); find().catch(fail); };
  await find();
}

function handoverSheet(p, done) {
  let method = p.charge > 0 ? 'cash' : 'prepaid';
  sheet(`<h3>Hand over ${esc(p.ref)}</h3>
    <dl class="kv"><dt>Recipient</dt><dd>${esc(p.recipient_name)}, ${esc(localPhone(p.recipient_phone))}</dd><dt>Item</dt><dd>${esc(p.description || '—')}${p.qty > 1 ? ' ×' + p.qty : ''}</dd><dt>Charge</dt><dd><b>${naira(p.charge)}</b></dd></dl>
    <label class="field"><span class="label">Pickup code from their SMS</span><input id="hcode" inputmode="numeric" pattern="[0-9]*" maxlength="4" class="code-input" autocomplete="off"></label>
    ${p.charge > 0 ? `<span class="label">Payment</span><div class="row"><button class="chip" data-hm="cash" aria-pressed="true">Cash</button><button class="chip" data-hm="transfer" aria-pressed="false">Transfer</button><button class="chip" data-hm="prepaid" aria-pressed="false">Already paid</button></div>` : '<p class="muted small">No charge: already paid.</p>'}
    <details><summary>No code? (lost phone or SMS)</summary><p class="muted small">Check a photo ID matches the name on the package, then write what you checked. This is recorded.</p>
      <input id="hreason" placeholder="e.g. Checked voter's card, name matches"></details>
    <button class="btn keke" id="hgo">Confirm hand-over</button><button class="link" id="closeS">Cancel</button>`);
  $$('[data-hm]').forEach(b => b.onclick = () => { method = b.dataset.hm; $$('[data-hm]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
  $('#closeS').onclick = closeSheet;
  $('#hgo').onclick = (e) => act(e.target, async () => {
    await api(`/depot/packages/${p.id}/handover`, { method: 'POST', body: { code: $('#hcode').value, override_reason: $('#hreason').value, pay_method: method } });
    closeSheet(); toast(`${p.ref} handed over to ${p.recipient_name.split(' ')[0]}.`); done && done();
  });
}

function bookDeliverySheet(p, done) {
  sheet(`<h3>Deliver ${esc(p.ref)} to ${esc(p.recipient_name)}</h3>
    <label class="field"><span class="label">Delivery area</span>${zoneField('bz', p.zone_id)}</label>
    <label class="field"><span class="label">Address or landmark</span><input id="ba" value="${esc(p.address || '')}"></label>
    <label class="field"><span class="label">Delivery fee (₦, leave empty to use the fare table)</span><input id="bf" inputmode="numeric"></label>
    <button class="btn" id="bgo">Add to deliveries</button><button class="link" id="closeS">Cancel</button>`);
  $('#closeS').onclick = closeSheet;
  $('#bgo').onclick = (e) => act(e.target, async () => {
    const out = await api(`/depot/packages/${p.id}/delivery`, { method: 'POST', body: { zone_id: $('#bz').value, address: $('#ba').value, delivery_fee: $('#bf').value } });
    closeSheet(); toast(`Ready for delivery. Fee ${naira(out.delivery_fee)}.`); done && done();
  });
}

async function dpDeliver(el) {
  const { packages } = await api('/depot/packages?status=delivery_requested');
  const pick = new Set();
  el.innerHTML = `<p class="muted small">Recipients who asked for delivery. Tick the ones going in the same direction and send them as one run.</p>
    <div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="all" style="width:auto;min-height:0"></th><th>Recipient</th><th>Area</th><th>Address</th><th>Charge</th><th>Fee</th></tr></thead><tbody>
    ${packages.map(p => `<tr><td><input type="checkbox" data-pk="${p.id}" style="width:auto;min-height:0"></td><td><b>${esc(p.recipient_name)}</b><br><span class="small">${esc(localPhone(p.recipient_phone))} · ${esc(p.ref)}</span></td>
      <td>${esc(p.zone_name || '—')}</td><td class="small">${esc(p.address || '')}</td><td>${naira(p.charge)}</td><td>${naira(p.delivery_fee)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No delivery requests yet. Recipients request delivery from their SMS link, or use "Deliver" under Hand over.</td></tr>'}</tbody></table></div>
    <div class="row" style="align-items:end"><label class="field"><span class="label">Vehicle</span><select id="rv"><option value="okada">🏍️ Okada (small items)</option><option value="keke">🛺 Keke (bigger items)</option><option value="taxi">🚕 Taxi</option></select></label>
      <button class="btn" id="mk" disabled style="flex:0 0 auto;width:auto">Create run</button></div>`;
  const upd = () => { const n = pick.size, fee = packages.filter(p => pick.has(p.id)).reduce((a, p) => a + p.delivery_fee, 0); $('#mk').disabled = !n; $('#mk').textContent = n ? `Create run: ${n} package(s), driver earns ${naira(fee)}` : 'Create run'; };
  $$('[data-pk]', el).forEach(c => c.onchange = () => { c.checked ? pick.add(+c.dataset.pk) : pick.delete(+c.dataset.pk); upd(); });
  $('#all').onchange = (e) => { $$('[data-pk]', el).forEach(c => { c.checked = e.target.checked; c.checked ? pick.add(+c.dataset.pk) : pick.delete(+c.dataset.pk); }); upd(); };
  $('#mk').onclick = (e) => act(e.target, async () => {
    await api('/depot/runs', { method: 'POST', body: { package_ids: [...pick], vehicle_type: $('#rv').value } });
    toast('Run created. Nearby drivers can accept it now.'); S.depotTab = 'runs'; viewDepot();
  });
}

async function dpRuns(el) {
  const load = async () => {
    const { runs } = await api('/depot/runs');
    el.innerHTML = runs.map(r => {
      const pk = r.packages || [];
      const returned = pk.filter(p => p.status === 'returned').length;
      const st = { open: ['Waiting for a driver', 'warn'], accepted: ['Driver coming to depot', 'warn'], picked_up: ['Out for delivery', 'warn'], done: ['Finished', 'ok'], cancelled: ['Cancelled', ''] }[r.status];
      return `<div class="card"><div class="row" style="align-items:center"><h3>Run #${r.id} · ${VEH_ICON[r.vehicle_type]} ${pk.length} package(s)</h3><span class="tag ${st[1]}" style="flex:0 0 auto">${st[0]}</span></div>
        ${r.driver_name ? `<p class="small">Driver: <b>${esc(r.driver_name)}</b> ${esc(r.plate || '')} · <a href="tel:+${esc(r.driver_phone)}">${esc(localPhone(r.driver_phone))}</a></p>` : ''}
        <div class="list">${pk.map(p => `<div class="item small"><span>${esc(p.recipient_name)} · ${esc(p.zone_name || '')}${p.fail_reason ? `<br><span class="muted">${esc(p.fail_reason)}</span>` : ''}</span><span class="acts">${naira(p.charge + (p.delivery_fee || 0))} ${pkgTag(p.status)}</span></div>`).join('')}</div>
        ${r.status === 'done' ? `<p class="small">Driver earned <b>${naira(r.fee_total)}</b> in delivery fees. Logistics charges collected: <b>${naira(r.cash_due)}</b>${r.remitted_at ? ' · ✔ received by depot' : ''}.</p>` : ''}
        <div class="row" style="flex-wrap:wrap">
          ${['open', 'accepted'].includes(r.status) ? `<button class="btn ghost sm" data-rc="${r.id}">Cancel run</button>` : ''}
          ${r.status === 'done' && returned && !r.returns_received_at ? `<button class="btn sm" data-rr="${r.id}">${returned} returned package(s) back at depot</button>` : ''}
          ${r.status === 'done' && r.cash_due > 0 && !r.remitted_at ? `<button class="btn keke sm" data-rm="${r.id}" data-amt="${r.cash_due}">Received ${naira(r.cash_due)} from driver</button>` : ''}
        </div></div>`;
    }).join('') || '<p class="muted">No runs yet. Create one from Deliveries.</p>';
    $$('[data-rc]', el).forEach(b => b.onclick = () => { if (confirm('Cancel this run? Its packages go back to the delivery list.')) act(b, async () => { await api(`/depot/runs/${b.dataset.rc}/cancel`, { method: 'POST' }); load(); }); });
    $$('[data-rr]', el).forEach(b => b.onclick = () => act(b, async () => { const o = await api(`/depot/runs/${b.dataset.rr}/returns`, { method: 'POST' }); toast(`${o.returned} package(s) checked back in.`); viewDepot(); }));
    $$('[data-rm]', el).forEach(b => b.onclick = () => { if (confirm(`Confirm you received ${naira(+b.dataset.amt)} from the driver?`)) act(b, async () => { await api(`/depot/runs/${b.dataset.rm}/remit`, { method: 'POST' }); toast('Cash recorded.'); viewDepot(); }); });
  };
  await load(); poll(load, 10000);
}

// ======================= DRIVER: DEPOT RUN =======================
async function renderRun(d, run, sum) {
  resetView();
  GPS.start(4000); GPS.keepAwake(true);
  const pk = run.packages;
  const left = pk.filter(p => p.status === 'out_for_delivery');
  const nav = (lat, lng) => lat != null ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}">Navigate</a>` : '';
  let body;
  if (run.status === 'accepted') {
    body = `<h2>📦 Go to ${esc(run.depot_name)}</h2>
      <div class="card"><p>${esc(run.depot_address || '')}</p><div class="row"><a class="btn ghost sm" href="tel:+${esc(run.depot_phone || '')}">Call depot</a>${nav(run.depot_lat, run.depot_lng)}</div></div>
      <p class="small">Collect these ${pk.length} package(s). Check each ref and name:</p>
      <div class="list">${pk.map(p => `<div class="item small"><span><b>${esc(p.ref)}</b> · ${esc(p.recipient_name)}<br><span class="muted">${esc(p.description || '')}${p.qty > 1 ? ' ×' + p.qty : ''}</span></span><span>${esc(p.zone_name)}</span></div>`).join('')}</div>
      <button class="btn keke" id="picked">I have all ${pk.length} package(s)</button>`;
  } else {
    body = `<h2>📦 ${left.length ? `${left.length} stop(s) left` : 'All stops done'}</h2>
      ${MAP_BLOCK}
      <div class="list">${pk.map(p => {
        const total = p.charge + (p.delivery_fee || 0);
        if (p.status !== 'out_for_delivery') return `<div class="item small"><span>${esc(p.recipient_name)} · ${esc(p.zone_name)}</span>${pkgTag(p.status)}</div>`;
        return `<div class="card"><div class="row" style="align-items:center"><h3>${esc(p.recipient_name)}</h3><b style="flex:0 0 auto">${naira(total)}</b></div>
          <p class="small">${esc(p.zone_name)} · ${esc(p.address || '')}<br><span class="muted">${esc(p.ref)} · ${esc(p.description || '')} · collect ${naira(p.charge)} charge + ${naira(p.delivery_fee)} delivery</span></p>
          <div class="row" style="flex-wrap:wrap"><a class="btn ghost sm" href="tel:+${esc(p.recipient_phone)}">Call</a>${nav(p.drop_lat, p.drop_lng)}
            <button class="btn keke sm" data-dl="${p.id}">Delivered</button><button class="btn ghost sm" data-fl="${p.id}">Not delivered</button></div></div>`;
      }).join('')}</div>
      ${left.length ? '' : '<button class="btn keke" id="finish">Finish run</button>'}`;
  }
  app.innerHTML = `<div id="gpsNote" class="notice gps-note"></div>
    <div class="stats"><div class="stat"><b>${naira(run.fee_total)}</b><span>You earn on this run</span></div><div class="stat"><b>${naira(pk.filter(p => p.status === 'delivered').reduce((a, p) => a + p.charge, 0))}</b><span>Charges collected for depot</span></div></div>
    ${body}`;
  GPS.note();
  if ($('#map')) {
    const lm = liveMap($('#map'), null, { icon: VEH_ICON[d.vehicle_type] });
    onReset(() => lm.destroy && lm.destroy());
    const first = left.find(p => p.drop_lat != null);
    if (first) lm.update({ pickup: { lat: first.drop_lat, lng: first.drop_lng } });
  }
  if ($('#picked')) $('#picked').onclick = (e) => act(e.target, async () => { await api(`/driver/runs/${run.id}/picked`, { method: 'POST' }); toast('Recipients have been told you are on the way.'); viewDriver(); });
  $$('[data-dl]').forEach(b => b.onclick = () => {
    const p = pk.find(x => x.id === +b.dataset.dl); let m = 'cash';
    sheet(`<h3>Deliver to ${esc(p.recipient_name)}</h3>
      <p class="small">Collect <b>${naira(p.charge + (p.delivery_fee || 0))}</b>: ${naira(p.charge)} logistics charge (for the depot) + ${naira(p.delivery_fee)} delivery (yours).</p>
      <label class="field"><span class="label">Code from their SMS</span><input id="rcode" inputmode="numeric" pattern="[0-9]*" maxlength="4" class="code-input" autocomplete="off"></label>
      <div class="row"><button class="chip" data-rm2="cash" aria-pressed="true">Paid cash</button><button class="chip" data-rm2="transfer" aria-pressed="false">Paid by transfer</button></div>
      <button class="btn keke" id="rgo">Confirm delivery</button><button class="link" id="closeS">Cancel</button>`);
    $$('[data-rm2]').forEach(x => x.onclick = () => { m = x.dataset.rm2; $$('[data-rm2]').forEach(y => y.setAttribute('aria-pressed', y === x)); });
    $('#closeS').onclick = closeSheet;
    $('#rgo').onclick = (e) => act(e.target, async () => { await api(`/driver/runs/${run.id}/packages/${p.id}/delivered`, { method: 'POST', body: { code: $('#rcode').value, pay_method: m } }); closeSheet(); toast(`${p.recipient_name.split(' ')[0]}'s package delivered.`); viewDriver(); });
  });
  $$('[data-fl]').forEach(b => b.onclick = () => {
    const p = pk.find(x => x.id === +b.dataset.fl);
    sheet(`<h3>Couldn't deliver to ${esc(p.recipient_name)}?</h3><p class="muted small">Bring the package back to the depot. The recipient can collect it there.</p>
      <label class="field"><span class="label">What happened?</span><input id="freason" placeholder="e.g. Not at home, phone switched off"></label>
      <button class="btn danger" id="fgo">Mark not delivered</button><button class="link" id="closeS">Cancel</button>`);
    $('#closeS').onclick = closeSheet;
    $('#fgo').onclick = (e) => act(e.target, async () => { await api(`/driver/runs/${run.id}/packages/${p.id}/failed`, { method: 'POST', body: { reason: $('#freason').value } }); closeSheet(); viewDriver(); });
  });
  if ($('#finish')) $('#finish').onclick = (e) => act(e.target, async () => {
    const o = await api(`/driver/runs/${run.id}/finish`, { method: 'POST' });
    sheet(`<h3>Run finished 🎉</h3><dl class="kv"><dt>Delivered</dt><dd>${o.delivered}</dd>${o.returned ? `<dt>Bring back</dt><dd>${o.returned} package(s)</dd>` : ''}
      <dt>You earned</dt><dd><b>${naira(o.earned)}</b></dd><dt>Hand to depot</dt><dd><b>${naira(o.cash_to_depot)}</b> (logistics charges you collected)</dd></dl>
      <p class="small muted">Take the charges${o.returned ? ' and the undelivered packages' : ''} back to ${esc(o.depot)}. They will confirm it in the app.</p>
      <button class="btn" id="closeS">Done</button>`);
    $('#closeS').onclick = () => { closeSheet(); viewDriver(); };
  });
  poll(async () => { const { run: r } = await api('/driver/run'); if (!r || r.status !== run.status) viewDriver(); }, 10000);
}

// ======================= RECIPIENT PACKAGE PAGE (/?p=TOKEN) =======================
async function viewPackage(tok) {
  S.view = 'package'; nav(S.user ? menuFor() : []); resetView();
  let map = null;
  const render = async () => {
    const p = await api('/public/package/' + encodeURIComponent(tok), { auth: false });
    const total = p.charge + (p.delivery_fee || 0);
    const head = `<h1>📦 Package ${esc(p.ref)}</h1>
      <p class="muted">For ${esc(p.recipient_name)}${p.description ? ` · ${esc(p.description)}` : ''}${p.qty > 1 ? ` ×${p.qty}` : ''}</p>
      ${['collected', 'delivered'].includes(p.status) ? '' : `<div class="card code-card"><span class="label">Your pickup / delivery code</span><div class="code">${esc(p.code)}</div>
        <p class="small muted">Give this code only when the package is in your hands.</p></div>`}`;
    let body = '';
    if (['at_depot', 'returned'].includes(p.status)) {
      body = `${p.status === 'returned' ? `<p class="notice warn small">A delivery was attempted${p.fail_reason ? ` (${esc(p.fail_reason)})` : ''}. It's back at the depot.</p>` : ''}
        <div class="card"><h3>Collect at the depot</h3><p class="small"><b>${esc(p.depot.name)}</b><br>${esc(p.depot.address || '')}</p>
          <p class="small">Pay <b>${naira(p.charge)}</b> there and show your code.</p>${p.depot.phone ? `<a class="btn ghost sm" href="tel:+${esc(p.depot.phone)}">Call the depot</a>` : ''}</div>
        <form id="dv" class="card"><h3>Or get it delivered</h3>
          <label class="field"><span class="label">Your area</span>${zoneField('dz', p.zone_id, 'zone_id')}</label>
          <label class="field"><span class="label">Street, house or landmark</span><input name="address" value="${esc(p.address || '')}" required></label>
          <label class="small"><input type="checkbox" id="useLoc" checked style="width:auto;min-height:0"> Share my location so the rider finds me</label>
          <p id="dq" class="small"></p>
          <button class="btn keke" type="submit">Deliver to me</button></form>`;
    } else if (p.status === 'delivery_requested') {
      body = `<div class="card"><h3>Delivery requested ✔</h3><p class="small">To ${esc(p.zone_name)}, ${esc(p.address || '')}. The depot will send it out with a verified rider.</p>
        <p>Pay the rider on delivery: <b>${naira(total)}</b><br><span class="small muted">${naira(p.charge)} logistics + ${naira(p.delivery_fee)} delivery</span></p>
        <button class="btn ghost sm" id="coll">I'll collect it at the depot instead</button></div>`;
    } else if (p.status === 'assigned') {
      body = `<div class="card"><h3>A rider has been assigned</h3><p class="small">${esc(p.driver?.name || '')} ${esc(p.driver?.plate || '')} will collect it from the depot soon. Have <b>${naira(total)}</b> ready.</p></div>`;
    } else if (p.status === 'out_for_delivery') {
      body = `<div class="card"><h3>On the way 🛵</h3><p class="small">${esc(p.driver.name)} · ${esc(p.driver.plate)}. Have <b>${naira(total)}</b> ready.</p>
        <a class="btn ghost sm" href="tel:+${esc(p.driver.phone)}">Call the rider</a></div>${MAP_BLOCK}`;
    } else {
      body = `<div class="card"><h3>${p.status === 'delivered' ? 'Delivered ✔' : 'Collected ✔'}</h3><p class="small">This package has been handed over. Thank you for using Waka Bonny.</p></div>`;
    }
    const sig = p.status + (p.delivery_fee || '');
    if (render.sig === sig && map) { map.update(p.track); return; }
    render.sig = sig; resetView(); map = null;
    app.innerHTML = head + body;
    if ($('#map')) { map = liveMap($('#map'), $('#mapMeta'), { icon: VEH_ICON[p.driver?.vehicle_type] || '🏍️' }); onReset(() => map.destroy && map.destroy()); map.update(p.track); }
    if ($('#dz')) {
      const quote = async () => { const z = $('#dz').value; if (!z) { $('#dq').textContent = ''; return; }
        const { delivery_fee } = await api(`/public/package/${encodeURIComponent(tok)}/quote?zone=${z}`, { auth: false });
        $('#dq').innerHTML = delivery_fee == null ? '<span class="stale">Delivery to this area is not priced yet. Call the depot.</span>' : `Delivery fee <b>${naira(delivery_fee)}</b>. Total to pay the rider: <b>${naira(p.charge + delivery_fee)}</b>`; };
      $('#dz').onchange = () => quote().catch(fail); quote().catch(() => {});
      $('#dv').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => {
        const b = Object.fromEntries(new FormData(e.target));
        if ($('#useLoc').checked) { const pos = await getPos(); if (pos) { b.lat = pos.latitude; b.lng = pos.longitude; } }
        await api(`/public/package/${encodeURIComponent(tok)}/deliver`, { method: 'POST', auth: false, body: b }); toast('Delivery requested.'); render.sig = null; render();
      }); };
    }
    if ($('#coll')) $('#coll').onclick = (e) => act(e.target, async () => { await api(`/public/package/${encodeURIComponent(tok)}/collect`, { method: 'POST', auth: false }); render.sig = null; render(); });
    if (['collected', 'delivered'].includes(p.status)) stopPoll();
  };
  try { await render(); poll(render, 8000); } catch (e) { app.innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
}

// ======================= ADMIN: DEPOTS =======================
async function adDepots(el) {
  const { depots } = await api('/admin/depots');
  el.innerHTML = `<form id="dpf" class="card"><h3>Add a depot</h3>
      <div class="row"><label class="field"><span class="label">Name</span><input name="name" placeholder="e.g. Jetty Cargo Depot" required></label>
        <label class="field"><span class="label">Area</span>${zoneField('dpz', '', 'zone_id')}</label></div>
      <div class="row"><label class="field"><span class="label">Address</span><input name="address"></label><label class="field"><span class="label">Depot phone</span><input name="phone" type="tel"></label></div>
      <div class="row" style="align-items:end"><label class="field"><span class="label">Latitude</span><input name="lat" inputmode="decimal"></label><label class="field"><span class="label">Longitude</span><input name="lng" inputmode="decimal"></label>
        <button type="button" class="btn ghost" id="here" style="flex:0 0 auto;width:auto">Use my location</button></div>
      <p class="muted small">Stand at the depot and tap "Use my location" so drivers see how far away it is. Delivery fees are worked out from the depot's area.</p>
      <button class="btn" type="submit">Save depot</button></form>
    ${depots.map(d => `<div class="card"><div class="row" style="align-items:center"><h3>🏬 ${esc(d.name)}</h3><span class="tag ${d.active ? 'ok' : ''}" style="flex:0 0 auto">${d.active ? 'Active' : 'Off'}</span></div>
      <p class="small">${esc(d.zone_name || '')} · ${esc(d.address || '')}${d.phone ? ' · ' + esc(localPhone(d.phone)) : ''}${d.lat != null ? '' : ' · <span class="stale">no map location</span>'}</p>
      <p class="small">${d.waiting} waiting · ${d.out} out for delivery · ${d.handed} handed over</p>
      <span class="label">Agents</span>
      <div class="list">${(d.agents || []).map(a => `<div class="item small"><span>${esc(a.name)} · ${esc(localPhone(a.phone))}</span><button class="btn ghost sm" data-rma="${a.id}" data-dep="${d.id}">Remove</button></div>`).join('') || '<p class="muted small">No agents yet.</p>'}</div>
      <form class="row" data-adda="${d.id}" style="align-items:end"><label class="field"><span class="label">Add agent by phone (they sign up in the app first)</span><input name="phone" type="tel"></label><button class="btn sm" style="flex:0 0 auto" type="submit">Add</button></form>
      <button class="btn ghost sm" data-tog="${d.id}" data-on="${d.active}">${d.active ? 'Switch off' : 'Switch on'}</button></div>`).join('')}`;
  $('#here').onclick = async () => { const p = await getPos(); if (!p) return toast('Could not get your location.', true); $('#dpf [name=lat]').value = p.latitude.toFixed(6); $('#dpf [name=lng]').value = p.longitude.toFixed(6); };
  $('#dpf').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => { await api('/admin/depots', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Depot saved.'); adDepots(el); }); };
  $$('[data-adda]', el).forEach(f => f.onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => { await api(`/admin/depots/${f.dataset.adda}/agents`, { method: 'POST', body: Object.fromEntries(new FormData(f)) }); toast('Agent added. They see the Depot screen next time they open the app.'); adDepots(el); }); });
  $$('[data-rma]', el).forEach(b => b.onclick = () => act(b, async () => { await api(`/admin/depots/${b.dataset.dep}/agents/${b.dataset.rma}`, { method: 'DELETE' }); adDepots(el); }));
  $$('[data-tog]', el).forEach(b => b.onclick = () => act(b, async () => {
    const d = depots.find(x => x.id === +b.dataset.tog);
    await api('/admin/depots', { method: 'POST', body: { id: d.id, name: d.name, zone_id: d.zone_id, address: d.address, phone: d.phone, lat: d.lat, lng: d.lng, active: !d.active } }); adDepots(el);
  }));
}

// ---------- admin desk ----------
const ADMIN_TABS = [['overview', 'Overview'], ['users', 'Users'], ['drivers', 'Drivers'], ['fares', 'Fares & areas'], ['intercity', 'Bonny ⇄ PH'], ['depots', 'Depots'], ['payments', 'Payments'], ['safety', 'Safety'], ['settings', 'Settings']];
async function viewAdmin() {
  S.adminTab = S.adminTab || 'overview';
  app.innerHTML = `<div class="seg" role="tablist" style="overflow-x:auto">${ADMIN_TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-pressed="${S.adminTab === k}">${l}</button>`).join('')}</div><div id="tab" class="list"></div>`;
  $$('[data-tab]').forEach(b => b.onclick = () => { S.adminTab = b.dataset.tab; stopPoll(); viewAdmin().catch(fail); });
  const T = { overview: adOverview, users: adUsers, drivers: adDrivers, fares: adFares, intercity: adIntercity, depots: adDepots, payments: adPayments, safety: adSafety, settings: adSettings };
  await T[S.adminTab]($('#tab'));
}

async function adOverview(el) {
  const load = async () => {
    const [o, { rides }] = await Promise.all([api('/admin/overview'), api('/admin/rides/live')]);
    el.innerHTML = `
      ${o.safety.sos ? `<div class="notice bad"><b>${o.safety.sos} open SOS alert(s).</b> Go to the Safety tab now.</div>` : ''}
      ${o.fares_missing ? `<div class="notice warn">${o.fares_missing} fare(s) are still placeholders. Passengers can't book those routes until you set them under Fares & areas.</div>` : ''}
      <div class="stats">
        <div class="stat"><b>${o.drivers.approved}</b><span>Verified drivers</span></div>
        <div class="stat"><b>${o.drivers.online}</b><span>Online now</span></div>
        <div class="stat"><b>${o.drivers.pending}</b><span>Waiting for verification</span></div>
        <div class="stat"><b>${o.rides.live}</b><span>Live rides</span></div>
        <div class="stat"><b>${o.rides.today}</b><span>Rides completed today</span></div>
        <div class="stat"><b>${naira(o.rides.value_today)}</b><span>Fares today</span></div>
        <div class="stat"><b>${o.intercity.upcoming}</b><span>PH departures upcoming</span></div>
        <div class="stat"><b>${o.intercity.on_road}</b><span>Vehicles on the road</span></div>
        <div class="stat"><b>${o.safety.complaints}</b><span>Open complaints</span></div>
        <div class="stat"><b>${naira(o.payments.online_today)}</b><span>Paid online today</span></div>
        <div class="stat"><b>${naira(o.payments.owed_drivers)}</b><span>Online fares owed to drivers</span></div>
      </div>
      <h2>Live rides</h2>
      <div class="list">${rides.length ? rides.map(r => `<div class="item"><div><b>${esc(r.from_name)} to ${esc(r.to_name)}</b>
        <div class="muted small">${SERVICE[r.service || 'ride'].icon} ${VEH_ICON[r.vehicle_type]} ${esc(r.passenger_name)}${r.driver_name ? ' with ' + esc(r.driver_name) + ' (' + esc(r.plate) + ')' : ''}${r.street_hail ? ' · street hail' : ''}</div></div>
        <div class="acts"><span class="tag ${r.status === 'started' ? 'warn' : ''}">${esc(r.status)}</span><a class="btn ghost sm" href="/?t=${esc(r.token)}" target="_blank" rel="noopener">Track</a></div></div>`).join('') : '<p class="muted">No rides in progress.</p>'}</div>`;
  };
  await load(); poll(load, 10000);
}

async function adDrivers(el) {
  S.drvFilter = S.drvFilter ?? 'pending';
  const { drivers } = await api('/admin/drivers' + (S.drvFilter ? '?status=' + S.drvFilter : ''));
  el.innerHTML = `<div class="row" style="align-items:end"><label class="field"><span class="label">Show</span><select id="flt">
      ${[['pending', 'Waiting for verification'], ['approved', 'Approved'], ['suspended', 'Suspended'], ['rejected', 'Rejected'], ['', 'All drivers']].map(([v, l]) => `<option value="${v}" ${S.drvFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="table-wrap"><table><thead><tr><th>Driver</th><th>Vehicle</th><th>Plate / permit</th><th>Badge</th><th>Strikes</th><th>Subscription</th><th>Status</th><th></th></tr></thead><tbody>
    ${drivers.map(d => `<tr><td><b>${esc(d.name)}</b><br><a href="tel:+${esc(d.phone)}">${esc(localPhone(d.phone))}</a></td>
      <td>${VEH_ICON[d.vehicle_type]} ${VEH[d.vehicle_type]}<br><span class="muted small">${esc(d.vehicle_desc || '')}${d.owner_type === 'other' ? `<br>Owner: ${esc(d.owner_name)} ${esc(localPhone(d.owner_phone))}` : '<br>Owner-driver'}</span>
        ${d.account_number ? `<br><span class="small">🏦 ${esc(d.bank_name)} ${esc(d.account_number)}${d.account_verified ? ' ✔' : ' (unverified)'}</span>` : '<br><span class="muted small">No bank account</span>'}</td>
      <td>${esc(d.plate)}<br>${esc(d.permit_no)}</td><td>${esc(d.badge_code)}</td><td>${d.strikes}/3</td>
      <td>${d.sub_paid_until ? `<span class="tag ${d.sub_active ? 'ok' : 'bad'}">${d.sub_active ? 'to ' : 'expired '}${new Date(d.sub_paid_until).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}</span>${d.sub_auto ? ' <span class="tag">auto</span>' : ''}` : '<span class="muted small">not started</span>'}
        <br><button class="link small" data-d="add-week" data-id="${d.user_id}">+1 week (cash)</button></td>
      <td><span class="tag ${d.status === 'approved' ? 'ok' : d.status === 'pending' ? 'warn' : 'bad'}">${esc(d.status)}</span>${d.live ? ' <span class="tag">online</span>' : ''}</td>
      <td><div class="acts">
        ${d.status === 'pending' ? `<button class="btn sm" data-d="approve" data-id="${d.user_id}">Approve</button><button class="btn ghost sm" data-d="reject" data-id="${d.user_id}">Reject</button>` : ''}
        ${d.status === 'approved' ? `<button class="btn ghost sm" data-d="strike" data-id="${d.user_id}">Add strike</button><button class="btn danger sm" data-d="suspend" data-id="${d.user_id}">Suspend</button>` : ''}
        ${['suspended', 'rejected'].includes(d.status) ? `<button class="btn sm" data-d="reinstate" data-id="${d.user_id}">Reinstate</button>` : ''}
      </div></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No drivers in this list.</td></tr>'}
    </tbody></table></div>`;
  $('#flt').onchange = (e) => { S.drvFilter = e.target.value; adDrivers(el).catch(fail); };
  $$('[data-d]', el).forEach(b => b.onclick = () => {
    if (b.dataset.d === 'suspend' && !confirm('Suspend this driver? They will be taken offline straight away.')) return;
    if (b.dataset.d === 'add-week' && !confirm('Record a cash payment and add 1 week to this driver\'s subscription?')) return;
    act(b, async () => { await api(`/admin/drivers/${b.dataset.id}/${b.dataset.d}`, { method: 'POST' }); toast(b.dataset.d === 'add-week' ? '1 week added.' : 'Driver updated.'); adDrivers(el); });
  });
}

async function adFares(el) {
  S.fareType = S.fareType || 'keke';
  const { zones, hale, last_sync: ls } = await api('/admin/zones');
  const active = zones.filter(z => z.active);
  S.fareZone = S.fareZone || active[0]?.id;
  const { fares } = S.fareZone ? await api(`/admin/fares?vehicle_type=${S.fareType}&zone=${S.fareZone}`) : { fares: [] };
  const zName = zones.find(z => z.id === +S.fareZone)?.name || '';
  el.innerHTML = `
    <p class="muted">Fares are fixed per area pair and work in both directions. Leave a box empty to keep it as a placeholder: passengers can't book that route until it has a price.</p>
    <div class="row"><label class="field"><span class="label">Vehicle</span><select id="ft">${['keke', 'okada', 'taxi'].map(t => `<option value="${t}" ${S.fareType === t ? 'selected' : ''}>${VEH[t]}</option>`).join('')}</select></label>
      <label class="field"><span class="label">From area</span>${zoneField('fz', S.fareZone)}</label></div>
    <div class="table-wrap"><table><thead><tr><th>${esc(zName)} to / from</th><th>${VEH[S.fareType]} fare (₦)</th></tr></thead><tbody>
      ${fares.map(f => `<tr><td>${f.other_id === +S.fareZone ? 'Within ' + esc(zName) : esc(f.other_name)}</td>
        <td><input type="number" min="0" step="50" inputmode="numeric" data-a="${f.zone_a}" data-b="${f.zone_b}" value="${f.amount ?? ''}" placeholder="Not set"></td></tr>`).join('')}
    </tbody></table></div>
    <button class="btn" id="saveF">Save ${VEH[S.fareType].toLowerCase()} fares</button>
    <h2>Areas</h2>
    ${hale ? `<div class="card"><div class="row" style="align-items:center"><div><h3>Synced with Hale</h3>
        <p class="small muted">Areas follow Hale's neighbourhood list automatically every 30 minutes.${ls ? ` Last sync ${fmtTime(ls.at)}${ls.added && ls.added.length ? `: added ${esc(ls.added.join(', '))}` : ''}${ls.hidden && ls.hidden.length ? `; hidden ${esc(ls.hidden.join(', '))}` : ''}.` : ''}</p></div>
        <button class="btn sm" id="syncH" style="flex:0 0 auto">Sync from Hale now</button></div></div>` : ''}
    <p class="muted small">Each neighbourhood is a fare zone. New areas start with no fares: set them above, or copy them from a similar area (for example from an old name after a rename).</p>
    <div class="list">${zones.map(z => `<div class="item"><span>${esc(z.name)} ${z.active ? '' : '<span class="tag">hidden</span>'} ${z.source === 'manual' ? '<span class="tag">added here</span>' : ''}
        <br><span class="small ${z.fares_set ? 'muted' : 'stale'}">${z.fares_set ? z.fares_set + ' fare(s) set' : 'No fares set yet'}</span></span>
      <span class="acts">${z.active ? `<button class="btn ghost sm" data-cf="${z.id}" data-nm="${esc(z.name)}">Copy fares from…</button>` : ''}<button class="btn ghost sm" data-zt="${z.id}">${z.active ? 'Hide' : 'Show'}</button></span></div>`).join('')}</div>
    <form id="addZ" class="row"><input name="name" placeholder="New neighbourhood name" required><button class="btn" style="flex:0 0 auto;width:auto" type="submit">Add area</button></form>`;
  $('#ft').onchange = (e) => { S.fareType = e.target.value; adFares(el).catch(fail); };
  $('#fz').onchange = (e) => { if (e.target.value) { S.fareZone = +e.target.value; adFares(el).catch(fail); } };
  if ($('#syncH')) $('#syncH').onclick = (e) => act(e.target, async () => {
    const r = await api('/admin/zones/sync', { method: 'POST' }); await loadMeta();
    toast(`Synced ${r.total} areas from Hale.${r.added.length ? ' Added: ' + r.added.join(', ') + '.' : ''}${r.hidden.length ? ' Hidden: ' + r.hidden.join(', ') + '.' : ''}`); adFares(el);
  });
  $$('[data-cf]', el).forEach(b => b.onclick = () => {
    sheet(`<h3>Copy fares into ${esc(b.dataset.nm)}</h3>
      <p class="muted small">Copies every keke, okada and taxi fare from another area (including hidden ones, e.g. an old name). Fares already set for ${esc(b.dataset.nm)} are kept.</p>
      <label class="field"><span class="label">Copy from</span><select id="cfFrom">${zones.filter(z => z.id !== +b.dataset.cf && z.fares_set).map(z => `<option value="${z.id}">${esc(z.name)}${z.active ? '' : ' (hidden)'} · ${z.fares_set} fares</option>`).join('')}</select></label>
      <button class="btn" id="cfGo">Copy fares</button><button class="link" id="closeS">Cancel</button>`);
    $('#closeS').onclick = closeSheet;
    if (!$('#cfFrom').options.length) { $('#cfGo').disabled = true; $('#cfFrom').outerHTML = '<p class="muted small">No other area has fares yet.</p>'; return; }
    $('#cfGo').onclick = (e) => act(e.target, async () => { const r = await api(`/admin/zones/${b.dataset.cf}/copy-fares`, { method: 'POST', body: { from_zone: $('#cfFrom').value } }); closeSheet(); toast(`${r.copied} fare(s) copied.`); adFares(el); });
  });
  $('#saveF').onclick = (e) => act(e.target, async () => {
    const items = $$('input[data-a]', el).map(i => ({ zone_a: +i.dataset.a, zone_b: +i.dataset.b, amount: i.value }));
    await api('/admin/fares', { method: 'PUT', body: { vehicle_type: S.fareType, items } }); toast('Fares saved.');
  });
  $$('[data-zt]', el).forEach(b => b.onclick = () => act(b, async () => { await api(`/admin/zones/${b.dataset.zt}/toggle`, { method: 'POST' }); await loadMeta(); adFares(el); }));
  $('#addZ').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => { await api('/admin/zones', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); await loadMeta(); toast('Area added. Set its fares next.'); adFares(el); }); };
}

async function adIntercity(el) {
  const [{ routes }, { departures }] = await Promise.all([api('/admin/routes'), api('/admin/departures')]);
  el.innerHTML = `<h2>Routes and seat prices</h2>
    <p class="muted small">Leave a price empty to keep it as a placeholder. Drivers can't publish departures until their vehicle type has a price.</p>
    ${routes.map(r => `<form class="card" data-route="${r.id}"><h3>${esc(r.origin)} to ${esc(r.destination)}</h3>
      <div class="row"><label class="field"><span class="label">Bus seat (₦)</span><input name="price_bus" type="number" min="0" step="50" value="${r.price_bus ?? ''}" placeholder="Not set"></label>
        <label class="field"><span class="label">Sienna seat (₦)</span><input name="price_sienna" type="number" min="0" step="50" value="${r.price_sienna ?? ''}" placeholder="Not set"></label></div>
      <label class="field"><span class="label">Stops, in order, separated by commas</span><input name="stops" value="${esc(r.stops)}"></label>
      <button class="btn" type="submit">Save route</button></form>`).join('')}
    <h2>Departures</h2>
    <div class="table-wrap"><table><thead><tr><th>Time</th><th>Route</th><th>Vehicle</th><th>Booked</th><th>Status</th><th></th></tr></thead><tbody>
      ${departures.map(d => `<tr><td>${fmtTime(d.depart_at)}</td><td>${esc(d.origin)} to ${esc(d.destination)}</td><td>${VEH[d.vehicle_type]} ${esc(d.plate)}<br><span class="muted small">${esc(d.driver_name)}</span></td>
        <td>${d.seats_booked}/${d.seats_total}</td><td><span class="tag ${d.status === 'departed' ? 'warn' : ''}">${esc(d.status)}</span></td>
        <td><button class="btn ghost sm" data-man="${d.id}">Manifest</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No departures yet.</td></tr>'}
    </tbody></table></div>`;
  $$('form[data-route]', el).forEach(f => f.onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => {
    await api(`/admin/routes/${f.dataset.route}`, { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); toast('Route saved.');
  }); });
  $$('[data-man]', el).forEach(b => b.onclick = () => manifestSheet(+b.dataset.man).catch(fail));
}

async function adUsers(el) {
  const F = S.userFilter = S.userFilter || { q: '', role: '', status: '' };
  const qs = new URLSearchParams(Object.entries(F).filter(([, v]) => v)).toString();
  const { users, counts } = await api('/admin/users' + (qs ? '?' + qs : ''));
  el.innerHTML = `
    <div class="stats"><div class="stat"><b>${counts.passengers}</b><span>Customers</span></div><div class="stat"><b>${counts.drivers}</b><span>Drivers</span></div><div class="stat"><b>${counts.banned}</b><span>Banned</span></div></div>
    <form id="uf" class="row" style="flex-wrap:wrap;align-items:end">
      <label class="field" style="flex:2 1 220px"><span class="label">Search name or phone</span><input name="q" value="${esc(F.q)}" placeholder="e.g. Mina or 0803…"></label>
      <label class="field" style="flex:1 1 140px"><span class="label">Type</span><select name="role">${[['', 'Everyone'], ['passenger', 'Customers'], ['driver', 'Drivers'], ['admin', 'Admins']].map(([v, l]) => `<option value="${v}" ${F.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" style="flex:1 1 140px"><span class="label">Status</span><select name="status">${[['', 'Any'], ['active', 'Active'], ['banned', 'Banned']].map(([v, l]) => `<option value="${v}" ${F.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn" style="flex:0 0 auto;width:auto" type="submit">Search</button></form>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Type</th><th>Activity</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr><td><b>${esc(u.name)}</b>${u.phone_verified ? ' <span title="Phone verified by SMS">✔</span>' : ''}</td><td><a href="tel:+${esc(u.phone)}">${esc(localPhone(u.phone))}</a></td>
      <td>${u.role === 'driver' ? `${VEH_ICON[u.vehicle_type] || ''} Driver${u.plate ? '<br><span class="muted small">' + esc(u.plate) + '</span>' : ''}` : u.role === 'admin' ? 'Admin' : 'Customer'}</td>
      <td class="small">${u.booked ? u.booked + ' booked' : ''}${u.driven ? (u.booked ? '<br>' : '') + u.driven + ' driven' : ''}${u.complaints ? `<br><span class="tag warn">${u.complaints} complaint(s)</span>` : ''}${!u.booked && !u.driven ? '<span class="muted">none</span>' : ''}
        ${u.last_seen_at ? `<br><span class="muted">seen ${fmtTime(u.last_seen_at)}</span>` : ''}</td>
      <td class="small">${fmtTime(u.created_at)}</td>
      <td>${u.banned_at ? '<span class="tag bad">Banned</span>' : '<span class="tag ok">Active</span>'}</td>
      <td><button class="btn ghost sm" data-u="${u.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No users match.</td></tr>'}
    </tbody></table></div>
    ${users.length === 200 ? '<p class="muted small">Showing the newest 200. Search to find others.</p>' : ''}`;
  $('#uf').onsubmit = (e) => { e.preventDefault(); S.userFilter = Object.fromEntries(new FormData(e.target)); adUsers(el).catch(fail); };
  $$('[data-u]', el).forEach(b => b.onclick = () => userSheet(+b.dataset.u, () => adUsers(el).catch(fail)));
}

async function userSheet(id, refresh) {
  const { user: u, rides, complaints, actions, paid } = await api('/admin/users/' + id);
  const isAdmin = u.role === 'admin' || u.id === S.user.id;
  sheet(`<h3>${esc(u.name)} ${u.banned_at ? '<span class="tag bad">Banned</span>' : ''}</h3>
    <dl class="kv"><dt>Phone</dt><dd><a href="tel:+${esc(u.phone)}">${esc(localPhone(u.phone))}</a>${u.phone_verified ? ' ✔ verified' : ''}</dd>
      <dt>Account</dt><dd>${u.role === 'driver' ? `Driver, ${VEH[u.vehicle_type] || ''} ${esc(u.plate || '')} (${esc(u.driver_status)}, ${u.strikes} strikes)` : esc(u.role === 'passenger' ? 'Customer' : u.role)}</dd>
      <dt>Joined</dt><dd>${fmtTime(u.created_at)}</dd>${u.last_seen_at ? `<dt>Last active</dt><dd>${fmtTime(u.last_seen_at)}</dd>` : ''}
      ${u.emergency_phone ? `<dt>Emergency contact</dt><dd>${esc(localPhone(u.emergency_phone))}</dd>` : ''}
      <dt>Paid online</dt><dd>${naira(paid)}</dd>
      ${u.banned_at ? `<dt>Banned</dt><dd>${fmtTime(u.banned_at)}: ${esc(u.ban_reason)}</dd>` : ''}</dl>
    ${complaints.length ? `<h3>Complaints</h3><div class="list">${complaints.map(c => `<div class="item small"><span>${esc(c.text)}<br><span class="muted">${esc(c.kind)} · ${fmtTime(c.created_at)} · ${esc(c.status)}</span></span></div>`).join('')}</div>` : ''}
    <h3>Recent trips</h3>
    <div class="list">${rides.map(r => `<div class="item small"><span>${SERVICE[r.service || 'ride'].icon} ${esc(r.from_name)} to ${esc(r.to_name)}<br><span class="muted">${fmtTime(r.created_at)} · ${esc(r.as_role)} · ${esc(r.status)}</span></span><b>${naira(r.fare)}</b></div>`).join('') || '<p class="muted small">No trips.</p>'}</div>
    ${actions.length ? `<h3>Moderation history</h3><div class="list">${actions.map(a => `<div class="item small"><span><b>${esc(a.action)}</b>${a.reason ? ': ' + esc(a.reason) : ''}<br><span class="muted">by ${esc(a.admin_name)}, ${fmtTime(a.created_at)}</span></span></div>`).join('')}</div>` : ''}
    ${isAdmin ? '<p class="muted small">Admin accounts cannot be banned or deleted here.</p>' : `
    <div id="modBox" class="card">
      <h3>Take action</h3>
      <label class="field"><span class="label">Reason (the user sees this if banned)</span><input id="modReason" maxlength="300" placeholder="e.g. Harassed a driver on 12 Sept"></label>
      <div class="row" style="flex-wrap:wrap">
        ${u.banned_at ? '<button class="btn sm" id="unban">Unban</button>' : '<button class="btn danger sm" id="ban">Ban user</button>'}
        <button class="btn ghost sm" id="delStart">Delete account…</button>
      </div>
      <div id="delBox" hidden class="list">
        <p class="notice bad small">Permanent. Their name, phone, PIN, emergency contact, saved places and GPS history are erased. Trip and payment records stay, anonymised, for your accounts. Pending trips and unpaid bookings are cancelled.</p>
        <label class="small"><input type="checkbox" id="blockNo" checked style="width:auto;min-height:0"> Also block this phone number from creating a new account</label>
        <label class="field"><span class="label">Type DELETE to confirm</span><input id="delConfirm" autocomplete="off"></label>
        <button class="btn danger" id="delGo">Delete permanently</button>
      </div>
    </div>`}
    <button class="btn ghost" id="closeS">Close</button>`, true);
  $('#closeS').onclick = closeSheet;
  if (isAdmin) return;
  const reason = () => $('#modReason').value.trim();
  if ($('#ban')) $('#ban').onclick = (e) => act(e.target, async () => {
    if (!reason()) throw new Error('Enter a reason for the ban.');
    await api(`/admin/users/${u.id}/ban`, { method: 'POST', body: { reason: reason() } });
    toast(`${u.name} is banned and signed out.`); closeSheet(); refresh();
  });
  if ($('#unban')) $('#unban').onclick = (e) => act(e.target, async () => {
    await api(`/admin/users/${u.id}/unban`, { method: 'POST', body: { reason: reason() } });
    toast(`${u.name} can use the app again.`); closeSheet(); refresh();
  });
  $('#delStart').onclick = () => { $('#delBox').hidden = false; $('#delConfirm').focus(); };
  $('#delGo').onclick = (e) => act(e.target, async () => {
    if (!reason()) throw new Error('Enter a reason for deleting this account.');
    const out = await api(`/admin/users/${u.id}/delete`, { method: 'POST', body: { reason: reason(), confirm: $('#delConfirm').value, block_phone: $('#blockNo').checked } });
    toast('Account deleted.' + (out.paidSeats ? ` Note: ${out.paidSeats} paid seat booking(s) may need a refund.` : '') + (out.subCancelFailed ? ' Cancel their Paystack subscription manually.' : ''));
    closeSheet(); refresh();
  });
}

async function adPayments(el) {
  const { owed, payments } = await api('/admin/payouts');
  el.innerHTML = `<h2>Online fares owed to drivers</h2>
    <p class="muted small">Passengers who paid by Paystack paid the platform, so each driver is owed those fares. Pay them (bank transfer), then mark as paid out.</p>
    <div class="table-wrap"><table><thead><tr><th>Driver</th><th>Vehicle</th><th>Jobs</th><th>Owed</th><th>Since</th><th></th></tr></thead><tbody>
    ${owed.map(o => `<tr><td><b>${esc(o.name)}</b><br><a href="tel:+${esc(o.phone)}">${esc(localPhone(o.phone))}</a></td><td>${VEH[o.vehicle_type]} ${esc(o.plate)}<br>${o.account_number ? `<span class="small">🏦 ${esc(o.bank_name)} ${esc(o.account_number)}<br>${esc(o.account_name)}${o.account_verified ? ' ✔' : ' (unverified)'}</span>` : '<span class="tag warn">No bank account</span>'}</td>
      <td>${o.trips}</td><td><b>${naira(o.amount)}</b></td><td>${fmtTime(o.since)}</td><td><button class="btn sm" data-po="${o.id}" data-amt="${o.amount}">Mark paid out</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">Nothing owed right now.</td></tr>'}</tbody></table></div>
    <h2>Recent payments</h2>
    <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>For</th><th>Amount</th><th>Status</th><th>Ref</th></tr></thead><tbody>
    ${payments.map(p => `<tr><td>${fmtTime(p.paid_at || p.created_at)}</td><td>${esc(p.name)}</td>
      <td>${{ ride: 'Ride / delivery', seat: 'PH seats', sub_week: 'Subscription (1 week)', sub_auto: 'Subscription (auto)' }[p.kind]}</td>
      <td>${naira(p.amount)}</td><td><span class="tag ${p.status === 'success' ? 'ok' : p.status === 'failed' ? 'bad' : ''}">${esc(p.status)}</span></td><td class="small">${esc(p.ref)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="muted">No payments yet.</td></tr>'}</tbody></table></div>`;
  $$('[data-po]', el).forEach(b => b.onclick = () => {
    if (!confirm(`Confirm you have paid ${naira(+b.dataset.amt)} to this driver?`)) return;
    act(b, async () => { await api(`/admin/payouts/${b.dataset.po}`, { method: 'POST' }); toast('Marked as paid out.'); adPayments(el); });
  });
}

async function adSafety(el) {
  const load = async () => {
    const [{ alerts }, { complaints }] = await Promise.all([api('/admin/sos'), api('/admin/complaints')]);
    el.innerHTML = `<h2>SOS alerts</h2>
      <div class="list">${alerts.length ? alerts.map(a => `<div class="card" style="${a.resolved ? '' : 'border-color:var(--danger);border-width:2px'}">
        <div class="row" style="align-items:center"><h3>${esc(a.user_name)}</h3><span class="tag ${a.resolved ? '' : 'bad'}" style="flex:0 0 auto">${a.resolved ? 'Resolved' : 'Open'}</span></div>
        <p class="small muted">${fmtTime(a.created_at)}${a.from_name ? ` · ${esc(a.from_name)} to ${esc(a.to_name)} · ${esc(a.driver_name || '')} ${esc(a.plate || '')}` : ''}${a.booking_ref ? ` · Port Harcourt booking ${esc(a.booking_ref)}` : ''}</p>
        ${a.note ? `<p>“${esc(a.note)}”</p>` : ''}
        <div class="row" style="flex-wrap:wrap"><a class="btn sm" href="tel:+${esc(a.user_phone)}">Call passenger</a>
          ${a.emergency_phone ? `<a class="btn ghost sm" href="tel:+${esc(a.emergency_phone)}">Call their contact</a>` : ''}
          ${a.token ? `<a class="btn ghost sm" href="/?t=${esc(a.token)}" target="_blank" rel="noopener">Track trip</a>` : ''}
          ${a.resolved ? '' : `<button class="btn ghost sm" data-res="${a.id}">Mark resolved</button>`}</div></div>`).join('') : '<p class="muted">No SOS alerts.</p>'}</div>
      <h2>Complaints</h2>
      <div class="list">${complaints.length ? complaints.map(c => `<div class="card">
        <div class="row" style="align-items:center"><h3>${esc(c.driver_name || 'Unknown driver')} ${c.plate ? '(' + esc(c.plate) + ')' : ''}</h3><span class="tag ${c.status === 'open' ? 'warn' : ''}" style="flex:0 0 auto">${esc(c.status)}</span></div>
        <p>${esc(c.text)}</p><p class="muted small">From ${esc(c.passenger_name)} (${esc(localPhone(c.passenger_phone))}) · ${fmtTime(c.created_at)} · driver has ${c.strikes ?? 0}/3 strikes</p>
        ${c.status === 'open' ? `<div class="row"><button class="btn danger sm" data-cr="strike" data-id="${c.id}">Give strike</button><button class="btn ghost sm" data-cr="dismissed" data-id="${c.id}">Dismiss</button></div>` : ''}</div>`).join('') : '<p class="muted">No complaints.</p>'}</div>`;
    $$('[data-res]', el).forEach(b => b.onclick = () => act(b, async () => { await api(`/admin/sos/${b.dataset.res}/resolve`, { method: 'POST' }); load(); }));
    $$('[data-cr]', el).forEach(b => b.onclick = () => act(b, async () => { await api(`/admin/complaints/${b.dataset.id}/resolve`, { method: 'POST', body: { action: b.dataset.cr } }); toast(b.dataset.cr === 'strike' ? 'Strike given. Three strikes suspends the driver.' : 'Complaint dismissed.'); load(); }));
  };
  await load(); poll(load, 10000);
}

async function adSettings(el) {
  const { settings: s } = await api('/admin/settings');
  const f = (k, label, hint = '', type = 'text') => `<label class="field"><span class="label">${label}</span><input name="${k}" type="${type}" value="${esc(s[k] ?? '')}" placeholder="Not set">${hint ? `<span class="muted small">${hint}</span>` : ''}</label>`;
  el.innerHTML = `<form id="setf" class="card">
    <h3>Night fares</h3>
    <div class="row">${f('night_start_hour', 'Night starts (hour, 0 to 23)', '', 'number')}${f('night_end_hour', 'Night ends (hour)', '', 'number')}</div>
    ${f('night_surcharge', 'Night surcharge (₦)', 'Added to island fares at night. Leave empty for none.', 'number')}
    <h3>Bonny ⇄ Port Harcourt</h3>
    <div class="row">${f('intercity_open_hour', 'Road opens (hour)', '', 'number')}${f('intercity_close_hour', 'Road closes (hour)', '', 'number')}</div>
    <p class="muted small">Departures outside these hours are blocked. Clear both to remove the restriction.</p>
    <h3>Parcels and errands</h3>
    <div class="row">${f('parcel_fee', 'Parcel fee (₦)', 'Added to the zone fare.', 'number')}${f('errand_fee', 'Errand fee (₦)', 'Added to the zone fare.', 'number')}</div>
    <h3>Driver fees</h3>
    <label class="field"><span class="label">Mode</span><select name="subscription_mode">
      <option value="free" ${s.subscription_mode !== 'on' ? 'selected' : ''}>🎉 Launch campaign: free for all drivers</option>
      <option value="on" ${s.subscription_mode === 'on' ? 'selected' : ''}>Weekly subscription: drivers must be paid up to go online</option></select>
      <span class="muted small">Switching to weekly gives every driver the free trial days below, counted from the day you switch, so nobody is locked out suddenly.</span></label>
    ${f('campaign_end', 'Campaign end (optional, shown to drivers)', 'e.g. 31 December 2026. Leave empty to show no date.')}
    <div class="row">${f('weekly_subscription', 'Weekly subscription (₦)', 'Kept ready for when you switch to weekly.', 'number')}${f('subscription_trial_days', 'Free trial when switching (days)', '', 'number')}</div>
    <h3>Safety</h3>
    ${f('safety_desk_phone', 'Safety desk phone (234…)', 'Shown on every SOS screen.', 'tel')}
    <button class="btn" type="submit">Save settings</button></form>`;
  $('#setf').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => {
    const body = Object.fromEntries(new FormData(e.target));
    if (body.safety_desk_phone) body.safety_desk_phone = body.safety_desk_phone.replace(/\D/g, '').replace(/^0/, '234');
    if (body.subscription_mode === 'on' && s.subscription_mode !== 'on'
      && !confirm(`Switch on weekly subscriptions at ${naira(+body.weekly_subscription || 0)} per week? Every driver gets ${body.subscription_trial_days || 7} free days from today, then must pay to go online.`)) return;
    const out = await api('/admin/settings', { method: 'PUT', body }); await loadMeta();
    toast(out.trials_started ? `Weekly subscriptions are on. ${out.trials_started} driver(s) started their free trial.` : 'Settings saved.');
    s.subscription_mode = body.subscription_mode;
  }); };
}

// ---------- boot ----------
async function loadMeta() { S.meta = await api('/public/meta', { auth: false }); }

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

(async function boot() {
  try { await loadMeta(); } catch (e) { app.innerHTML = `<div class="notice bad">Can't reach the Waka Bonny server. Check your connection and reload.</div>`; return; }
  const p = new URLSearchParams(location.search);
  if (S.token) { try { S.user = (await api('/auth/me')).user; } catch { S.user = null; } }
  if (p.get('pay') && S.user) return handlePayReturn(p.get('pay'));
  if (p.get('t')) return viewShare(p.get('t'));
  if (p.get('p')) return viewPackage(p.get('p'));
  if (p.get('badge')) return viewBadge(p.get('badge'));
  home();
})();
})();
