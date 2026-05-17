// ============ EDGAR_INFO.JS - ЛОГИКА ДЛЯ /INFO ЭНДПОИНТОВ ==========
// Этот файл содержит ТОЛЬКО логику (функции), без эндпоинтов
// Эндпоинты вынесены в endpoints.js

// ============ 1. ИМПОРТЫ И КОНФИГУРАЦИЯ ==========
const fetch = require('node-fetch');

const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// ============ 2. КЭШИ (С КОММЕНТАРИЯМИ) ==========

// 2.1. Кэш для тикеров (company_tickers.json)
// TTL: 24 часа, размер: 1 запись (хранит только последний загруженный файл)
// Назначение: маппинг тикер → CIK для всех компаний
let tickersCache = null;
let tickersCacheTime = 0;
const TICKERS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа

// 2.2. Кэш для CIK по тикеру
// TTL: 24 часа, размер: 500 записей
// Назначение: быстрый поиск CIK по тикеру без повторной загрузки company_tickers.json
const cikCache = new Map();
const CIK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа
const CIK_CACHE_MAX_SIZE = 500;

// 2.3. Кэш для submissions (метаданные компании)
// TTL: 24 часа, размер: 20 записей
// Назначение: хранение полных метаданных компании (адрес, название, отчёты)
const submissionsCache = new Map();
const SUBMISSIONS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа
const SUBMISSIONS_CACHE_MAX_SIZE = 20;

// 2.4. Кэш для companyfacts (финансовые данные XBRL)
// TTL: 6 часов, размер: 20 записей
// Назначение: хранение всех XBRL фактов компании (для метрик)
const factsCache = new Map();
const FACTS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 часов
const FACTS_CACHE_MAX_SIZE = 20;

// 2.5. Кэш для метаданных компании (краткая версия)
// TTL: 24 часа, размер: 500 записей
// Назначение: быстрый доступ к fiscalYearEnd, name, category и т.д.
const companyMetaCache = new Map();
const META_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа
const META_CACHE_MAX_SIZE = 500;

// ============ 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

// 3.1. Логирование с timestamp
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

// 3.2. Безопасное преобразование даты (возвращает 0 при ошибке)
function safeDateValue(dateStr) {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  return isNaN(t) ? 0 : t;
}

// 3.3. Проверка валидности кэша
function isCacheValid(cached, ttl) {
  return cached && (Date.now() - cached.time < ttl);
}

// 3.4. Получение данных из кэша
function getFromCache(map, key, ttl) {
  if (!map.has(key)) return null;
  const cached = map.get(key);
  if (isCacheValid(cached, ttl)) return cached.data;
  map.delete(key);
  return null;
}

// 3.5. Сохранение данных в кэш (с удалением старых записей при превышении размера)
function setToCache(map, key, data, ttl, maxSize) {
  // Если кэш переполнен, удаляем самую старую запись
  if (map.size >= maxSize) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
    log(`Кэш ${map.name || 'map'} переполнен, удалена запись ${oldest}`);
  }
  map.set(key, { data, time: Date.now() });
}

// 3.6. Fetch с retry при rate limit (429)
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      log(`fetchWithRetry: попытка ${i+1} для ${url.substring(0, 100)}...`);
      const response = await fetch(url, options);
      if (response.ok) {
        log(`fetchWithRetry: успех, status=${response.status}`);
        return response;
      }
      // Rate limit — ждём и повторяем
      if (response.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        log(`Rate limit, waiting ${delay}ms...`);
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

// ============ 4. ОСНОВНЫЕ ФУНКЦИИ ДЛЯ РАБОТЫ С SEC API ==========

// 4.1. Получение CIK по тикеру (с кэшированием)
async function getCIK(ticker) {
  log(`getCIK: поиск CIK для тикера ${ticker}`);
  
  // Проверяем кэш CIK
  const cachedCik = getFromCache(cikCache, ticker, CIK_CACHE_TTL);
  if (cachedCik !== null) {
    log(`getCIK: кэш HIT для ${ticker} -> ${cachedCik}`);
    return cachedCik;
  }
  
  // Загружаем company_tickers.json (кэшируется отдельно)
  let tickersData = null;
  if (tickersCache && isCacheValid({ time: tickersCacheTime }, TICKERS_CACHE_TTL)) {
    log(`getCIK: tickersCache HIT`);
    tickersData = tickersCache;
  } else {
    log(`getCIK: tickersCache MISS, загружаем company_tickers.json`);
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    tickersData = await response.json();
    tickersCache = tickersData;
    tickersCacheTime = Date.now();
    log(`getCIK: tickersCache обновлён, записей: ${Object.keys(tickersData).length}`);
  }
  
  // Ищем тикер
  const upperTicker = ticker.toUpperCase();
  const entry = Object.values(tickersData).find(t => t.ticker === upperTicker);
  
  if (!entry) {
    log(`getCIK: тикер ${ticker} не найден`);
    return null;
  }
  
  const cik = entry.cik_str.toString().padStart(10, '0');
  log(`getCIK: найден CIK = ${cik}`);
  
  // Сохраняем в кэш CIK
  setToCache(cikCache, ticker, cik, CIK_CACHE_TTL, CIK_CACHE_MAX_SIZE);
  
  return cik;
}

// 4.2. Получение submissions (метаданные компании) с кэшированием
async function getSubmissions(cik) {
  log(`getSubmissions: загрузка submissions для CIK ${cik}`);
  
  // Проверяем кэш
  const cached = getFromCache(submissionsCache, cik, SUBMISSIONS_CACHE_TTL);
  if (cached !== null) {
    log(`getSubmissions: кэш HIT для ${cik}`);
    return cached;
  }
  
  // Загружаем из SEC
  const url = `${DATA_BASE}/submissions/CIK${cik}.json`;
  const response = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT }
  });
  
  if (!response.ok) {
    log(`getSubmissions: ошибка загрузки, status=${response.status}`);
    return null;
  }
  
  const data = await response.json();
  
  // Сохраняем в кэш
  setToCache(submissionsCache, cik, data, SUBMISSIONS_CACHE_TTL, SUBMISSIONS_CACHE_MAX_SIZE);
  log(`getSubmissions: загружено и закэшировано`);
  
  return data;
}

// 4.3. Получение companyfacts (XBRL данные) с кэшированием
async function getCompanyFacts(cik) {
  log(`getCompanyFacts: загрузка companyfacts для CIK ${cik}`);
  
  // Проверяем кэш
  const cached = getFromCache(factsCache, cik, FACTS_CACHE_TTL);
  if (cached !== null) {
    log(`getCompanyFacts: кэш HIT для ${cik}`);
    return cached;
  }
  
  // Загружаем из SEC
  const url = `${DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
  const response = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT }
  });
  
  if (!response.ok) {
    log(`getCompanyFacts: ошибка загрузки, status=${response.status}`);
    return null;
  }
  
  const data = await response.json();
  
  // Сохраняем в кэш
  setToCache(factsCache, cik, data, FACTS_CACHE_TTL, FACTS_CACHE_MAX_SIZE);
  log(`getCompanyFacts: загружено и закэшировано`);
  
  return data;
}

// 4.4. Получение метаданных компании (краткая версия) с кэшированием
async function getCompanyMeta(cik, ticker) {
  log(`getCompanyMeta: получение метаданных для CIK ${cik}`);
  
  // Проверяем кэш
  const cached = getFromCache(companyMetaCache, cik, META_CACHE_TTL);
  if (cached !== null) {
    log(`getCompanyMeta: кэш HIT для ${cik}`);
    return cached;
  }
  
  // Загружаем submissions (используем существующую функцию)
  const subData = await getSubmissions(cik);
  if (!subData) return null;
  
  // Извлекаем только нужные поля
  const meta = {
    fiscalYearEnd: subData.fiscalYearEnd || null,
    name: subData.entityName || null,
    category: subData.category || null,
    stateOfIncorporation: subData.stateOfIncorporation || null,
    ticker: ticker,
    sic: subData.sic || null,
    sicDescription: subData.sicDescription || null
  };
  
  // Сохраняем в кэш
  setToCache(companyMetaCache, cik, meta, META_CACHE_TTL, META_CACHE_MAX_SIZE);
  log(`getCompanyMeta: закэшировано для ${cik}`);
  
  return meta;
}

// ============ 5. ОСНОВНЫЕ ФУНКЦИИ (ХЭНДЛЕРЫ ДЛЯ ЭНДПОИНТОВ) ==========

// 5.1. GET /info/:ticker — статическая информация о компании
async function getInfo(req, res) {
  const ticker = req.params.ticker.toUpperCase();
  log(`GET /info/${ticker}`);
  
  try {
    const cik = await getCIK(ticker);
    if (!cik) {
      return res.status(404).json({ error: 'Тикер не найден' });
    }
    
    const subData = await getSubmissions(cik);
    if (!subData) {
      return res.status(500).json({ error: 'Ошибка получения данных' });
    }
    
    // Формируем ответ — все доступные статические данные
    const response = {
      // Идентификация
      cik: subData.cik,
      name: subData.entityName,
      ein: subData.ein || null,
      entityType: subData.entityType || null,
      
      // Описание
      description: subData.description || null,
      
      // Рыночная информация
      tickers: subData.tickers || [],
      exchanges: subData.exchanges || [],
      sic: subData.sic || null,
      sicDescription: subData.sicDescription || null,
      category: subData.category || null,
      
      // Юридическая информация
      stateOfIncorporation: subData.stateOfIncorporation || null,
      fiscalYearEnd: subData.fiscalYearEnd || null,
      phone: subData.phone || null,
      
      // Веб-сайты
      website: subData.website || null,
      investorWebsite: subData.investorWebsite || null,
      
      // Адреса
      businessAddress: subData.addresses?.business || null,
      mailingAddress: subData.addresses?.mailing || null,
      
      // Бывшие названия
      formerNames: subData.formerNames || [],
      
      // Флаги
      flags: subData.flags || null
    };
    
    res.json(response);
    
  } catch (error) {
    log(`GET /info error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// 5.2. GET /submissions/:identifier — полные submissions (по тикеру или CIK)
async function getSubmissionsHandler(req, res) {
  const identifier = req.params.identifier;
  log(`GET /submissions/${identifier}`);
  
  try {
    let cik = null;
    
    // Если identifier — это CIK (10 цифр)
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      // Иначе считаем, что это тикер
      cik = await getCIK(identifier.toUpperCase());
    }
    
    if (!cik) {
      return res.status(404).json({ error: 'Тикер или CIK не найден' });
    }
    
    const subData = await getSubmissions(cik);
    if (!subData) {
      return res.status(500).json({ error: 'Ошибка получения данных' });
    }
    
    res.json(subData);
    
  } catch (error) {
    log(`GET /submissions error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// 5.3. GET /companyfacts/:identifier — полные companyfacts (по тикеру или CIK)
async function getCompanyFactsHandler(req, res) {
  const identifier = req.params.identifier;
  log(`GET /companyfacts/${identifier}`);
  
  try {
    let cik = null;
    
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await getCIK(identifier.toUpperCase());
    }
    
    if (!cik) {
      return res.status(404).json({ error: 'Тикер или CIK не найден' });
    }
    
    const factsData = await getCompanyFacts(cik);
    if (!factsData) {
      return res.status(500).json({ error: 'Ошибка получения данных' });
    }
    
    res.json(factsData);
    
  } catch (error) {
    log(`GET /companyfacts error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// 5.4. GET /company-meta/:ticker — краткие метаданные компании
async function getCompanyMetaHandler(req, res) {
  const ticker = req.params.ticker.toUpperCase();
  log(`GET /company-meta/${ticker}`);
  
  try {
    const cik = await getCIK(ticker);
    if (!cik) {
      return res.status(404).json({ error: 'Тикер не найден' });
    }
    
    const meta = await getCompanyMeta(cik, ticker);
    if (!meta) {
      return res.status(500).json({ error: 'Ошибка получения данных' });
    }
    
    res.json(meta);
    
  } catch (error) {
    log(`GET /company-meta error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// 5.5. GET /company-tickers — все тикеры и CIK
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

// 5.6. GET /company-tickers-mf — тикеры для фондов и ETF
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

// 5.7. GET /company-tickers-exchange — расширенный маппинг с биржами
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

// 5.8. GET /companyconcept/:identifier/:taxonomy/:tag — конкретный показатель
async function getCompanyConcept(req, res) {
  const identifier = req.params.identifier;
  const taxonomy = req.params.taxonomy;
  const tag = req.params.tag;
  log(`GET /companyconcept/${identifier}/${taxonomy}/${tag}`);
  
  try {
    let cik = null;
    
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await getCIK(identifier.toUpperCase());
    }
    
    if (!cik) {
      return res.status(404).json({ error: 'Тикер или CIK не найден' });
    }
    
    const url = `${DATA_BASE}/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`;
    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Данные не найдены' });
    }
    
    const data = await response.json();
    res.json(data);
    
  } catch (error) {
    log(`GET /companyconcept error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// 5.9. GET /frames/:taxonomy/:tag/:unit/:period — агрегированные данные
async function getFrames(req, res) {
  const taxonomy = req.params.taxonomy;
  const tag = req.params.tag;
  const unit = req.params.unit;
  const period = req.params.period;
  log(`GET /frames/${taxonomy}/${tag}/${unit}/${period}`);
  
  try {
    const url = `${DATA_BASE}/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`;
    const response = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Данные не найдены' });
    }
    
    const data = await response.json();
    res.json(data);
    
  } catch (error) {
    log(`GET /frames error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// 5.10. GET /cache-status — статус кэшей (для отладки)
async function getCacheStatus(req, res) {
  log('GET /cache-status');
  
  res.json({
    tickersCache: tickersCache ? `активен, записей: ${Object.keys(tickersCache).length}` : 'пуст',
    cikCache: { size: cikCache.size, maxSize: CIK_CACHE_MAX_SIZE },
    submissionsCache: { size: submissionsCache.size, maxSize: SUBMISSIONS_CACHE_MAX_SIZE },
    factsCache: { size: factsCache.size, maxSize: FACTS_CACHE_MAX_SIZE },
    companyMetaCache: { size: companyMetaCache.size, maxSize: META_CACHE_MAX_SIZE }
  });
}

// 5.11. POST /clear-cache — очистка кэша (только для отладки)
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

// ============ 6. ЭКСПОРТ ФУНКЦИЙ ==========
// Все функции экспортируются для использования в endpoints.js

module.exports = {
  // Основные хэндлеры
  getInfo,
  getSubmissions: getSubmissionsHandler,
  getCompanyFacts: getCompanyFactsHandler,
  getCompanyMeta: getCompanyMetaHandler,
  
  // Company tickers
  getCompanyTickers,
  getCompanyTickersMF,
  getCompanyTickersExchange,
  
  // XBRL
  getCompanyConcept,
  getFrames,
  
  // Вспомогательные
  getCacheStatus,
  clearCache,
  
  // Внутренние функции (для использования в других модулях)
  getCIK,
  getSubmissionsData: getSubmissions,
  getCompanyFactsData: getCompanyFacts,
  getCompanyMetaData: getCompanyMeta
};
