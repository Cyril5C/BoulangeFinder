const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const DATA_DIR = process.env.NODE_ENV === 'production'
  ? '/data'
  : path.join(__dirname, '../../data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CUSTOM_POIS_FILE = path.join(DATA_DIR, 'custom_pois.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(CUSTOM_POIS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeAll(data) {
  fs.writeFileSync(CUSTOM_POIS_FILE, JSON.stringify(data), 'utf8');
}

// GET /api/custom-pois?traceKey=xxx
router.get('/', (req, res) => {
  const { traceKey } = req.query;
  if (!traceKey) return res.status(400).json({ error: 'traceKey requis' });
  const all = readAll();
  res.json(all[traceKey] || []);
});

// POST /api/custom-pois { traceKey, poi }
router.post('/', (req, res) => {
  const { traceKey, poi } = req.body;
  if (!traceKey || !poi) return res.status(400).json({ error: 'traceKey et poi requis' });
  const all = readAll();
  if (!all[traceKey]) all[traceKey] = [];
  all[traceKey].push(poi);
  writeAll(all);
  res.json(all[traceKey]);
});

// DELETE /api/custom-pois/:id?traceKey=xxx
router.delete('/:id', (req, res) => {
  const { traceKey } = req.query;
  const { id } = req.params;
  if (!traceKey) return res.status(400).json({ error: 'traceKey requis' });
  const all = readAll();
  if (all[traceKey]) {
    all[traceKey] = all[traceKey].filter(p => String(p.id) !== String(id));
    writeAll(all);
  }
  res.json(all[traceKey] || []);
});

module.exports = router;
