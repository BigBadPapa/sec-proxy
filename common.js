// ============ COMMON.JS - ОБЩИЕ УТИЛИТЫ ==========

const fetch = require('node-fetch');
const cache = require('./cache');
const catalogs = require('./catalogs');

// ============ 1. КОНСТАНТЫ ==========
const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// ============ 2. БАЗОВЫЕ УТИЛИТЫ ==========

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
  
  if (cache.CACHE_CONFIG.quarterParse.enabled) {
    const cached = cache.getFromCache(cache.quarterParseCache, quarterStr, cache.CACHE_CONFIG.quarterParse.ttl);
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
  
  if (result && cache.CACHE_CONFIG.quarterParse.enabled && cache.quarterParseCache.size < cache.CACHE_CONFIG.quarterParse.maxSize) {
    cache.setToCache(cache.quarterParseCache, quarterStr, result, cache.CACHE_CONFIG.quarterParse.ttl, cache.CACHE_CONFIG.quarterParse.maxSize);
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

// ============ 3. НОРМАЛИЗАЦИЯ ==========

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

// ============ 4. РЕЗОЛВИНГ АЛИАСОВ ==========

function resolveAlias(alias, context = 'metric') {
  if (!alias) return null;
  
  let normalized;
  if (context === 'metric') {
    normalized = alias.toString().trim().toLowerCase().replace(/[\s_-]/g, '');
  } else {
    normalized = alias.toString().trim().toLowerCase();
  }
  
  if (context === 'metric' && catalogs.METRICS_CATALOG[normalized]) {
    return normalized;
  }
  
  if (catalogs.ALIASES[normalized]) {
    return catalogs.ALIASES[normalized];
  }
  
  return null;
}

// ============ 5. HTTP С РЕТРАЯМИ ==========

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

// ============ 6. ФУНКЦИИ ДЛЯ SEC API ==========

async function getCIK(ticker) {
  const normalizedTicker = normalizeTicker(ticker);
  log(`getCIK: поиск CIK для тикера ${normalizedTicker}`);
  
  if (cache.CACHE_CONFIG.cik.enabled) {
    const cached = cache.getFromCache(cache.cikCache, normalizedTicker, cache.CACHE_CONFIG.cik.ttl);
    if (cached !== null) {
      log(`getCIK: кэш HIT для ${normalizedTicker} -> ${cached}`);
      return cached;
    }
  }
  
  let tickersCache = cache.tickersCache;
  let tickersCacheTime = cache.tickersCacheTime;
  
  if (tickersCache && cache.isCacheValid({ time: tickersCacheTime }, cache.CACHE_CONFIG.tickers.ttl)) {
    log(`getCIK: tickersCache HIT`);
  } else {
    log(`getCIK: tickersCache MISS, загружаем company_tickers.json`);
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    tickersCache = await response.json();
    cache.tickersCache = tickersCache;
    cache.tickersCacheTime = Date.now();
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
  
  if (cache.CACHE_CONFIG.cik.enabled && cik) {
    cache.setToCache(cache.cikCache, normalizedTicker, cik, cache.CACHE_CONFIG.cik.ttl, cache.CACHE_CONFIG.cik.maxSize);
  }
  
  return cik;
}

async function getCompanyFacts(cik) {
  log(`getCompanyFacts: загрузка companyfacts для CIK ${cik}`);
  
  if (cache.CACHE_CONFIG.facts.enabled) {
    const cached = cache.getFromCache(cache.factsCache, cik, cache.CACHE_CONFIG.facts.ttl);
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
  
  if (cache.CACHE_CONFIG.facts.enabled) {
    cache.setToCache(cache.factsCache, cik, data, cache.CACHE_CONFIG.facts.ttl, cache.CACHE_CONFIG.facts.maxSize);
  }
  
  log(`getCompanyFacts: загружено и закэшировано`);
  return data;
}

async function getSubmissionsData(cik) {
  log(`getSubmissionsData: загрузка submissions для CIK ${cik}`);
  
  if (cache.CACHE_CONFIG.submissions.enabled) {
    const cached = cache.getFromCache(cache.submissionsCache, cik, cache.CACHE_CONFIG.submissions.ttl);
    if (cached !== null) return cached;
  }
  
  const url = `${DATA_BASE}/submissions/CIK${cik}.json`;
  const response = await fetchWithRetry(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) return null;
  
  const data = await response.json();
  
  if (cache.CACHE_CONFIG.submissions.enabled) {
    cache.setToCache(cache.submissionsCache, cik, data, cache.CACHE_CONFIG.submissions.ttl, cache.CACHE_CONFIG.submissions.maxSize);
  }
  
  return data;
}

// ============ 7. ФУНКЦИИ ДЛЯ ОТЧЕТОВ ==========

async function getLastReport(cik, type = 'all') {
  const subData = await getSubmissionsData(cik);
  if (!subData || !subData.filings || !subData.filings.recent) {
    log(`getLastReport: нет данных для CIK ${cik}`);
    return null;
  }

  const recent = subData.filings.recent;
  const forms = recent.form || [];
  const accessionNumbers = recent.accessionNumber || [];
  const reportDates = recent.reportDate || [];
  const primaryDocuments = recent.primaryDocument || [];
  const fy = recent.fy || [];
  const fp = recent.fp || [];

  // Определяем допустимые формы
  let allowedForms = [];
  if (type === 'annual') {
    allowedForms = ['10-K', '20-F', '40-F'];
  } else if (type === 'quarterly') {
    allowedForms = ['10-Q', '6-K'];
  } else {
    allowedForms = ['10-K', '10-Q', '20-F', '40-F', '6-K'];
  }

  log(`getLastReport: Поиск для CIK ${cik}, тип ${type}. Всего форм: ${forms.length}`);

  // Идем по原始ным индексам, от самых свежих (0) до более старых
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!allowedForms.includes(form)) {
      continue;
    }

    // Для 6-K обязательно наличие reportDate
    if (form === '6-K') {
      const reportDate = reportDates[i];
      if (!reportDate || reportDate === '') {
        log(`getLastReport: Пропускаем 6-K индекс ${i} без reportDate`);
        continue;
      }
    }

    const accessionNumberRaw = accessionNumbers[i];
    const primaryDocument = primaryDocuments[i];
    const fyValue = fy[i];
    const fpValue = fp[i];
    const reportDate = reportDates[i];

    // ВАЖНО: Проверяем, что все необходимые поля для отчета есть
    if (!accessionNumberRaw || !primaryDocument || fyValue === undefined || fpValue === undefined) {
      log(`getLastReport: Пропускаем индекс ${i} (${form}) из-за отсутствующих данных. fy=${fyValue}, fp=${fpValue}, acc=${!!accessionNumberRaw}, doc=${!!primaryDocument}`);
      continue;
    }

    // Убеждаемся, что fp начинается с 'Q' для квартальных или что это годовой отчет (FY)
    if (!fpValue.startsWith('Q') && type !== 'annual') {
        log(`getLastReport: Пропускаем индекс ${i} (${form}) - fp не начинается с Q: ${fpValue}`);
        continue;
    }

    log(`getLastReport: НАЙДЕН отчет! Индекс ${i}, Форма ${form}, FY=${fyValue}, FP=${fpValue}, Accession=${accessionNumberRaw}`);

    const accessionNumber = accessionNumberRaw.replace(/-/g, '');
    return {
      form: form,
      fy: fyValue,
      fp: fpValue,
      accessionNumber: accessionNumber,
      accessionNumberRaw: accessionNumberRaw,
      primaryDocument: primaryDocument,
      filingDate: recent.filingDate[i] || null,
      reportDate: reportDate || null
    };
  }

  log(`getLastReport: Отчет не найден для CIK ${cik}, type=${type}`);
  return null;
}

async function getCompanyCurrency(cik) {
  const factsData = await getCompanyFacts(cik);
  if (!factsData || !factsData.facts) {
    log(`getCompanyCurrency: нет данных для CIK ${cik}`);
    return 'N/A';
  }
  
  // Ищем любой тег с units
  const taxonomies = ['us-gaap', 'ifrs-full', 'srt'];
  for (const taxonomy of taxonomies) {
    const taxData = factsData.facts[taxonomy];
    if (!taxData) continue;
    
    // Берем первый попавшийся тег
    const firstTag = Object.keys(taxData)[0];
    if (firstTag && taxData[firstTag].units) {
      const units = Object.keys(taxData[firstTag].units);
      if (units.length > 0) {
        log(`getCompanyCurrency: найдена валюта ${units[0]} для CIK ${cik}`);
        return units[0];
      }
    }
  }
  
  log(`getCompanyCurrency: валюта не найдена для CIK ${cik}`);
  return 'N/A';
}

// ============ 8. ЭКСПОРТ ==========

module.exports = {
  USER_AGENT,
  SEC_BASE,
  DATA_BASE,
  log,
  safeDateValue,
  sortByEndDesc,
  sortByStartDesc,
  filterReportsWithFiled,
  findAnnualReport,
  findQuarterlyReport,
  parseQuarterStringCached,
  applyScale,
  normalizeTicker,
  normalizeScale,
  normalizeQuarter,
  resolveAlias,
  fetchWithRetry,
  getCIK,
  getCompanyFacts,
  getSubmissionsData,
  getLastReport,
  getCompanyCurrency
};
