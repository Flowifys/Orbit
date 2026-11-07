// Orbit service worker — enables install + offline shell. Network-first so the app stays current.
const CACHE = 'orbit-shell-v1';
const SHELL = ['/', '/styles.css', '/js/core.js', '/js/voice.js', '/js/ui.js', '/js/settings.js', '/logo.png', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;            // never touch API, socket.io, uploads cross-origin
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/uploads/')) return;
  e.respondWith(
    fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});
