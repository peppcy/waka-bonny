// Waka Bonny service worker: makes the app installable and loads the app shell fast on slow networks.
// API calls and map tiles always go to the network (live data must never be served stale).
const CACHE = 'waka-shell-v4';
const SHELL = ['/', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first so updates show immediately; fall back to cache when offline or the network is too slow
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});

// An alert from the server. Shown even when the app is closed.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Waka Bonny';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: d.icon || '/icons/icon-192.png',
    badge: d.badge || '/icons/icon-192.png',
    // Same tag replaces an older alert about the same thing instead of stacking up
    tag: d.tag || 'waka',
    renotify: d.renotify !== false,
    requireInteraction: !!d.sticky,
    vibrate: [180, 90, 180],
    data: { url: d.url || '/' }
  }));
});

// Tapping the alert opens the app on the right page, reusing the open window if there is one.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).origin === location.origin) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(target); } catch {} }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// Chrome can replace a subscription on its own; the app re-registers next time it opens.
self.addEventListener('pushsubscriptionchange', () => {});
