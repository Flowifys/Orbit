// Orbit service worker — enables install + offline shell. Network-first so the app stays current.
const CACHE = 'orbit-shell-v78';
const MEDIA = 'orbit-media-v1';
async function trimMedia() { const c = await caches.open(MEDIA); const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - 600))) await c.delete(k); }
const SHELL = ['/', '/updating.html', '/updating-logo.png', '/styles.css', '/layouts.css', '/js/core.js', '/js/voice.js', '/js/ui.js', '/js/features.js', '/js/titlebar.js', '/js/profile.js', '/js/gamepad.js', '/js/settings.js', '/logo.png', '/manifest.webmanifest', '/sounds/ring1.mp3','/sounds/ring2.mp3','/sounds/ring3.mp3','/sounds/notif1.mp3','/sounds/notif2.mp3','/sounds/notif3.mp3','/sounds/join.mp3','/sounds/leave.mp3'];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {}))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== MEDIA).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;            // never touch API, socket.io, uploads cross-origin
  // profile pictures, banners, emojis: their URLs never change, so keep a local copy and show it instantly
  if (url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/emoji/') || url.pathname.startsWith('/embed-img')) {
    if (e.request.headers.get('range')) return;   // let video/audio seeking go straight to the network
    e.respondWith(caches.open(MEDIA).then(async (c) => {
      const hit = await c.match(e.request); if (hit) return hit;
      const res = await fetch(e.request);
      const type = res.headers.get('content-type') || '', len = Number(res.headers.get('content-length') || 0);
      if (res.ok && type.startsWith('image/') && len < 3e6) { c.put(e.request, res.clone()).then(trimMedia).catch(() => {}); }
      return res;
    }));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return;
  const isNav = e.request.mode === 'navigate';
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      // Mid-deploy, Render's edge answers 502/503/504 while the server restarts.
      // Show our branded "updating" page for page loads, and cached copies for assets.
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        if (isNav) return (await caches.match('/updating.html')) || res;
        return (await caches.match(e.request)) || res;
      }
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); }
      return res;
    } catch (err) {
      // true network failure (offline): fall back to cache, then the app shell
      const hit = await caches.match(e.request);
      if (hit) return hit;
      if (isNav) return (await caches.match('/')) || (await caches.match('/updating.html')) || Response.error();
      return Response.error();
    }
  })());
});
