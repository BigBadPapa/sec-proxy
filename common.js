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
  
  const normalized = alias.toString().trim().toLowerCase().replace(/[\s_-]/g, '');
  
  if (context === 'metric' && catalogs.METRICS_CATALOG[normalized]) {
    return normalized;
  }
  
  if (catalogs.ALIASES[normalized]) {
    return catalogs.ALIASES[normalized];
  }
  
  return null;
}

// ============ 5. НОРМАЛИЗАЦИЯ ЗНАЧЕНИЙ ДЛЯ INFO ==========

function normalizeInfoValue(value, fieldName) {
  if (value === null || value === undefined) return null;
  
  if (typeof value === 'string') return value;
  
  if (Array.isArray(value)) {
    if (fieldName === 'tickers' || fieldName === 'exchanges') {
      return value.join(', ');
    }
    if (fieldName === 'formerNames') {
      return value.map(fn => fn.name || fn).join(', ');
    }
    return value.join(', ');
  }
  
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  
  return String(value);
}

// ============ 6. HTTP С РЕТРАЯМИ ==========

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

// ============ 7. ФУНКЦИИ ДЛЯ SEC API ==========

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

// ============ 8. ФУНКЦИИ ДЛЯ ПОИСКА ОТЧЕТОВ ==========

function buildDocumentUrl(cik, accessionNumberRaw, primaryDocument, format) {
  const cikNumber = parseInt(cik, 10);
  const accessionNumber = accessionNumberRaw.replace(/-/g, '');
  
  log(`[buildDocumentUrl] cik=${cik}, cikNumber=${cikNumber}, accessionNumberRaw=${accessionNumberRaw}, accessionNumber=${accessionNumber}, primaryDocument=${primaryDocument}, format=${format}`);
  
  if (format === 'html') {
    const url = `${SEC_BASE}/Archives/edgar/data/${cikNumber}/${accessionNumber}/${primaryDocument}`;
    log(`[buildDocumentUrl] html URL: ${url}`);
    return url;
  } else if (format === 'xbrl') {
    const url = `${SEC_BASE}/ix?doc=/Archives/edgar/data/${cikNumber}/${accessionNumber}/${primaryDocument}`;
    log(`[buildDocumentUrl] xbrl URL: ${url}`);
    return url;
  }
  
  log(`[buildDocumentUrl] Неизвестный format: ${format}`);
  return null;
}

function formatReportString(report, format) {
  log(`[formatReportString] Начало: report=${report ? 'есть' : 'null'}, format=${format}`);
  
  if (!report) {
    log(`[formatReportString] report = null, возвращаем 'Н/Д'`);
    return 'Н/Д';
  }
  
  log(`[formatReportString] report.fy=${report.fy}, report.fp=${report.fp}, report.form=${report.form}`);
  
  if (format === 'text') {
    const year = report.fy;
    const fp = report.fp;
    
    if (fp === 'FY' || report.form === '10-K' || report.form === '20-F' || report.form === '40-F') {
      const result = `FY ${year}`;
      log(`[formatReportString] text (годовой): ${result}`);
      return result;
    }
    const quarterNum = fp.replace('Q', '');
    const result = `Q${quarterNum} ${year}`;
    log(`[formatReportString] text (квартальный): ${result}`);
    return result;
  }
  
  if (format === 'html') {
    const url = buildDocumentUrl(report.cik, report.accessionNumberRaw, report.primaryDocument, 'html');
    log(`[formatReportString] html URL: ${url}`);
    return url;
  }
  
  if (format === 'xbrl') {
    const url = buildDocumentUrl(report.cik, report.accessionNumberRaw, report.primaryDocument, 'xbrl');
    log(`[formatReportString] xbrl URL: ${url}`);
    return url;
  }
  
  log(`[formatReportString] Неизвестный format: ${format}, возвращаем 'Н/Д'`);
  return 'Н/Д';
}

async function getLastReport(cik, type = 'all') {
  const cacheKey = `lastreport:${cik}:${type}`;
  
  log(`[getLastReport] НАЧАЛО: CIK=${cik}, type=${type}`);
  
  if (cache.CACHE_CONFIG.metrics.enabled) {
    const cached = cache.getFromCache(cache.metricsCache, cacheKey, cache.CACHE_CONFIG.metrics.ttl);
    if (cached !== null) {
      log(`[getLastReport] КЭШ HIT: ${cacheKey} -> возвращаем из кэша`);
      return cached;
    }
    log(`[getLastReport] КЭШ MISS: ${cacheKey}`);
  }
  
  log(`[getLastReport] Загружаем submissions для CIK ${cik}`);
  const subData = await getSubmissionsData(cik);
  if (!subData || !subData.filings || !subData.filings.recent) {
    log(`[getLastReport] ОШИБКА: нет submissions для CIK ${cik}`);
    return null;
  }
  log(`[getLastReport] submissions загружены, количество отчетов: ${subData.filings.recent.form?.length || 0}`);

  log(`[getLastReport] Загружаем companyfacts для CIK ${cik}`);
  const factsData = await getCompanyFacts(cik);
  if (!factsData || !factsData.facts) {
    log(`[getLastReport] ОШИБКА: нет XBRL данных для CIK ${cik}`);
    return null;
  }
  log(`[getLastReport] companyfacts загружены`);

  log(`[getLastReport] Поиск тега Assets в XBRL...`);
  let assetsData = null;
  const taxonomies = ['us-gaap', 'ifrs-full', 'srt'];
  for (const taxonomy of taxonomies) {
    const taxData = factsData.facts[taxonomy];
    if (taxData && taxData.Assets) {
      assetsData = taxData.Assets;
      log(`[getLastReport] Тег Assets найден в таксономии: ${taxonomy}`);
      break;
    }
  }

  if (!assetsData || !assetsData.units) {
    log(`[getLastReport] ОШИБКА: тег Assets не найден в XBRL для CIK ${cik}`);
    return null;
  }

  const unitKey = Object.keys(assetsData.units)[0];
  const assetsValues = assetsData.units[unitKey] || [];
  log(`[getLastReport] Assets найден, единица измерения: ${unitKey}, количество значений: ${assetsValues.length}`);

  if (assetsValues.length === 0) {
    log(`[getLastReport] ОШИБКА: нет значений Assets для CIK ${cik}`);
    return null;
  }

  const sortedAssets = assetsValues.sort((a, b) => {
    const filedA = a.filed ? new Date(a.filed).getTime() : 0;
    const filedB = b.filed ? new Date(b.filed).getTime() : 0;
    return filedB - filedA;
  });
  log(`[getLastReport] Assets отсортированы. Первые 3 даты filed: ${sortedAssets.slice(0, 3).map(a => a.filed).join(', ')}`);

  let allowedForms = [];
  if (type === 'annual') {
    allowedForms = ['10-K', '20-F', '40-F'];
    log(`[getLastReport] Тип: annual, допустимые формы: ${allowedForms.join(', ')}`);
  } else if (type === 'quarterly') {
    allowedForms = ['10-Q', '6-K'];
    log(`[getLastReport] Тип: quarterly, допустимые формы: ${allowedForms.join(', ')}`);
  } else {
    allowedForms = ['10-K', '10-Q', '20-F', '40-F', '6-K'];
    log(`[getLastReport] Тип: all, допустимые формы: ${allowedForms.join(', ')}`);
  }

  const recent = subData.filings.recent;
  const forms = recent.form || [];
  const accessionNumbers = recent.accessionNumber || [];
  const filingDates = recent.filingDate || [];
  const primaryDocuments = recent.primaryDocument || [];

  log(`[getLastReport] Всего отчетов в submissions: ${forms.length}`);
  log(`[getLastReport] Первые 5 форм: ${forms.slice(0, 5).join(', ')}`);
  log(`[getLastReport] Первые 5 дат filing: ${filingDates.slice(0, 5).join(', ')}`);

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!allowedForms.includes(form)) continue;
    
    log(`[getLastReport] Проверяем отчет ${i}: form=${form}, filingDate=${filingDates[i]}`);
    
    const accessionNumberRaw = accessionNumbers[i];
    const primaryDocument = primaryDocuments[i];
    const filingDate = filingDates[i];

    if (!accessionNumberRaw || !primaryDocument) {
      log(`[getLastReport] Пропускаем: нет accessionNumber или primaryDocument`);
      continue;
    }

    let matchingAsset = null;
    for (const asset of sortedAssets) {
      if (asset.filed === filingDate) {
        matchingAsset = asset;
        log(`[getLastReport] Найдено совпадение по filed: asset.filed=${asset.filed}, filingDate=${filingDate}`);
        break;
      }
    }

    if (matchingAsset) {
      const fyValue = matchingAsset.fy;
      const fpValue = matchingAsset.fp;
      
      log(`[getLastReport] matchingAsset: fy=${fyValue}, fp=${fpValue}, form=${form}`);
      
      if (fyValue && fpValue) {
        log(`[getLastReport] УСПЕХ! Найден отчет! Индекс ${i}, Форма ${form}, FY=${fyValue}, FP=${fpValue}, filingDate=${filingDate}`);
        
        const result = {
          cik: cik,
          form: form,
          fy: fyValue,
          fp: fpValue,
          accessionNumberRaw: accessionNumberRaw,
          primaryDocument: primaryDocument,
          filingDate: filingDate || null,
          reportDate: matchingAsset.end || null
        };
        
        if (cache.CACHE_CONFIG.metrics.enabled && result) {
          cache.setToCache(cache.metricsCache, cacheKey, result, cache.CACHE_CONFIG.metrics.ttl, cache.CACHE_CONFIG.metrics.maxSize);
          log(`[getLastReport] Результат сохранен в кэш: ${cacheKey}`);
        }
        
        return result;
      } else {
        log(`[getLastReport] Пропускаем: fy или fp отсутствуют (fy=${fyValue}, fp=${fpValue})`);
      }
    } else {
      log(`[getLastReport] Нет совпадения по filed для filingDate=${filingDate}`);
    }
  }

  log(`[getLastReport] НЕ НАЙДЕН: отчет для CIK ${cik}, type=${type}`);
  return null;
}

// ============ 9. ЗАГРУЗКА ЛОКАЛЬНОГО ИНДЕКСА SUBMISSIONS ==========

const fs = require('fs').promises;
const path = require('path');

let submissionsIndex = null;
let submissionsIndexLoaded = false;

async function loadSubmissionsIndex() {
  if (submissionsIndexLoaded) return submissionsIndex;
  
  try {
    const indexPath = path.join(__dirname, 'data', 'submissions.json');
    const data = await fs.readFile(indexPath, 'utf8');
    submissionsIndex = JSON.parse(data);
    submissionsIndexLoaded = true;
    log(`submissions-index загружен: ${Object.keys(submissionsIndex).length} компаний`);
    return submissionsIndex;
  } catch (error) {
    log(`Ошибка загрузки submissions-index: ${error.message}`);
    return null;
  }
}

async function getInfoFromIndex(cik) {
  const index = await loadSubmissionsIndex();
  if (!index) return null;
  return index[cik] || null;
}

// ============ 10. ЭКСПОРТ ==========

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
  normalizeInfoValue,
  fetchWithRetry,
  getCIK,
  getCompanyFacts,
  getSubmissionsData,
  buildDocumentUrl,
  formatReportString,
  getLastReport,
  loadSubmissionsIndex,
  getInfoFromIndex
};
