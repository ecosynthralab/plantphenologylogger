// Service worker for Ecosynthra Field. Two jobs:
//   1. Make the app installable (a registered SW with a fetch handler is
//      one of the browser's requirements for the install prompt).
//   2. Let the app shell (this single index.html + its CDN libraries) load
//      when offline, since the app's actual data already lives in
//      localStorage and works offline regardless.
//
// Netlify function calls (/.netlify/functions/...) and Supabase/GBIF/
// Wikidata/etc. requests are deliberately NEVER cached here — those are
// live data, not app shell, and a stale cached response for something
// like species classification would be actively misleading.

// v2: app shell switched from cache-first to network-first. Cache-first
// meant every load served whatever was cached IMMEDIATELY, with a fresh
// copy only fetched quietly in the background for next time \u2014 so an
// update deployed to Netlify wouldn't actually be seen until the SECOND
// reload after it went live, and a mobile "hard refresh" doesn't reliably
// bypass an active service worker the way it does in desktop DevTools.
// That's a real cost for an app under active iteration; offline support
// is still fully preserved via the catch() fallback below.
const CACHE_VERSION = 'ecosynthra-shell-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isAppShellRequest(url) {
  return url.origin === self.location.origin &&
    !url.pathname.startsWith('/.netlify/functions/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes

  const url = new URL(req.url);

  // Live data (Netlify functions, Supabase, GBIF, Wikidata, Gemini, etc.)
  // — always go to the network, never served from cache.
  if (!isAppShellRequest(url) && url.origin === self.location.origin) return;
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  if (isAppShellRequest(url)) {
    // App shell: network-first. Always try to get the latest deploy when
    // online; only serve the cached copy if the network request actually
    // fails (offline, or a flaky connection in the field). This is the
    // one place staleness has a real cost \u2014 this file changes often
    // during active development \u2014 so freshness wins over instant load.
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Third-party CDN libraries (Chart.js, SheetJS, exif-js, Supabase JS):
  // stale-while-revalidate. Fine to serve slightly stale, never worth
  // blocking the app on.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
