// ============ EDGAR_COMMON.JS - ОБЩИЕ УТИЛИТЫ ДЛЯ ВСЕХ МОДУЛЕЙ ===========
// Содержит функции, используемые metrics, handler и будущими модулями

const fetch = require('node-fetch');
const catalogs = require('./catalogs');

// ============ 1. КОНСТАНТЫ ==========
const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// Единый конфиг кэшей для всех модулей
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

// ============ 3. БАЗОВЫЕ УТИЛИТЫ ==========

function log(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

function safeDateValue(dateStr) {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  return isNaN(t) ? 0 : t;
}

function sortByEndDesc(values) {
  return [...values].sort((a, b) => {
    const endA = safeDateValue(a.end);
    const endB = safeDateValue(b.end);
    return endB - endA;
  });
}

function sortByStartDesc(values) {
  return [...values].sort((a, b) => {
    const startA = safeDateValue(a.start);
    const startB = safeDateValue(b.start);
    return startB - startA;
  });
}

function filterReportsWithFiled(values, allowedForms = ['10-K', '10-Q', '20-F', '40-F', '6-K']) {
  return values.filter(v => allowedForms.includes(v.form) && v.filed);
}

function findAnnualReport(values, year, forms = ['10-K', '20-F', '40-F']) {
  for (const form of forms) {
    const report = values.find(v => v.fy === year && v.form === form);
    if (report) return report;
  }
  return null;
}

function findQuarterlyReport(values, year, fp, forms = ['10-Q', '6-K']) {
  for (const form of forms) {
    const report = values.find(v => v.form === form && v.fy === year && v.fp === fp);
    if (report) return report;
  }
  return null;
}

function parseQuarterStringCached(quarterStr) {
  if (!quarterStr || typeof quarterStr !== 'string') return null;
  
  if (CACHE_CONFIG.quarterParse.enabled) {
    const cached = quarterParseCache.get(quarterStr);
    if (cached) return cached;
  }
  
  const lower = quarterStr.toLowerCase().trim();
  let result = null;
  
  if (lower === 'q1') result = { type: 'quarter', num: 1 };
  else if (lower === 'q2') result = { type: 'quarter', num: 2 };
  else if (lower === 'q3') result = { type: 'quarter', num: 3 };
  else if (lower === 'q4') result = { type: 'quarter', num: 4 };
  else if (lower === '1q') result = { type: 'ytd', num: 1 };
  else if (lower === '2q') result = { type: 'ytd', num: 2 };
  else if (lower === '3q') result = { type: 'ytd', num: 3 };
  else if (lower === '4q') result = { type: 'ytd', num: 4 };
  
  if (result && CACHE_CONFIG.quarterParse.enabled && quarterParseCache.size < CACHE_CONFIG.quarterParse.maxSize) {
    quarterParseCache.set(quarterStr, result);
  }
  
  return result;
}

function applyScale(value, scale) {
  if (value === null || value === undefined) return null;
  if (!scale) return value;
  switch (scale) {
    case 'k': return value / 1000;
    case 'kk': return value / 1000000;
    case 'kkk': return value / 1000000000;
    default: return value;
  }
}

// ============ 4. ФУНКЦИИ ДЛЯ КЭШИРОВАНИЯ ==========

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

// ============ 5. НОРМАЛИЗАЦИЯ ==========

function normalizeTicker(ticker) {
  if (!ticker) return null;
  return String(ticker).toUpperCase().trim().replace(/\./g, '-');
}

function normalizeScale(scale) {
  if (!scale) return null;
  const str = String(scale).toLowerCase().trim();
  if (str === 'k' || str === 'т' || str === 'тысячи') return 'k';
  if (str === 'kk' || str === 'м' || str === 'миллионы') return 'kk';
  if (str === 'kkk' || str === 'млрд' || str === 'миллиарды') return 'kkk';
  return null;
}

function normalizeQuarter(value) {
  if (value === undefined || value === null) return undefined;
  const str = String(value).toLowerCase().trim();
  if (str === 'год' || str === 'годовой' || str === 'fy') return 'annual';
  if (str === 'q1') return 'q1';
  if (str === 'q2') return 'q2';
  if (str === 'q3') return 'q3';
  if (str === 'q4') return 'q4';
  if (str === '1q') return '1q';
  if (str === '2q') return '2q';
  if (str === '3q') return '3q';
  if (str === '4q') return '4q';
  return undefined;
}

// ============ 6. РЕЗОЛВИНГ АЛИАСОВ ==========

function resolveAlias(alias, context = 'metric') {
  if (!alias) return null;
  
  let normalized;
  if (context === 'metric') {
    normalized = alias.toString().trim().toLowerCase().replace(/[\s_-]/g, '');
  } else {
    normalized = alias.toString().trim().toLowerCase();
  }
  
  // Проверка прямого совпадения с каталогом (только для метрик)
  if (context === 'metric' && catalogs.METRICS_CATALOG[normalized]) {
    return normalized;
  }
  
  // Поиск в едином словаре синонимов
  if (catalogs.ALIASES[normalized]) {
    return catalogs.ALIASES[normalized];
  }
  
  return null;
}

// ============ 7. HTTP С РЕТРАЯМИ ==========

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      log(`fetchWithRetry: попытка ${i+1} для ${url.substring(0, 100)}...`);
      const response = await fetch(url, options);
      if (response.ok) {
        log(`fetchWithRetry: успех, status=${response.status}`);
        return response;
      }
      if (response.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        log(`fetchWithRetry: rate limit, пауза ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      log(`fetchWithRetry: ошибка попытки ${i+1}: ${error.message}`);
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ============ 8. ФУНКЦИИ ДЛЯ SEC API ==========

async function getCIK(ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  log(`getCIK: поиск CIK для тикера ${normalizedTicker}`);
  
  if (CACHE_CONFIG.cik.enabled) {
    const cached = getFromCache(cikCache, normalizedTicker, CACHE_CONFIG.cik.ttl);
    if (cached !== null) {
      log(`getCIK: кэш HIT для ${normalizedTicker} -> ${cached}`);
      return cached;
    }
  }
  
  if (tickersCache && isCacheValid({ time: tickersCacheTime }, CACHE_CONFIG.tickers.ttl)) {
    log(`getCIK: tickersCache HIT`);
  } else {
    log(`getCIK: tickersCache MISS, загружаем company_tickers.json`);
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    tickersCache = await response.json();
    tickersCacheTime = Date.now();
    log(`getCIK: tickersCache обновлён, записей: ${Object.keys(tickersCache).length}`);
  }
  
  const upperTicker = normalizedTicker.toUpperCase();
  const entry = Object.values(tickersCache).find(t => t.ticker === upperTicker);
  if (!entry) {
    log(`getCIK: тикер ${normalizedTicker} не найден`);
    return null;
  }
  
  const cik = entry.cik_str.toString().padStart(10, '0');
  log(`getCIK: найден CIK = ${cik}`);
  
  if (CACHE_CONFIG.cik.enabled && cik) {
    setToCache(cikCache, normalizedTicker, cik, CACHE_CONFIG.cik.ttl, CACHE_CONFIG.cik.maxSize);
  }
  
  return cik;
}

async function getCompanyFacts(cik) {
  log(`getCompanyFacts: загрузка companyfacts для CIK ${cik}`);
  
  if (CACHE_CONFIG.facts.enabled) {
    const cached = getFromCache(factsCache, cik, CACHE_CONFIG.facts.ttl);
    if (cached !== null) {
      log(`getCompanyFacts: кэш HIT для ${cik}`);
      return cached;
    }
    log(`getCompanyFacts: кэш EXPIRED или MISS для ${cik}`);
  }
  
  const url = `${DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
  const response = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) {
    log(`getCompanyFacts: ошибка загрузки, status=${response.status}`);
    return null;
  }
  
  const data = await response.json();
  
  if (CACHE_CONFIG.facts.enabled) {
    setToCache(factsCache, cik, data, CACHE_CONFIG.facts.ttl, CACHE_CONFIG.facts.maxSize);
  }
  
  log(`getCompanyFacts: загружено и закэшировано`);
  return data;
}

async function getSubmissionsData(cik) {
  log(`getSubmissionsData: загрузка submissions для CIK ${cik}`);
  
  if (CACHE_CONFIG.submissions.enabled) {
    const cached = getFromCache(submissionsCache, cik, CACHE_CONFIG.submissions.ttl);
    if (cached !== null) return cached;
  }
  
  const url = `${DATA_BASE}/submissions/CIK${cik}.json`;
  const response = await fetchWithRetry(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) return null;
  
  const data = await response.json();
  
  if (CACHE_CONFIG.submissions.enabled) {
    setToCache(submissionsCache, cik, data, CACHE_CONFIG.submissions.ttl, CACHE_CONFIG.submissions.maxSize);
  }
  
  return data;
}

// ============ 9. ХЕНДЛЕРЫ ДЛЯ УПРАВЛЕНИЯ КЭШЕМ ==========

async function getCacheStatus(req, res) {
  log('GET /cache-status');
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
  const key = req.query.key || 'all';
  log(`POST /clear-cache?key=${key}`);
  
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

// ============ 10. ЭКСПОРТ ==========

module.exports = {
  // Константы
  USER_AGENT,
  SEC_BASE,
  DATA_BASE,
  CACHE_CONFIG,
  
  // Кэш-переменные
  tickersCache,
  tickersCacheTime,
  cikCache,
  factsCache,
  metricsCache,
  submissionsCache,
  quarterParseCache,
  companyMetaCache,
  
  // Базовые утилиты
  log,
  safeDateValue,
  sortByEndDesc,
  sortByStartDesc,
  filterReportsWithFiled,
  findAnnualReport,
  findQuarterlyReport,
  parseQuarterStringCached,
  applyScale,
  
  // Нормализация
  normalizeTicker,
  normalizeScale,
  normalizeQuarter,
  
  // Резолвинг алиасов
  resolveAlias,
  
  // Кэш-утилиты
  isCacheValid,
  getFromCache,
  setToCache,
  
  // HTTP и SEC API
  fetchWithRetry,
  getCIK,
  getCompanyFacts,
  getSubmissionsData,
  
  // Хендлеры
  getCacheStatus,
  clearCache
};
