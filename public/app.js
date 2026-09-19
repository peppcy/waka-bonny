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
const saveForm = () => localStorage.setItem('waka_form', JSON.stringify(S.form));

// ---------- view cleanup (maps, GPS watchers, timers) ----------
S.cleanups = [];
function resetView() { S.cleanups.forEach(f => { try { f(); } catch {} }); S.cleanups = []; }
const onReset = (f) => S.cleanups.push(f);

// ---------- live map ----------
const BONNY = [4.4380, 7.1650];
const agoText = (t) => { if (!t) return ''; const s = Math.max(0, Math.round((Date.now() - new Date(t)) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`; };

// Creates a Leaflet map in `el`. update(track) moves the vehicle, draws the trail and pickup.
function liveMap(el, metaEl, { icon = '🛺', showMe = true } = {}) {
  if (!window.L) { el.innerHTML = '<p class="muted small" style="padding:1rem">Map could not load. Check your connection.</p>'; return { update() {}, me() {} }; }
  const m = L.map(el, { zoomControl: true }).setView(BONNY, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
  let veh = null, meDot = null, pick = null, line = null, follow = true, fitted = false, last = null;
  m.on('dragstart zoomstart', (e) => { if (e.originalEvent || e.type === 'dragstart') follow = false; });
  const vIcon = L.divIcon({ className: '', html: `<div class="vi">${icon}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] });
  const pIcon = L.divIcon({ className: '', html: '<div class="pin">📍</div>', iconSize: [28, 28], iconAnchor: [14, 28] });
  const api = {
    map: m,
    update(t) {
      if (!t) return;
      if (t.pickup && !pick) pick = L.marker([t.pickup.lat, t.pickup.lng], { icon: pIcon, title: 'Pickup' }).addTo(m);
      if (t.trail && t.trail.length > 1) { if (line) line.setLatLngs(t.trail); else line = L.polyline(t.trail, { color: '#0E4D5C', weight: 5, opacity: .75 }).addTo(m); }
      if (t.driver) {
        const ll = [t.driver.lat, t.driver.lng];
        if (veh) veh.setLatLng(ll); else veh = L.marker(ll, { icon: vIcon, title: 'Vehicle', zIndexOffset: 1000 }).addTo(m);
        last = t.driver.at;
        if (!fitted) { fitted = true; const pts = [ll]; if (pick) pts.push(pick.getLatLng()); if (meDot) pts.push(meDot.getLatLng()); pts.length > 1 ? m.fitBounds(pts, { padding: [40, 40], maxZoom: 17 }) : m.setView(ll, 16); }
        else if (follow) m.panTo(ll, { animate: true });
      } else if (!fitted && pick) { m.setView(pick.getLatLng(), 16); }
      renderMeta();
    },
    me(lat, lng, acc) {
      if (meDot) meDot.setLatLng([lat, lng]);
      else meDot = L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1E73E8', fillOpacity: 1 }).addTo(m).bindTooltip('You');
      if (!veh && !pick && !fitted) m.setView([lat, lng], 16);
    },
    recenter() { follow = true; if (veh) m.setView(veh.getLatLng(), 16); else if (meDot) m.setView(meDot.getLatLng(), 16); }
  };
  function renderMeta() {
    if (!metaEl) return;
    if (!last) { metaEl.innerHTML = `<span>Waiting for the vehicle's GPS…</span><button class="link" type="button">Recenter</button>`; }
    else {
      const stale = Date.now() - new Date(last) > 60000;
      metaEl.innerHTML = `<span class="${stale ? 'stale' : 'live'}">${stale ? '● GPS not updating' : '● Live'}</span><span>Updated ${agoText(last)}</span><button class="link" type="button">Recenter</button>`;
    }
    metaEl.querySelector('button').onclick = () => api.recenter();
  }
  renderMeta();
  const tick = setInterval(renderMeta, 5000);
  // The passenger's own blue dot, from their phone
  let watch = null;
  if (showMe && navigator.geolocation) watch = navigator.geolocation.watchPosition(p => api.me(p.coords.latitude, p.coords.longitude, p.coords.accuracy), () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  setTimeout(() => m.invalidateSize(), 150);
  const destroy = () => { clearInterval(tick); if (watch != null) navigator.geolocation.clearWatch(watch); m.remove(); };
  api.destroy = destroy;
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
function nav(items) {
  $('#nav').innerHTML = items.map(([k, label]) => `<button data-nav="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${label}</button>`).join('');
  $$('#nav [data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
}
function menuFor() {
  const u = S.user;
  if (!u) return [];
  if (u.role === 'admin') return [['admin', 'Desk'], ['account', 'Account']];
  if (u.role === 'driver') return [['driver', 'Work'], ['account', 'Account']];
  return [['ride', 'Ride'], ['intercity', 'Bonny ⇄ PH'], ['trips', 'Trips'], ['account', 'Account']];
}
function go(view, push = true) {
  stopPoll(); closeSheet(); resetView();
  S.view = view;
  try { sessionStorage.setItem('waka_view', view); } catch {}
  if (push) history.replaceState(null, '', '/');
  app.classList.toggle('wide', view === 'admin');
  nav(menuFor());
  const V = { auth: viewAuth, ride: viewRide, intercity: viewIntercity, trips: viewTrips, account: viewAccount, driver: viewDriver, admin: viewAdmin };
  (V[view] || viewAuth)().catch(fail);
}
function home() {
  const u = S.user;
  if (!u) return go('auth');
  // Return to the tab the user was on before a refresh, if their role allows it
  let saved = null; try { saved = sessionStorage.getItem('waka_view'); } catch {}
  if (saved && menuFor().some(([k]) => k === saved)) return go(saved);
  go(u.role === 'admin' ? 'admin' : u.role === 'driver' ? 'driver' : 'ride');
}
function signOut(msg = true) {
  GPS.stop();
  S.token = null; S.user = null; localStorage.removeItem('waka_token'); try { sessionStorage.removeItem('waka_view'); } catch {}
  if (msg) toast('Signed out.');
  go('auth');
}

// ---------- auth ----------
async function viewAuth() {
  let mode = S.authMode || 'login', role = S.authRole || 'passenger';
  const render = () => {
    app.innerHTML = `
      <section class="hero"><h1>Rides you can trust on Bonny Island.</h1>
        <p>Verified keke, okada and taxi drivers at fixed fares, plus bus and Sienna seats to Port Harcourt.</p></section>
      <div class="seg" role="group" aria-label="Sign in or create account">
        <button data-m="login" aria-pressed="${mode === 'login'}">Sign in</button>
        <button data-m="register" aria-pressed="${mode === 'register'}">Create account</button>
      </div>
      <form id="authForm" class="card" novalidate>
        ${mode === 'register' ? `
          <div class="field"><span class="label">I want to</span>
            <div class="row">
              <button type="button" class="chip" data-r="passenger" aria-pressed="${role === 'passenger'}">Book rides<small>Passenger</small></button>
              <button type="button" class="chip" data-r="driver" aria-pressed="${role === 'driver'}">Drive<small>Keke, okada, taxi, bus, Sienna</small></button>
            </div></div>
          <label class="field"><span class="label">Full name</span><input name="name" autocomplete="name" required></label>` : ''}
        <label class="field"><span class="label">Phone number</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0803 123 4567" required></label>
        <label class="field"><span class="label">PIN (4 to 6 digits)</span><input name="pin" type="password" inputmode="numeric" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" maxlength="6" required></label>
        ${mode === 'register' ? `
          <label class="field"><span class="label">Emergency contact phone (optional)</span><input name="emergency_phone" type="tel" inputmode="tel" placeholder="Family member's number"></label>
          ${role === 'driver' ? `
            <label class="field"><span class="label">Vehicle type</span><select name="vehicle_type" required>
              <option value="">Choose vehicle</option>${Object.entries(VEH).map(([k, v]) => `<option value="${k}">${VEH_ICON[k]} ${v}</option>`).join('')}</select></label>
            <div class="row">
              <label class="field"><span class="label">Plate number</span><input name="plate" required></label>
              <label class="field"><span class="label">Association / union permit no.</span><input name="permit_no" required></label>
            </div>
            <label class="field"><span class="label">Vehicle description</span><input name="vehicle_desc" placeholder="e.g. Yellow Bajaj keke"></label>
            <p class="notice small">After signing up, visit the association desk with your ID and vehicle papers. You can take trips once you're verified.</p>` : ''}` : ''}
        <button class="btn" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>`;
    $$('[data-m]').forEach(b => b.onclick = () => { mode = S.authMode = b.dataset.m; render(); });
    $$('[data-r]').forEach(b => b.onclick = () => { role = S.authRole = b.dataset.r; render(); });
    $('#authForm').onsubmit = (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if (mode === 'register') body.role = role;
      act(e.submitter, async () => {
        const out = await api('/auth/' + (mode === 'login' ? 'login' : 'register'), { method: 'POST', body, auth: false });
        S.token = out.token; S.user = out.user; localStorage.setItem('waka_token', out.token);
        toast(mode === 'login' ? `Welcome back, ${out.user.name.split(' ')[0]}.` : 'Account created.');
        afterSignIn();
      });
    };
  };
  render();
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

function renderRideForm() {
  const f = S.form; f.type = f.type || 'keke';
  const s = S.meta.settings;
  app.innerHTML = `
    <h1>Where are you going?</h1>
    <div class="card">
      <label class="field"><span class="label">Pickup area</span><select id="from">${zoneOptions(f.from)}</select></label>
      <label class="field"><span class="label">Pickup landmark (helps the driver find you)</span><input id="pickup" value="${esc(f.pickup || '')}" placeholder="e.g. Opposite the church gate"></label>
      <label class="field"><span class="label">Destination area</span><select id="to">${zoneOptions(f.to)}</select></label>
      <label class="field"><span class="label">Drop-off landmark (optional)</span><input id="dropoff" value="${esc(f.dropoff || '')}"></label>
    </div>
    <div class="row">
      ${['keke', 'okada', 'taxi'].map(t => `<button class="chip" data-type="${t}" aria-pressed="${f.type === t}">${VEH_ICON[t]} ${VEH[t]}<small>${t === 'keke' ? 'Up to 3' : t === 'okada' ? '1 person' : 'Up to 4, AC'}</small></button>`).join('')}
    </div>
    <div id="quote"></div>
    <button class="btn" id="request" disabled>Request ${VEH[f.type].toLowerCase()}</button>
    <button class="link" id="haveBadge">Flagged one down? Enter the badge code on the vehicle</button>
    ${s.night_surcharge ? `<p class="muted small">Night trips (${s.night_start_hour}:00 to ${s.night_end_hour}:00) include a ${naira(s.night_surcharge)} surcharge.</p>` : ''}`;
  const upd = () => {
    f.from = $('#from').value; f.to = $('#to').value; f.pickup = $('#pickup').value; f.dropoff = $('#dropoff').value; saveForm();
  };
  ['#from', '#to'].forEach(s => $(s).onchange = () => { upd(); loadQuote(); });
  ['#pickup', '#dropoff'].forEach(s => $(s).oninput = upd);
  $$('[data-type]').forEach(b => b.onclick = () => { upd(); f.type = b.dataset.type; saveForm(); renderRideForm(); });
  $('#haveBadge').onclick = () => askBadge();
  $('#request').onclick = (e) => act(e.target, async () => {
    upd();
    const pos = await getPos();
    await api('/rides', { method: 'POST', body: { from_zone: f.from, to_zone: f.to, vehicle_type: f.type, pickup_note: f.pickup, dropoff_note: f.dropoff,
      pickup_lat: pos && pos.latitude, pickup_lng: pos && pos.longitude } });
    viewRide();
  });
  loadQuote();
}

async function loadQuote() {
  const f = S.form, box = $('#quote'), btn = $('#request');
  if (!box) return;
  if (!f.from || !f.to) { box.innerHTML = ''; btn.disabled = true; return; }
  try {
    const qt = await api(`/public/quote?from=${f.from}&to=${f.to}&type=${f.type}`, { auth: false });
    if (qt.fare == null) {
      box.innerHTML = `<div class="ticket unset"><div><small>Fare</small><span class="amt">Not set</span></div><div class="small">The association hasn't set this ${VEH[f.type].toLowerCase()} fare yet.</div></div>`;
      btn.disabled = true;
    } else {
      box.innerHTML = `<div class="ticket"><div><small>Fixed fare, no haggling</small><span class="amt">${naira(qt.fare)}</span></div>
        <div style="text-align:right"><small>${qt.night && qt.surcharge ? 'Includes night surcharge' : 'Standard fare'}</small><small>Pay cash or transfer</small></div></div>`;
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

const MAP_BLOCK = '<div id="map" class="map" role="region" aria-label="Live map"></div><div id="mapMeta" class="map-meta"></div>';
function renderActive(r) {
  resetView();
  const route = `${esc(r.from_name)} to ${esc(r.to_name)}`;
  let html = '';
  if (r.status === 'cancelled') {
    html = `<div class="center" style="padding-top:2rem"><h2>${r.cancelled_by === 'timeout' ? 'No driver accepted in time' : 'Your driver is no longer available'}</h2>
      <p class="muted" style="margin-top:.5rem">${route}. Try again, or choose a different vehicle type.</p></div>
      <button class="btn" data-a="dismiss">Try again</button>`;
  } else if (r.status === 'requested') {
    html = `<div class="center"><div class="pulse"></div><h2>Finding a verified ${VEH[r.vehicle_type].toLowerCase()} driver</h2>
      <p class="muted" style="margin-top:.4rem">${route}. Fare ${naira(r.fare)}.</p></div>
      <button class="btn ghost" data-a="cancel">Cancel request</button>`;
  } else if (r.status === 'accepted' || r.status === 'arrived') {
    html = `<h2>${r.status === 'arrived' ? `${esc(r.driver_name.split(' ')[0])} has arrived` : `${esc(r.driver_name.split(' ')[0])} is on the way`}</h2>
      ${r.status === 'arrived' ? `<p class="notice">Check the plate matches before you board: <b>${esc(r.plate)}</b></p>` : `<p class="muted">Pickup: ${esc(r.from_name)}${r.pickup_note ? ', ' + esc(r.pickup_note) : ''}</p>`}
      ${MAP_BLOCK}
      ${driverCard(r)}
      <div class="ticket"><div><small>Fixed fare</small><span class="amt">${naira(r.fare)}</span></div><div style="text-align:right"><small>${route}</small></div></div>
      <div class="row"><a class="btn ghost" href="tel:+${esc(r.driver_phone)}">Call driver</a><button class="btn ghost" data-a="share">Share trip</button></div>
      <button class="link" data-a="cancel">Cancel ride</button>`;
  } else if (r.status === 'started') {
    html = `<h2>On the way to ${esc(r.to_name)}</h2>
      <p class="muted">With ${esc(r.driver_name)}, ${esc(r.plate)}. This trip is being recorded.</p>
      ${MAP_BLOCK}
      <div class="row"><button class="btn ghost" data-a="share">Share trip</button><button class="btn danger" data-a="sos">SOS</button></div>
      ${driverCard(r)}`;
  } else if (r.status === 'completed') {
    let pay = 'cash', stars = 0;
    html = `<h2>You've arrived</h2>
      <div class="ticket"><div><small>Pay ${esc(r.driver_name.split(' ')[0])}</small><span class="amt">${naira(r.fare)}</span></div><div style="text-align:right"><small>${route}</small></div></div>
      <span class="label">How did you pay?</span>
      <div class="row"><button class="chip" data-pay="cash" aria-pressed="true">Cash<small>Handed to driver</small></button><button class="chip" data-pay="transfer" aria-pressed="false">Transfer<small>To driver's account</small></button></div>
      <span class="label">Rate your ride</span>
      <div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-star="${i}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <button class="btn" id="confirm" disabled>Confirm payment</button>
      <button class="link" data-a="complain">Report a problem with this ride</button>`;
    app.innerHTML = html;
    $$('[data-pay]').forEach(b => b.onclick = () => { pay = b.dataset.pay; $$('[data-pay]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
    $$('[data-star]').forEach(b => b.onclick = () => { stars = +b.dataset.star; $$('[data-star]').forEach(x => x.classList.toggle('on', +x.dataset.star <= stars)); $('#confirm').disabled = false; });
    $('#confirm').onclick = (e) => act(e.target, async () => { await api(`/rides/${r.id}/confirm`, { method: 'POST', body: { pay_method: pay, rating: stars } }); toast('Payment confirmed. Thanks for riding with a verified driver.'); S.form.pickup = ''; S.form.dropoff = ''; saveForm(); viewRide(); });
    bindRideActions(r);
    stopPoll();
    return;
  }
  app.innerHTML = html;
  bindRideActions(r);
  let lm = null;
  if ($('#map')) {
    lm = liveMap($('#map'), $('#mapMeta'), { icon: VEH_ICON[r.vehicle_type] });
    onReset(() => lm.destroy && lm.destroy());
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
        <label class="field"><span class="label">Where are you now?</span><select id="hf">${zoneOptions(f.from)}</select></label>
        <label class="field"><span class="label">Where are you going?</span><select id="ht">${zoneOptions(f.to)}</select></label>
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
  const upcoming = bookings.filter(b => b.status !== 'cancelled' && ['scheduled', 'boarding', 'departed'].includes(b.departure_status));
  app.innerHTML = `
    <h1>Bonny ⇄ Port Harcourt</h1>
    <p class="muted">Book a seat on a registered bus or Sienna over the Bodo-Bonny road. Every booking goes on the driver's manifest.</p>
    <div class="seg" role="group" aria-label="Direction">${routes.map(r => `<button data-route="${r.id}" aria-pressed="${route && r.id === route.id}">${esc(r.origin.replace(' (Abali Park)', ''))} to ${esc(r.destination.replace(' (Abali Park)', ''))}</button>`).join('')}</div>
    ${s.intercity_open_hour && s.intercity_close_hour ? `<p class="notice small">Departures run between ${esc(s.intercity_open_hour)}:00 and ${esc(s.intercity_close_hour)}:00.</p>` : ''}
    ${upcoming.length ? `<h2>Your seats</h2><div class="list">${upcoming.map(b => `
      <div class="card"><div class="row" style="align-items:center"><div><h3>${esc(b.origin)} to ${esc(b.destination)}</h3><div class="muted small">${fmtTime(b.depart_at)}, ${VEH[b.vehicle_type]} ${esc(b.plate)}</div></div>
        <span class="tag ${b.departure_status === 'departed' ? 'warn' : ''}" style="flex:0 0 auto">${b.departure_status === 'departed' ? 'On the road' : b.departure_status === 'boarding' ? 'Boarding' : 'Booked'}</span></div>
        <dl class="kv"><dt>Booking ref</dt><dd>${esc(b.ref)}</dd><dt>Seats</dt><dd>${b.seats}</dd><dt>Fare</dt><dd>${naira(b.price * b.seats)}, pay at the park</dd><dt>Driver</dt><dd>${esc(b.driver_name)}, <a href="tel:+${esc(b.driver_phone)}">${esc(localPhone(b.driver_phone))}</a></dd></dl>
        <div class="row">${['boarding', 'departed'].includes(b.departure_status) ? `<button class="btn sm" data-trackb="${b.id}" data-veh="${b.vehicle_type}">Track vehicle</button>` : ''}${b.departure_status === 'departed' ? `<button class="btn danger sm" data-sos="${b.id}">SOS</button>` : `<button class="btn ghost sm" data-cancelb="${b.id}">Cancel booking</button>`}</div></div>`).join('')}</div>` : ''}
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
      <button class="btn" type="submit">Book seats</button></form>
    <button class="link" id="closeS">Cancel</button>`);
  $('#closeS').onclick = closeSheet;
  $('#bk').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => {
    const { booking } = await api(`/intercity/departures/${d.id}/book`, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    closeSheet(); toast(`Booked. Your reference is ${booking.ref}.`); viewIntercity();
  }); };
}

// ---------- passenger: history & account ----------
async function viewTrips() {
  const { rides } = await api('/rides/history');
  app.innerHTML = `<h1>Your trips</h1>
    <div class="list">${rides.length ? rides.map(r => `<div class="item"><div><b>${esc(r.from_name)} to ${esc(r.to_name)}</b>
      <div class="muted small">${fmtTime(r.created_at)} · ${VEH[r.vehicle_type]}${r.driver_name ? ' · ' + esc(r.driver_name) : ''}${r.street_hail ? ' · Street hail' : ''}</div></div>
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
    <button class="btn ghost" id="out">Sign out</button>`;
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
      <button class="btn ghost" id="refresh">Check again</button>`;
    $('#refresh').onclick = () => viewDriver().catch(fail);
    return;
  }
  if (['bus', 'sienna'].includes(d.vehicle_type)) return viewOperator(d);
  return viewIslandDriver(d);
}

async function viewIslandDriver(d) {
  resetView();
  const [sum, { ride }] = await Promise.all([api('/driver/summary'), api('/driver/active')]);
  // GPS: every 4s on a trip (screen kept awake), every 15s while waiting online, off when offline
  if (ride) { GPS.start(4000); GPS.keepAwake(true); }
  else if (d.online) { GPS.start(15000); GPS.keepAwake(false); }
  else GPS.stop();
  let body = '';
  if (ride) {
    const nextBtn = ride.status === 'accepted'
      ? `<button class="btn ghost" data-t="arrived">I've arrived at pickup</button><button class="btn" data-t="start">Passenger on board, start trip</button><button class="link" data-t="release">I can't make this pickup</button>`
      : ride.status === 'arrived' ? `<button class="btn" data-t="start">Passenger on board, start trip</button><button class="link" data-t="release">Passenger didn't show up</button>`
      : `<button class="btn keke" data-t="complete">End trip and collect ${naira(ride.fare)}</button>`;
    body = `<h2>${ride.status === 'started' ? `Heading to ${esc(ride.to_name)}` : `Pick up ${esc(ride.passenger_name.split(' ')[0])} at ${esc(ride.from_name)}`}</h2>
      <div class="card"><dl class="kv"><dt>Passenger</dt><dd>${esc(ride.passenger_name)}</dd><dt>Pickup</dt><dd>${esc(ride.from_name)}${ride.pickup_note ? ', ' + esc(ride.pickup_note) : ''}</dd>
        <dt>Drop-off</dt><dd>${esc(ride.to_name)}${ride.dropoff_note ? ', ' + esc(ride.dropoff_note) : ''}</dd><dt>Fare</dt><dd>${naira(ride.fare)}</dd></dl>
        <a class="btn ghost" href="tel:+${esc(ride.passenger_phone)}">Call passenger</a>
        ${ride.pickup_lat != null && ride.status !== 'started' ? `<a class="btn ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${ride.pickup_lat},${ride.pickup_lng}">Navigate to pickup</a>` : ''}</div>
      ${MAP_BLOCK}
      <p class="muted small">Keep this screen open during the trip so the passenger can follow you on the map.</p>
      ${nextBtn}`;
  } else if (d.online) {
    body = `<h2>Ride requests</h2><div id="reqs" class="list"><p class="muted">Looking for requests…</p></div>`;
  } else {
    body = `<p class="muted">Go online to receive ride requests from passengers near you.</p>`;
  }
  app.innerHTML = `
    ${ride || d.online ? '<div id="gpsNote" class="notice gps-note"></div>' : ''}
    <div class="toggle ${d.online ? 'on' : 'off'}"><span>${d.online ? "You're online" : "You're offline"}</span>
      <button class="switch" role="switch" aria-checked="${d.online}" aria-label="Online" id="onl"></button></div>
    <label class="field"><span class="label">Area you're in now</span><select id="zone">${zoneOptions(d.zone_id)}</select></label>
    <div class="stats"><div class="stat"><b>${naira(sum.earnings)}</b><span>Fares today</span></div><div class="stat"><b>${sum.trips}</b><span>Trips today</span></div><div class="stat"><b>${sum.rating ?? '—'}</b><span>Your rating</span></div></div>
    ${body}
    <button class="link" id="badge">Show my QR badge</button>`;
  $('#onl').onclick = (e) => act(e.target, async () => { await api('/driver/online', { method: 'POST', body: { online: !d.online, zone_id: $('#zone').value } }); viewDriver(); });
  $('#zone').onchange = () => api('/driver/online', { method: 'POST', body: { online: d.online, zone_id: $('#zone').value } }).then(() => toast('Area updated.')).catch(fail);
  $('#badge').onclick = () => badgeSheet(d);
  GPS.note();
  if (ride && $('#map')) {
    const lm = liveMap($('#map'), null, { icon: VEH_ICON[d.vehicle_type] });
    onReset(() => lm.destroy && lm.destroy());
    if (ride.pickup_lat != null && ride.status !== 'started') lm.update({ pickup: { lat: ride.pickup_lat, lng: ride.pickup_lng } });
  }
  $$('[data-t]').forEach(b => b.onclick = () => act(b, async () => {
    await api(`/driver/rides/${ride.id}/${b.dataset.t}`, { method: 'POST' });
    if (b.dataset.t === 'complete') toast(`Trip complete. Collect ${naira(ride.fare)}.`);
    viewDriver();
  }));
  if (ride) {
    poll(async () => { const { ride: r } = await api('/driver/active'); if (!r || r.status !== ride.status) viewDriver(); }, 6000);
  } else if (d.online) {
    const load = async () => {
      const { requests } = await api('/driver/requests');
      const box = $('#reqs'); if (!box) return;
      box.innerHTML = requests.length ? requests.map(r => `
        <div class="card"><div class="ticket"><div><small>${r.nearby ? 'Near you' : 'Fixed fare'}</small><span class="amt">${naira(r.fare)}</span></div>
          <div style="text-align:right"><small>${esc(r.from_name)}</small><small>to ${esc(r.to_name)}</small></div></div>
          ${r.pickup_note ? `<p class="small">Pickup: ${esc(r.pickup_note)}</p>` : ''}
          <button class="btn" data-acc="${r.id}">Accept ride for ${esc(r.passenger_first)}</button></div>`).join('')
        : `<p class="muted">No requests right now. Stay near busy spots like the jetty and market.</p>`;
      $$('[data-acc]').forEach(b => b.onclick = () => act(b, async () => { await api(`/driver/rides/${b.dataset.acc}/accept`, { method: 'POST' }); toast('Ride accepted. Head to the pickup.'); viewDriver(); }));
    };
    await load(); poll(load, 4000);
  }
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
  const [{ routes }, { departures }] = await Promise.all([api('/intercity/routes'), api('/intercity/departures/mine')]);
  const onRoad = departures.some(x => ['boarding', 'departed'].includes(x.status));
  if (onRoad) { GPS.start(5000); GPS.keepAwake(true); } else GPS.stop();
  const cap = d.vehicle_type === 'bus' ? 18 : 7;
  const s = S.meta.settings;
  app.innerHTML = `
    <h1>${VEH_ICON[d.vehicle_type]} Your departures</h1>
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
      <td>${esc(m.nok_name)}<br>${esc(localPhone(m.nok_phone))}</td><td>${m.seats}</td><td>${esc(m.drop_stop || '')}</td><td>${esc(m.status)}</td>
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

// ---------- admin desk ----------
const ADMIN_TABS = [['overview', 'Overview'], ['drivers', 'Drivers'], ['fares', 'Fares & areas'], ['intercity', 'Bonny ⇄ PH'], ['safety', 'Safety'], ['settings', 'Settings']];
async function viewAdmin() {
  S.adminTab = S.adminTab || 'overview';
  app.innerHTML = `<div class="seg" role="tablist" style="overflow-x:auto">${ADMIN_TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-pressed="${S.adminTab === k}">${l}</button>`).join('')}</div><div id="tab" class="list"></div>`;
  $$('[data-tab]').forEach(b => b.onclick = () => { S.adminTab = b.dataset.tab; stopPoll(); viewAdmin().catch(fail); });
  const T = { overview: adOverview, drivers: adDrivers, fares: adFares, intercity: adIntercity, safety: adSafety, settings: adSettings };
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
      </div>
      <h2>Live rides</h2>
      <div class="list">${rides.length ? rides.map(r => `<div class="item"><div><b>${esc(r.from_name)} to ${esc(r.to_name)}</b>
        <div class="muted small">${VEH_ICON[r.vehicle_type]} ${esc(r.passenger_name)}${r.driver_name ? ' with ' + esc(r.driver_name) + ' (' + esc(r.plate) + ')' : ''}${r.street_hail ? ' · street hail' : ''}</div></div>
        <div class="acts"><span class="tag ${r.status === 'started' ? 'warn' : ''}">${esc(r.status)}</span><a class="btn ghost sm" href="/?t=${esc(r.token)}" target="_blank" rel="noopener">Track</a></div></div>`).join('') : '<p class="muted">No rides in progress.</p>'}</div>`;
  };
  await load(); poll(load, 10000);
}

async function adDrivers(el) {
  S.drvFilter = S.drvFilter ?? 'pending';
  const { drivers } = await api('/admin/drivers' + (S.drvFilter ? '?status=' + S.drvFilter : ''));
  el.innerHTML = `<div class="row" style="align-items:end"><label class="field"><span class="label">Show</span><select id="flt">
      ${[['pending', 'Waiting for verification'], ['approved', 'Approved'], ['suspended', 'Suspended'], ['rejected', 'Rejected'], ['', 'All drivers']].map(([v, l]) => `<option value="${v}" ${S.drvFilter === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="table-wrap"><table><thead><tr><th>Driver</th><th>Vehicle</th><th>Plate / permit</th><th>Badge</th><th>Strikes</th><th>Status</th><th></th></tr></thead><tbody>
    ${drivers.map(d => `<tr><td><b>${esc(d.name)}</b><br><a href="tel:+${esc(d.phone)}">${esc(localPhone(d.phone))}</a></td>
      <td>${VEH_ICON[d.vehicle_type]} ${VEH[d.vehicle_type]}<br><span class="muted small">${esc(d.vehicle_desc || '')}</span></td>
      <td>${esc(d.plate)}<br>${esc(d.permit_no)}</td><td>${esc(d.badge_code)}</td><td>${d.strikes}/3</td>
      <td><span class="tag ${d.status === 'approved' ? 'ok' : d.status === 'pending' ? 'warn' : 'bad'}">${esc(d.status)}</span>${d.live ? ' <span class="tag">online</span>' : ''}</td>
      <td><div class="acts">
        ${d.status === 'pending' ? `<button class="btn sm" data-d="approve" data-id="${d.user_id}">Approve</button><button class="btn ghost sm" data-d="reject" data-id="${d.user_id}">Reject</button>` : ''}
        ${d.status === 'approved' ? `<button class="btn ghost sm" data-d="strike" data-id="${d.user_id}">Add strike</button><button class="btn danger sm" data-d="suspend" data-id="${d.user_id}">Suspend</button>` : ''}
        ${['suspended', 'rejected'].includes(d.status) ? `<button class="btn sm" data-d="reinstate" data-id="${d.user_id}">Reinstate</button>` : ''}
      </div></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No drivers in this list.</td></tr>'}
    </tbody></table></div>`;
  $('#flt').onchange = (e) => { S.drvFilter = e.target.value; adDrivers(el).catch(fail); };
  $$('[data-d]', el).forEach(b => b.onclick = () => {
    if (b.dataset.d === 'suspend' && !confirm('Suspend this driver? They will be taken offline straight away.')) return;
    act(b, async () => { await api(`/admin/drivers/${b.dataset.id}/${b.dataset.d}`, { method: 'POST' }); toast('Driver updated.'); adDrivers(el); });
  });
}

async function adFares(el) {
  S.fareType = S.fareType || 'keke';
  const { zones } = await api('/admin/zones');
  const active = zones.filter(z => z.active);
  S.fareZone = S.fareZone || active[0]?.id;
  const { fares } = S.fareZone ? await api(`/admin/fares?vehicle_type=${S.fareType}&zone=${S.fareZone}`) : { fares: [] };
  const zName = zones.find(z => z.id === +S.fareZone)?.name || '';
  el.innerHTML = `
    <p class="muted">Fares are fixed per area pair and work in both directions. Leave a box empty to keep it as a placeholder: passengers can't book that route until it has a price.</p>
    <div class="row"><label class="field"><span class="label">Vehicle</span><select id="ft">${['keke', 'okada', 'taxi'].map(t => `<option value="${t}" ${S.fareType === t ? 'selected' : ''}>${VEH[t]}</option>`).join('')}</select></label>
      <label class="field"><span class="label">From area</span><select id="fz">${active.map(z => `<option value="${z.id}" ${+S.fareZone === z.id ? 'selected' : ''}>${esc(z.name)}</option>`).join('')}</select></label></div>
    <div class="table-wrap"><table><thead><tr><th>${esc(zName)} to / from</th><th>${VEH[S.fareType]} fare (₦)</th></tr></thead><tbody>
      ${fares.map(f => `<tr><td>${f.other_id === +S.fareZone ? 'Within ' + esc(zName) : esc(f.other_name)}</td>
        <td><input type="number" min="0" step="50" inputmode="numeric" data-a="${f.zone_a}" data-b="${f.zone_b}" value="${f.amount ?? ''}" placeholder="Not set"></td></tr>`).join('')}
    </tbody></table></div>
    <button class="btn" id="saveF">Save ${VEH[S.fareType].toLowerCase()} fares</button>
    <h2>Areas</h2>
    <p class="muted small">Each neighbourhood is a fare zone. Add missing ones here or hide ones you don't serve.</p>
    <div class="list">${zones.map(z => `<div class="item"><span>${esc(z.name)}</span><button class="btn ghost sm" data-zt="${z.id}">${z.active ? 'Hide' : 'Show'}</button></div>`).join('')}</div>
    <form id="addZ" class="row"><input name="name" placeholder="New neighbourhood name" required><button class="btn" style="flex:0 0 auto;width:auto" type="submit">Add area</button></form>`;
  $('#ft').onchange = (e) => { S.fareType = e.target.value; adFares(el).catch(fail); };
  $('#fz').onchange = (e) => { S.fareZone = +e.target.value; adFares(el).catch(fail); };
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
    <h3>Safety and fees</h3>
    ${f('safety_desk_phone', 'Safety desk phone (234…)', 'Shown on every SOS screen.', 'tel')}
    ${f('weekly_subscription', 'Weekly driver subscription (₦)', 'For your records. Collection is not automated yet.', 'number')}
    <button class="btn" type="submit">Save settings</button></form>`;
  $('#setf').onsubmit = (e) => { e.preventDefault(); act(e.submitter, async () => {
    const body = Object.fromEntries(new FormData(e.target));
    if (body.safety_desk_phone) body.safety_desk_phone = body.safety_desk_phone.replace(/\D/g, '').replace(/^0/, '234');
    await api('/admin/settings', { method: 'PUT', body }); await loadMeta(); toast('Settings saved.');
  }); };
}

// ---------- boot ----------
async function loadMeta() { S.meta = await api('/public/meta', { auth: false }); }

(async function boot() {
  try { await loadMeta(); } catch (e) { app.innerHTML = `<div class="notice bad">Can't reach the Waka Bonny server. Check your connection and reload.</div>`; return; }
  const p = new URLSearchParams(location.search);
  if (S.token) { try { S.user = (await api('/auth/me')).user; } catch { S.user = null; } }
  if (p.get('t')) return viewShare(p.get('t'));
  if (p.get('badge')) return viewBadge(p.get('badge'));
  home();
})();
})();
