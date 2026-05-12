const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const DATA_DIR = process.env.NODE_ENV === 'production'
  ? '/data/traces'
  : path.join(__dirname, '../../data/traces');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function tracePath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeIndex(index) {
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(index), 'utf8');
}

// Stable ID from filename — same file on any device gives the same ID
function traceId(filename) {
  return crypto.createHash('sha256').update(filename).digest('hex').slice(0, 12);
}

// GET /api/traces — list all saved traces (metadata only)
router.get('/', (req, res) => {
  res.json(readIndex());
});

// GET /api/traces/:id — load full trace data
router.get('/:id', (req, res) => {
  const file = tracePath(req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Trace introuvable' });
  try {
    const { data } = JSON.parse(fs.readFileSync(file, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Erreur lecture trace' });
  }
});

// DELETE /api/traces/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const file = tracePath(id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const index = readIndex().filter(t => t.id !== id);
  writeIndex(index);
  res.json({ ok: true });
});

// Called internally from gpx route to save a trace
function saveTrace(filename, data) {
  const id = traceId(filename);
  fs.writeFileSync(tracePath(id), JSON.stringify({ data, savedAt: Date.now() }), 'utf8');

  const index = readIndex();
  const existing = index.findIndex(t => t.id === id);
  const meta = {
    id,
    name: filename.replace(/\.gpx$/i, ''),
    savedAt: Date.now(),
    poiCount: data.pois.filter(p => p.type !== 'borne').length,
    trackPoints: data.track.length
  };
  if (existing >= 0) index[existing] = meta;
  else index.unshift(meta);
  writeIndex(index);
  return id;
}

module.exports = router;
module.exports.saveTrace = saveTrace;
