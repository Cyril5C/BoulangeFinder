const CACHE_NAME = 'boulanges-finder-v12';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/login.html',
  '/manifest.json',
  '/icons/icon.svg'
];

const EXTERNAL_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache local assets
      await cache.addAll(STATIC_ASSETS);
      // Cache external assets (may fail if offline during install)
      try {
        await cache.addAll(EXTERNAL_ASSETS);
      } catch (e) {
        console.log('Could not cache external assets:', e);
      }
    })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Handle tile requests (OpenStreetMap) - cache first, then network
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          const response = await fetch(event.request);
          if (response.ok) {
            cache.put(event.request, response.clone());
          }
          return response;
        } catch (e) {
          // Return a placeholder tile or nothing
          return new Response('', { status: 408 });
        }
      })
    );
    return;
  }

  // Handle API requests - network only, but cache successful responses
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful GPX responses for offline use
          if (response.ok && url.pathname === '/api/gpx/upload') {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/api/gpx/last-result', cloned);
            });
          }
          return response;
        })
        .catch(() => {
          // If offline and requesting GPX, return cached result
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
          // Fallback to index.html for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
