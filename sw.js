/* HK Weather 3D — service worker
   Goal: an installable app shell that opens instantly and still shows the
   last-known weather offline. It NEVER stores stale data as if it were live:
   HKO API responses are network-only, and /api/history falls back to its last
   cached copy which the UI labels with a timestamp. */

const CACHE = 'hkweather3d-v2.0.1';

/* the app shell — same-origin, safe to serve from cache */
const SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=2.0.1',
  '/core.js?v=2.0.1',
  '/v2.js?v=2.0.1',
  '/manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* HKO open data: always live, never cached (stale weather is worse than none) */
  if (url.hostname.endsWith('weather.gov.hk')) return;

  /* timeline snapshots: network first, last copy when offline */
  if (url.pathname.startsWith('/api/history')) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  /* navigations: network first so a new deploy is picked up immediately */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('/', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('/'))
    );
    return;
  }

  /* same-origin static assets: NETWORK first.
     Cache-first here silently served stale core.js/v2.js after a deploy — the
     version query string only helps if someone remembers to bump it. The cache
     is kept purely as the offline fallback. */
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req))
    );
  }
  /* everything else (Cesium CDN, Esri tiles): let the browser handle it */
});
