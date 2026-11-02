// Service worker for Plant Phenology Logger. Two jobs:
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

// v3: cache the vendor libraries during installation because the worker
// registers after the first page load, so it otherwise misses those requests.
// The app shell stays network-first while online; Cache Storage is the
// offline fallback.
const CACHE_VERSION = 'ecosynthra-shell-v3';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png'
];
const VENDOR_ASSETS = [
  'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exif-js/2.3.0/exif.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await Promise.all(VENDOR_ASSETS.map(async (url) => {
        try {
          const response = await fetch(url, { mode: 'no-cors' });
          if (!response.ok && response.type !== 'opaque') {
            throw new Error('HTTP ' + response.status);
          }
          await cache.put(url, response);
        } catch (error) {
          console.warn('Could not pre-cache optional library for offline use:', url, error.message);
        }
      }));
    })
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
