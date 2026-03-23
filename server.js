/**
 * Statement Vault — Production Proxy Server
 * Proxies GoCardless API calls and persists session data server-side
 * so any device can resume bank connections without re-authenticating.
 */

const express = require('express');
const https   = require('https');
const path    = require('path');
const cors    = require('cors');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const GC_HOST      = 'bankaccountdata.gocardless.com';
const SESSION_FILE = path.join(__dirname, 'session.json');

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// ── Session routes (use JSON body parser ONLY here) ───────────────────────────
function readSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch(e) { console.error('Session read error:', e.message); }
  return {};
}
function writeSession(data) {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8'); }
  catch(e) { console.error('Session write error:', e.message); }
}

app.get('/session', function(req, res) {
  res.json(readSession());
});

app.post('/session', express.json(), function(req, res) {
  var updated = Object.assign(readSession(), req.body);
  writeSession(updated);
  res.json({ ok: true });
});

app.delete('/session/:key', function(req, res) {
  var current = readSession();
  delete current[req.params.key];
  writeSession(current);
  res.json({ ok: true });
});

// ── GoCardless API Proxy ──────────────────────────────────────────────────────
// Use express.raw() so the body is NOT pre-parsed — we forward it as-is.
app.use('/api', express.raw({ type: '*/*', limit: '10mb' }), function(req, res) {
  var gcPath = '/api/v2' + req.url;
  var body   = req.body && req.body.length ? req.body : Buffer.alloc(0);
  console.log('-> GoCardless: ' + req.method + ' ' + gcPath + ' (' + body.length + ' bytes)');

  function attempt(retriesLeft) {
    var options = {
      hostname: GC_HOST,
      path:     gcPath,
      method:   req.method,
      headers: {
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'Content-Length': body.length
      }
    };
    if (req.headers.authorization) options.headers['Authorization'] = req.headers.authorization;

    var proxyReq = https.request(options, function(proxyRes) {
      console.log('<- ' + proxyRes.statusCode + ' ' + req.method + ' ' + gcPath);
      res.status(proxyRes.statusCode);
      Object.keys(proxyRes.headers).forEach(function(h) {
        if (h !== 'transfer-encoding') res.setHeader(h, proxyRes.headers[h]);
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', function(err) {
      console.error('Proxy error: ' + err.message + ' (retries left: ' + retriesLeft + ')');
      if (retriesLeft > 0) {
        setTimeout(function() { attempt(retriesLeft - 1); }, 800);
      } else {
        if (!res.headersSent) res.status(502).json({ error: 'Proxy error', detail: err.message });
      }
    });

    if (body.length > 0) proxyReq.write(body);
    proxyReq.end();
  }

  attempt(3);
});

// ── Serve static frontend ─────────────────────────────────────────────────────
app.use(express.static(__dirname));

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, function() {
  console.log('\n✅ Statement Vault running on port ' + PORT);
  console.log('   Proxying /api/* -> https://' + GC_HOST + '/api/v2/*');
  console.log('   Session file: ' + SESSION_FILE + '\n');
});
