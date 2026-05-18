// ============ ENDPOINTS.JS - ВСЕ ЭНДПОИНТЫ SEC ============
// Полный список эндпоинтов из официальной документации SEC
// Примеры для AAPL: https://sec-proxy-2tup.onrender.com/...

const express = require('express');
const router = express.Router();

// Подключаем логику
const metricsLogic = require('./edgar_metrics');
const infoLogic = require('./edgar_info');

// ============ 1. COMPANY TICKERS ============

// 1.1. Основной маппинг тикер → CIK
// Пример: https://www.sec.gov/files/company_tickers.json
router.get('/company-tickers', infoLogic.getCompanyTickers);

// 1.2. Маппинг для фондов и ETF
// Пример: https://www.sec.gov/files/company_tickers_mf.json
router.get('/company-tickers-mf', infoLogic.getCompanyTickersMF);

// 1.3. Расширенный маппинг с биржами
// Пример: https://www.sec.gov/files/company_tickers_exchange.json
router.get('/company-tickers-exchange', infoLogic.getCompanyTickersExchange);

// ============ 2. SUBMISSIONS ============

// 2.1. Метаданные + история подач компании (по тикеру или CIK)
// Пример: https://data.sec.gov/submissions/CIK0000320193.json
router.get('/submissions/:identifier', infoLogic.getSubmissions);

// ============ 3. XBRL DATA ============

// 3.1. Все XBRL факты компании
// Пример: https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json
router.get('/companyfacts/:identifier', infoLogic.getCompanyFacts);

// 3.2. Конкретный показатель компании (taxonomy + tag)
// Пример: https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Revenues.json
router.get('/companyconcept/:identifier/:taxonomy/:tag', infoLogic.getCompanyConcept);

// 3.3. Агрегированные данные по рынку
// Пример: https://data.sec.gov/api/xbrl/frames/us-gaap/Assets/USD/CY2024.json
router.get('/frames/:taxonomy/:tag/:unit/:period', infoLogic.getFrames);

// ============ 4. FINANCIAL METRICS (КАСТОМНЫЕ) ============

// 4.1. Финансовые показатели с обработкой (TTM, compute, масштабы)
// Пример: https://sec-proxy-2tup.onrender.com/metrics/AAPL?metrics=revenue&year=2024&quarter=4&scale=kkk
router.get('/metrics/:ticker', metricsLogic.getMetric);

// 4.2. Справочник метрик
// Пример: https://sec-proxy-2tup.onrender.com/catalog
router.get('/catalog', metricsLogic.getCatalog);

// 4.3. Валидация метрики
// Пример: https://sec-proxy-2tup.onrender.com/validate/revenue
router.get('/validate/:metric', metricsLogic.validateMetric);

// ============ 5. COMPANY INFO (СТАТИКА) ============

// 5.1. Статическая информация о компании
// Пример: https://sec-proxy-2tup.onrender.com/info/AAPL
router.get('/info/:ticker', infoLogic.getInfo);

// 5.2. Метаданные компании (кратко)
// Пример: https://sec-proxy-2tup.onrender.com/company-meta/AAPL
router.get('/company-meta/:ticker', infoLogic.getCompanyMeta);

// ============ 6. ACTIONS (КОРПОРАТИВНЫЕ ДЕЙСТВИЯ) - ЗАГЛУШКИ ============

// 6.1. Отчёты по тикеру
router.get('/actions/reports/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.2. Отчёт по accession number
router.get('/actions/report/:cik/:accessionNumber', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.3. Инсайдерские сделки
router.get('/actions/insider/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.4. Дивиденды
router.get('/actions/dividends/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.5. Количество акций
router.get('/actions/shares/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.6. Выкуп акций
router.get('/actions/buybacks/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.7. Сплиты
router.get('/actions/splits/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.8. Институциональные владельцы
router.get('/actions/ownership/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.9. Голосования акционеров
router.get('/actions/meetings/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.10. Смена руководства
router.get('/actions/executive/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.11. Публичные предложения
router.get('/actions/offerings/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 6.12. Принудительные меры SEC
router.get('/actions/enforcement/:ticker', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// ============ 7. DOCUMENT DOWNLOAD ============

// 7.1. HTML файл отчёта
router.get('/document/:cik/:accessionNo/:document', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 7.2. JSON-индекс файлов отчёта
router.get('/document-index/:cik/:accessionNo', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

// 7.3. Inline XBRL просмотрщик
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

const common = require('./edgar_common');
router.get('/cache-status', common.getCacheStatus);
router.post('/clear-cache', common.clearCache);

module.exports = router;
