// Global state
let map = null;
let trackLayer = null;
let poiLayers = {
  bakery: null,
  cafe: null,
  water: null
};
let currentData = null;

// DOM Elements
const uploadSection = document.getElementById('upload-section');
const mapSection = document.getElementById('map-section');
const gpxForm = document.getElementById('gpx-form');
const gpxFileInput = document.getElementById('gpx-file');
const fileNameSpan = document.getElementById('file-name');
const submitBtn = document.querySelector('.submit-btn');
const backBtn = document.getElementById('back-btn');

// Marker icons
const icons = {
  bakery: createIcon('#f59e0b', '🥖'),
  cafe: createIcon('#8b5cf6', '☕'),
  water: createIcon('#3b82f6', '💧')
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

  const formData = new FormData();
  formData.append('gpx', file);
  formData.append('maxDetour', document.getElementById('max-detour').value);

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
    showMap(currentData);
  } catch (error) {
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

  // Update stats
  updateStats(data.stats);
  updateFilters();
}

function createPopupContent(poi) {
  const typeLabels = {
    bakery: 'Boulangerie',
    cafe: 'Bar / Café',
    water: "Point d'eau"
  };

  let html = `<div class="poi-popup">
    <span class="poi-type ${poi.type}">${typeLabels[poi.type]}</span>
    <h4>${poi.name}</h4>
    <p>Distance du parcours: ${poi.distance}m</p>`;

  if (poi.tags?.opening_hours) {
    html += `<p>Horaires: ${poi.tags.opening_hours}</p>`;
  }

  html += '</div>';
  return html;
}

function updateStats(stats) {
  document.getElementById('stats').innerHTML = `
    <strong>${stats.trackPoints}</strong> points de trace<br>
    <strong>${stats.totalPois}</strong> POI trouvés
  `;

  document.getElementById('count-bakery').textContent = stats.bakeries;
  document.getElementById('count-cafe').textContent = stats.cafes;
  document.getElementById('count-water').textContent = stats.waterPoints;
}

function updateFilters() {
  ['bakery', 'cafe', 'water'].forEach(type => {
    const checkbox = document.getElementById(`filter-${type}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        map.addLayer(poiLayers[type]);
      } else {
        map.removeLayer(poiLayers[type]);
      }
    });
  });
}

// Back button
backBtn.addEventListener('click', () => {
  mapSection.classList.add('hidden');
  uploadSection.classList.remove('hidden');
  gpxForm.reset();
  fileNameSpan.textContent = '';
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
  const filters = {
    bakery: document.getElementById('filter-bakery').checked,
    cafe: document.getElementById('filter-cafe').checked,
    water: document.getElementById('filter-water').checked
  };

  return currentData.pois.filter(poi => filters[poi.type]);
}

function generateGPX(pois) {
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BoulangeFinder">
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
