// ============ HANDLER.JS - ОБРАБОТЧИК ЗАПРОСОВ ОТ GAS ==========

const common = require('./common');
const cache = require('./cache');
const metrics = require('./metrics');

function parseYear(raw) {
  if (raw === undefined || raw === null) return undefined;
  const year = Number(raw);
  return isNaN(year) ? undefined : year;
}

function parseStringArray(raw, defaultSeparator = '/') {
  if (!raw) return { items: [], isBatch: false };
  
  let itemsArray = [];
  let isBatch = false;
  
  if (Array.isArray(raw)) {
    itemsArray = raw.flat().filter(item => item && String(item).trim() !== '');
    isBatch = true;
  } else if (typeof raw === 'string' && (raw.includes('/') || raw.includes(','))) {
    const separator = raw.includes('/') ? '/' : ',';
    itemsArray = raw.split(separator).map(item => item.trim());
    isBatch = true;
  } else if (typeof raw === 'string') {
    itemsArray = [raw];
    isBatch = false;
  } else if (raw) {
    itemsArray = [String(raw)];
    isBatch = false;
  }
  
  return { items: itemsArray, isBatch };
}

function formatResponse(success, data, isBatch = false, error = null) {
  if (!success) {
    return { success: false, displayValue: error || 'Ошибка' };
  }
  
  if (isBatch) {
    return { success: true, displayValue: [data] };
  } else {
    return { success: true, displayValue: data };
  }
}

async function processEdgar(req, res) {
  try {
    const { ticker: rawTicker, metric: rawMetric, year: rawYear, quarter: rawQuarter, scale: rawScale, compare: rawCompare } = req.body;
    
    const ticker = common.normalizeTicker(rawTicker);
    if (!ticker) {
      return res.json(formatResponse(false, null, false, 'Тикер не указан'));
    }
    
    const { items: metricsArray, isBatch } = parseStringArray(rawMetric);
    if (metricsArray.length === 0) {
      return res.json(formatResponse(false, null, false, 'Метрики не указаны'));
    }
    
    const year = parseYear(rawYear);
    const quarter = common.normalizeQuarter(rawQuarter);
    const scale = common.normalizeScale(rawScale);
    const compare = rawCompare ? String(rawCompare).toLowerCase().trim() : undefined;
    
    const resolvedMetrics = [];
    const notFound = [];
    
    for (const m of metricsArray) {
      const resolved = common.resolveAlias(m, 'metric');
      if (resolved) {
        resolvedMetrics.push(resolved);
      } else {
        notFound.push(m);
      }
    }
    
    if (resolvedMetrics.length === 0) {
      return res.json(formatResponse(false, null, isBatch, 'Метрики не найдены'));
    }
    
    const cik = await common.getCIK(ticker);
    if (!cik) {
      return res.json(formatResponse(false, null, isBatch, 'Тикер не найден'));
    }
    
    const factsData = await common.getCompanyFacts(cik);
    if (!factsData) {
      return res.json(formatResponse(false, null, isBatch, 'Ошибка получения данных из SEC'));
    }
    
    const results = [];
    for (const metric of resolvedMetrics) {
      const value = metrics.getMetricValue(factsData, metric, year, quarter, scale, ticker);
      results.push(value !== null ? value : null);
    }
    
    if (notFound.length > 0) {
      return res.json(formatResponse(true, results, isBatch, `Не найдены: ${notFound.join(', ')}`));
    }
    
    return res.json(formatResponse(true, results, isBatch));
    
  } catch (error) {
    console.error('processEdgar error:', error);
    return res.json(formatResponse(false, null, false, error.message));
  }
}

async function processInfo(req, res) {
  try {
    const { ticker: rawTicker, field: rawField } = req.body;
    
    const ticker = common.normalizeTicker(rawTicker);
    if (!ticker) {
      return res.json(formatResponse(false, null, false, 'Тикер не указан'));
    }
    
    // Определяем, что за поле запрошено (если строка)
    let fieldStr = null;
    let isSpecialField = false;
    let specialFieldType = null;
    let specialFieldFormat = null;
    
    if (typeof rawField === 'string') {
      fieldStr = rawField.trim().toLowerCase();
      
      // Проверка на специальные поля для отчетов
      const specialFields = {
        'lastreport': { type: 'all', format: 'text' },
        'lastreporthtml': { type: 'all', format: 'html' },
        'lastreportxbrl': { type: 'all', format: 'xbrl' },
        'alastreport': { type: 'annual', format: 'text' },
        'alastreporthtml': { type: 'annual', format: 'html' },
        'alastreportxbrl': { type: 'annual', format: 'xbrl' },
        'qlastreport': { type: 'quarterly', format: 'text' },
        'qlastreporthtml': { type: 'quarterly', format: 'html' },
        'qlastreportxbrl': { type: 'quarterly', format: 'xbrl' }
      };
      
      if (specialFields[fieldStr]) {
        isSpecialField = true;
        specialFieldType = specialFields[fieldStr].type;
        specialFieldFormat = specialFields[fieldStr].format;
      }
    }
    
    // Обработка специальных полей (lastreport и т.д.)
    if (isSpecialField) {
      const cik = await common.getCIK(ticker);
      if (!cik) {
        return res.json(formatResponse(false, null, false, 'Тикер не найден'));
      }
      
      const report = await common.getLastReport(cik, specialFieldType);
      const result = common.formatReportString(report, specialFieldFormat);
      return res.json(formatResponse(true, result, false));
    }
    
    // Обычные поля (массив или строка)
    let fieldsArray = [];
    let isBatch = false;
    
    if (Array.isArray(rawField)) {
      fieldsArray = rawField.flat().filter(f => f && f.toString().trim() !== '');
      isBatch = true;
    } else if (typeof rawField === 'string' && (rawField.includes(',') || rawField.includes('/'))) {
      const separator = rawField.includes(',') ? ',' : '/';
      fieldsArray = rawField.split(separator).map(f => f.trim());
      isBatch = true;
    } else if (typeof rawField === 'string') {
      fieldsArray = [rawField];
      isBatch = false;
    } else if (rawField) {
      fieldsArray = [String(rawField)];
      isBatch = false;
    }
    
    if (fieldsArray.length === 0) {
      return res.json(formatResponse(false, null, false, 'Поля не указаны'));
    }
    
    const resolvedFields = [];
    const notFound = [];
    
    for (const f of fieldsArray) {
      const resolved = common.resolveAlias(f, 'info');
      if (resolved) {
        resolvedFields.push(resolved);
      } else {
        notFound.push(f);
      }
    }
    
    if (resolvedFields.length === 0) {
      return res.json(formatResponse(false, null, isBatch, 'Поля не найдены'));
    }
    
    const cik = await common.getCIK(ticker);
    if (!cik) {
      return res.json(formatResponse(false, null, isBatch, 'Тикер не найден'));
    }
    
    const subData = await common.getSubmissionsData(cik);
    if (!subData) {
      return res.json(formatResponse(false, null, isBatch, 'Ошибка получения данных из SEC'));
    }
    
    const results = [];
    for (const resolved of resolvedFields) {
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
    
    if (notFound.length > 0) {
      return res.json(formatResponse(true, results, isBatch, `Не найдены: ${notFound.join(', ')}`));
    }
    
    return res.json(formatResponse(true, results, isBatch));
    
  } catch (error) {
    console.error('processInfo error:', error);
    return res.json(formatResponse(false, null, false, error.message));
  }
}

module.exports = {
  processEdgar,
  processInfo
};
