// ============ ENDPOINTS.JS - ВСЕ ЭНДПОИНТЫ SEC ==========
// Полный список эндпоинтов из официальной документации SEC

const express = require('express');
const router = express.Router();

// Подключаем логику
const metricsLogic = require('./edgar_metrics');
const infoLogic = require('./edgar_info');
const handler = require('./handler');
const common = require('./edgar_common');

// ============ НОВЫЕ ЭНДПОИНТЫ ДЛЯ GAS ============
router.post('/api/edgar', handler.processEdgar);
router.post('/api/info', handler.processInfo);

// ============ 1. COMPANY TICKERS ============
router.get('/company-tickers', infoLogic.getCompanyTickers);
router.get('/company-tickers-mf', infoLogic.getCompanyTickersMF);
router.get('/company-tickers-exchange', infoLogic.getCompanyTickersExchange);

// ============ 2. SUBMISSIONS ============
router.get('/submissions/:identifier', infoLogic.getSubmissions);

// ============ 3. XBRL DATA ============
router.get('/companyfacts/:identifier', infoLogic.getCompanyFacts);
router.get('/companyconcept/:identifier/:taxonomy/:tag', infoLogic.getCompanyConcept);
router.get('/frames/:taxonomy/:tag/:unit/:period', infoLogic.getFrames);

// ============ 4. FINANCIAL METRICS (КАСТОМНЫЕ) ============
router.get('/metrics/:ticker', metricsLogic.getMetric);
router.get('/catalog', metricsLogic.getCatalog);
router.get('/validate/:metric', metricsLogic.validateMetric);

// ============ 5. COMPANY INFO (СТАТИКА) ============
router.get('/info/:ticker', infoLogic.getInfo);
router.get('/company-meta/:ticker', infoLogic.getCompanyMeta);

// ============ 6. ACTIONS (КОРПОРАТИВНЫЕ ДЕЙСТВИЯ) - ЗАГЛУШКИ ============
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

// ============ 7. DOCUMENT DOWNLOAD ============
router.get('/document/:cik/:accessionNo/:document', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/document-index/:cik/:accessionNo', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/ix', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// ============ 8. FULL-TEXT SEARCH ============
router.get('/search', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// ============ 9. INDEX FILES ============
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

// ============ 10. BULK DATA ============
router.get('/bulk/submissions', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/bulk/companyfacts', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// ============ 11. RSS FEEDS ============
router.get('/rss/company/:cik', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/rss/latest/:form', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// ============ 12. ВСПОМОГАТЕЛЬНЫЕ ============
router.get('/version', (req, res) => {
  res.json({ version: '1.0.0', name: 'SEC Proxy' });
});
router.get('/cache-status', common.getCacheStatus);
router.post('/clear-cache', common.clearCache);

module.exports = router;
