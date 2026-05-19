// ============ HANDLER.JS - ОБРАБОТЧИК ЗАПРОСОВ ОТ GAS ==========
// Принимает сырые данные от GAS, парсит, вызывает нужную логику, форматирует ответ

const catalogs = require('./catalogs');
const metricsLogic = require('./edgar_metrics');
const infoLogic = require('./edgar_info');

// ============ 1. ПАРСЕРЫ ==========

function parseTicker(raw) {
  if (!raw) return null;
  return String(raw).toUpperCase().trim().replace(/\./g, '-');
}

function parseYear(raw) {
  if (raw === undefined || raw === null) return undefined;
  const year = Number(raw);
  return isNaN(year) ? undefined : year;
}

function parseQuarter(raw) {
  if (raw === undefined || raw === null) return undefined;
  const str = String(raw).toLowerCase().trim();
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

function parseScale(raw) {
  if (!raw) return null;
  const str = String(raw).toLowerCase().trim();
  if (str === 'k' || str === 'т' || str === 'тысячи') return 'k';
  if (str === 'kk' || str === 'м' || str === 'миллионы') return 'kk';
  if (str === 'kkk' || str === 'млрд' || str === 'миллиарды') return 'kkk';
  return null;
}

function parseMetrics(raw) {
  let metricsArray = [];
  let isBatch = false;
  
  if (Array.isArray(raw)) {
    metricsArray = raw.flat().filter(m => m && String(m).trim() !== '');
    isBatch = true;
  } else if (typeof raw === 'string' && (raw.includes('/') || raw.includes(','))) {
    const separator = raw.includes('/') ? '/' : ',';
    metricsArray = raw.split(separator).map(m => m.trim());
    isBatch = true;
  } else if (typeof raw === 'string') {
    metricsArray = [raw];
    isBatch = false;
  } else if (raw) {
    metricsArray = [String(raw)];
    isBatch = false;
  }
  
  return { metricsArray, isBatch };
}

function parseFields(raw) {
  let fieldsArray = [];
  let isBatch = false;
  
  if (Array.isArray(raw)) {
    fieldsArray = raw.flat().filter(f => f && String(f).trim() !== '');
    isBatch = true;
  } else if (typeof raw === 'string' && (raw.includes(',') || raw.includes('/'))) {
    const separator = raw.includes(',') ? ',' : '/';
    fieldsArray = raw.split(separator).map(f => f.trim());
    isBatch = true;
  } else if (typeof raw === 'string') {
    fieldsArray = [raw];
    isBatch = false;
  } else if (raw) {
    fieldsArray = [String(raw)];
    isBatch = false;
  }
  
  return { fieldsArray, isBatch };
}

function resolveAlias(alias, context = 'metric') {
  if (!alias) return null;
  const normalized = alias.toString().trim().toLowerCase();
  
  if (catalogs.ALIASES[normalized]) {
    return catalogs.ALIASES[normalized];
  }
  
  return alias.toString().trim();
}

// ============ 2. ФОРМАТИРОВАТЕЛИ ОТВЕТА ==========

function formatResponse(success, data, isBatch = false, notFound = [], error = null) {
  const response = { success };
  
  if (error) {
    response.error = error;
    return response;
  }
  
  if (isBatch) {
    response.isBatch = true;
    response.results = data;
    if (notFound.length > 0) response.notFound = notFound;
  } else {
    response.isBatch = false;
    response.result = data;
  }
  
  return response;
}

// ============ 3. ОСНОВНЫЕ ОБРАБОТЧИКИ ==========

async function processEdgar(req, res) {
  try {
    const { ticker: rawTicker, metric: rawMetric, year: rawYear, quarter: rawQuarter, scale: rawScale, compare: rawCompare } = req.body;
    
    // Парсинг
    const ticker = parseTicker(rawTicker);
    if (!ticker) {
      return res.json(formatResponse(false, null, false, [], 'Тикер не указан'));
    }
    
    const { metricsArray, isBatch } = parseMetrics(rawMetric);
    if (metricsArray.length === 0) {
      return res.json(formatResponse(false, null, false, [], 'Метрики не указаны'));
    }
    
    const year = parseYear(rawYear);
    const quarter = parseQuarter(rawQuarter);
    const scale = parseScale(rawScale);
    const compare = rawCompare ? String(rawCompare).toLowerCase().trim() : undefined;
    
    // Резолвинг метрик
    const resolvedMetrics = [];
    const notFound = [];
    
    for (const m of metricsArray) {
      const resolved = resolveAlias(m, 'metric');
      if (resolved) {
        resolvedMetrics.push(resolved);
      } else {
        notFound.push(m);
      }
    }
    
    if (resolvedMetrics.length === 0) {
      return res.json(formatResponse(false, null, isBatch, notFound, 'Метрики не найдены'));
    }
    
    // Получение CIK
    const common = require('./edgar_common');
    const cik = await common.getCIK(ticker);
    if (!cik) {
      return res.json(formatResponse(false, null, isBatch, [], 'Тикер не найден'));
    }
    
    // Получение companyfacts
    const factsData = await common.getCompanyFacts(cik);
    if (!factsData) {
      return res.json(formatResponse(false, null, isBatch, [], 'Ошибка получения данных из SEC'));
    }
    
    // Расчет метрик
    const results = [];
    for (const metric of resolvedMetrics) {
      const value = metricsLogic.getMetricValue(factsData, metric, year, quarter, scale, ticker);
      results.push(value !== null ? value : null);
    }
    
    if (isBatch && results.length > 1) {
      return res.json(formatResponse(true, results, true, notFound));
    } else {
      return res.json(formatResponse(true, results[0], false, notFound));
    }
    
  } catch (error) {
    console.error('processEdgar error:', error);
    return res.json(formatResponse(false, null, false, [], error.message));
  }
}

async function processInfo(req, res) {
  try {
    const { ticker: rawTicker, field: rawField } = req.body;
    
    // Парсинг
    const ticker = parseTicker(rawTicker);
    if (!ticker) {
      return res.json(formatResponse(false, null, false, [], 'Тикер не указан'));
    }
    
    const { fieldsArray, isBatch } = parseFields(rawField);
    if (fieldsArray.length === 0) {
      return res.json(formatResponse(false, null, false, [], 'Поля не указаны'));
    }
    
    // Резолвинг полей
    const resolvedFields = [];
    const notFound = [];
    
    for (const f of fieldsArray) {
      const resolved = resolveAlias(f, 'info');
      if (resolved) {
        resolvedFields.push({ original: f, resolved });
      } else {
        notFound.push(f);
      }
    }
    
    if (resolvedFields.length === 0) {
      return res.json(formatResponse(false, null, isBatch, notFound, 'Поля не найдены'));
    }
    
    // Получение данных
    const common = require('./edgar_common');
    const cik = await common.getCIK(ticker);
    if (!cik) {
      return res.json(formatResponse(false, null, isBatch, [], 'Тикер не найден'));
    }
    
    const subData = await common.getSubmissionsData(cik);
    if (!subData) {
      return res.json(formatResponse(false, null, isBatch, [], 'Ошибка получения данных из SEC'));
    }
    
    // Извлечение значений
    const results = [];
    const notFoundResults = [];
    
    for (const { original, resolved } of resolvedFields) {
      const keys = resolved.split('.');
      let value = subData;
      for (const key of keys) {
        if (value === null || value === undefined) {
          value = null;
          break;
        }
        value = value[key];
      }
      results.push(value !== null && value !== undefined ? value : null);
    }
    
    if (isBatch && results.length > 1) {
      return res.json(formatResponse(true, results, true, notFound));
    } else {
      return res.json(formatResponse(true, results[0], false, notFound));
    }
    
  } catch (error) {
    console.error('processInfo error:', error);
    return res.json(formatResponse(false, null, false, [], error.message));
  }
}

// ============ 4. ЭКСПОРТ ==========

module.exports = {
  processEdgar,
  processInfo
};
