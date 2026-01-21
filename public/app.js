// Global state
let map = null;
let trackLayer = null;
let poiLayers = {
  bakery: null,
  cafe: null,
  water: null,
  toilets: null
};
let currentData = null;
let selectedPoiTypes = [];
let userLocationMarker = null;
let isOffline = !navigator.onLine;

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
  toilets: createIcon('#10b981', '🚻')
};

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

  // Get selected POI types
  selectedPoiTypes = [];
  if (document.getElementById('poi-bakery').checked) selectedPoiTypes.push('bakery');
  if (document.getElementById('poi-cafe').checked) selectedPoiTypes.push('cafe');
  if (document.getElementById('poi-water').checked) selectedPoiTypes.push('water');
  if (document.getElementById('poi-toilets').checked) selectedPoiTypes.push('toilets');

  if (selectedPoiTypes.length === 0) {
    alert('Veuillez sélectionner au moins un type de POI');
    return;
  }

  const maxDetour = document.getElementById('max-detour').value;
  const cacheKey = getCacheKey(file, maxDetour, selectedPoiTypes);

  // Check localStorage cache first
  const cached = loadFromCache(cacheKey);
  if (cached) {
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

    // Save to localStorage cache
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

function showMap(data) {
  uploadSection.classList.add('hidden');
  mapSection.classList.remove('hidden');

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
    color: '#667eea',
    weight: 4,
    opacity: 0.8
  }).addTo(map);

  // Create POI layers
  poiLayers.bakery = L.layerGroup();
  poiLayers.cafe = L.layerGroup();
  poiLayers.water = L.layerGroup();
  poiLayers.toilets = L.layerGroup();

  data.pois.forEach(poi => {
    // Skip unknown POI types
    if (!poiLayers[poi.type]) return;

    const marker = L.marker([poi.lat, poi.lon], {
      icon: icons[poi.type]
    });

    marker.bindPopup(createPopupContent(poi));
    poiLayers[poi.type].addLayer(marker);
  });

  // Add layers to map
  Object.values(poiLayers).forEach(layer => layer.addTo(map));

  // Fit bounds
  map.fitBounds(trackLayer.getBounds(), { padding: [50, 50] });
}

function createPopupContent(poi) {
  const typeLabels = {
    bakery: 'Boulangerie',
    cafe: 'Bar / Café',
    water: "Point d'eau",
    toilets: 'Toilettes'
  };

  let html = `<div class="poi-popup">
    <span class="poi-type ${poi.type}">${typeLabels[poi.type] || poi.type}</span>
    <h4>${escapeHtml(poi.name)}</h4>
    <p>Distance du parcours: ${poi.distance}m</p>`;

  if (poi.tags?.opening_hours) {
    const hours = formatOpeningHours(poi.tags.opening_hours);
    html += `<p>Horaires: ${hours}</p>`;
  }

  html += `<div class="poi-nav-links">
    <a href="#" onclick="navigateTo(${poi.lat}, ${poi.lon}, 'google', '${encodeURIComponent(poi.name)}'); return false;" class="nav-link">Google Maps</a>
    <a href="#" onclick="navigateTo(${poi.lat}, ${poi.lon}, 'apple', '${encodeURIComponent(poi.name)}'); return false;" class="nav-link">Apple Plans</a>
    <a href="#" onclick="navigateTo(${poi.lat}, ${poi.lon}, 'comaps', '${encodeURIComponent(poi.name)}'); return false;" class="nav-link">Comaps</a>
  </div>`;

  html += '</div>';
  return html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function navigateTo(destLat, destLon, app, name) {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const startLat = position.coords.latitude;
        const startLon = position.coords.longitude;
        openNavApp(startLat, startLon, destLat, destLon, app, name);
      },
      () => {
        // Fallback sans géolocalisation
        openNavApp(null, null, destLat, destLon, app, name);
      },
      { timeout: 5000, maximumAge: 60000 }
    );
  } else {
    openNavApp(null, null, destLat, destLon, app, name);
  }
}

function openNavApp(startLat, startLon, destLat, destLon, app, name) {
  let url;

  switch (app) {
    case 'google':
      if (startLat && startLon) {
        url = `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLon}&destination=${destLat},${destLon}&travelmode=bicycling`;
      } else {
        url = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLon}&travelmode=bicycling`;
      }
      break;
    case 'apple':
      url = `https://maps.apple.com/?daddr=${destLat},${destLon}&dirflg=w`;
      break;
    case 'comaps':
      if (startLat && startLon) {
        url = `https://comaps.at/route?sll=${startLat},${startLon}&dll=${destLat},${destLon}&type=bicycle`;
      } else {
        // Sans position de départ, ouvrir juste le point sur la carte
        url = `https://comaps.at/@${destLat},${destLon},17z`;
      }
      break;
  }

  window.open(url, '_blank');
}

// Geolocation button
geolocBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Géolocalisation non supportée');
    return;
  }

  geolocBtn.classList.add('loading');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;

      // Remove existing marker
      if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
      }

      // Add user location marker
      userLocationMarker = L.circleMarker([latitude, longitude], {
        radius: 10,
        fillColor: '#667eea',
        color: '#fff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.8
      }).addTo(map);

      userLocationMarker.bindPopup('Ma position').openPopup();

      // Center map on user location
      map.setView([latitude, longitude], 15);

      geolocBtn.classList.remove('loading');
    },
    (error) => {
      geolocBtn.classList.remove('loading');
      alert('Impossible d\'obtenir votre position');
    },
    { timeout: 10000, maximumAge: 0 }
  );
});

// Back button
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

  // Remove user location marker
  if (userLocationMarker) {
    map.removeLayer(userLocationMarker);
    userLocationMarker = null;
  }
});

// Export functions
document.getElementById('export-gpx').addEventListener('click', () => exportPOIs('gpx'));
document.getElementById('export-csv').addEventListener('click', () => exportPOIs('csv'));
document.getElementById('export-json').addEventListener('click', () => exportPOIs('json'));

function exportPOIs(format) {
  if (!currentData) return;

  const filteredPois = getFilteredPOIs();
  let content, filename, type;

  switch (format) {
    case 'gpx':
      content = generateGPX(filteredPois);
      filename = 'pois.gpx';
      type = 'application/gpx+xml';
      break;
    case 'csv':
      content = generateCSV(filteredPois);
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

function generateGPX(pois) {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BoulangesFinder">
`;

  pois.forEach(poi => {
    gpx += `  <wpt lat="${poi.lat}" lon="${poi.lon}">
    <name>${escapeXml(poi.name)}</name>
    <type>${poi.type}</type>
    <desc>Distance: ${poi.distance}m</desc>
  </wpt>
`;
  });

  gpx += '</gpx>';
  return gpx;
}

function generateCSV(pois) {
  const headers = ['nom', 'type', 'latitude', 'longitude', 'distance_m'];
  const rows = pois.map(poi =>
    [poi.name, poi.type, poi.lat, poi.lon, poi.distance].join(',')
  );
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
