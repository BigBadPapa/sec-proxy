const express = require('express');
const app = express();

// Подключаем роутер метрик
const metricsRouter = require('./edgar_metrics');
app.use('/metrics', metricsRouter);

// Подключаем роутер info (когда создашь)
// const infoRouter = require('./edgar_info');
// app.use('/info', infoRouter);

// Health check
app.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SEC Proxy server running on port ${PORT}`);
});
