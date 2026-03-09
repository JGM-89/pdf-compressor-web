// Service Worker for PDF Compressor Web (PWA)
var CACHE_NAME = 'pdf-tools-v5';

var URLS_TO_CACHE = [
  '/',
  '/manifest.json',
  '/css/styles.css',
  '/css/shared.css',
  '/js/utils.js',
  '/js/estimator.js',
  '/js/analyzer.js',
  '/js/metadata.js',
  '/js/image-compress.js',
  '/js/flatten.js',
  '/js/compressor.js',
  '/js/app.js',
  '/js/thumbnail.js',
  '/merge/',
  '/css/merge.css',
  '/js/merge/app.js',
  '/split/',
  '/css/split.css',
  '/js/split/app.js',
  '/pages/',
  '/css/pages.css',
  '/js/pages/app.js',
  '/protect/',
  '/css/protect.css',
  '/js/protect/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install: cache core assets
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for HTML, cache-first for assets
self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // CDN libraries should not be cached by SW (browser cache handles them)
  if (url.pathname.indexOf('/npm/') !== -1 || url.pathname.indexOf('/ajax/') !== -1) return;

  event.respondWith(
    // Try network first
    fetch(event.request)
      .then(function (response) {
        // Cache successful responses
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(function () {
        // Fallback to cache
        return caches.match(event.request);
      })
  );
});
