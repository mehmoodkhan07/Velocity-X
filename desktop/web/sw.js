// VELOCITY X service worker (v0.8) — makes the game installable and playable offline.
// Navigation is network-first with a short timeout (a new build is picked up immediately, a weak mobile
// signal never leaves the player on a white screen); assets are cache-first (instant second load, and
// it works with no connection at all once installed).
const CACHE = 'vx-0.8.0';   // bump this (and the ?v= tags in index.html) with every shipped change
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css',
  './js/game.js', './js/extras.js', './js/extras2.js', './js/features.js',
  './js/input.js', './js/horn.js', './js/audio.js', './js/controls.js',
  './js/models.js', './js/gameplay.js', './js/autodrive.js', './js/mobile.js',
  './vendor/three.min.js', './vendor/GLTFLoader.js', './vendor/game-core.js',
  './img/icon-180.png', './img/icon-192.png', './img/icon-512.png', './img/icon.svg'
];
// big files: cached one by one so a single failed download can never throw the whole install away
const HEAVY = [
  './img/splash.png', './img/weather-reference.png', './img/icon-1024.png',
  './models/sports.glb', './models/toyota.glb', './models/white-corolla.glb', './models/yellow-car.glb'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await Promise.all(CORE.concat(HEAVY).map(u =>
      fetch(new Request(u, { cache: 'reload' })).then(r => { if (r && r.ok) return c.put(u, r); }).catch(() => { })));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function vxTimeout(p, ms) {
  return new Promise((ok, no) => { const t = setTimeout(() => no(new Error('timeout')), ms); p.then(v => { clearTimeout(t); ok(v); }, err => { clearTimeout(t); no(err); }); });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;                 // never touch the leaderboard server / CDN
  if (req.mode === 'navigate') {
    e.respondWith(vxTimeout(fetch(req), 4000)
      .then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); }
        return res;
      })
      .catch(() => caches.match('./index.html', { ignoreSearch: true }).then(hit => hit || fetch(req))));
    return;
  }
  // index.html asks for style.css?v=14 while the precache holds style.css: match on the path only
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    if (hit) return hit;
    return fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    });
  }));
});
