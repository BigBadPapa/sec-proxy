// ============ INDEX.JS - ТОЧКА ВХОДА =============

const express = require('express');
const app = express();

// Парсинг POST тела
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const endpoints = require('./endpoints');

app.use('/', endpoints);

app.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.url, method: req.method });
});

app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`SEC Proxy server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/ping`);
  console.log(`Metrics: http://localhost:${PORT}/metrics/AAPL?metrics=revenue`);
  console.log(`Info: http://localhost:${PORT}/api/info (POST only)`);
  console.log(`Catalog: http://localhost:${PORT}/catalog`);
  console.log(`========================================`);
});

module.exports = app;
