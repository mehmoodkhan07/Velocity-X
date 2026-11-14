// VELOCITY X service worker (v0.7) — makes the game installable and playable offline.
// Navigation is network-first (so a new build is picked up immediately), assets are cache-first
// (so the second load is instant and works with no connection at all).
const CACHE = 'vx-0.7.0';   // bump this (and the ?v= tags in index.html) with every shipped change
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css',
  './js/game.js', './js/extras.js', './js/extras2.js', './js/features.js',
  './js/input.js', './js/horn.js', './js/audio.js', './js/controls.js',
  './js/models.js', './js/gameplay.js', './js/autodrive.js',
  './vendor/three.min.js', './vendor/GLTFLoader.js', './vendor/game-core.js',
  './img/icon-1024.png', './img/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => { }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;                 // never touch the leaderboard server / CDN
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    if (hit) return hit;
    return fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
  }));
});
