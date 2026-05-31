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

    const submissionsData = await common.getSubmissionsData(cik);
    
    const results = [];
    for (const metric of resolvedMetrics) {
      const value = metrics.getMetricValue(factsData, submissionsData, metric, year, quarter, scale, ticker);
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
    
    common.log(`[processInfo] НАЧАЛО: rawTicker=${rawTicker}, rawField=${JSON.stringify(rawField)}`);
    
    const ticker = common.normalizeTicker(rawTicker);
    common.log(`[processInfo] После normalizeTicker: ticker=${ticker}`);
    
    if (!ticker) {
      common.log(`[processInfo] ОШИБКА: Тикер не указан`);
      return res.json(formatResponse(false, null, false, 'Тикер не указан'));
    }
    
    // ============ ОПРЕДЕЛЕНИЕ СПЕЦИАЛЬНЫХ ПОЛЕЙ ============
    let fieldStr = null;
    let isSpecialField = false;
    let specialFieldType = null;
    let specialFieldFormat = null;
    
    if (typeof rawField === 'string') {
      fieldStr = rawField.trim().toLowerCase();
      common.log(`[processInfo] fieldStr=${fieldStr}`);
      
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
        common.log(`[processInfo] Обнаружено специальное поле: type=${specialFieldType}, format=${specialFieldFormat}`);
      }
    }
    
    // ============ ОБРАБОТКА СПЕЦИАЛЬНЫХ ПОЛЕЙ ============
    if (isSpecialField) {
      common.log(`[processInfo] Начало обработки специального поля: fieldStr=${fieldStr}`);
      
      const cik = await common.getCIK(ticker);
      common.log(`[processInfo] getCIK вернул: ${cik}`);
      
      if (!cik) {
        common.log(`[processInfo] ОШИБКА: CIK не найден для тикера ${ticker}`);
        return res.json(formatResponse(false, null, false, 'Тикер не найден'));
      }
      
      common.log(`[processInfo] Вызов common.getLastReport(${cik}, ${specialFieldType})`);
      const report = await common.getLastReport(cik, specialFieldType);
      common.log(`[processInfo] getLastReport вернул: ${report ? 'отчет найден' : 'null'}`);
      
      if (report) {
        common.log(`[processInfo] report.fy=${report.fy}, report.fp=${report.fp}, report.form=${report.form}`);
      }
      
      common.log(`[processInfo] Вызов common.formatReportString с format=${specialFieldFormat}`);
      const result = common.formatReportString(report, specialFieldFormat);
      common.log(`[processInfo] formatReportString вернул: ${result}`);
      
      common.log(`[processInfo] Возвращаем результат для специального поля`);
      return res.json(formatResponse(true, result, false));
    }
    
    // ============ ОБЫЧНЫЕ ПОЛЯ ============
    common.log(`[processInfo] Обработка обычных полей`);
    
    let fieldsArray = [];
    let isBatch = false;
    
    if (Array.isArray(rawField)) {
      fieldsArray = rawField.flat().filter(f => f && f.toString().trim() !== '');
      isBatch = true;
      common.log(`[processInfo] rawField - массив, полей: ${fieldsArray.length}, isBatch=${isBatch}`);
    } else if (typeof rawField === 'string' && (rawField.includes(',') || rawField.includes('/'))) {
      const separator = rawField.includes(',') ? ',' : '/';
      fieldsArray = rawField.split(separator).map(f => f.trim());
      isBatch = true;
      common.log(`[processInfo] rawField - строка с разделителем '${separator}', полей: ${fieldsArray.length}, isBatch=${isBatch}`);
    } else if (typeof rawField === 'string') {
      fieldsArray = [rawField];
      isBatch = false;
      common.log(`[processInfo] rawField - одиночная строка: ${rawField}, isBatch=${isBatch}`);
    } else if (rawField) {
      fieldsArray = [String(rawField)];
      isBatch = false;
      common.log(`[processInfo] rawField - прочий тип, приведен к строке`);
    } else {
      common.log(`[processInfo] rawField пустой`);
    }
    
    if (fieldsArray.length === 0) {
      common.log(`[processInfo] ОШИБКА: Поля не указаны`);
      return res.json(formatResponse(false, null, false, 'Поля не указаны'));
    }
    
    common.log(`[processInfo] fieldsArray: [${fieldsArray.join(', ')}]`);
    
    const resolvedFields = [];
    const notFound = [];
    
    for (const f of fieldsArray) {
      common.log(`[processInfo] Резолвинг поля: ${f}`);
      const resolved = common.resolveAlias(f, 'info');
      if (resolved) {
        resolvedFields.push(resolved);
        common.log(`[processInfo]   -> резолвлено в: ${resolved}`);
      } else {
        notFound.push(f);
        common.log(`[processInfo]   -> НЕ НАЙДЕНО`);
      }
    }
    
    common.log(`[processInfo] resolvedFields: [${resolvedFields.join(', ')}], notFound: [${notFound.join(', ')}]`);
    
    if (resolvedFields.length === 0) {
      common.log(`[processInfo] ОШИБКА: Поля не найдены`);
      return res.json(formatResponse(false, null, isBatch, 'Поля не найдены'));
    }
    
    common.log(`[processInfo] Вызов common.getCIK(${ticker})`);
    const cik = await common.getCIK(ticker);
    common.log(`[processInfo] getCIK вернул: ${cik}`);
    
    if (!cik) {
      common.log(`[processInfo] ОШИБКА: Тикер не найден`);
      return res.json(formatResponse(false, null, isBatch, 'Тикер не найден'));
    }
    
    common.log(`[processInfo] Вызов common.getSubmissionsData(${cik})`);
    const subData = await common.getSubmissionsData(cik);
    if (!subData) {
      common.log(`[processInfo] ОШИБКА: Не удалось получить submissions`);
      return res.json(formatResponse(false, null, isBatch, 'Ошибка получения данных из SEC'));
    }
    common.log(`[processInfo] subData получен`);
    
    const results = [];
    for (const resolved of resolvedFields) {
      common.log(`[processInfo] Извлечение значения для поля: ${resolved}`);
      const keys = resolved.split('.');
      let value = subData;
      for (const key of keys) {
        if (value === null || value === undefined) {
          common.log(`[processInfo]   -> ключ ${key} не найден, value становится null`);
          value = null;
          break;
        }
        value = value[key];
        common.log(`[processInfo]   -> ключ ${key} = ${typeof value === 'object' ? JSON.stringify(value).substring(0, 50) : value}`);
      }
      
      value = common.normalizeInfoValue(value, resolved);
      results.push(value);
    }
    
    common.log(`[processInfo] results: [${results.map(r => r === null ? 'null' : r).join(', ')}]`);
    
    if (notFound.length > 0) {
      common.log(`[processInfo] Возврат с notFound: ${notFound.join(', ')}`);
      return res.json(formatResponse(true, results, isBatch, `Не найдены: ${notFound.join(', ')}`));
    }
    
    common.log(`[processInfo] УСПЕХ! Возврат результата`);
    return res.json(formatResponse(true, results, isBatch));
    
  } catch (error) {
    common.log(`[processInfo] КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
    console.error('processInfo error:', error);
    return res.json(formatResponse(false, null, false, error.message));
  }
}

module.exports = {
  processEdgar,
  processInfo
};
