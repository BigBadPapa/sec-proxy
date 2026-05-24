// ============ ENDPOINTS.JS - ВСЕ ЭНДПОИНТЫ SEC ==========

const express = require('express');
const path = require('path');
const router = express.Router();

const handler = require('./handler');
const api = require('./api');
const cache = require('./cache');

// ============ ЭНДПОИНТЫ ДЛЯ GAS ============
router.post('/api/edgar', handler.processEdgar);
router.post('/api/info', handler.processInfo);

// ============ ПРЯМЫЕ ЗАПРОСЫ (METRICS) ============
router.get('/metrics/:ticker', api.getMetric);
router.get('/catalog', api.getCatalog);
router.get('/validate/:metric', api.validateMetric);

// ============ ПРЯМЫЕ ЗАПРОСЫ (INFO) ============
router.get('/info/:ticker', api.getInfo);
router.get('/company-meta/:ticker', api.getCompanyMeta);
router.get('/submissions/:identifier', api.getSubmissions);
router.get('/companyfacts/:identifier', api.getCompanyFacts);
router.get('/companyconcept/:identifier/:taxonomy/:tag', api.getCompanyConcept);
router.get('/frames/:taxonomy/:tag/:unit/:period', api.getFrames);
router.get('/company-tickers', api.getCompanyTickers);
router.get('/company-tickers-mf', api.getCompanyTickersMF);
router.get('/company-tickers-exchange', api.getCompanyTickersExchange);

// ============ СПИСОК ТИКЕРОВ ДЛЯ GAS (с фильтрацией и логами) ==========
router.get('/api/tickers-list', (req, res) => {
  console.log('[tickers-list] Начало запроса');
  
  try {
    const fs = require('fs');
    const indexPath = path.join(__dirname, 'data', 'submissions.json');
    console.log('[tickers-list] Путь к файлу: ' + indexPath);
    
    // Проверяем, существует ли файл
    if (!fs.existsSync(indexPath)) {
      console.log('[tickers-list] Файл НЕ НАЙДЕН: ' + indexPath);
      return res.status(404).json({ error: 'Файл submissions.json не найден' });
    }
    console.log('[tickers-list] Файл найден');
    
    // Читаем файл
    const fileContent = fs.readFileSync(indexPath, 'utf8');
    console.log('[tickers-list] Размер файла: ' + fileContent.length + ' байт');
    
    // Парсим JSON
    const data = JSON.parse(fileContent);
    console.log('[tickers-list] Количество CIK в файле: ' + Object.keys(data).length);
    
    const tickersList = [];
    let processedCompanies = 0;
    let skippedCompanies = 0;
    
    for (const cik in data) {
      const company = data[cik];
      const tickersStr = company.tickers;
      const exchangesStr = company.exchanges;
      const stateDesc = company.stateOfIncorporationDescription || '';
      const ownerOrg = company.ownerOrg || '';
      const sicDesc = company.sicDescription || '';
      
      if (!tickersStr) {
        skippedCompanies++;
        continue;
      }
      
      const tickers = tickersStr.split(', ');
      const exchanges = exchangesStr ? exchangesStr.split(', ') : [];
      
      for (let i = 0; i < tickers.length; i++) {
        tickersList.push({
          ticker: tickers[i],
          exchange: exchanges[i] || (exchanges[0] || 'OTC'),
          stateOrCountry: stateDesc,
          ownerOrg: ownerOrg,
          sicDescription: sicDesc
        });
      }
      processedCompanies++;
    }
    
    console.log('[tickers-list] Обработано компаний: ' + processedCompanies);
    console.log('[tickers-list] Пропущено (нет тикеров): ' + skippedCompanies);
    console.log('[tickers-list] Всего строк в ответе: ' + tickersList.length);
    
    res.json(tickersList);
    
  } catch (err) {
    console.log('[tickers-list] ОШИБКА: ' + err.message);
    console.log('[tickers-list] Стек: ' + err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ============ СТАТИЧЕСКИЕ ФАЙЛЫ ==========
router.get('/data/submissions.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'submissions.json'));
});

// ============ ВСПОМОГАТЕЛЬНЫЕ ============
router.get('/version', (req, res) => {
  res.json({ version: '1.0.0', name: 'SEC Proxy' });
});
router.get('/cache-status', cache.getCacheStatus);
router.post('/clear-cache', cache.clearCache);
router.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

// ============ ЗАГЛУШКИ ДЛЯ БУДУЩИХ ЭНДПОИНТОВ ============
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
router.get('/document/:cik/:accessionNo/:document', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/document-index/:cik/:accessionNo', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/ix', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/search', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
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
router.get('/bulk/submissions', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/bulk/companyfacts', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/rss/company/:cik', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});
router.get('/rss/latest/:form', (req, res) => {
  res.status(501).json({ error: 'Not implemented yet', endpoint: req.path });
});

module.exports = router;
