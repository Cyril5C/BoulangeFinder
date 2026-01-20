const express = require('express');
const multer = require('multer');
const { parseGPX } = require('../services/gpxParser');
const { findPOIsAlongRoute } = require('../services/poiService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', upload.single('gpx'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier GPX fourni' });
    }

    const gpxContent = req.file.buffer.toString('utf-8');
    const trackPoints = parseGPX(gpxContent);

    if (trackPoints.length === 0) {
      return res.status(400).json({ error: 'Aucun point de trace trouvé dans le fichier GPX' });
    }

    const maxDetour = parseInt(req.body.maxDetour) || 500;

    // Parse POI types from request
    let poiTypes = ['bakery']; // Default
    if (req.body.poiTypes) {
      try {
        poiTypes = JSON.parse(req.body.poiTypes);
      } catch (e) {
        poiTypes = req.body.poiTypes.split(',');
      }
    }

    console.log('Requested POI types:', poiTypes);
    const pois = await findPOIsAlongRoute(trackPoints, maxDetour, poiTypes);
    console.log('Found POIs by type:', {
      bakery: pois.filter(p => p.type === 'bakery').length,
      cafe: pois.filter(p => p.type === 'cafe').length,
      water: pois.filter(p => p.type === 'water').length,
      toilets: pois.filter(p => p.type === 'toilets').length
    });

    res.json({
      track: trackPoints,
      pois: pois,
      stats: {
        trackPoints: trackPoints.length,
        totalPois: pois.length,
        bakeries: pois.filter(p => p.type === 'bakery').length,
        cafes: pois.filter(p => p.type === 'cafe').length,
        waterPoints: pois.filter(p => p.type === 'water').length,
        toilets: pois.filter(p => p.type === 'toilets').length
      }
    });
  } catch (error) {
    console.error('Erreur lors du traitement du GPX:', error);
    res.status(500).json({ error: 'Erreur lors du traitement du fichier GPX' });
  }
});

module.exports = router;
