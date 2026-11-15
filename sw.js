/* LawVault v5 — service worker (optional).
   Cache-first for same-origin assets and data; navigation requests try
   the network first and fall back to the cached homepage when offline.
   Cache name is bumped from v4 so an old v4 cache is purged on update.
   Note: Google Sheet reads (docs.google.com) are cross-origin and are
   never cached here, so Sheet edits show up without a cache purge. */
var CACHE = 'lawvault-v5-final';
var CORE = [
  './',
  './index.html',
  './admin.html',
  './assets/css/style.css',
  './assets/css/admin.css',
  './assets/js/app.js',
  './assets/js/search.js',
  './assets/js/admin.js',
  './assets/images/logo.svg',
  './assets/images/icon-192.png',
  './assets/images/icon-512.png',
  './data/site-config.json',
  './data/content.json',
  './data/sheets-config.json',
  './manifest.webmanifest',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(CORE); })
      .then(function () { return self.skipWaiting(); })
      .catch(function () {})
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // cache-first for same-origin assets and data
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
