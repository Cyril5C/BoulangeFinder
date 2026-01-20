/**
 * Calculate bounding box around track points with buffer
 */
function getBoundingBox(points, bufferMeters) {
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;

  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }

  // Convert buffer from meters to degrees (approximate)
  const latBuffer = bufferMeters / 111000;
  const lonBuffer = bufferMeters / (111000 * Math.cos(toRad((minLat + maxLat) / 2)));

  return {
    south: minLat - latBuffer,
    north: maxLat + latBuffer,
    west: minLon - lonBuffer,
    east: maxLon + lonBuffer
  };
}

/**
 * Simplify track by keeping points at minimum interval
 */
function simplifyTrack(points, minIntervalMeters) {
  if (points.length <= 2) return points;

  const simplified = [points[0]];
  let lastPoint = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = haversineDistance(
      lastPoint.lat, lastPoint.lon,
      points[i].lat, points[i].lon
    );

    if (distance >= minIntervalMeters) {
      simplified.push(points[i]);
      lastPoint = points[i];
    }
  }

  // Always include last point
  simplified.push(points[points.length - 1]);

  return simplified;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
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

module.exports = { getBoundingBox, simplifyTrack, haversineDistance };
