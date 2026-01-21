const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// File-based storage for shared maps
// Use /data for Railway volume mount, fallback to local data/ for development
const DATA_DIR = process.env.NODE_ENV === 'production'
  ? '/data/shares'
  : path.join(__dirname, '../../data/shares');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Helper functions
function getSharePath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function saveShare(id, data) {
  const filePath = getSharePath(id);
  fs.writeFileSync(filePath, JSON.stringify({
    data,
    createdAt: Date.now()
  }));
}

function loadShare(id) {
  const filePath = getSharePath(id);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

// Clean old entries every hour
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

  try {
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(DATA_DIR, file);
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (now - content.createdAt > maxAge) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        // Remove corrupted files
        fs.unlinkSync(filePath);
      }
    }
  } catch (e) {
    console.error('Error cleaning old shares:', e);
  }
}, 60 * 60 * 1000);

// Create a shared map
router.post('/create', (req, res) => {
  try {
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    if (!data.track || !data.pois) {
      return res.status(400).json({ error: 'Données invalides (track ou pois manquants)' });
    }

    // Generate unique ID
    const id = crypto.randomBytes(6).toString('base64url');

    // Save to file
    saveShare(id, data);

    res.json({ id, url: `/share/${id}` });
  } catch (error) {
    console.error('Share create error:', error);
    res.status(500).json({ error: 'Erreur lors de la création du partage' });
  }
});

// Get shared map data
router.get('/:id', (req, res) => {
  const { id } = req.params;

  const entry = loadShare(id);
  if (!entry) {
    return res.status(404).json({ error: 'Carte non trouvée ou expirée' });
  }

  res.json(entry.data);
});

module.exports = router;
