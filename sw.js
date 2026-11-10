/* Tortuga Scan service worker: caches the app shell for offline launch. Lookups always need the network. */
var CACHE = 'tortuga-shell-v6';
var SHELL = ['./', 'index.html', '404.html', 'styles.css', 'app.js', 'rules.js', 'manifest.webmanifest',
  'data/catalog.json', 'data/household.json', 'data/lab-tests.json', 'data/news.json', 'data/websites.json',
  'vendor/html5-qrcode.min.js', 'icons/tortuga-logo.png', 'icons/torty-portrait.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/apple-touch-icon.png', 'icons/tortoise-mark.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // OFF API + images: network only
  // Network first so updates show up; fall back to cache when offline.
  e.respondWith(fetch(e.request).then(function (res) {
    var copy = res.clone();
    if (res.ok) caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); });
  }));
});
