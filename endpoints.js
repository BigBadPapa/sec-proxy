// ============ ENDPOINTS.JS - ВСЕ ЭНДПОИНТЫ SEC ==========

const express = require('express');
const router = express.Router();

const handler = require('./handler');
const direct = require('./direct');
const common = require('./common');

// ============ ЭНДПОИНТЫ ДЛЯ GAS ============
router.post('/api/edgar', handler.processEdgar);
router.post('/api/info', handler.processInfo);

// ============ ПРЯМЫЕ ЗАПРОСЫ (METRICS) ============
router.get('/metrics/:ticker', direct.getMetric);
router.get('/catalog', direct.getCatalog);
router.get('/validate/:metric', direct.validateMetric);

// ============ ВСПОМОГАТЕЛЬНЫЕ ============
router.get('/version', (req, res) => {
  res.json({ version: '1.0.0', name: 'SEC Proxy' });
});
router.get('/cache-status', common.getCacheStatus);
router.post('/clear-cache', common.clearCache);
router.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

// ============ ЗАГЛУШКИ ДЛЯ БУДУЩИХ ЭНДПОИНТОВ ==========
router.get('/company-tickers', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - будет реализовано в будущем', endpoint: req.path });
});
router.get('/company-tickers-mf', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - будет реализовано в будущем', endpoint: req.path });
});
router.get('/company-tickers-exchange', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - будет реализовано в будущем', endpoint: req.path });
});
router.get('/submissions/:identifier', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - будет реализовано в будущем', endpoint: req.path });
});
router.get('/companyfacts/:identifier', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - будет реализовано в будущем', endpoint: req.path });
});
router.get('/companyconcept/:identifier/:taxonomy/:tag', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - будет реализовано в будущем', endpoint: req.path });
});
router.get('/frames/:taxonomy/:tag/:unit/:period', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - будет реализовано в будущем', endpoint: req.path });
});
router.get('/info/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - будет реализовано в будущем', endpoint: req.path });
});
router.get('/company-meta/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet - будет реализовано в будущем', endpoint: req.path });
});

// ACTIONS
router.get('/actions/reports/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/report/:cik/:accessionNumber', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/insider/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/dividends/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/shares/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/buybacks/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/splits/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/ownership/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/meetings/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/executive/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/offerings/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/actions/enforcement/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// DOCUMENT
router.get('/document/:cik/:accessionNo/:document', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/document-index/:cik/:accessionNo', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/ix', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// SEARCH
router.get('/search', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// INDEX FILES
router.get('/daily-index/:year/:quarter/:date', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/full-index/:year/:quarter', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/daily-index/:year/:quarter/company/:date', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/daily-index/:year/:quarter/form/:date', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// BULK DATA
router.get('/bulk/submissions', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/bulk/companyfacts', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// RSS FEEDS
router.get('/rss/company/:cik', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/rss/latest/:form', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

module.exports = router;
