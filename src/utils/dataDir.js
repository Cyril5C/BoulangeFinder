const fs = require('fs');
const path = require('path');

// Priority: DATA_PATH env var → /data if production → local data/
const DATA_DIR = process.env.DATA_PATH
  || (process.env.NODE_ENV === 'production' ? '/data' : path.join(__dirname, '../../data'));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

module.exports = DATA_DIR;
