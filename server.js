/**
 * TraktiRie — Express server
 * Local / Railway / Render: node server.js
 * Vercel: routes all traffic here via vercel.json (@vercel/node)
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api/profile', require('./routes/profile'));
app.use('/api/commission', require('./routes/commission'));
app.use('/api/products', require('./routes/products'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/linkbio', require('./routes/linkbio'));
app.use('/api/theme', require('./routes/theme'));
app.use('/api/wa', require('./routes/wa'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'TraktiRie', runtime: 'express' });
});

// Static files (HTML, CSS, JS, assets)
app.use(express.static(publicDir, {
  extensions: ['html'],
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (/\.(html|css|js)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

function sendHtml(name) {
  return (_req, res) => res.sendFile(path.join(publicDir, name));
}

// Pretty public URLs
app.get('/:user/(linkbio|bio|links)/?', sendHtml('linkbio.html'));
app.get('/:user/(shop|store|toko)/?', sendHtml('shop.html'));
app.get('/:user/(commission|comm|open)/?', sendHtml('commission.html'));
app.get('/:user/(support|donasi|donate|tip)/?', sendHtml('support.html'));
app.get('/shop/:user/?', sendHtml('shop.html'));
app.get('/u/:user/?', sendHtml('linkbio.html'));

// /username → linkbio
app.get('/:user', (req, res, next) => {
  const reserved = new Set([
    'api', 'css', 'js', 'assets', 'index', 'login', 'signup', 'dashboard',
    'linkbio', 'shop', 'commission', 'support', 'manifest.json',
    'service-worker.js', 'robots.txt', 'favicon.ico'
  ]);
  if (reserved.has(req.params.user) || req.params.user.includes('.')) return next();
  res.sendFile(path.join(publicDir, 'linkbio.html'));
});

// Root fallback
app.get('/', sendHtml('index.html'));

app.use((err, _req, res, _next) => {
  console.error('[TraktiRie]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Export for Vercel serverless; listen only outside Vercel
module.exports = app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`TraktiRie running at http://localhost:${PORT}`);
  });
}
