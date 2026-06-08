const express = require('express');
const fs = require('fs');
const path = require('path');
const DATA_DIR = require('../utils/dataDir');

const router = express.Router();
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');

function readComments() {
  try {
    return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeComments(comments) {
  fs.writeFileSync(COMMENTS_FILE, JSON.stringify(comments), 'utf8');
}

// GET /api/comments → { poiId: text, ... }
router.get('/', (req, res) => {
  res.json(readComments());
});

// POST /api/comments { id, text } → updated map (empty text removes the comment)
router.post('/', (req, res) => {
  const { id, text } = req.body;
  if (!id) return res.status(400).json({ error: 'id requis' });

  const comments = readComments();
  const trimmed = String(text || '').trim();
  if (trimmed) {
    comments[String(id)] = trimmed;
  } else {
    delete comments[String(id)];
  }
  writeComments(comments);
  res.json(comments);
});

module.exports = router;
