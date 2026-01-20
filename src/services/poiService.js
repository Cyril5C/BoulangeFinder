const { getBoundingBox, simplifyTrack } = require('../utils/geo');

// Multiple Overpass API endpoints for fallback
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

const POI_QUERIES = {
  bakery: 'node["shop"="bakery"]',
  cafe: 'node["amenity"~"cafe|bar|pub"]',
  water: 'node["amenity"="drinking_water"]',
  toilets: 'node["amenity"="toilets"]'
};

// Paris bounding box (approximate)
const PARIS_BBOX = {
  south: 48.815,
  north: 48.902,
  west: 2.225,
  east: 2.470
};

function isInParis(lat, lon) {
  return lat >= PARIS_BBOX.south && lat <= PARIS_BBOX.north &&
         lon >= PARIS_BBOX.west && lon <= PARIS_BBOX.east;
}

async function findPOIsAlongRoute(trackPoints, maxDetourMeters = 500, poiTypes = ['bakery', 'cafe', 'water', 'toilets']) {
  // Simplify track to reduce query complexity
  const simplifiedTrack = simplifyTrack(trackPoints, 500);

  // Get bounding box with buffer
  const bbox = getBoundingBox(simplifiedTrack, maxDetourMeters);

  // Build Overpass query with selected POI types
  const query = buildOverpassQuery(bbox, poiTypes);

  // Try each endpoint until one works
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Trying Overpass endpoint: ${endpoint}`);
      const data = await fetchWithRetry(endpoint, query);

      // Filter POIs by actual distance to track
      const pois = filterPOIsByDistance(data.elements || [], trackPoints, maxDetourMeters);
      return pois;
    } catch (error) {
      console.error(`Endpoint ${endpoint} failed:`, error.message);
      lastError = error;
    }
  }

  throw lastError || new Error('All Overpass endpoints failed');
}

async function fetchWithRetry(endpoint, query, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.status === 429 || response.status === 504) {
        // Rate limited or timeout - wait and retry
        if (attempt < retries) {
          const waitTime = (attempt + 1) * 2000;
          console.log(`Got ${response.status}, waiting ${waitTime}ms before retry...`);
          await sleep(waitTime);
          continue;
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep((attempt + 1) * 1000);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildOverpassQuery(bbox, poiTypes) {
  const { south, west, north, east } = bbox;
  const bboxStr = `${south},${west},${north},${east}`;

  const queries = poiTypes
    .filter(type => POI_QUERIES[type])
    .map(type => `${POI_QUERIES[type]}(${bboxStr});`)
    .join('\n      ');

  return `
    [out:json][timeout:60];
    (
      ${queries}
    );
    out body;
  `;
}

function filterPOIsByDistance(elements, trackPoints, maxDistance) {
  const pois = [];

  for (const element of elements) {
    if (element.type !== 'node') continue;

    // Exclude POIs in Paris (too many points)
    if (isInParis(element.lat, element.lon)) continue;

    const minDistance = getMinDistanceToTrack(element.lat, element.lon, trackPoints);

    if (minDistance <= maxDistance) {
      pois.push({
        id: element.id,
        lat: element.lat,
        lon: element.lon,
        type: getPOIType(element.tags),
        name: element.tags?.name || getDefaultName(element.tags),
        distance: Math.round(minDistance),
        tags: element.tags
      });
    }
  }

  return pois;
}

function getPOIType(tags) {
  if (!tags) return 'unknown';
  if (tags.shop === 'bakery') return 'bakery';
  if (tags.amenity === 'cafe' || tags.amenity === 'bar' || tags.amenity === 'pub') return 'cafe';
  if (tags.amenity === 'drinking_water') return 'water';
  if (tags.amenity === 'toilets') return 'toilets';
  return 'unknown';
}

function getDefaultName(tags) {
  if (!tags) return 'Sans nom';
  if (tags.shop === 'bakery') return 'Boulangerie';
  if (tags.amenity === 'cafe') return 'Café';
  if (tags.amenity === 'bar') return 'Bar';
  if (tags.amenity === 'pub') return 'Pub';
  if (tags.amenity === 'drinking_water') return "Point d'eau";
  if (tags.amenity === 'toilets') return 'Toilettes';
  return 'POI';
}

function getMinDistanceToTrack(lat, lon, trackPoints) {
  let minDistance = Infinity;

  for (let i = 0; i < trackPoints.length - 1; i++) {
    const distance = pointToSegmentDistance(
      lat, lon,
      trackPoints[i].lat, trackPoints[i].lon,
      trackPoints[i + 1].lat, trackPoints[i + 1].lon
    );
    minDistance = Math.min(minDistance, distance);
  }

  return minDistance;
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  return haversineDistance(px, py, xx, yy);
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

module.exports = { findPOIsAlongRoute };
