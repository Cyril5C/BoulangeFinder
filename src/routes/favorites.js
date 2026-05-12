const express = require('express');
const fs = require('fs');
const path = require('path');
const DATA_DIR = require('../utils/dataDir');

const router = express.Router();
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

function readFavorites() {
  try {
    return JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeFavorites(ids) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(ids), 'utf8');
}

// GET /api/favorites → array of POI ids
router.get('/', (req, res) => {
  res.json(readFavorites());
});

// POST /api/favorites/toggle { id } → updated array
router.post('/toggle', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id requis' });

  const ids = readFavorites();
  const strId = String(id);
  const idx = ids.indexOf(strId);
  if (idx === -1) {
    ids.push(strId);
  } else {
    ids.splice(idx, 1);
  }
  writeFavorites(ids);
  res.json(ids);
});

module.exports = router;
