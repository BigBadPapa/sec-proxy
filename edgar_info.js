// ============ EDGAR_INFO.JS - ЛОГИКА ДЛЯ /INFO И /SUBMISSIONS ============
// Содержит функции для получения статической информации о компании
// и прямого доступа к SEC API

const fetch = require('node-fetch');

// ============ КОНФИГУРАЦИЯ ============
const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// ============ КЭШИ ============
// Все кэши можно включить/выключить через CACHE_CONFIG в основном файле
// Здесь используются глобальные переменные, но в идеале их нужно вынести в общий модуль

// Кэш для company_tickers.json (все тикеры → CIK)
// Влияет: на быстроту поиска CIK по тикеру
let tickersCache = null;
let tickersCacheTime = 0;
const TICKERS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа

// Кэш для submissions (история подач компании)
// Влияет: на быстроту получения списка отчётов компании
const submissionsCache = new Map();
const SUBMISSIONS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа
const SUBMISSIONS_CACHE_MAX_SIZE = 20;

// Кэш для companyfacts (все XBRL данные)
// Влияет: на быстроту получения финансовых данных
const factsCache = new Map();
const FACTS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 часов
const FACTS_CACHE_MAX_SIZE = 20;

// Кэш для company meta (краткая информация)
// Влияет: на быстроту получения названия, категории и т.д.
const companyMetaCache = new Map();
const META_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа
const META_CACHE_MAX_SIZE = 500;

// Кэш для CIK (тикер → CIK)
// Влияет: на быстроту получения CIK без перебора company_tickers
const cikCache = new Map();
const CIK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа
const CIK_CACHE_MAX_SIZE = 500;

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============

/**
 * Логирование с временной меткой
 */
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

/**
 * Безопасное преобразование даты (возвращает 0 при ошибке)
 */
function safeDateValue(dateStr) {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Проверка валидности кэша
 */
function isCacheValid(cached, ttl) {
  return cached && (Date.now() - cached.time < ttl);
}

/**
 * Получение данных из кэша
 */
function getFromCache(map, key, ttl) {
  if (!map.has(key)) return null;
  const cached = map.get(key);
  if (isCacheValid(cached, ttl)) return cached.data;
  map.delete(key);
  return null;
}

/**
 * Сохранение данных в кэш
 */
function setToCache(map, key, data, ttl, maxSize) {
  // Если превышен максимальный размер, удаляем самый старый элемент
  if (map.size >= maxSize) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  map.set(key, { data, time: Date.now() });
}

// ============ FETCH С RETRY ============

/**
 * Выполняет HTTP запрос с повторными попытками при ошибках
 * @param {string} url - URL для запроса
 * @param {object} options - Опции fetch
 * @param {number} maxRetries - Максимальное количество попыток
 * @returns {Promise<Response>} - Ответ fetch
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      log(`fetchWithRetry: попытка ${i+1} для ${url.substring(0, 100)}...`);
      const response = await fetch(url, options);
      if (response.ok) {
        log(`fetchWithRetry: успех, status=${response.status}`);
        return response;
      }
      // Rate limiting — ждём и повторяем
      if (response.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        log(`Rate limited, waiting ${delay}ms...`);
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

// ============ РАБОТА С SEC API ============

/**
 * Получает CIK компании по тикеру
 * @param {string} ticker - Биржевой тикер (например, "AAPL")
 * @returns {Promise<string|null>} - CIK с ведущими нулями (10 цифр)
 */
async function getCIK(ticker) {
  log(`getCIK: поиск CIK для тикера ${ticker}`);
  
  // Проверяем кэш CIK
  if (cikCache.size > 0) {
    const cached = getFromCache(cikCache, ticker, CIK_CACHE_TTL);
    if (cached !== null) {
      log(`getCIK: кэш HIT для ${ticker} -> ${cached}`);
      return cached;
    }
  }
  
  // Загружаем company_tickers.json (кэшируется на 24 часа)
  let cik = null;
  if (tickersCache && isCacheValid({ time: tickersCacheTime }, TICKERS_CACHE_TTL)) {
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
  if (!entry) {
    log(`getCIK: тикер ${ticker} не найден`);
    return null;
  }
  
  cik = entry.cik_str.toString().padStart(10, '0');
  log(`getCIK: найден CIK = ${cik}`);
  
  // Сохраняем в кэш CIK
  if (cik) {
    setToCache(cikCache, ticker, cik, CIK_CACHE_TTL, CIK_CACHE_MAX_SIZE);
  }
  
  return cik;
}

/**
 * Получает submissions (история подач) компании по CIK
 * @param {string} cik - CIK компании (10 цифр)
 * @returns {Promise<object|null>} - JSON с историей подач
 */
async function getSubmissions(cik) {
  log(`getSubmissions: загрузка submissions для CIK ${cik}`);
  
  // Проверяем кэш submissions
  const cached = getFromCache(submissionsCache, cik, SUBMISSIONS_CACHE_TTL);
  if (cached !== null) {
    log(`getSubmissions: кэш HIT для ${cik}`);
    return cached;
  }
  log(`getSubmissions: кэш MISS для ${cik}`);
  
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

/**
 * Получает companyfacts (все XBRL данные) компании по CIK
 * @param {string} cik - CIK компании (10 цифр)
 * @returns {Promise<object|null>} - JSON с финансовыми данными
 */
async function getCompanyFacts(cik) {
  log(`getCompanyFacts: загрузка companyfacts для CIK ${cik}`);
  
  // Проверяем кэш companyfacts
  const cached = getFromCache(factsCache, cik, FACTS_CACHE_TTL);
  if (cached !== null) {
    log(`getCompanyFacts: кэш HIT для ${cik}`);
    return cached;
  }
  log(`getCompanyFacts: кэш MISS для ${cik}`);
  
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

/**
 * Получает краткие метаданные компании (название, категория, etc.)
 * @param {string} cik - CIK компании
 * @param {string} ticker - Тикер компании
 * @returns {Promise<object|null>} - Объект с метаданными
 */
async function getCompanyMeta(cik, ticker) {
  log(`getCompanyMeta: получение метаданных для CIK ${cik}`);
  
  // Проверяем кэш метаданных
  const cached = getFromCache(companyMetaCache, cik, META_CACHE_TTL);
  if (cached !== null) {
    log(`getCompanyMeta: кэш HIT для ${cik}`);
    return cached;
  }
  
  const subData = await getSubmissions(cik);
  if (!subData) return null;
  
  const meta = {
    fiscalYearEnd: subData.fiscalYearEnd || null,
    name: subData.entityName || null,
    category: subData.category || null,
    stateOfIncorporation: subData.stateOfIncorporation || null,
    ticker: ticker,
    sic: subData.sic || null,
    sicDescription: subData.sicDescription || null,
    ein: subData.ein || null
  };
  
  // Сохраняем в кэш
  setToCache(companyMetaCache, cik, meta, META_CACHE_TTL, META_CACHE_MAX_SIZE);
  log(`getCompanyMeta: получено и закэшировано`);
  
  return meta;
}

// ============ ОСНОВНАЯ ЛОГИКА ДЛЯ ЭНДПОИНТОВ ============

/**
 * GET /info/:ticker
 * Возвращает статическую информацию о компании
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function getInfo(req, res) {
  const ticker = req.params.ticker.toUpperCase();
  log(`GET /info/${ticker}`);
  
  try {
    // 1. Получаем CIK по тикеру
    const cik = await getCIK(ticker);
    if (!cik) {
      return res.status(404).json({ error: 'Тикер не найден' });
    }
    
    // 2. Получаем submissions
    const subData = await getSubmissions(cik);
    if (!subData) {
      return res.status(500).json({ error: 'Ошибка получения данных' });
    }
    
    // 3. Формируем ответ
    const response = {
      cik: subData.cik,
      name: subData.entityName,
      ein: subData.ein || null,
      description: subData.description || null,
      category: subData.category || null,
      fiscalYearEnd: subData.fiscalYearEnd || null,
      stateOfIncorporation: subData.stateOfIncorporation || null,
      phone: subData.phone || null,
      website: subData.website || null,
      investorWebsite: subData.investorWebsite || null,
      businessAddress: subData.addresses?.business || null,
      mailingAddress: subData.addresses?.mailing || null,
      formerNames: subData.formerNames || [],
      tickers: subData.tickers || [],
      exchanges: subData.exchanges || [],
      sic: subData.sic || null,
      sicDescription: subData.sicDescription || null,
      entityType: subData.entityType || null,
      flags: subData.flags || null
    };
    
    res.json(response);
    
  } catch (error) {
    log(`GET /info error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /submissions/:identifier
 * Возвращает полные submissions (по тикеру или CIK)
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function getSubmissionsEndpoint(req, res) {
  const identifier = req.params.identifier;
  log(`GET /submissions/${identifier}`);
  
  try {
    let cik = null;
    
    // Определяем, CIK это или тикер
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
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

/**
 * GET /companyfacts/:identifier
 * Возвращает полные companyfacts (по тикеру или CIK)
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function getCompanyFactsEndpoint(req, res) {
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

/**
 * GET /company-meta/:ticker
 * Возвращает краткие метаданные компании
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
async function getCompanyMetaEndpoint(req, res) {
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

/**
 * GET /company-tickers
 * Возвращает маппинг всех тикеров → CIK
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
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

/**
 * GET /company-tickers-mf
 * Возвращает маппинг для фондов и ETF
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
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

/**
 * GET /company-tickers-exchange
 * Возвращает расширенный маппинг с биржами
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
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

/**
 * GET /companyconcept/:identifier/:taxonomy/:tag
 * Возвращает конкретный показатель компании
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
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
      return res.status(response.status).json({ error: `HTTP ${response.status}` });
    }
    
    const data = await response.json();
    res.json(data);
    
  } catch (error) {
    log(`GET /companyconcept error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /frames/:taxonomy/:tag/:unit/:period
 * Возвращает агрегированные данные по рынку
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
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
      return res.status(response.status).json({ error: `HTTP ${response.status}` });
    }
    
    const data = await response.json();
    res.json(data);
    
  } catch (error) {
    log(`GET /frames error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// ============ ЭКСПОРТ ФУНКЦИЙ ============
module.exports = {
  getInfo,
  getSubmissions: getSubmissionsEndpoint,
  getCompanyFacts: getCompanyFactsEndpoint,
  getCompanyMeta: getCompanyMetaEndpoint,
  getCompanyTickers,
  getCompanyTickersMF,
  getCompanyTickersExchange,
  getCompanyConcept,
  getFrames
};  });
  if (!response.ok) return null;
  return response.json();
}

// ============ ЭНДПОИНТ INFO ============
router.get('/:ticker', async (req, res) => {
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
    
    // Формируем ответ (сейчас только базовая информация)
    const response = {
      cik: subData.cik,
      name: subData.entityName,
      ein: subData.ein || null,
      description: subData.description || null,
      category: subData.category || null,
      fiscalYearEnd: subData.fiscalYearEnd || null,
      stateOfIncorporation: subData.stateOfIncorporation || null,
      phone: subData.phone || null,
      website: subData.website || null,
      investorWebsite: subData.investorWebsite || null,
      businessAddress: subData.addresses?.business || null,
      mailingAddress: subData.addresses?.mailing || null,
      formerNames: subData.formerNames || [],
      tickers: subData.tickers || [],
      exchanges: subData.exchanges || [],
      sic: subData.sic || null,
      sicDescription: subData.sicDescription || null,
      entityType: subData.entityType || null,
      flags: subData.flags || null
    };
    
    res.json(response);
    
  } catch (error) {
    log(`GET /info error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
