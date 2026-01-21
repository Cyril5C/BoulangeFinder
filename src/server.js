const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const gpxRoutes = require('./routes/gpx');
const shareRoutes = require('./routes/share');

const app = express();
const PORT = process.env.PORT || 3000;

// Password from environment variable or default
const APP_PASSWORD = process.env.APP_PASSWORD || 'boulanges2024';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy for Railway/Render (required for secure cookies behind reverse proxy)
app.set('trust proxy', 1);

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'boulanges-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Login page (public)
app.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Login API (public)
app.post('/api/login', (req, res) => {
  const { password } = req.body;

  if (password === APP_PASSWORD) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

// Logout API
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Auth middleware for all other routes
app.use((req, res, next) => {
  // Allow service worker and manifest for PWA
  if (req.path === '/sw.js' || req.path === '/manifest.json') {
    return next();
  }

  if (req.session.authenticated) {
    return next();
  }

  // For API requests, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  // Redirect to login
  res.redirect('/login');
});

// Protected static files
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/gpx', gpxRoutes);
app.use('/api/share', shareRoutes);

// Shared map page (public with auth)
app.get('/share/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
