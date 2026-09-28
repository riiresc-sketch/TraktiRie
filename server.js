/**
 * TraktiRie — Express server
 * Serves static frontend + /api/* routes (Turso + Supabase Auth).
 *
 * Run locally:
 *   npm install
 *   cp .env.example .env   # fill in values
 *   npm start
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// API routes (same paths as before so frontend keeps working)
app.use('/api/profile', require('./routes/profile'));
app.use('/api/commission', require('./routes/commission'));
app.use('/api/products', require('./routes/products'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/linkbio', require('./routes/linkbio'));
app.use('/api/theme', require('./routes/theme'));
app.use('/api/wa', require('./routes/wa'));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'TraktiRie', runtime: 'express' });
});

// Static files
const root = __dirname;
app.use(express.static(root, {
  extensions: ['html'],
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }
}));

// Pretty public URLs: /username/shop, /username/commission, etc.
function sendHtml(name) {
  return (_req, res) => res.sendFile(path.join(root, name));
}

app.get('/:user/(linkbio|bio|links)/?', sendHtml('linkbio.html'));
app.get('/:user/(shop|store|toko)/?', sendHtml('shop.html'));
app.get('/:user/(commission|comm|open)/?', sendHtml('commission.html'));
app.get('/:user/(support|donasi|donate|tip)/?', sendHtml('support.html'));
app.get('/shop/:user/?', sendHtml('shop.html'));
app.get('/u/:user/?', sendHtml('linkbio.html'));

// Fallback: /username → linkbio
app.get('/:user', (req, res, next) => {
  const reserved = new Set([
    'api', 'css', 'js', 'assets', 'index', 'login', 'signup', 'dashboard',
    'linkbio', 'shop', 'commission', 'support', 'manifest.json', 'service-worker.js', 'robots.txt'
  ]);
  if (reserved.has(req.params.user) || req.params.user.includes('.')) return next();
  res.sendFile(path.join(root, 'linkbio.html'));
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[TraktiRie]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`TraktiRie (Express) running at http://localhost:${PORT}`);
});
