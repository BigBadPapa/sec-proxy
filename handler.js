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

// Формирует объект с данными для построения формулы в GAS
function formatReportLinkForGas(report, cik) {
  if (!report) return 'Н/Д';
  
  const htmlUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${report.accessionNumber}/${report.primaryDocument}`;
  const xbrlUrl = `https://www.sec.gov/ix?doc=/Archives/edgar/data/${parseInt(cik)}/${report.accessionNumber}/${report.primaryDocument}`;
  
  // Возвращаем объект с данными для построения формулы в GAS
  return {
    htmlUrl: htmlUrl,
    xbrlUrl: xbrlUrl,
    fp: report.fp,
    fy: report.fy
  };
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
    
    // Нормализация field: если массив, берем первый элемент
    let normalizedField = rawField;
    if (Array.isArray(normalizedField)) {
      normalizedField = normalizedField[0];
    }
    
    // Приводим к строке и убираем пробелы
    const fieldStr = normalizedField ? normalizedField.toString().trim().toLowerCase() : '';
    
    // ============ ОБРАБОТКА СПЕЦИАЛЬНЫХ ПОЛЕЙ ============
    
    // lastreport - последний earnings отчет (любой)
    if (fieldStr === 'lastreport') {
      const cik = await common.getCIK(ticker);
      if (!cik) {
        return res.json(formatResponse(false, null, false, 'Тикер не найден'));
      }
      const report = await common.getLastReport(cik, 'all');
      if (!report) {
        return res.json(formatResponse(true, 'Н/Д', false));
      }
      const linkData = formatReportLinkForGas(report, cik);
      return res.json(formatResponse(true, linkData, false));
    }
    
    // lastreporta - последний годовой earnings отчет
    if (fieldStr === 'lastreporta') {
      const cik = await common.getCIK(ticker);
      if (!cik) {
        return res.json(formatResponse(false, null, false, 'Тикер не найден'));
      }
      const report = await common.getLastReport(cik, 'annual');
      if (!report) {
        return res.json(formatResponse(true, 'Н/Д', false));
      }
      const linkData = formatReportLinkForGas(report, cik);
      return res.json(formatResponse(true, linkData, false));
    }
    
    // lastreportq - последний квартальный earnings отчет
    if (fieldStr === 'lastreportq') {
      const cik = await common.getCIK(ticker);
      if (!cik) {
        return res.json(formatResponse(false, null, false, 'Тикер не найден'));
      }
      const report = await common.getLastReport(cik, 'quarterly');
      if (!report) {
        return res.json(formatResponse(true, 'Н/Д', false));
      }
      const linkData = formatReportLinkForGas(report, cik);
      return res.json(formatResponse(true, linkData, false));
    }
    
    // currency - валюта отчетности
    if (fieldStr === 'currency') {
      const cik = await common.getCIK(ticker);
      if (!cik) {
        return res.json(formatResponse(false, null, false, 'Тикер не найден'));
      }
      const currency = await common.getCompanyCurrency(cik);
      return res.json(formatResponse(true, currency, false));
    }
    
    // ============ ОБЫЧНАЯ ОБРАБОТКА INFO (batch и одно поле) ============
    
    // Определяем, batch это или нет
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
