// ============ ENDPOINTS.JS - ВСЕ ЭНДПОИНТЫ SEC ============

const express = require('express');
const router = express.Router();

// Подключаем логику
const metricsLogic = require('./edgar_metrics');
const infoLogic = require('./edgar_info');
const actionsLogic = require('./edgar_actions');
const searchLogic = require('./edgar_search');
const indexLogic = require('./edgar_index');
const bulkLogic = require('./edgar_bulk');

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
router.get('/metrics/:ticker', metricsLogic.getMetric);

// 4.2. Справочник метрик
router.get('/catalog', metricsLogic.getCatalog);

// 4.3. Валидация метрики
router.get('/validate/:metric', metricsLogic.validateMetric);

// ============ 5. COMPANY INFO (СТАТИКА) ============

// 5.1. Статическая информация о компании
router.get('/info/:ticker', infoLogic.getInfo);

// 5.2. Метаданные компании (кратко)
router.get('/company-meta/:ticker', infoLogic.getCompanyMeta);

// ============ 6. FULL-TEXT SEARCH ============

// 6.1. Полнотекстовый поиск по всем filings
// Пример: https://efts.sec.gov/LATEST/search-index?q=artificial+intelligence&forms=10-K
router.get('/search', searchLogic.fullTextSearch);

// ============ 7. INDEX FILES ============

// 7.1. Дневной индекс (JSON)
// Пример: https://www.sec.gov/edgar/daily-index/2024/QTR4/master.2024-10-01.json
router.get('/daily-index/:year/:quarter/:date', indexLogic.getDailyIndex);

// 7.2. Полный индекс за квартал
// Пример: https://www.sec.gov/edgar/full-index/2024/QTR4/master.idx
router.get('/full-index/:year/:quarter', indexLogic.getFullIndex);

// 7.3. Дневной индекс по компаниям
router.get('/daily-index/:year/:quarter/company/:date', indexLogic.getDailyIndexCompany);

// 7.4. Дневной индекс по формам
router.get('/daily-index/:year/:quarter/form/:date', indexLogic.getDailyIndexForm);

// ============ 8. BULK DATA ============

// 8.1. Bulk submissions (ZIP)
// Пример: https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip
router.get('/bulk/submissions', bulkLogic.getSubmissionsBulk);

// 8.2. Bulk companyfacts (ZIP)
// Пример: https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip
router.get('/bulk/companyfacts', bulkLogic.getCompanyFactsBulk);

// ============ 9. DOCUMENT DOWNLOAD ============

// 9.1. HTML файл отчёта
// Пример: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
router.get('/document/:cik/:accessionNo/:document', actionsLogic.getDocument);

// 9.2. JSON-индекс файлов отчёта
// Пример: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/index.json
router.get('/document-index/:cik/:accessionNo', actionsLogic.getDocumentIndex);

// 9.3. Inline XBRL просмотрщик
// Пример: https://www.sec.gov/ix?doc=/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
router.get('/ix', actionsLogic.getInlineXbrl);

// ============ 10. RSS FEEDS ============

// 10.1. RSS по компании и форме
// Пример: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&type=10-K&output=atom
router.get('/rss/company/:cik', indexLogic.getRssCompany);

// 10.2. RSS последних подач по форме
// Пример: https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-K&output=atom
router.get('/rss/latest/:form', indexLogic.getRssLatest);

// ============ 11. ACTIONS (ОТЧЁТЫ И СОБЫТИЯ) ============

// 11.1. Отчёты по тикеру, форме, году, кварталу
router.get('/actions/reports/:ticker', actionsLogic.getReport);

// 11.2. Отчёт по accession number
router.get('/actions/report/:cik/:accessionNumber', actionsLogic.getReportByAccession);

// 11.3. Инсайдерские сделки (формы 3,4,5)
router.get('/actions/insider/:ticker', actionsLogic.getInsiderTrades);

// 11.4. Дивиденды
router.get('/actions/dividends/:ticker', actionsLogic.getDividends);

// 11.5. Количество акций в обращении
router.get('/actions/shares/:ticker', actionsLogic.getSharesOutstanding);

// 11.6. Выкуп акций
router.get('/actions/buybacks/:ticker', actionsLogic.getBuybacks);

// 11.7. Сплиты акций
router.get('/actions/splits/:ticker', actionsLogic.getSplits);

// 11.8. Институциональные владельцы (13F)
router.get('/actions/ownership/:ticker', actionsLogic.getInstitutionalOwners);

// 11.9. Голосования акционеров
router.get('/actions/meetings/:ticker', actionsLogic.getShareholderMeetings);

// 11.10. Смена руководства
router.get('/actions/executive/:ticker', actionsLogic.getExecutiveChanges);

// 11.11. Публичные предложения (IPO, S-1)
router.get('/actions/offerings/:ticker', actionsLogic.getOfferings);

// 11.12. Принудительные меры SEC
router.get('/actions/enforcement/:ticker', actionsLogic.getEnforcementActions);

// ============ 12. ВСПОМОГАТЕЛЬНЫЕ ============

router.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

router.get('/version', (req, res) => {
  res.json({ version: '1.0.0', name: 'SEC Proxy' });
});

router.get('/cache-status', infoLogic.getCacheStatus);

router.post('/clear-cache', infoLogic.clearCache);

module.exports = router;
