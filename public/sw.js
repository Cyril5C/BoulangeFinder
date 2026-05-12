const CACHE_NAME = 'boulanges-finder-v19';
// Tile cache is intentionally versioned separately so app updates
// never wipe the tiles the user pre-cached for offline use.
const TILE_CACHE_NAME = 'boulanges-tiles-v1';

const STATIC_ASSETS = [
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

const EXTERNAL_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);
      try {
        await cache.addAll(EXTERNAL_ASSETS);
      } catch (e) {
        console.log('Could not cache external assets:', e);
      }
    })
  );
  self.skipWaiting();
});

// Activate - delete old app caches but preserve tile cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== TILE_CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  // OSM tiles — cache-first in the persistent tile cache
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          // cors mode so the response is never opaque and can be stored
          const response = await fetch(new Request(event.request.url, {
            mode: 'cors',
            credentials: 'omit'
          }));
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch (e) {
          return new Response('', { status: 408 });
        }
      })
    );
    return;
  }

  // API requests - network only, fallback to cached GPX result
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && url.pathname === '/api/gpx/upload') {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/api/gpx/last-result', cloned);
            });
          }
          return response;
        })
        .catch(() => {
          if (url.pathname === '/api/gpx/upload') {
            return caches.match('/api/gpx/last-result');
          }
          return new Response(JSON.stringify({ error: 'Hors ligne' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // Static assets - network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, cloned);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
