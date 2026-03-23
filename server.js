/**
 * Statement Vault — Production Proxy Server
 * Proxies GoCardless API calls and persists session data server-side
 * so any device can resume bank connections without re-authenticating.
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const GC_HOST = 'bankaccountdata.gocardless.com';
const SESSION_FILE = path.join(__dirname, 'session.json');

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());

// ── Session persistence ───────────────────────────────────────────────────────
// Saves requisition IDs and extra banks server-side so any device can load them

function readSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch(e) {
    console.error('Error reading session:', e.message);
  }
  return {};
}

function writeSession(data) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch(e) {
    console.error('Error writing session:', e.message);
  }
}

// GET /session — load saved requisitions + extra banks
app.get('/session', function(req, res) {
  res.json(readSession());
});

// POST /session — save requisitions + extra banks
app.post('/session', function(req, res) {
  var current = readSession();
  var updated = Object.assign(current, req.body);
  writeSession(updated);
  res.json({ ok: true });
});

// DELETE /session/:key — remove a single key (e.g. when removing a bank)
app.delete('/session/:key', function(req, res) {
  var current = readSession();
  delete current[req.params.key];
  writeSession(current);
  res.json({ ok: true });
});

// ── GoCardless API Proxy ──────────────────────────────────────────────────────
app.use('/api', createProxyMiddleware({
  target: 'https://' + GC_HOST,
  changeOrigin: true,
  pathRewrite: function(reqPath) {
    var rewritten = '/api/v2' + reqPath;
    console.log('-> GoCardless: ' + rewritten);
    return rewritten;
  },
  on: {
    proxyRes: function(proxyRes, req) {
      console.log('<- ' + proxyRes.statusCode + ' ' + req.method + ' ' + req.path);
    },
    error: function(err, req, res) {
      console.error('Proxy error:', err.message);
      res.status(502).json({ error: 'Proxy error', detail: err.message });
    }
  }
}));

// ── Serve static frontend ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, function() {
  console.log('\n✅ Statement Vault running on port ' + PORT);
  console.log('   Proxying /api/* -> https://' + GC_HOST + '/api/v2/*');
  console.log('   Session file: ' + SESSION_FILE);
  console.log('   Environment: ' + (process.env.NODE_ENV || 'development') + '\n');
});
