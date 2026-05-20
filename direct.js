// ============ DIRECT.JS - ОБРАБОТКА ПРЯМЫХ HTTP-ЗАПРОСОВ ==========

const common = require('./common');
const metrics = require('./metrics');
const catalogs = require('./catalogs');

// ============ GET /metrics/:ticker ==========
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

// ============ GET /catalog ==========
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

// ============ GET /validate/:metric ==========
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

module.exports = {
  getMetric,
  getCatalog,
  validateMetric
};
