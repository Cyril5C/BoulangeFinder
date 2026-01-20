const { getBoundingBox, simplifyTrack } = require('../utils/geo');

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

const POI_QUERIES = {
  bakery: 'node["shop"="bakery"]',
  cafe: 'node["amenity"~"cafe|bar|pub"]',
  water: 'node["amenity"="drinking_water"]'
};

async function findPOIsAlongRoute(trackPoints, maxDetourMeters = 500) {
  // Simplify track to reduce query complexity
  const simplifiedTrack = simplifyTrack(trackPoints, 100);

  // Get bounding box with buffer
  const bbox = getBoundingBox(simplifiedTrack, maxDetourMeters);

  // Build Overpass query
  const query = buildOverpassQuery(bbox);

  try {
    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`);
    }

    const data = await response.json();

    // Filter POIs by actual distance to track
    const pois = filterPOIsByDistance(data.elements, trackPoints, maxDetourMeters);

    return pois;
  } catch (error) {
    console.error('Erreur Overpass API:', error);
    throw error;
  }
}

function buildOverpassQuery(bbox) {
  const { south, west, north, east } = bbox;
  const bboxStr = `${south},${west},${north},${east}`;

  return `
    [out:json][timeout:30];
    (
      ${POI_QUERIES.bakery}(${bboxStr});
      ${POI_QUERIES.cafe}(${bboxStr});
      ${POI_QUERIES.water}(${bboxStr});
    );
    out body;
  `;
}

function filterPOIsByDistance(elements, trackPoints, maxDistance) {
  const pois = [];

  for (const element of elements) {
    if (element.type !== 'node') continue;

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
  return 'unknown';
}

function getDefaultName(tags) {
  if (!tags) return 'Sans nom';
  if (tags.shop === 'bakery') return 'Boulangerie';
  if (tags.amenity === 'cafe') return 'Café';
  if (tags.amenity === 'bar') return 'Bar';
  if (tags.amenity === 'pub') return 'Pub';
  if (tags.amenity === 'drinking_water') return "Point d'eau";
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
