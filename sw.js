/* NIR-Sim service worker: precache the whole app so it runs offline after the first load. */
const VERSION = 'nir-sim-v7-2';
const FILES = ['./', './index.html', './css/style.css', './manifest.webmanifest',
  './js/anatomy.js', './js/i18n.js', './js/shapes.js', './js/sim.js', './js/scenarios.js', './js/render.js', './js/ui.js', './js/mobile.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && new URL(e.request.url).origin === location.origin) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match('./index.html'))));
});
