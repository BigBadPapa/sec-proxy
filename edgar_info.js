// ============ EDGAR_INFO.JS - ЛОГИКА ДЛЯ /INFO И СВЯЗАННЫХ ЭНДПОИНТОВ ==========
// Этот файл содержит ТОЛЬКО логику, без эндпоинтов
// Эндпоинты вынесены в endpoints.js

const fetch = require('node-fetch');

// ============ 1. КОНСТАНТЫ ==========

const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// ============ 2. НАСТРОЙКИ КЭШЕЙ ==========
const CACHE_CONFIG = {
  // Кэш для тикеров (company_tickers.json)
  tickersCache: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 1 },
  // Кэш для CIK по тикеру
  cikCache: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 500 },
  // Кэш для companyfacts
  factsCache: { enabled: true, ttl: 6 * 60 * 60 * 1000, maxSize: 20 },
  // Кэш для submissions
  submissionsCache: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 20 },
  // Кэш для метаданных компании
  companyMetaCache: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 500 }
};

// ============ 3. ПЕРЕМЕННЫЕ КЭШЕЙ ==========
let tickersCache = null;
let tickersCacheTime = 0;

const cikCache = new Map();
const factsCache = new Map();
const submissionsCache = new Map();
const companyMetaCache = new Map();

// ============ 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

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

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ============ 5. ФУНКЦИИ ДЛЯ SEC API ==========

async function getCIK(ticker) {
  log(`getCIK: поиск CIK для тикера ${ticker}`);
  
  if (CACHE_CONFIG.cikCache.enabled) {
    const cached = getFromCache(cikCache, ticker, CACHE_CONFIG.cikCache.ttl);
    if (cached !== null) {
      log(`getCIK: кэш HIT для ${ticker} -> ${cached}`);
      return cached;
    }
  }
  
  if (tickersCache && isCacheValid({ time: tickersCacheTime }, CACHE_CONFIG.tickersCache.ttl)) {
    log(`getCIK: tickersCache HIT`);
  } else {
    log(`getCIK: tickersCache MISS, загружаем company_tickers.json`);
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    tickersCache = await response.json();
    tickersCacheTime = Date.now();
  }
  
  const upperTicker = ticker.toUpperCase();
  const entry = Object.values(tickersCache).find(t => t.ticker === upperTicker);
  if (!entry) return null;
  
  const cik = entry.cik_str.toString().padStart(10, '0');
  
  if (CACHE_CONFIG.cikCache.enabled && cik) {
    setToCache(cikCache, ticker, cik, CACHE_CONFIG.cikCache.ttl, CACHE_CONFIG.cikCache.maxSize);
  }
  
  return cik;
}

async function getSubmissionsData(cik) {
  log(`getSubmissionsData: загрузка submissions для CIK ${cik}`);
  
  if (CACHE_CONFIG.submissionsCache.enabled) {
    const cached = getFromCache(submissionsCache, cik, CACHE_CONFIG.submissionsCache.ttl);
    if (cached !== null) return cached;
  }
  
  const url = `${DATA_BASE}/submissions/CIK${cik}.json`;
  const response = await fetchWithRetry(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) return null;
  
  const data = await response.json();
  
  if (CACHE_CONFIG.submissionsCache.enabled) {
    setToCache(submissionsCache, cik, data, CACHE_CONFIG.submissionsCache.ttl, CACHE_CONFIG.submissionsCache.maxSize);
  }
  
  return data;
}

async function getCompanyFactsData(cik) {
  log(`getCompanyFactsData: загрузка companyfacts для CIK ${cik}`);
  
  if (CACHE_CONFIG.factsCache.enabled) {
    const cached = getFromCache(factsCache, cik, CACHE_CONFIG.factsCache.ttl);
    if (cached !== null) return cached;
  }
  
  const url = `${DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
  const response = await fetchWithRetry(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) return null;
  
  const data = await response.json();
  
  if (CACHE_CONFIG.factsCache.enabled) {
    setToCache(factsCache, cik, data, CACHE_CONFIG.factsCache.ttl, CACHE_CONFIG.factsCache.maxSize);
  }
  
  return data;
}

// ============ 6. ОСНОВНЫЕ ФУНКЦИИ (ХЭНДЛЕРЫ ДЛЯ ЭНДПОИНТОВ) ==========

async function getInfo(req, res) {
  const ticker = req.params.ticker.toUpperCase();
  log(`GET /info/${ticker}`);
  
  try {
    const cik = await getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    const subData = await getSubmissionsData(cik);
    if (!subData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
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
      investorWebsite: subData.investorWebsite || null,
      businessAddress: subData.addresses?.business || null,
      mailingAddress: subData.addresses?.mailing || null,
      formerNames: subData.formerNames || [],
      flags: subData.flags || null
    });
  } catch (error) {
    log(`GET /info error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getSubmissions(req, res) {
  const identifier = req.params.identifier;
  log(`GET /submissions/${identifier}`);
  
  try {
    let cik;
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await getCIK(identifier.toUpperCase());
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const data = await getSubmissionsData(cik);
    if (!data) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    res.json(data);
  } catch (error) {
    log(`GET /submissions error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyFacts(req, res) {
  const identifier = req.params.identifier;
  log(`GET /companyfacts/${identifier}`);
  
  try {
    let cik;
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await getCIK(identifier.toUpperCase());
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const data = await getCompanyFactsData(cik);
    if (!data) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    res.json(data);
  } catch (error) {
    log(`GET /companyfacts error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyMeta(req, res) {
  const ticker = req.params.ticker.toUpperCase();
  log(`GET /company-meta/${ticker}`);
  
  try {
    const cik = await getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    if (CACHE_CONFIG.companyMetaCache.enabled) {
      const cached = getFromCache(companyMetaCache, cik, CACHE_CONFIG.companyMetaCache.ttl);
      if (cached) return res.json(cached);
    }
    
    const subData = await getSubmissionsData(cik);
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
    
    if (CACHE_CONFIG.companyMetaCache.enabled) {
      setToCache(companyMetaCache, cik, meta, CACHE_CONFIG.companyMetaCache.ttl, CACHE_CONFIG.companyMetaCache.maxSize);
    }
    
    res.json(meta);
  } catch (error) {
    log(`GET /company-meta error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyTickers(req, res) {
  log('GET /company-tickers');
  try {
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    log(`GET /company-tickers error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyTickersMF(req, res) {
  log('GET /company-tickers-mf');
  try {
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers_mf.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    log(`GET /company-tickers-mf error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyTickersExchange(req, res) {
  log('GET /company-tickers-exchange');
  try {
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers_exchange.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    log(`GET /company-tickers-exchange error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyConcept(req, res) {
  const identifier = req.params.identifier;
  const taxonomy = req.params.taxonomy;
  const tag = req.params.tag;
  log(`GET /companyconcept/${identifier}/${taxonomy}/${tag}`);
  
  try {
    let cik;
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await getCIK(identifier.toUpperCase());
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const url = `${DATA_BASE}/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`;
    const response = await fetchWithRetry(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return res.status(response.status).json({ error: 'Данные не найдены' });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    log(`GET /companyconcept error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getFrames(req, res) {
  const taxonomy = req.params.taxonomy;
  const tag = req.params.tag;
  const unit = req.params.unit;
  const period = req.params.period;
  log(`GET /frames/${taxonomy}/${tag}/${unit}/${period}`);
  
  try {
    const url = `${DATA_BASE}/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`;
    const response = await fetchWithRetry(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) return res.status(response.status).json({ error: 'Данные не найдены' });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    log(`GET /frames error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCacheStatus(req, res) {
  log('GET /cache-status');
  res.json({
    tickersCache: tickersCache ? `активен, записей: ${Object.keys(tickersCache).length}` : 'пуст',
    cikCache: { size: cikCache.size, maxSize: CACHE_CONFIG.cikCache.maxSize },
    submissionsCache: { size: submissionsCache.size, maxSize: CACHE_CONFIG.submissionsCache.maxSize },
    factsCache: { size: factsCache.size, maxSize: CACHE_CONFIG.factsCache.maxSize },
    companyMetaCache: { size: companyMetaCache.size, maxSize: CACHE_CONFIG.companyMetaCache.maxSize }
  });
}

async function clearCache(req, res) {
  const key = req.query.key || 'all';
  log(`POST /clear-cache?key=${key}`);
  
  if (key === 'all' || key === 'cik') cikCache.clear();
  if (key === 'all' || key === 'submissions') submissionsCache.clear();
  if (key === 'all' || key === 'facts') factsCache.clear();
  if (key === 'all' || key === 'meta') companyMetaCache.clear();
  if (key === 'all' || key === 'tickers') {
    tickersCache = null;
    tickersCacheTime = 0;
  }
  
  res.json({ message: `Кэш ${key} очищен` });
}

// ============ 7. ЭКСПОРТ ФУНКЦИЙ ==========

module.exports = {
  getInfo,
  getSubmissions,
  getCompanyFacts,
  getCompanyMeta,
  getCompanyTickers,
  getCompanyTickersMF,
  getCompanyTickersExchange,
  getCompanyConcept,
  getFrames,
  getCacheStatus,
  clearCache
};
