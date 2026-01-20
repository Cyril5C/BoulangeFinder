const { XMLParser } = require('fast-xml-parser');

function parseGPX(gpxContent) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });

  const result = parser.parse(gpxContent);
  const points = [];

  if (!result.gpx) {
    throw new Error('Format GPX invalide');
  }

  // Handle track points (trk > trkseg > trkpt)
  const tracks = result.gpx.trk;
  if (tracks) {
    const trackArray = Array.isArray(tracks) ? tracks : [tracks];
    for (const track of trackArray) {
      const segments = track.trkseg;
      if (segments) {
        const segmentArray = Array.isArray(segments) ? segments : [segments];
        for (const segment of segmentArray) {
          const trackPoints = segment.trkpt;
          if (trackPoints) {
            const pointArray = Array.isArray(trackPoints) ? trackPoints : [trackPoints];
            for (const point of pointArray) {
              points.push({
                lat: parseFloat(point['@_lat']),
                lon: parseFloat(point['@_lon']),
                ele: point.ele ? parseFloat(point.ele) : null
              });
            }
          }
        }
      }
    }
  }

  // Handle route points (rte > rtept)
  const routes = result.gpx.rte;
  if (routes) {
    const routeArray = Array.isArray(routes) ? routes : [routes];
    for (const route of routeArray) {
      const routePoints = route.rtept;
      if (routePoints) {
        const pointArray = Array.isArray(routePoints) ? routePoints : [routePoints];
        for (const point of pointArray) {
          points.push({
            lat: parseFloat(point['@_lat']),
            lon: parseFloat(point['@_lon']),
            ele: point.ele ? parseFloat(point.ele) : null
          });
        }
      }
    }
  }

  return points;
}

module.exports = { parseGPX };
