// Global state
let map = null;
let trackLayer = null;
let poiLayers = {
  bakery: null,
  cafe: null,
  water: null,
  toilets: null,
  hotel: null,
  camping: null,
  restaurant: null,
  supermarket: null
};
let currentData = null;
let currentTraceName = null;
let selectedPoiTypes = [];
let userLocationMarker = null;
let showKmMarkers = false;
let isOffline = !navigator.onLine;
let allPoiMarkers = [];
let activePoiTypeFilters = new Set();
let favoritePois = new Set();
let showOnlyFavorites = true;
let markerByPoiId = new Map();
let customPois = [];
let currentTraceKey = null;
let addPoiMode = false;
let pendingCustomPoiLatLon = null;
let poiComments = new Map();
let pendingCommentPoiId = null;

// ── Favorites ───────────────────────────────────────────────────────────────

async function loadFavorites() {
  try {
    const res = await fetch('/api/favorites', { credentials: 'same-origin' });
    if (res.ok) {
      favoritePois = new Set(await res.json());
    }
  } catch (e) {
    // Offline fallback: use localStorage mirror
    try {
      const stored = localStorage.getItem('boulange_favorites_cache');
      favoritePois = new Set(stored ? JSON.parse(stored) : []);
    } catch (_) { favoritePois = new Set(); }
  }
}

async function toggleFavorite(poiId) {
  const id = String(poiId);
  try {
    const res = await fetch('/api/favorites/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      favoritePois = new Set(await res.json());
      localStorage.setItem('boulange_favorites_cache', JSON.stringify([...favoritePois]));
    }
  } catch (e) {
    // Offline: toggle locally
    if (favoritePois.has(id)) { favoritePois.delete(id); } else { favoritePois.add(id); }
    localStorage.setItem('boulange_favorites_cache', JSON.stringify([...favoritePois]));
  }

  const entry = markerByPoiId.get(id);
  if (entry) {
    const { marker, poi } = entry;
    const isFav = favoritePois.has(id);
    marker.setIcon(isFav ? createFavoriteIcon(poi.type) : (icons[poi.type] || icons.custom));
    marker.setPopupContent(createPopupContent(poi));
  }

  if (showOnlyFavorites) applyFavoritesFilter();
}

function applyFavoritesFilter() {
  allPoiMarkers.forEach(({ marker, poi, type }) => {
    if (type === 'borne') return;
    const layer = poiLayers[type];
    if (!layer) return;
    const isFav = favoritePois.has(String(poi.id));
    const visible = !showOnlyFavorites || isFav;
    if (visible) {
      if (!layer.hasLayer(marker)) layer.addLayer(marker);
      // Ensure the layer group itself is on the map
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else {
      layer.removeLayer(marker);
    }
  });
}

// ── Comments ────────────────────────────────────────────────────────────────

async function loadComments() {
  try {
    const res = await fetch('/api/comments', { credentials: 'same-origin' });
    if (res.ok) {
      poiComments = new Map(Object.entries(await res.json()));
    }
  } catch (e) {
    poiComments = new Map();
  }
}

async function saveComment(poiId, text) {
  const id = String(poiId);
  try {
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id, text })
    });
    if (res.ok) {
      poiComments = new Map(Object.entries(await res.json()));
    }
  } catch (e) {
    if (text.trim()) poiComments.set(id, text.trim());
    else poiComments.delete(id);
  }

  const entry = markerByPoiId.get(id);
  if (entry) entry.marker.setPopupContent(createPopupContent(entry.poi));
}

// ── Custom POIs ─────────────────────────────────────────────────────────────

async function loadCustomPois(traceKey) {
  try {
    const res = await fetch(`/api/custom-pois?traceKey=${encodeURIComponent(traceKey)}`, { credentials: 'same-origin' });
    customPois = res.ok ? await res.json() : [];
  } catch (e) {
    customPois = [];
  }
}

async function addCustomPoi(lat, lon, name, type, notes) {
  const poi = {
    id: `custom_${Date.now()}`,
    lat, lon,
    type: type || 'custom',
    name: name || 'POI personnalisé',
    notes: notes || '',
    distance: 0,
    tags: {},
    isCustom: true
  };
  try {
    const res = await fetch('/api/custom-pois', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ traceKey: currentTraceKey, poi })
    });
    if (res.ok) customPois = await res.json();
    else customPois.push(poi);
  } catch (e) {
    customPois.push(poi);
  }
  placePoiMarker(poi);
  buildTypeFilterPanel({ pois: allPoiMarkers.map(e => e.poi) });
  return poi;
}

async function deleteCustomPoi(poiId) {
  try {
    await fetch(`/api/custom-pois/${encodeURIComponent(poiId)}?traceKey=${encodeURIComponent(currentTraceKey)}`, {
      method: 'DELETE',
      credentials: 'same-origin'
    });
  } catch (e) { /* offline — remove locally anyway */ }

  customPois = customPois.filter(p => p.id !== poiId);
  const entry = markerByPoiId.get(String(poiId));
  if (entry) {
    const { marker, type } = entry;
    if (poiLayers[type]) poiLayers[type].removeLayer(marker);
    allPoiMarkers = allPoiMarkers.filter(e => e.poi.id !== poiId);
    markerByPoiId.delete(String(poiId));
  }
}

// ── Offline tile caching ─────────────────────────────────────────────────────

function latLonToTileXY(lat, lon, z) {
  const x = Math.floor((lon + 180) / 360 * (1 << z));
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * (1 << z));
  return [x, y];
}

function getTrackTileUrls(track, z) {
  const seen = new Set();
  const urls = [];
  const subdomains = ['a', 'b', 'c'];
  let si = 0;
  track.forEach(({ lat, lon }) => {
    const [x, y] = latLonToTileXY(lat, lon, z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${x + dx}/${y + dy}`;
        if (!seen.has(key)) {
          seen.add(key);
          urls.push(`https://${subdomains[si % 3]}.tile.openstreetmap.org/${z}/${key}.png`);
          si++;
        }
      }
    }
  });
  return urls;
}

async function cacheTrackTiles(track) {
  const btn = document.getElementById('cache-offline-btn');
  if (!navigator.onLine) { if (btn) btn.textContent = '📵'; return; }

  const urls = getTrackTileUrls(track, 13);
  btn.disabled = true;
  let n = 0;
  for (const url of urls) {
    try { await fetch(url); } catch (e) {}
    n++;
    if (n % 5 === 0) {
      btn.textContent = `📥 ${Math.round(n / urls.length * 100)}%`;
      await new Promise(r => setTimeout(r, 30));
    }
  }
  btn.textContent = '✅';
  btn.title = `${urls.length} tuiles mises en cache`;
  showOfflineToast();
}

function showOfflineToast() {
  const toast = document.getElementById('offline-toast');
  toast.classList.remove('hidden', 'fade-out');
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.classList.add('hidden'), 400);
  }, 3000);

  document.getElementById('offline-badge').classList.remove('hidden');
}

const POI_META = {
  bakery:      { label: 'Boulanges',    emoji: '🥖' },
  cafe:        { label: 'Cafés',        emoji: '☕' },
  water:       { label: "Points d'eau", emoji: '💧' },
  toilets:     { label: 'Toilettes',    emoji: '🚻' },
  hotel:       { label: 'Hôtels',       emoji: '🏨' },
  camping:     { label: 'Campings',     emoji: '⛺' },
  restaurant:  { label: 'Restaurants',  emoji: '🍽️' },
  supermarket: { label: 'Supermarchés', emoji: '🛒' },
  custom:      { label: 'Perso',        emoji: '📌' },
};

// DOM Elements
const uploadSection = document.getElementById('upload-section');
const mapSection = document.getElementById('map-section');
const gpxForm = document.getElementById('gpx-form');
const gpxFileInput = document.getElementById('gpx-file');
const fileNameSpan = document.getElementById('file-name');
const submitBtn = document.querySelector('.submit-btn');
const backBtn = document.getElementById('back-btn');
const geolocBtn = document.getElementById('geoloc-btn');

// Marker icons
const icons = {
  bakery: createIcon('#f59e0b', '🥖'),
  cafe: createIcon('#8b5cf6', '☕'),
  water: createIcon('#3b82f6', '💧'),
  toilets: createIcon('#10b981', '🚻'),
  hotel: createIcon('#ec4899', '🏨'),
  camping: createIcon('#16a34a', '⛺'),
  restaurant: createIcon('#ef4444', '🍽️'),
  supermarket: createIcon('#0ea5e9', '🛒'),
  custom: createIcon('#7c3aed', '📌')
};

const POI_COLORS = {
  bakery: '#f59e0b', cafe: '#8b5cf6', water: '#3b82f6',
  toilets: '#10b981', hotel: '#ec4899', camping: '#16a34a',
  restaurant: '#ef4444', supermarket: '#0ea5e9', custom: '#7c3aed'
};
const POI_EMOJIS = {
  bakery: '🥖', cafe: '☕', water: '💧', toilets: '🚻',
  hotel: '🏨', camping: '⛺', restaurant: '🍽️', supermarket: '🛒', custom: '📌'
};

function createFavoriteIcon(type) {
  const color = POI_COLORS[type] || '#667eea';
  const emoji = POI_EMOJIS[type] || '📍';
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background:white;border:3px solid ${color};border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 0 0 2.5px #fbbf24;position:relative;">${emoji}<span style="position:absolute;top:-7px;right:-7px;font-size:11px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3));">⭐</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15]
  });
}

function createBorneIcon(name) {
  return L.divIcon({
    className: 'distance-marker',
    html: `<div class="distance-marker-inner">${name}</div>`,
    iconSize: [40, 32],
    iconAnchor: [20, 16]
  });
}

function createIcon(color, emoji) {
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="
      background: white;
      border: 3px solid ${color};
      border-radius: 50%;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    ">${emoji}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15]
  });
}

// Service Worker registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(() => console.log('Service Worker registered'))
    .catch(err => console.log('SW registration failed:', err));
}

// PWA install prompt
let deferredInstallPrompt = null;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  if (outcome === 'accepted') installBtn.classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  installBtn.classList.add('hidden');
  deferredInstallPrompt = null;
});

// Check for shared map URL
async function checkSharedMap() {
  const path = window.location.pathname;
  const match = path.match(/^\/share\/([a-zA-Z0-9_-]+)$/);

  if (match) {
    const shareId = match[1];
    try {
      const response = await fetch(`/api/share/${shareId}`);
      if (response.ok) {
        const data = await response.json();
        currentData = data;
        showMap(data);
        // Update URL without reload to clean state
        history.replaceState({}, '', '/');
      } else {
        alert('Carte partagée non trouvée ou expirée');
      }
    } catch (error) {
      console.error('Failed to load shared map:', error);
    }
  }
}

// Load shared map on startup
checkSharedMap();

// Offline/Online detection
function updateOnlineStatus() {
  isOffline = !navigator.onLine;
  document.body.classList.toggle('offline', isOffline);

  if (isOffline) {
    showOfflineBanner();
  } else {
    hideOfflineBanner();
  }
}

function showOfflineBanner() {
  let banner = document.getElementById('offline-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.innerHTML = '📴 Mode hors ligne - Données en cache';
    document.body.appendChild(banner);
  }
  banner.classList.add('visible');
}

function hideOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  if (banner) {
    banner.classList.remove('visible');
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// IndexedDB for offline storage
const DB_NAME = 'boulanges-finder';
const DB_VERSION = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('traces')) {
        db.createObjectStore('traces', { keyPath: 'id' });
      }
    };
  });
}

async function saveTrace(id, data) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('traces', 'readwrite');
    const store = tx.objectStore('traces');
    store.put({ id, data, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadTrace(id) {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('traces', 'readonly');
    const store = tx.objectStore('traces');
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result?.data);
    request.onerror = () => reject(request.error);
  });
}

async function getLastTrace() {
  if (!db) await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('traces', 'readonly');
    const store = tx.objectStore('traces');
    const request = store.openCursor(null, 'prev');
    request.onsuccess = () => {
      const cursor = request.result;
      resolve(cursor ? cursor.value.data : null);
    };
    request.onerror = () => reject(request.error);
  });
}

// Initialize DB
openDB().catch(console.error);

// LocalStorage cache functions (kept for backward compatibility)
function saveToCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({
      timestamp: Date.now(),
      data: data
    }));
  } catch (e) {
    console.warn('LocalStorage full, clearing old gpx_ entries');
    // Only clear gpx_ entries, not everything
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('gpx_')) localStorage.removeItem(k);
    });
  }
}

function loadFromCache(key, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const { timestamp, data } = JSON.parse(cached);
    if (Date.now() - timestamp > maxAgeMs) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function getCacheKey(file, maxDetour, poiTypes) {
  return `gpx_${file.name}_${file.size}_${maxDetour}_${poiTypes.sort().join('-')}`;
}

// Get all cached GPX entries from localStorage
function getCachedGpxList() {
  const cached = [];
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('gpx_')) {
      try {
        const item = JSON.parse(localStorage.getItem(key));
        if (item && item.timestamp && item.data) {
          // Check if still valid
          if (Date.now() - item.timestamp <= maxAgeMs) {
            // Parse cache key: gpx_filename_size_maxDetour_poiTypes
            const parts = key.replace('gpx_', '').split('_');
            const filename = parts[0];
            const poiCount = item.data.pois?.length || 0;

            cached.push({
              key,
              filename,
              timestamp: item.timestamp,
              poiCount,
              data: item.data
            });
          } else {
            // Clean up expired entry
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        // Invalid cache entry
      }
    }
  }

  // Sort by most recent first
  cached.sort((a, b) => b.timestamp - a.timestamp);
  return cached;
}

// Display cached GPX list
function displayCachedGpxList() {
  // Section removed from UI
}

// Format time ago
function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "à l'instant";
  if (seconds < 3600) return `il y a ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.floor(seconds / 3600)}h`;
  return `il y a ${Math.floor(seconds / 86400)}j`;
}

// Fetch and display server-saved traces
async function displayServerTracesList() {
  const section = document.getElementById('server-traces-section');
  const listContainer = document.getElementById('server-traces-list');
  if (!section || !listContainer) return;

  try {
    const res = await fetch('/api/traces', { credentials: 'same-origin' });
    if (!res.ok) { section.classList.add('hidden'); return; }

    const traces = await res.json();
    if (traces.length === 0) { section.classList.add('hidden'); return; }

    section.classList.remove('hidden');
    listContainer.innerHTML = '';

    traces.forEach(trace => {
      const div = document.createElement('div');
      div.className = 'cached-gpx-item';
      div.innerHTML = `
        <div class="cached-gpx-info">
          <span class="cached-gpx-name">${escapeHtml(trace.name)}</span>
          <span class="cached-gpx-meta">${trace.poiCount} POIs · ${getTimeAgo(trace.savedAt)}</span>
        </div>
        <div class="cached-gpx-actions">
          <button class="cached-gpx-load" title="Charger">📂</button>
          <button class="cached-gpx-delete" title="Supprimer">🗑️</button>
        </div>
      `;

      div.querySelector('.cached-gpx-load').addEventListener('click', async () => {
        try {
          const r = await fetch(`/api/traces/${trace.id}`, { credentials: 'same-origin' });
          if (!r.ok) { alert('Trace introuvable sur le serveur'); return; }
          currentData = await r.json();
          currentTraceKey = trace.id;
          currentTraceName = trace.name;
          showMap(currentData);
        } catch (e) {
          alert('Erreur lors du chargement de la trace');
        }
      });

      div.querySelector('.cached-gpx-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Supprimer "${trace.name}" ?`)) return;
        await fetch(`/api/traces/${trace.id}`, { method: 'DELETE', credentials: 'same-origin' });
        displayServerTracesList();
      });

      listContainer.appendChild(div);
    });
  } catch (e) {
    section.classList.add('hidden');
  }
}

// Display cached list on page load
displayCachedGpxList();
displayServerTracesList();

// File input display
gpxFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    fileNameSpan.textContent = file.name;
  }
});

// Form submission
gpxForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const file = gpxFileInput.files[0];
  if (!file) return;

  currentTraceName = file.name.replace(/\.gpx$/i, '');

  // Get selected POI types
  selectedPoiTypes = [];
  if (document.getElementById('poi-bakery').checked) selectedPoiTypes.push('bakery');
  if (document.getElementById('poi-cafe').checked) selectedPoiTypes.push('cafe');
  if (document.getElementById('poi-water').checked) selectedPoiTypes.push('water');
  if (document.getElementById('poi-toilets').checked) selectedPoiTypes.push('toilets');
  if (document.getElementById('poi-hotel').checked) selectedPoiTypes.push('hotel');
  if (document.getElementById('poi-camping').checked) selectedPoiTypes.push('camping');
  if (document.getElementById('poi-restaurant').checked) selectedPoiTypes.push('restaurant');
  if (document.getElementById('poi-supermarket').checked) selectedPoiTypes.push('supermarket');

  if (selectedPoiTypes.length === 0) {
    alert('Veuillez sélectionner au moins un type de POI');
    return;
  }

  const maxDetour = document.getElementById('max-detour').value;
  const cacheKey = getCacheKey(file, maxDetour, selectedPoiTypes);

  // Check localStorage cache first
  const cached = loadFromCache(cacheKey);
  if (cached) {
    currentTraceKey = cached.traceId || cacheKey;
    currentData = cached;
    showMap(currentData);
    return;
  }

  // If offline, try to load last trace from IndexedDB
  if (isOffline) {
    try {
      const lastTrace = await getLastTrace();
      if (lastTrace) {
        currentData = lastTrace;
        showMap(currentData);
        return;
      }
    } catch (e) {
      console.error('Failed to load from IndexedDB:', e);
    }
    alert('Vous êtes hors ligne. Aucune donnée en cache disponible.');
    return;
  }

  const formData = new FormData();
  formData.append('gpx', file);
  formData.append('maxDetour', maxDetour);
  formData.append('poiTypes', JSON.stringify(selectedPoiTypes));

  setLoading(true);

  try {
    const response = await fetch('/api/gpx/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erreur lors du traitement');
    }

    currentData = await response.json();

    // Use stable traceId from server as currentTraceKey
    currentTraceKey = currentData.traceId || cacheKey;
    saveToCache(cacheKey, currentData);

    // Save to IndexedDB for offline use
    try {
      await saveTrace(cacheKey, currentData);
    } catch (e) {
      console.error('Failed to save to IndexedDB:', e);
    }

    showMap(currentData);
  } catch (error) {
    // If network error and we have cached data, use it
    if (error.message === 'Failed to fetch' || error.message === 'Hors ligne') {
      try {
        const lastTrace = await getLastTrace();
        if (lastTrace) {
          currentData = lastTrace;
          showMap(currentData);
          showOfflineBanner();
          return;
        }
      } catch (e) {
        console.error('Failed to load from IndexedDB:', e);
      }
    }
    alert(error.message);
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.querySelector('.btn-text').classList.toggle('hidden', loading);
  submitBtn.querySelector('.btn-loader').classList.toggle('hidden', !loading);
}

async function showMap(data) {
  uploadSection.classList.add('hidden');
  mapSection.classList.remove('hidden');

  // Trace info header
  const { totalKm, elevationGain } = getTrackStats(data.track);
  document.getElementById('trace-info-name').textContent = currentTraceName || '';
  document.getElementById('trace-info-km').textContent = `📏 ${totalKm} km`;
  document.getElementById('trace-info-elevation').textContent = `⛰️ D+ ${elevationGain} m`;
  document.getElementById('trace-info').classList.remove('hidden');

  if (!map) {
    map = L.map('map');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);
  }

  // Clear existing layers
  if (trackLayer) map.removeLayer(trackLayer);
  Object.values(poiLayers).forEach(layer => {
    if (layer) map.removeLayer(layer);
  });

  // Draw track
  const trackCoords = data.track.map(p => [p.lat, p.lon]);
  trackLayer = L.polyline(trackCoords, {
    color: '#1a3a6b',
    weight: 4,
    opacity: 0.9
  }).addTo(map);

  // Create POI layers
  ['bakery','cafe','water','toilets','hotel','camping','restaurant','supermarket','borne','custom'].forEach(t => {
    poiLayers[t] = L.layerGroup();
  });
  allPoiMarkers = [];
  markerByPoiId = new Map();

  // Load state for this trace
  await loadFavorites();
  await loadComments();
  if (currentTraceKey) await loadCustomPois(currentTraceKey);

  // Place OSM POIs
  data.pois.forEach(poi => placePoiMarker(poi));

  // Place custom POIs
  customPois.forEach(poi => placePoiMarker(poi));

  // Add layers to map (bornes kilométriques masquées par défaut, via le toggle)
  Object.entries(poiLayers).forEach(([type, layer]) => {
    if (type === 'borne') {
      if (showKmMarkers) layer.addTo(map);
    } else {
      layer.addTo(map);
    }
  });

  // Restore filters
  buildTypeFilterPanel({ pois: allPoiMarkers.map(e => e.poi) });
  if (showOnlyFavorites) applyFavoritesFilter();

  // Fit bounds
  map.fitBounds(trackLayer.getBounds(), { padding: [50, 50] });

  // Map click for add-POI mode (register once)
  if (!map._addPoiListenerRegistered) {
    map.on('click', (e) => {
      if (!addPoiMode) return;
      pendingCustomPoiLatLon = { lat: e.latlng.lat, lon: e.latlng.lng };
      document.getElementById('custom-poi-name').value = '';
      document.getElementById('custom-poi-notes').value = '';
      document.getElementById('custom-poi-type').value = 'custom';
      document.getElementById('add-poi-modal').classList.remove('hidden');
      setTimeout(() => document.getElementById('custom-poi-name').focus(), 50);
    });
    map._addPoiListenerRegistered = true;
  }

  // Sync fav filter button visual state
  const favBtn = document.getElementById('fav-filter-btn');
  favBtn.textContent = showOnlyFavorites ? '⭐' : '☆';
  favBtn.classList.toggle('active', showOnlyFavorites);

  // Reset cache button and offline badge
  const cacheBtn = document.getElementById('cache-offline-btn');
  if (cacheBtn) { cacheBtn.textContent = '📥'; cacheBtn.disabled = false; }
  document.getElementById('offline-badge').classList.add('hidden');
}

function placePoiMarker(poi) {
  if (!poiLayers[poi.type]) return;

  const isFav = favoritePois.has(String(poi.id));
  let icon;
  if (poi.type === 'borne') {
    icon = createBorneIcon(poi.name);
  } else {
    icon = isFav ? createFavoriteIcon(poi.type) : (icons[poi.type] || icons.custom);
  }

  const marker = L.marker([poi.lat, poi.lon], { icon });
  marker.bindPopup(createPopupContent(poi));
  marker.poiData = poi;

  allPoiMarkers.push({ marker, poi, type: poi.type });
  markerByPoiId.set(String(poi.id), { marker, poi, type: poi.type });
  poiLayers[poi.type].addLayer(marker);
}

function createPopupContent(poi) {
  const typeLabels = {
    bakery: 'Boulangerie',
    cafe: 'Bar / Café',
    water: "Point d'eau",
    toilets: 'Toilettes',
    hotel: 'Hébergement',
    camping: 'Camping',
    restaurant: 'Restaurant',
    supermarket: 'Supermarché / Épicerie',
    borne: 'Borne kilométrique'
  };

  const { distDone, distRemaining } = (currentData?.track)
    ? getTrackPosition(poi, currentData.track)
    : { distDone: null, distRemaining: null };

  let html = `<div class="poi-popup">
    <span class="poi-type ${poi.type}">${typeLabels[poi.type] || poi.type}</span>
    <h4>${escapeHtml(poi.name)}</h4>
    <p>↔ ${poi.distance}m de la trace`;

  if (distDone !== null) {
    html += ` · 🚴 ${distDone} km parcourus · ${distRemaining} km restants`;
  }
  html += `</p>`;

  if (poi.tags?.opening_hours) {
    const hours = formatOpeningHours(poi.tags.opening_hours);
    html += `<p>Horaires: ${escapeHtml(hours).replace(/&lt;br&gt;/g, '<br>')}</p>`;
  }

  const phone = poi.tags?.phone || poi.tags?.['contact:phone'];
  if (phone) {
    html += `<p>📞 <a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></p>`;
  }

  const mobile = poi.tags?.mobile || poi.tags?.['contact:mobile'];
  if (mobile) {
    html += `<p>📱 <a href="tel:${escapeHtml(mobile)}">${escapeHtml(mobile)}</a></p>`;
  }

  const website = poi.tags?.website || poi.tags?.['contact:website'];
  if (website) {
    html += `<p>🌐 <a href="${escapeHtml(website)}" target="_blank" rel="noopener">Site web</a></p>`;
  }

  if (poi.type !== 'borne') {
    const isFav = favoritePois.has(String(poi.id));
    html += `<button class="fav-btn ${isFav ? 'active' : ''}" data-poi-id="${escapeHtml(String(poi.id))}">
      ${isFav ? '⭐ Dans les favoris' : '☆ Ajouter aux favoris'}
    </button>`;
  }

  if (poi.notes) {
    html += `<p>📝 ${escapeHtml(poi.notes)}</p>`;
  }

  if (poi.type !== 'borne') {
    const comment = poiComments.get(String(poi.id));
    if (comment) {
      html += `<p class="poi-comment">💬 ${escapeHtml(comment)}</p>`;
    }
    html += `<button class="comment-btn" data-poi-id="${escapeHtml(String(poi.id))}">
      ${comment ? '✏️ Modifier le commentaire' : '💬 Ajouter un commentaire'}
    </button>`;
  }

  if (poi.type !== 'borne') {
    html += `<a href="https://www.google.com/maps?q=${poi.lat},${poi.lon}" target="_blank" rel="noopener" class="nav-link-gmaps">Voir sur Google Maps</a>`;
  }

  if (poi.isCustom) {
    html += `<button class="delete-custom-poi" data-poi-id="${escapeHtml(String(poi.id))}">🗑️ Supprimer ce POI</button>`;
  }

  html += '</div>';
  return html;
}

// Event delegation for popup buttons (fav + delete + comment)
document.getElementById('map').addEventListener('click', (e) => {
  const favBtn = e.target.closest('.fav-btn');
  if (favBtn) { toggleFavorite(favBtn.dataset.poiId); return; }

  const delBtn = e.target.closest('.delete-custom-poi');
  if (delBtn) { deleteCustomPoi(delBtn.dataset.poiId); return; }

  const commentBtn = e.target.closest('.comment-btn');
  if (commentBtn) {
    pendingCommentPoiId = commentBtn.dataset.poiId;
    document.getElementById('comment-text').value = poiComments.get(pendingCommentPoiId) || '';
    document.getElementById('comment-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('comment-text').focus(), 50);
    return;
  }
});

// Comment modal
document.getElementById('cancel-comment').addEventListener('click', () => {
  document.getElementById('comment-modal').classList.add('hidden');
  pendingCommentPoiId = null;
});

document.getElementById('comment-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('comment-modal')) {
    document.getElementById('comment-modal').classList.add('hidden');
    pendingCommentPoiId = null;
  }
});

document.getElementById('confirm-comment').addEventListener('click', async () => {
  if (!pendingCommentPoiId) return;
  const text = document.getElementById('comment-text').value;
  document.getElementById('comment-modal').classList.add('hidden');
  await saveComment(pendingCommentPoiId, text);
  pendingCommentPoiId = null;
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Geolocation button — one-shot position
geolocBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Géolocalisation non supportée');
    return;
  }

  geolocBtn.classList.add('loading');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      geolocBtn.classList.remove('loading');
      const { latitude, longitude } = position.coords;

      if (userLocationMarker) {
        userLocationMarker.setLatLng([latitude, longitude]);
      } else {
        userLocationMarker = L.circleMarker([latitude, longitude], {
          radius: 10,
          fillColor: '#667eea',
          color: '#fff',
          weight: 3,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(map);
      }

      map.setView([latitude, longitude], 15);
    },
    () => {
      geolocBtn.classList.remove('loading');
      alert('Impossible d\'obtenir votre position');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
});

// Back button
// Select all / deselect all POI types
const POI_CHECKBOX_IDS = ['poi-bakery','poi-cafe','poi-water','poi-toilets','poi-hotel','poi-camping','poi-restaurant','poi-supermarket'];

document.getElementById('toggle-all-poi').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  const allChecked = POI_CHECKBOX_IDS.every(id => document.getElementById(id).checked);
  POI_CHECKBOX_IDS.forEach(id => { document.getElementById(id).checked = !allChecked; });
  btn.textContent = allChecked ? 'Tout sélectionner' : 'Tout désélectionner';
});

backBtn.addEventListener('click', () => {
  mapSection.classList.add('hidden');
  uploadSection.classList.remove('hidden');
  gpxForm.reset();
  fileNameSpan.textContent = '';
  // Reset default checkbox state
  document.getElementById('poi-bakery').checked = true;
  document.getElementById('poi-cafe').checked = false;
  document.getElementById('poi-water').checked = false;
  document.getElementById('poi-toilets').checked = false;
  document.getElementById('poi-hotel').checked = false;
  document.getElementById('poi-camping').checked = false;
  document.getElementById('poi-restaurant').checked = false;
  document.getElementById('poi-supermarket').checked = false;

  // Remove user location marker
  if (userLocationMarker) {
    map.removeLayer(userLocationMarker);
    userLocationMarker = null;
  }

  // Refresh cached GPX lists
  displayCachedGpxList();
  displayServerTracesList();
});

// Share function
document.getElementById('share-btn').addEventListener('click', async () => {
  if (!currentData) return;

  const shareBtn = document.getElementById('share-btn');
  shareBtn.disabled = true;
  shareBtn.textContent = '...';

  try {
    const response = await fetch('/api/share/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ data: currentData })
    });

    if (!response.ok) {
      throw new Error('Erreur lors du partage');
    }

    const { url } = await response.json();
    const fullUrl = window.location.origin + url;

    // Try to use native share API on mobile
    if (navigator.share) {
      await navigator.share({
        title: 'Boulanges Finder - Carte partagée',
        url: fullUrl
      });
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(fullUrl);
      alert('Lien copié dans le presse-papiers !\n\n' + fullUrl);
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      alert('Erreur: ' + error.message);
    }
  } finally {
    shareBtn.disabled = false;
    shareBtn.textContent = '🔗';
  }
});

// Favorites filter
document.getElementById('fav-filter-btn').addEventListener('click', () => {
  showOnlyFavorites = !showOnlyFavorites;
  const btn = document.getElementById('fav-filter-btn');
  btn.textContent = showOnlyFavorites ? '⭐' : '☆';
  btn.classList.toggle('active', showOnlyFavorites);
  if (showOnlyFavorites) {
    applyFavoritesFilter();
  } else {
    // Restore all markers (re-apply type + day filters)
    allPoiMarkers.forEach(({ marker, poi, type }) => {
      if (type === 'borne') return;
      const layer = poiLayers[type];
      if (layer && !layer.hasLayer(marker)) layer.addLayer(marker);
    });
    // Re-apply type filters
    Object.keys(poiLayers).forEach(type => {
      if (type === 'borne') return;
      if (!activePoiTypeFilters.has(type) && poiLayers[type] && map.hasLayer(poiLayers[type])) {
        map.removeLayer(poiLayers[type]);
      }
    });
  }
});

// Add POI button
const addPoiBtn = document.getElementById('add-poi-btn');
addPoiBtn.addEventListener('click', () => {
  addPoiMode = !addPoiMode;
  addPoiBtn.classList.toggle('active', addPoiMode);
  map.getContainer().classList.toggle('map-add-mode', addPoiMode);
});

// Cache offline button
document.getElementById('km-markers-btn').addEventListener('click', () => {
  showKmMarkers = !showKmMarkers;
  document.getElementById('km-markers-btn').classList.toggle('active', showKmMarkers);
  const borneLayer = poiLayers.borne;
  if (!borneLayer) return;
  if (showKmMarkers) borneLayer.addTo(map);
  else map.removeLayer(borneLayer);
});

document.getElementById('cache-offline-btn').addEventListener('click', () => {
  if (currentData?.track) cacheTrackTiles(currentData.track);
});

document.getElementById('roadbook-btn').addEventListener('click', () => {
  if (!currentData?.track) return;
  const { totalKm } = getTrackStats(currentData.track);
  document.getElementById('roadbook-start').value = 0;
  document.getElementById('roadbook-end').value = totalKm;
  document.getElementById('roadbook-modal').classList.remove('hidden');
});

document.getElementById('cancel-roadbook').addEventListener('click', () => {
  document.getElementById('roadbook-modal').classList.add('hidden');
});

document.getElementById('confirm-roadbook').addEventListener('click', () => {
  const startKm = parseFloat(document.getElementById('roadbook-start').value) || 0;
  const endKm   = parseFloat(document.getElementById('roadbook-end').value);
  document.getElementById('roadbook-modal').classList.add('hidden');
  generateRoadbookImage(startKm, endKm);
});

// Custom POI modal
document.getElementById('cancel-add-poi').addEventListener('click', () => {
  document.getElementById('add-poi-modal').classList.add('hidden');
  pendingCustomPoiLatLon = null;
});

document.getElementById('confirm-add-poi').addEventListener('click', async () => {
  if (!pendingCustomPoiLatLon) return;
  const name = document.getElementById('custom-poi-name').value.trim() || 'POI personnalisé';
  const type = document.getElementById('custom-poi-type').value;
  const notes = document.getElementById('custom-poi-notes').value.trim();
  await addCustomPoi(pendingCustomPoiLatLon.lat, pendingCustomPoiLatLon.lon, name, type, notes);
  document.getElementById('add-poi-modal').classList.add('hidden');
  pendingCustomPoiLatLon = null;
  addPoiMode = false;
  addPoiBtn.classList.remove('active');
  map.getContainer().classList.remove('map-add-mode');
});

document.getElementById('add-poi-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('add-poi-modal')) {
    document.getElementById('add-poi-modal').classList.add('hidden');
    pendingCustomPoiLatLon = null;
  }
});

// Map click → add custom POI
// (initialized after map is created in showMap)

function buildTypeFilterPanel(data) {
  const panel = document.getElementById('poi-type-filter');
  panel.innerHTML = '';

  const typeCounts = {};
  data.pois.forEach(poi => {
    if (poi.type === 'borne') return;
    typeCounts[poi.type] = (typeCounts[poi.type] || 0) + 1;
  });

  const types = Object.keys(typeCounts);
  if (types.length === 0) {
    panel.classList.add('hidden');
    return;
  }

  // All chips inactive by default — user enables what they want
  activePoiTypeFilters = new Set();

  types.forEach(type => {
    const meta = POI_META[type];
    if (!meta) return;
    const btn = document.createElement('button');
    btn.className = `poi-filter-btn ${type} inactive`;
    btn.dataset.type = type;
    btn.innerHTML = `${meta.emoji} ${meta.label} <span class="filter-count">${typeCounts[type]}</span>`;
    btn.addEventListener('click', () => toggleTypeFilter(type, btn));
    panel.appendChild(btn);
  });

  panel.classList.remove('hidden');
}

function toggleTypeFilter(type, btn) {
  if (activePoiTypeFilters.has(type)) {
    activePoiTypeFilters.delete(type);
    btn.classList.remove('active');
    btn.classList.add('inactive');
    // Only hide layer if favorites filter is off, or re-apply favorites to keep favorites visible
    if (showOnlyFavorites) {
      applyFavoritesFilter();
    } else if (poiLayers[type] && map.hasLayer(poiLayers[type])) {
      map.removeLayer(poiLayers[type]);
    }
  } else {
    activePoiTypeFilters.add(type);
    btn.classList.remove('inactive');
    btn.classList.add('active');
    if (poiLayers[type] && !map.hasLayer(poiLayers[type])) {
      poiLayers[type].addTo(map);
    }
    if (showOnlyFavorites) {
      applyFavoritesFilter();
    }
  }
}


// Export functions
// Export button — toggle popup
const exportPopup = document.getElementById('export-popup');
document.getElementById('export-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  exportPopup.classList.toggle('hidden');
});

exportPopup.addEventListener('click', (e) => {
  const item = e.target.closest('.export-popup-item');
  if (!item) return;
  exportPOIs(item.dataset.format);
  exportPopup.classList.add('hidden');
});

// Close popup when clicking outside
document.addEventListener('click', () => exportPopup.classList.add('hidden'));

function exportPOIs(format) {
  if (!currentData) return;

  const filteredPois = getFilteredPOIs();
  let content, filename, type;

  switch (format) {
    case 'gpx':
      content = generateGPX(currentData.track);
      filename = 'trace.gpx';
      type = 'application/gpx+xml';
      break;
    case 'csv':
      content = generateCSV(filteredPois, currentData.track);
      filename = 'pois.csv';
      type = 'text/csv';
      break;
    case 'json':
      content = JSON.stringify(filteredPois, null, 2);
      filename = 'pois.json';
      type = 'application/json';
      break;
  }

  downloadFile(content, filename, type);
}

function getFilteredPOIs() {
  return currentData.pois;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * Math.PI / 180;
}

function getTrackStats(track) {
  let totalM = 0;
  let elevationGain = 0;
  for (let i = 1; i < track.length; i++) {
    totalM += haversineDistance(track[i-1].lat, track[i-1].lon, track[i].lat, track[i].lon);
    const prevEle = track[i-1].ele;
    const ele = track[i].ele;
    if (prevEle != null && ele != null && ele > prevEle) {
      elevationGain += ele - prevEle;
    }
  }
  return {
    totalKm: Math.round(totalM / 100) / 10,
    elevationGain: Math.round(elevationGain)
  };
}

function generateGPX(track) {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BoulangesFinder">
  <trk>
    <trkseg>
`;
  track.forEach(p => {
    gpx += `      <trkpt lat="${p.lat}" lon="${p.lon}">`;
    if (p.ele != null) gpx += `<ele>${p.ele}</ele>`;
    gpx += `</trkpt>\n`;
  });
  gpx += `    </trkseg>
  </trk>
</gpx>`;
  return gpx;
}

function getTrackPosition(poi, track) {
  if (!track || track.length < 2) return { distDone: null, distRemaining: null };

  const cumDist = [0];
  for (let i = 1; i < track.length; i++) {
    cumDist.push(cumDist[i - 1] + haversineDistance(track[i - 1].lat, track[i - 1].lon, track[i].lat, track[i].lon));
  }
  const totalDist = cumDist[cumDist.length - 1];

  let bestDist = Infinity;
  let bestDistDone = 0;
  for (let i = 1; i < track.length; i++) {
    const segLen = cumDist[i] - cumDist[i - 1];
    if (segLen === 0) continue;
    const dx = track[i].lat - track[i - 1].lat;
    const dy = track[i].lon - track[i - 1].lon;
    const t = Math.max(0, Math.min(1, ((poi.lat - track[i - 1].lat) * dx + (poi.lon - track[i - 1].lon) * dy) / (dx * dx + dy * dy)));
    const projLat = track[i - 1].lat + t * dx;
    const projLon = track[i - 1].lon + t * dy;
    const dist = haversineDistance(poi.lat, poi.lon, projLat, projLon);
    if (dist < bestDist) {
      bestDist = dist;
      bestDistDone = cumDist[i - 1] + t * segLen;
    }
  }

  return {
    distDone: Math.round(bestDistDone / 100) / 10,       // km, 1 décimale
    distRemaining: Math.round((totalDist - bestDistDone) / 100) / 10
  };
}

function generateCSV(pois, track) {
  const headers = ['favori', 'nom', 'type', 'latitude', 'longitude', 'distance_m', 'km_parcourus', 'km_restants', 'horaires', 'telephone', 'mobile', 'site_web', 'adresse', 'google_maps'];
  const escape = v => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = pois.filter(poi => poi.type && poi.type !== 'unknown').map(poi => {
    const tags = poi.tags || {};
    const adresse = [tags['addr:housenumber'], tags['addr:street'], tags['addr:postcode'], tags['addr:city']]
      .filter(Boolean).join(' ');
    const googleMaps = `https://www.google.com/maps?q=${poi.lat},${poi.lon}`;
    const phone = tags.phone || tags['contact:phone'] || '';
    const mobile = tags.mobile || tags['contact:mobile'] || '';
    const website = tags.website || tags['contact:website'] || '';
    const { distDone, distRemaining } = getTrackPosition(poi, track);
    return ['', poi.name, poi.type, poi.lat, poi.lon, poi.distance, distDone, distRemaining, tags.opening_hours, phone, mobile, website, adresse, googleMaps]
      .map(escape).join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

function escapeXml(str) {
  return str.replace(/[<>&'"]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  }[c]));
}

function formatOpeningHours(osmHours) {
  if (!osmHours) return null;

  const dayNames = {
    'Mo': 'Lun',
    'Tu': 'Mar',
    'We': 'Mer',
    'Th': 'Jeu',
    'Fr': 'Ven',
    'Sa': 'Sam',
    'Su': 'Dim',
    'PH': 'Fériés'
  };

  // Handle simple cases
  if (osmHours === '24/7') return 'Ouvert 24h/24, 7j/7';

  let formatted = osmHours;

  // Replace day abbreviations
  Object.entries(dayNames).forEach(([en, fr]) => {
    formatted = formatted.replace(new RegExp(`\\b${en}\\b`, 'g'), fr);
  });

  // Replace common patterns
  formatted = formatted
    .replace(/off/gi, 'fermé')
    .replace(/-/g, ' - ')
    .replace(/,\s*/g, ', ')
    .replace(/;\s*/g, '<br>')
    .replace(/\s+/g, ' ')
    .trim();

  return formatted;
}

function isOpenOnDay(openingHours, targetDay) {
  if (!openingHours) return false;
  if (openingHours === '24/7') return true;

  const osmDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const targetIdx = osmDays.indexOf(targetDay);
  if (targetIdx === -1) return false;

  const rules = openingHours.split(';').map(r => r.trim());

  for (const rule of rules) {
    // Skip empty rules, "off", "closed", or rules with year dates (vacation periods)
    if (!rule || rule.toLowerCase() === 'off' || rule.toLowerCase() === 'closed') continue;
    if (/\d{4}/.test(rule)) continue; // Skip rules with year (e.g., "2025 Jul 27...")

    // Match pattern: optional day spec, then time range(s)
    // Day spec can be: Mo-Fr, Tu, Mo,We,Fr, etc.
    const match = rule.match(/^([A-Za-z]{2}(?:-[A-Za-z]{2})?(?:,[A-Za-z]{2}(?:-[A-Za-z]{2})?)*)\s+(.+)$/);

    let dayPart = null;
    let timePart = rule;

    if (match) {
      dayPart = match[1];
      timePart = match[2];
    }

    // Check if target day matches
    let dayMatches = false;

    if (!dayPart) {
      // No day specified = applies every day
      dayMatches = true;
    } else {
      // Handle multiple day specs separated by comma (e.g., "Mo-Fr,Su")
      const daySpecs = dayPart.split(',');

      for (const spec of daySpecs) {
        // Handle day ranges like "Mo-Fr" or "Tu-Su"
        const rangeMatch = spec.match(/^([A-Za-z]{2})-([A-Za-z]{2})$/);
        if (rangeMatch) {
          const startIdx = osmDays.indexOf(rangeMatch[1]);
          const endIdx = osmDays.indexOf(rangeMatch[2]);

          if (startIdx !== -1 && endIdx !== -1) {
            if (startIdx <= endIdx) {
              if (targetIdx >= startIdx && targetIdx <= endIdx) dayMatches = true;
            } else {
              if (targetIdx >= startIdx || targetIdx <= endIdx) dayMatches = true;
            }
          }
        }
        // Single day
        else if (osmDays.includes(spec)) {
          if (spec === targetDay) dayMatches = true;
        }
      }
    }

    // If day matches and there's a valid time part, it's open that day
    if (dayMatches && timePart) {
      // Normalize different dash types and check for time pattern
      const normalizedTime = timePart.replace(/[–—]/g, '-');
      const timeRanges = normalizedTime.split(',').map(t => t.trim());
      for (const timeRange of timeRanges) {
        if (timeRange.match(/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/)) {
          return true; // Has valid opening hours on this day
        }
      }
    }
  }

  return false;
}

function isOpenNow(openingHours) {
  if (!openingHours) return false; // Unknown = assume closed for filtering
  if (openingHours === '24/7') return true;

  const now = new Date();
  const dayIndex = now.getDay(); // 0 = Sunday
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // OSM day mapping (Mo=0 in OSM terms, but we need to convert from JS where Su=0)
  const osmDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const todayOsm = osmDays[dayIndex];

  // Parse the opening hours string
  // Supports formats like:
  // "Mo-Fr 07:00-19:00"
  // "Mo-Fr 07:00-19:00; Sa 08:00-18:00"
  // "Mo,Tu,We,Th,Fr 07:00-19:00"
  // "Tu-Su 07:30-13:30,15:30-20:00" (multiple time ranges)

  const rules = openingHours.split(';').map(r => r.trim());

  for (const rule of rules) {
    if (rule.toLowerCase() === 'off' || rule.toLowerCase() === 'closed') continue;

    // Split day part from time part
    // Match patterns like "Mo-Fr 07:00-19:00" or "Mo 07:00-19:00" or "07:00-19:00"
    const dayTimeMatch = rule.match(/^([A-Za-z,\-\s]+)?\s*(.+)$/);
    if (!dayTimeMatch) continue;

    const [, dayPart, timePart] = dayTimeMatch;

    // Check if today matches the day specification
    let dayMatches = false;

    if (!dayPart || !dayPart.trim()) {
      // No day specified = applies every day
      dayMatches = true;
    } else {
      const daySpec = dayPart.trim();

      // Handle day ranges like "Mo-Fr" or "Tu-Su"
      const rangeMatch = daySpec.match(/^([A-Za-z]{2})-([A-Za-z]{2})$/);
      if (rangeMatch) {
        const startDay = rangeMatch[1];
        const endDay = rangeMatch[2];
        const startIdx = osmDays.indexOf(startDay);
        const endIdx = osmDays.indexOf(endDay);

        if (startIdx !== -1 && endIdx !== -1) {
          const todayIdx = osmDays.indexOf(todayOsm);
          if (startIdx <= endIdx) {
            dayMatches = todayIdx >= startIdx && todayIdx <= endIdx;
          } else {
            // Wrap around (e.g., Fr-Mo or Tu-Su where Su < Tu)
            dayMatches = todayIdx >= startIdx || todayIdx <= endIdx;
          }
        }
      }
      // Handle comma-separated days like "Mo,Tu,We"
      else if (daySpec.includes(',')) {
        const days = daySpec.split(',').map(d => d.trim());
        dayMatches = days.includes(todayOsm);
      }
      // Single day
      else if (osmDays.includes(daySpec)) {
        dayMatches = daySpec === todayOsm;
      }
    }

    if (dayMatches && timePart) {
      // Handle multiple time ranges separated by comma: "07:30-13:30,15:30-20:00"
      const timeRanges = timePart.split(',').map(t => t.trim());

      for (const timeRange of timeRanges) {
        const timeMatch = timeRange.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
        if (!timeMatch) continue;

        const [, startTime, endTime] = timeMatch;

        // Parse times
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        // Handle overnight hours (e.g., 22:00-02:00)
        if (endMinutes < startMinutes) {
          if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
            return true;
          }
        } else {
          if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function generateRoadbookImage(startKm, endKm) {
  if (!currentData) return;
  const favorites = (currentData.pois || []).filter(p => favoritePois.has(String(p.id)));

  if (!favorites.length) {
    alert('Aucun favori. Marque des POIs en favori (★) sur la carte.');
    return;
  }

  const track = currentData.track;

  const all = favorites.map(poi => {
    const pos = getTrackPosition(poi, track);
    return { poi, distDone: pos.distDone ?? 0 };
  }).sort((a, b) => a.distDone - b.distDone);

  const segEnd = endKm ?? (all.length ? all[all.length-1].distDone + 1 : 999);
  const sorted = all
    .filter(({ distDone }) => distDone >= startKm && distDone <= segEnd)
    .map(({ poi, distDone }) => ({
      poi,
      distDone,
      distRemaining: Math.round((segEnd - distDone) * 10) / 10
    }));

  // iPhone 16 dimensions
  const W = 1179;
  const H = 2556;
  const FONT = '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';
  const MARGIN = 32;
  const GAP = 6;
  const COLS = 3;
  const ROWS = 4;
  const PAGE_SIZE = COLS * ROWS;
  const CELL_ZONE_TOP = 635;
  // Tailles de police
  const KM_FONT    = 130;
  const EMOJI_FONT = 96;
  // Positions (offsets depuis cy), ascent ≈ 80% de la taille de police
  const PAD_TOP  = 20;
  const KM_Y     = PAD_TOP + Math.round(KM_FONT * 0.80);   // ~124
  const BAR_Y    = KM_Y + 14;    // top barre, bottom = BAR_Y + 10
  const EMOJI_Y  = BAR_Y + 10 + 30 + Math.round(EMOJI_FONT * 0.80); // 30px gap sous la barre
  const PAD_BOT  = 14;
  const CELL_H   = EMOJI_Y + PAD_BOT;
  const CELL_W   = Math.floor((W - 2 * MARGIN - (COLS - 1) * GAP) / COLS);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE) || 1;
  const baseName = (currentTraceName || 'roadbook').replace(/[\\/:*?"<>|]/g, '_');
  const canvases = [];

  for (let page = 0; page < totalPages; page++) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    function rrect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    for (let i = 0; i < PAGE_SIZE; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = MARGIN + col * (CELL_W + GAP);
      const cy = CELL_ZONE_TOP + row * (CELL_H + GAP);

      ctx.fillStyle = i % 2 === 0 ? '#111827' : '#161b27';
      rrect(cx, cy, CELL_W, CELL_H, 28);
      ctx.fill();

      const item = sorted[page * PAGE_SIZE + i];
      if (!item) continue;

      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = 3;
      rrect(cx, cy, CELL_W, CELL_H, 28);
      ctx.stroke();

      const { poi, distRemaining } = item;
      const meta = POI_META[poi.type] || { label: poi.type, emoji: '📍' };
      const kmStr = distRemaining % 1
        ? `${Math.floor(distRemaining)}.${Math.round((distRemaining % 1) * 10)}`
        : String(distRemaining);

      const midX = cx + CELL_W / 2;

      ctx.textAlign = 'center';
      ctx.fillStyle = '#c7d2fe';
      ctx.font = `bold ${KM_FONT}px ${FONT}`;
      ctx.fillText(kmStr, midX, cy + KM_Y);

      const d = poi.distance;
      const maxLineW = CELL_W - 48;
      const lineW = Math.round(Math.min(d / 2000, 1) * maxLineW);
      const barX = midX - lineW / 2;
      ctx.fillStyle = '#818cf8';
      ctx.beginPath();
      ctx.roundRect(barX, cy + BAR_Y, lineW, 10, 5);
      ctx.fill();

      ctx.font = `${EMOJI_FONT}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(meta.emoji, midX, cy + EMOJI_Y);
    }

    canvases.push(canvas);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (canvases.length === 1) {
    canvases[0].toBlob(blob => downloadBlob(blob, `${baseName}.png`));
    return;
  }

  const zip = new JSZip();
  canvases.forEach((canvas, i) => {
    const b64 = canvas.toDataURL('image/png').split(',')[1];
    zip.file(`${baseName}_${i + 1}.png`, b64, { base64: true });
  });

  zip.generateAsync({ type: 'blob' }).then(blob => downloadBlob(blob, `${baseName}.zip`));
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
