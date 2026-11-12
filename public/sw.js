/*
 * AsiaWay Staff service worker.
 *
 * Caches ONLY static assets (built JS/CSS, fonts, icons) and the offline page.
 * Pages and data (orders, prices, deliveries) are never cached: they always
 * come from the network, and when the network is gone the offline page shows.
 * Goods-in scans survive a lost connection on their own (kept in localStorage
 * by the scanning screen), so nothing here needs to hold business data.
 */
const VERSION = 'aw-staff-v1';
// The app may be served under a path (e.g. /staff/app/); the worker's own scope tells us.
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const OFFLINE_URL = BASE + '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([OFFLINE_URL, BASE + '/manifest.webmanifest', BASE + '/icons/icon-192.png', BASE + '/icons/icon-512.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  const isStatic = url.pathname.startsWith(BASE + '/_next/static/') || url.pathname.startsWith(BASE + '/icons/');
  if (!isStatic) return;
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
