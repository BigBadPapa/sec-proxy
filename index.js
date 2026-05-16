const express = require('express');
const app = express();

const metricsRouter = require('./edgar_metrics');
const infoRouter = require('./edgar_info');

app.use('/metrics', metricsRouter);
app.use('/info', infoRouter);

app.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SEC Proxy server running on port ${PORT}`);
});
