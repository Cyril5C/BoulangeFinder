const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// In-memory store for shared maps (in production, use Redis or a database)
const sharedMaps = new Map();

// Clean old entries every hour
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
  for (const [id, entry] of sharedMaps) {
    if (now - entry.createdAt > maxAge) {
      sharedMaps.delete(id);
    }
  }
}, 60 * 60 * 1000);

// Create a shared map
router.post('/create', (req, res) => {
  try {
    const { data } = req.body;

    console.log('Share create request received, body size:', JSON.stringify(req.body).length);

    if (!data) {
      console.log('No data in request body');
      return res.status(400).json({ error: 'Données manquantes' });
    }

    if (!data.track || !data.pois) {
      console.log('Missing track or pois:', { hasTrack: !!data.track, hasPois: !!data.pois });
      return res.status(400).json({ error: 'Données invalides (track ou pois manquants)' });
    }

    // Generate unique ID
    const id = crypto.randomBytes(6).toString('base64url');

    // Store the data
    sharedMaps.set(id, {
      data,
      createdAt: Date.now()
    });

    res.json({ id, url: `/share/${id}` });
  } catch (error) {
    console.error('Share create error:', error);
    res.status(500).json({ error: 'Erreur lors de la création du partage' });
  }
});

// Get shared map data
router.get('/:id', (req, res) => {
  const { id } = req.params;

  const entry = sharedMaps.get(id);
  if (!entry) {
    return res.status(404).json({ error: 'Carte non trouvée ou expirée' });
  }

  res.json(entry.data);
});

module.exports = router;
