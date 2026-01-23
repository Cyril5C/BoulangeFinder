const express = require('express');
const multer = require('multer');
const { parseGPX } = require('../services/gpxParser');
const { findPOIsAlongRoute, getCacheStats } = require('../services/poiService');

const router = express.Router();

// File upload with size limit (10MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Valid POI types
const VALID_POI_TYPES = ['bakery', 'cafe', 'water', 'toilets', 'hotel'];

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

    // Validate maxDetour (100-5000 meters)
    const maxDetour = parseInt(req.body.maxDetour) || 500;
    if (maxDetour < 100 || maxDetour > 5000) {
      return res.status(400).json({ error: 'maxDetour doit être entre 100 et 5000 mètres' });
    }

    // Parse and validate POI types
    let poiTypes = ['bakery']; // Default
    if (req.body.poiTypes) {
      try {
        poiTypes = JSON.parse(req.body.poiTypes);
      } catch (e) {
        poiTypes = req.body.poiTypes.split(',');
      }
      // Filter to only valid types
      poiTypes = poiTypes.filter(type => VALID_POI_TYPES.includes(type));
      if (poiTypes.length === 0) {
        return res.status(400).json({ error: 'Au moins un type de POI valide requis' });
      }
    }

    console.log('Requested POI types:', poiTypes);
    const pois = await findPOIsAlongRoute(trackPoints, maxDetour, poiTypes);
    console.log('Found POIs by type:', {
      bakery: pois.filter(p => p.type === 'bakery').length,
      cafe: pois.filter(p => p.type === 'cafe').length,
      water: pois.filter(p => p.type === 'water').length,
      toilets: pois.filter(p => p.type === 'toilets').length,
      hotel: pois.filter(p => p.type === 'hotel').length
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
        toilets: pois.filter(p => p.type === 'toilets').length,
        hotels: pois.filter(p => p.type === 'hotel').length
      }
    });
  } catch (error) {
    console.error('Erreur lors du traitement du GPX:', error);
    res.status(500).json({ error: 'Erreur lors du traitement du fichier GPX' });
  }
});

// Get server-side cache stats
router.get('/cache', (req, res) => {
  try {
    const stats = getCacheStats();
    res.json(stats);
  } catch (error) {
    console.error('Erreur lors de la récupération du cache:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du cache' });
  }
});

module.exports = router;
