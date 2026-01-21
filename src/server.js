const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const gpxRoutes = require('./routes/gpx');

const app = express();
const PORT = process.env.PORT || 3000;

// Password from environment variable or default
const APP_PASSWORD = process.env.APP_PASSWORD || 'boulanges2024';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'boulanges-secret-key-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session.authenticated) {
    return next();
  }
  // Allow login page and API
  if (req.path === '/login' || req.path === '/api/login') {
    return next();
  }
  // Redirect to login
  res.redirect('/login');
}

// Login page
app.get('/login', (req, res) => {
  if (req.session.authenticated) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Login API
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

// Protected static files
app.use(requireAuth);
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/gpx', gpxRoutes);

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
