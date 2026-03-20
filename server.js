/**
 * Statement Vault — Production Proxy Server
 * Deploys to Railway or Render.
 * Proxies GoCardless API calls server-side to avoid CORS errors.
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const GC_HOST = 'bankaccountdata.gocardless.com';

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// GoCardless API Proxy
// Browser calls /api/token/new/ -> proxy rewrites to /api/v2/token/new/
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

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, function() {
  console.log('\n✅ Statement Vault running on port ' + PORT);
  console.log('   Proxying /api/* -> https://' + GC_HOST + '/api/v2/*');
  console.log('   Environment: ' + (process.env.NODE_ENV || 'development') + '\n');
});
