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
let distanceMarkers = [];
let isOffline = !navigator.onLine;
let filterOpenNow = false;
let allPoiMarkers = [];

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
  distanceMarkers.forEach(marker => map.removeLayer(marker));
  distanceMarkers = [];

  // Draw track
  const trackCoords = data.track.map(p => [p.lat, p.lon]);
  trackLayer = L.polyline(trackCoords, {
    color: '#667eea',
    weight: 4,
    opacity: 0.8
  }).addTo(map);

  // Add distance markers every 20km
  addDistanceMarkers(data.track);

  // Create POI layers
  poiLayers.bakery = L.layerGroup();
  poiLayers.cafe = L.layerGroup();
  poiLayers.water = L.layerGroup();
  poiLayers.toilets = L.layerGroup();
  allPoiMarkers = [];

  data.pois.forEach(poi => {
    // Skip unknown POI types
    if (!poiLayers[poi.type]) return;

    const marker = L.marker([poi.lat, poi.lon], {
      icon: icons[poi.type]
    });

    marker.bindPopup(createPopupContent(poi));
    marker.poiData = poi; // Store POI data for filtering
    allPoiMarkers.push({ marker, poi, type: poi.type });
    poiLayers[poi.type].addLayer(marker);
  });

  // Add layers to map
  Object.values(poiLayers).forEach(layer => layer.addTo(map));

  // Apply filter if active
  if (filterOpenNow) {
    applyOpenNowFilter();
  }

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

// Open now filter toggle
document.getElementById('open-now-btn').addEventListener('click', () => {
  const btn = document.getElementById('open-now-btn');
  filterOpenNow = !filterOpenNow;
  btn.classList.toggle('active', filterOpenNow);

  if (filterOpenNow) {
    applyOpenNowFilter();
  } else {
    removeOpenNowFilter();
  }
});

function applyOpenNowFilter() {
  allPoiMarkers.forEach(({ marker, poi, type }) => {
    // Water and toilets are always "open"
    if (type === 'water' || type === 'toilets') return;

    // Use pre-computed isOpenNow from server if it's a boolean, otherwise fallback to client-side parsing
    let isOpen;
    if (typeof poi.isOpenNow === 'boolean') {
      isOpen = poi.isOpenNow;
    } else {
      // Server couldn't determine (null) or field missing - use client-side parser
      isOpen = isOpenNow(poi.tags?.opening_hours);
    }

    if (!isOpen) {
      poiLayers[type].removeLayer(marker);
    }
  });
}

function removeOpenNowFilter() {
  allPoiMarkers.forEach(({ marker, type }) => {
    if (!poiLayers[type].hasLayer(marker)) {
      poiLayers[type].addLayer(marker);
    }
  });
}

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

// Add distance markers every 20km along the track
function addDistanceMarkers(track) {
  const intervalKm = 20;
  let cumulativeDistance = 0;
  let nextMarkerKm = 0;

  // Add start marker (0 km)
  addDistanceMarker(track[0].lat, track[0].lon, 0);
  nextMarkerKm = intervalKm;

  for (let i = 1; i < track.length; i++) {
    const segmentDistance = haversineDistance(
      track[i - 1].lat, track[i - 1].lon,
      track[i].lat, track[i].lon
    );

    const prevCumulative = cumulativeDistance;
    cumulativeDistance += segmentDistance / 1000; // Convert to km

    // Check if we crossed a marker point
    while (cumulativeDistance >= nextMarkerKm) {
      // Interpolate position
      const ratio = (nextMarkerKm - prevCumulative) / (cumulativeDistance - prevCumulative);
      const lat = track[i - 1].lat + ratio * (track[i].lat - track[i - 1].lat);
      const lon = track[i - 1].lon + ratio * (track[i].lon - track[i - 1].lon);

      addDistanceMarker(lat, lon, nextMarkerKm);
      nextMarkerKm += intervalKm;
    }
  }
}

function addDistanceMarker(lat, lon, km) {
  const icon = L.divIcon({
    className: 'distance-marker',
    html: `<div class="distance-marker-inner">${km}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  const marker = L.marker([lat, lon], { icon }).addTo(map);
  marker.bindTooltip(`${km} km`, { permanent: false, direction: 'top' });
  distanceMarkers.push(marker);
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

// Check if a POI is currently open based on OSM opening_hours
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
