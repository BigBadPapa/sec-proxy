// ============ CACHE.JS - УПРАВЛЕНИЕ КЭШИРОВАНИЕМ ==========

// ============ 1. КОНФИГ КЭШЕЙ ==========
const CACHE_CONFIG = {
  tickers: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 1 },
  cik: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 500 },
  facts: { enabled: true, ttl: 6 * 60 * 60 * 1000, maxSize: 20 },
  submissions: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 20 },
  metrics: { enabled: true, ttl: 5 * 60 * 1000, maxSize: 1000 },
  quarterParse: { enabled: true, ttl: Infinity, maxSize: 50 },
  companyMeta: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 500 }
};

// ============ 2. ПЕРЕМЕННЫЕ КЭШЕЙ ==========
let tickersCache = null;
let tickersCacheTime = 0;

const cikCache = new Map();
const factsCache = new Map();
const metricsCache = new Map();
const submissionsCache = new Map();
const quarterParseCache = new Map();
const companyMetaCache = new Map();

// ============ 3. ФУНКЦИИ ДЛЯ РАБОТЫ С КЭШЕМ ==========

function isCacheValid(cached, ttl) {
  return cached && (Date.now() - cached.time < ttl);
}

function getFromCache(map, key, ttl) {
  if (!map.has(key)) return null;
  const cached = map.get(key);
  if (isCacheValid(cached, ttl)) return cached.data;
  map.delete(key);
  return null;
}

function setToCache(map, key, data, ttl, maxSize) {
  if (map.size >= maxSize) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  map.set(key, { data, time: Date.now() });
}

// ============ 4. ХЕНДЛЕРЫ ДЛЯ УПРАВЛЕНИЯ КЭШЕМ ==========

async function getCacheStatus(req, res) {
  const common = require('./common');
  common.log('GET /cache-status');
  res.json({
    tickersCache: tickersCache ? `активен, записей: ${Object.keys(tickersCache).length}` : 'пуст',
    cikCache: { size: cikCache.size, maxSize: CACHE_CONFIG.cik.maxSize },
    submissionsCache: { size: submissionsCache.size, maxSize: CACHE_CONFIG.submissions.maxSize },
    factsCache: { size: factsCache.size, maxSize: CACHE_CONFIG.facts.maxSize },
    metricsCache: { size: metricsCache.size, maxSize: CACHE_CONFIG.metrics.maxSize },
    companyMetaCache: { size: companyMetaCache.size, maxSize: CACHE_CONFIG.companyMeta.maxSize },
    quarterParseCache: { size: quarterParseCache.size, maxSize: CACHE_CONFIG.quarterParse.maxSize }
  });
}

async function clearCache(req, res) {
  const common = require('./common');
  const key = req.query.key || 'all';
  common.log(`POST /clear-cache?key=${key}`);
  
  if (key === 'all' || key === 'cik') cikCache.clear();
  if (key === 'all' || key === 'submissions') submissionsCache.clear();
  if (key === 'all' || key === 'facts') factsCache.clear();
  if (key === 'all' || key === 'metrics') metricsCache.clear();
  if (key === 'all' || key === 'meta') companyMetaCache.clear();
  if (key === 'all' || key === 'quarterParse') quarterParseCache.clear();
  if (key === 'all' || key === 'tickers') {
    tickersCache = null;
    tickersCacheTime = 0;
  }
  
  res.json({ message: `Кэш ${key} очищен` });
}

// ============ 5. ЭКСПОРТ ==========

module.exports = {
  CACHE_CONFIG,
  tickersCache,
  tickersCacheTime,
  cikCache,
  factsCache,
  metricsCache,
  submissionsCache,
  quarterParseCache,
  companyMetaCache,
  isCacheValid,
  getFromCache,
  setToCache,
  getCacheStatus,
  clearCache
};
