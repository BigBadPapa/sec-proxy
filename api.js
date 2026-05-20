// ============ API.JS - ОБРАБОТКА ПРЯМЫХ HTTP-ЗАПРОСОВ ==========
// Содержит все хендлеры для прямых запросов (не через GAS)

const common = require('./common');
const cache = require('./cache');
const metrics = require('./metrics');
const catalogs = require('./catalogs');

// ============ 1. METRICS (ФИНАНСОВЫЕ МЕТРИКИ) ==========

// GET /metrics/:ticker
async function getMetric(req, res) {
  const tickerRaw = req.params.ticker;
  const year = req.query.year ? parseInt(req.query.year) : undefined;
  const quarterRaw = req.query.quarter !== undefined ? String(req.query.quarter) : undefined;
  const scale = common.normalizeScale(req.query.scale);
  
  const ticker = common.normalizeTicker(tickerRaw);
  const quarter = common.normalizeQuarter(quarterRaw);
  
  common.log(`GET /metrics/${ticker}?year=${year}&quarter=${quarter}&scale=${scale}`);
  
  try {
    let rawMetrics = req.query.metrics || req.query.metric;
    if (!rawMetrics) {
      return res.status(400).json({ 
        error: 'Укажите metric или metrics',
        hint: 'Используйте /catalog для списка метрик'
      });
    }
    
    const metricsList = rawMetrics.split('/').map(m => m.trim());
    const resolvedMetrics = [];
    const notFound = [];
    
    for (const m of metricsList) {
      const resolved = common.resolveAlias(m, 'metric');
      if (resolved) {
        resolvedMetrics.push(resolved);
      } else {
        notFound.push(m);
      }
    }
    
    if (resolvedMetrics.length === 0) {
      return res.status(404).json({
        error: 'Метрики не найдены',
        notFound: notFound,
        available: Object.keys(catalogs.METRICS_CATALOG).slice(0, 20).join(', ') + '...',
        totalAvailable: Object.keys(catalogs.METRICS_CATALOG).length
      });
    }
    
    const cik = await common.getCIK(ticker);
    if (!cik) {
      common.log(`getCIK вернул null для тикера ${ticker}`);
      return res.status(404).json({ error: 'Тикер не найден' });
    }
    
    const factsData = await common.getCompanyFacts(cik);
    if (!factsData) {
      common.log(`getCompanyFacts вернул null для CIK ${cik}`);
      return res.status(500).json({ error: 'Ошибка получения данных' });
    }
    
    const results = {};
    for (const metric of resolvedMetrics) {
      const value = metrics.getMetricValue(factsData, metric, year, quarter, scale, ticker);
      results[metric] = value !== null ? value : null;
    }
    
    res.json({
      ticker: ticker,
      year: year || null,
      quarter: quarter || null,
      scale: scale,
      metrics: results,
      notFound: notFound.length > 0 ? notFound : undefined
    });
  } catch (error) {
    common.log(`GET /metrics error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /catalog
async function getCatalog(req, res) {
  common.log('GET /catalog');
  try {
    const list = [];
    for (const [key, val] of Object.entries(catalogs.METRICS_CATALOG)) {
      list.push({
        alias: key,
        ru: val.ru,
        category: val.category,
        ttm: val.ttm,
        tags: val.tags
      });
    }
    res.json({ metrics: list, count: list.length });
  } catch (error) {
    common.log(`GET /catalog error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /validate/:metric
async function validateMetric(req, res) {
  common.log(`GET /validate/${req.params.metric}`);
  try {
    const resolved = common.resolveAlias(req.params.metric, 'metric');
    if (!resolved) {
      const available = Object.keys(catalogs.METRICS_CATALOG).slice(0, 20).join(', ');
      return res.status(404).json({ 
        error: 'Метрика не найдена',
        available: available,
        count: Object.keys(catalogs.METRICS_CATALOG).length
      });
    }
    res.json({ 
      valid: true, 
      metric: resolved,
      info: catalogs.METRICS_CATALOG[resolved]
    });
  } catch (error) {
    common.log(`GET /validate error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// ============ 2. INFO (СТАТИЧЕСКАЯ ИНФОРМАЦИЯ) ==========

// GET /info/:ticker
async function getInfo(req, res) {
  const tickerRaw = req.params.ticker;
  const fieldRaw = req.query.field;
  const fieldsRaw = req.query.fields;
  
  const ticker = common.normalizeTicker(tickerRaw);
  
  common.log(`GET /info/${ticker}${fieldRaw ? `?field=${fieldRaw}` : ''}${fieldsRaw ? `?fields=${fieldsRaw}` : ''}`);
  
  try {
    const cik = await common.getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    const subData = await common.getSubmissionsData(cik);
    if (!subData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    // BATCH РЕЖИМ: несколько полей
    if (fieldsRaw) {
      const fieldsList = fieldsRaw.split(',').map(f => f.trim());
      const result = {};
      
      for (const f of fieldsList) {
        const resolvedField = common.resolveAlias(f, 'info');
        const keys = resolvedField.split('.');
        let value = subData;
        for (const key of keys) {
          if (value === null || value === undefined) break;
          value = value[key];
        }
        result[f] = (value !== null && value !== undefined) ? value : null;
      }
      
      return res.json(result);
    }
    
    // ОДНО ПОЛЕ
    if (fieldRaw) {
      const resolvedField = common.resolveAlias(fieldRaw, 'info');
      const keys = resolvedField.split('.');
      let value = subData;
      
      for (const key of keys) {
        if (value === null || value === undefined) {
          return res.json({ field: resolvedField, value: null });
        }
        value = value[key];
      }
      
      return res.json({ field: resolvedField, value: (value !== null && value !== undefined) ? value : null });
    }
    
    // ВСЕ ПОЛЯ
    res.json({
      cik: subData.cik,
      name: subData.entityName,
      ein: subData.ein || null,
      entityType: subData.entityType || null,
      description: subData.description || null,
      tickers: subData.tickers || [],
      exchanges: subData.exchanges || [],
      sic: subData.sic || null,
      sicDescription: subData.sicDescription || null,
      category: subData.category || null,
      stateOfIncorporation: subData.stateOfIncorporation || null,
      fiscalYearEnd: subData.fiscalYearEnd || null,
      phone: subData.phone || null,
      website: subData.website || null,
      businessAddress: subData.addresses?.business || null,
      mailingAddress: subData.addresses?.mailing || null,
      formerNames: subData.formerNames || [],
      flags: subData.flags || null
    });
    
  } catch (error) {
    common.log(`GET /info error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /submissions/:identifier
async function getSubmissions(req, res) {
  const identifier = req.params.identifier;
  common.log(`GET /submissions/${identifier}`);
  
  try {
    let cik;
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await common.getCIK(common.normalizeTicker(identifier));
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const data = await common.getSubmissionsData(cik);
    if (!data) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    res.json(data);
  } catch (error) {
    common.log(`GET /submissions error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /companyfacts/:identifier
async function getCompanyFacts(req, res) {
  const identifier = req.params.identifier;
  common.log(`GET /companyfacts/${identifier}`);
  
  try {
    let cik;
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await common.getCIK(common.normalizeTicker(identifier));
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const data = await common.getCompanyFacts(cik);
    if (!data) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    res.json(data);
  } catch (error) {
    common.log(`GET /companyfacts error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /company-meta/:ticker
async function getCompanyMeta(req, res) {
  const tickerRaw = req.params.ticker;
  const ticker = common.normalizeTicker(tickerRaw);
  common.log(`GET /company-meta/${ticker}`);
  
  try {
    const cik = await common.getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    if (cache.CACHE_CONFIG.companyMeta.enabled) {
      const cached = cache.getFromCache(cache.companyMetaCache, cik, cache.CACHE_CONFIG.companyMeta.ttl);
      if (cached) return res.json(cached);
    }
    
    const subData = await common.getSubmissionsData(cik);
    if (!subData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    const meta = {
      fiscalYearEnd: subData.fiscalYearEnd || null,
      name: subData.entityName || null,
      category: subData.category || null,
      stateOfIncorporation: subData.stateOfIncorporation || null,
      ticker: ticker,
      sic: subData.sic || null,
      sicDescription: subData.sicDescription || null
    };
    
    if (cache.CACHE_CONFIG.companyMeta.enabled) {
      cache.setToCache(cache.companyMetaCache, cik, meta, cache.CACHE_CONFIG.companyMeta.ttl, cache.CACHE_CONFIG.companyMeta.maxSize);
    }
    
    res.json(meta);
  } catch (error) {
    common.log(`GET /company-meta error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /company-tickers
async function getCompanyTickers(req, res) {
  common.log('GET /company-tickers');
  try {
    const response = await common.fetchWithRetry(`${common.SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': common.USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /company-tickers error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /company-tickers-mf
async function getCompanyTickersMF(req, res) {
  common.log('GET /company-tickers-mf');
  try {
    const response = await common.fetchWithRetry(`${common.SEC_BASE}/files/company_tickers_mf.json`, {
      headers: { 'User-Agent': common.USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /company-tickers-mf error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /company-tickers-exchange
async function getCompanyTickersExchange(req, res) {
  common.log('GET /company-tickers-exchange');
  try {
    const response = await common.fetchWithRetry(`${common.SEC_BASE}/files/company_tickers_exchange.json`, {
      headers: { 'User-Agent': common.USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /company-tickers-exchange error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /companyconcept/:identifier/:taxonomy/:tag
async function getCompanyConcept(req, res) {
  const identifier = req.params.identifier;
  const taxonomy = req.params.taxonomy;
  const tag = req.params.tag;
  common.log(`GET /companyconcept/${identifier}/${taxonomy}/${tag}`);
  
  try {
    let cik;
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await common.getCIK(common.normalizeTicker(identifier));
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const url = `${common.DATA_BASE}/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`;
    const response = await common.fetchWithRetry(url, { headers: { 'User-Agent': common.USER_AGENT } });
    if (!response.ok) return res.status(response.status).json({ error: 'Данные не найдены' });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /companyconcept error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// GET /frames/:taxonomy/:tag/:unit/:period
async function getFrames(req, res) {
  const taxonomy = req.params.taxonomy;
  const tag = req.params.tag;
  const unit = req.params.unit;
  const period = req.params.period;
  common.log(`GET /frames/${taxonomy}/${tag}/${unit}/${period}`);
  
  try {
    const url = `${common.DATA_BASE}/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`;
    const response = await common.fetchWithRetry(url, { headers: { 'User-Agent': common.USER_AGENT } });
    if (!response.ok) return res.status(response.status).json({ error: 'Данные не найдены' });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /frames error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// ============ 3. ЭКСПОРТ ==========

module.exports = {
  // Metrics
  getMetric,
  getCatalog,
  validateMetric,
  // Info
  getInfo,
  getSubmissions,
  getCompanyFacts,
  getCompanyMeta,
  getCompanyTickers,
  getCompanyTickersMF,
  getCompanyTickersExchange,
  getCompanyConcept,
  getFrames
};
