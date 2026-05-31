// ============ METRICS.JS - ЯДРО РАСЧЕТА ФИНАНСОВЫХ МЕТРИК ==========

const common = require('./common');
const cache = require('./cache');
const catalogs = require('./catalogs');

// ============ 1. КОНСТАНТЫ ==========

const QUARTER_DAYS = {
  1: { min: 60, max: 120 },
  2: { min: 150, max: 210 },
  3: { min: 240, max: 300 },
  4: { min: 350, max: 370 }
};

// ============ 2. КЭШ-ПЕРЕМЕННЫЕ ==========
const durationCache = new Map();
const collectAllTagValuesCache = new Map();
const getMetricValuesArrayCache = new Map();

// ============ 3. ВНУТРЕННИЕ УТИЛИТЫ ==========

function getDaysDifference(start, end) {
  return (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24);
}

function findTagData(factsData, tags) {
  const taxonomies = ['us-gaap', 'ifrs-full', 'srt'];
  const facts = factsData?.facts;
  if (!facts) {
    common.log('findTagData: factsData.facts отсутствует');
    return null;
  }

  for (const taxonomy of taxonomies) {
    const taxData = facts[taxonomy];
    if (!taxData) continue;
    for (const tag of tags) {
      if (taxData[tag]) {
        common.log(`findTagData: найден тег ${tag} в таксономии ${taxonomy}`);
        return { taxonomy, tag, data: taxData[tag] };
      }
    }
  }
  common.log(`findTagData: теги ${tags.join(', ')} не найдены ни в одной таксономии`);
  return null;
}

function getMetricValuesArray(factsData, tagOrAlias) {
  const catalog = catalogs.METRICS_CATALOG[tagOrAlias];
  const facts = factsData?.facts;
  if (!facts) {
    common.log('getMetricValuesArray: factsData.facts отсутствует');
    return null;
  }
  
  if (catalog) {
    const found = findTagData(factsData, catalog.tags);
    if (!found) {
      common.log(`getMetricValuesArray: теги для алиаса ${tagOrAlias} не найдены`);
      return null;
    }
    
    const units = found.data.units;
    const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                    Object.keys(units).find(k => k.includes('shares')) ||
                    Object.keys(units).find(k => k.includes('pure')) ||
                    Object.keys(units)[0];
    common.log(`getMetricValuesArray: для ${tagOrAlias} найдено ${units[unitKey]?.length || 0} значений`);
    return units[unitKey] || null;
  }
  
  const found = findTagData(factsData, [tagOrAlias]);
  if (!found) {
    common.log(`getMetricValuesArray: прямой тег ${tagOrAlias} не найден`);
    return null;
  }
  
  const units = found.data.units;
  const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                  Object.keys(units).find(k => k.includes('shares')) ||
                  Object.keys(units).find(k => k.includes('pure')) ||
                  Object.keys(units)[0];
  common.log(`getMetricValuesArray: для тега ${tagOrAlias} найдено ${units[unitKey]?.length || 0} значений`);
  return units[unitKey] || null;
}

function collectAllTagValues(factsData, tags) {
  common.log(`collectAllTagValues: начинаем сбор для тегов [${tags.join(', ')}]`);
  const allValues = [];
  
  for (const tag of tags) {
    const found = findTagData(factsData, [tag]);
    if (!found) continue;
    
    const units = found.data.units;
    const unitKey = Object.keys(units).find(k => k.includes('USD')) || Object.keys(units)[0];
    const values = units[unitKey];
    if (values && values.length > 0) {
      common.log(`collectAllTagValues: из тега ${tag} добавлено ${values.length} значений`);
      allValues.push(...values);
    }
  }
  
  const unique = new Map();
  for (const v of allValues) {
    const key = `${v.fy || ''}|${v.fp || ''}|${v.form || ''}|${v.end || ''}|${v.start || ''}|${v.filed || ''}`;
    const existing = unique.get(key);
    if (!existing || common.safeDateValue(v.filed) > common.safeDateValue(existing.filed)) {
      unique.set(key, v);
    }
  }
  
  const result = Array.from(unique.values());
  common.log(`collectAllTagValues: после дедупликации осталось ${result.length} значений`);
  return result;
}

function getValueFromTag(tagData, metricName, year, quarterParam, isBalanceMetric, ticker, factsData) {
  const catalog = catalogs.METRICS_CATALOG[metricName];
  if (!catalog) {
    common.log(`getValueFromTag: метрика ${metricName} не найдена`);
    return null;
  }
  
  const units = tagData.units;
  const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                  Object.keys(units).find(k => k.includes('shares')) ||
                  Object.keys(units).find(k => k.includes('pure')) ||
                  Object.keys(units)[0];
  const values = units[unitKey];
  if (!values || values.length === 0) {
    common.log(`getValueFromTag: нет значений для метрики ${metricName}`);
    return null;
  }
  
  let result = null;
  
  let sortedValues;
  if (isBalanceMetric) {
    sortedValues = common.sortByEndDesc(values);
  } else {
    sortedValues = common.sortByStartDesc(values);
  }
  
  if (year !== undefined && (quarterParam === undefined || quarterParam === 0 || quarterParam === 'annual' || quarterParam === 'год' || quarterParam === '4q')) {
    let annual = null;
    for (const v of sortedValues) {
      if (v.fy !== year) continue;
      const days = getDaysDifference(v.start, v.end);
      if (days >= QUARTER_DAYS[4].min && days <= QUARTER_DAYS[4].max) {
        annual = v;
        break;
      }
    }
  
    if (annual) {
      common.log(`getValueFromTag: найден годовой отчёт за ${year}: ${annual.val}`);
      result = annual.val;
    } else {
      common.log(`getValueFromTag: годовой отчёт за ${year} не найден`);
    }
  }
  
  else if (year !== undefined && quarterParam) {
    const quarterInfo = common.parseQuarterStringCached(quarterParam);
    if (!quarterInfo) {
      common.log(`getValueFromTag: не удалось распарсить quarterParam=${quarterParam}`);
      return null;
    }
    
    if (isBalanceMetric) {
      const targetFp = `Q${quarterInfo.num}`;
      if (quarterInfo.num === 4) {
        const annual = common.findAnnualReport(sortedValues, year);
        result = annual?.val || null;
        common.log(`getValueFromTag: баланс Q4 -> годовой отчёт: ${result}`);
      } else {
        const balanceValue = common.findQuarterlyReport(sortedValues, year, targetFp);
        result = balanceValue?.val || null;
        common.log(`getValueFromTag: баланс ${targetFp}: ${result}`);
      }
    }
    else {
      const targetFp = `Q${quarterInfo.num}`;
      
      if (quarterInfo.type === 'quarter') {
        const formsToTry = ['10-Q', '6-K'];
        let candidates = [];
        for (const form of formsToTry) {
          candidates = sortedValues.filter(v => 
            v.form === form && 
            v.fy === year && 
            v.fp === targetFp
          );
          if (candidates.length > 0) break;
        }
        
        let quarterValue = candidates.find(v => {
          const days = getDaysDifference(v.start, v.end);
          return days >= QUARTER_DAYS[1].min && days <= QUARTER_DAYS[1].max;
        });
        
        if (!quarterValue && (quarterInfo.num === 2 || quarterInfo.num === 3)) {
          const ytdCurrent = candidates.find(v => {
            const days = getDaysDifference(v.start, v.end);
            return days >= QUARTER_DAYS[quarterInfo.num].min && days <= QUARTER_DAYS[quarterInfo.num].max;
          });
          const prevFp = `Q${quarterInfo.num - 1}`;
          const ytdPrev = common.findQuarterlyReport(sortedValues, year, prevFp);
          
          if (ytdCurrent && ytdPrev) {
            quarterValue = { val: ytdCurrent.val - ytdPrev.val };
            common.log(`getValueFromTag: вычислен ${targetFp} через YTD: ${ytdCurrent.val} - ${ytdPrev.val} = ${quarterValue.val}`);
          } else if (ytdCurrent) {
            quarterValue = ytdCurrent;
            common.log(`getValueFromTag: взят YTD ${targetFp} как есть: ${quarterValue.val}`);
          }
        }
        
        result = quarterValue?.val || null;
        common.log(`getValueFromTag: ${quarterParam} -> ${result}`);
      }
      else if (quarterInfo.type === 'ytd') {
        let ytdValue = null;
        
        if (quarterInfo.num === 1) {
          const formsToTry = ['10-Q', '6-K'];
          let candidates = [];
          for (const form of formsToTry) {
            candidates = sortedValues.filter(v => 
              v.form === form && 
              v.fy === year && 
              v.fp === targetFp
            );
            if (candidates.length > 0) break;
          }
          ytdValue = candidates.find(v => {
            const days = getDaysDifference(v.start, v.end);
            return days >= QUARTER_DAYS[1].min && days <= QUARTER_DAYS[1].max;
          });
        } else {
          const formsToTry = ['10-Q', '6-K'];
          let candidates = [];
          for (const form of formsToTry) {
            candidates = sortedValues.filter(v => 
              v.form === form && 
              v.fy === year && 
              v.fp === targetFp
            );
            if (candidates.length > 0) break;
          }
          
          ytdValue = candidates.find(v => {
            const days = getDaysDifference(v.start, v.end);
            return days >= QUARTER_DAYS[quarterInfo.num].min && days <= QUARTER_DAYS[quarterInfo.num].max;
          });
        }
        
        result = ytdValue?.val || null;
        common.log(`getValueFromTag: ${quarterParam} (YTD) -> ${result}`);
      }
    }
  }
  
  return result;
}

function getMetricValueInternal(factsData, metric, year, quarterParam, scale, ticker) {
  const catalog = catalogs.METRICS_CATALOG[metric];
  if (!catalog) {
    common.log(`getMetricValueInternal: метрика ${metric} не найдена в каталоге`);
    return null;
  }
  
  if (quarterParam === '4q') {
    quarterParam = undefined;
  }
  
  const isBalanceMetric = catalog.ttm === 'last';
  
  common.log(`getMetricValueInternal: ticker=${ticker}, metric=${metric}, year=${year}, quarterParam=${quarterParam}, isBalance=${isBalanceMetric}`);
  
  if (quarterParam === 'q4') {
    const annual = getMetricValueInternal(factsData, metric, year, '4q', null, ticker);
    const ytdQ3 = getMetricValueInternal(factsData, metric, year, '3q', null, ticker);
    const result = (annual !== null && ytdQ3 !== null) ? annual - ytdQ3 : null;
    return result !== null ? common.applyScale(result, scale) : null;
  }
  
  let result = searchValueInAllTags(factsData, catalog, year, quarterParam, isBalanceMetric, ticker);
  
  // ИСПРАВЛЕНИЕ: compute через рекурсивный вызов getMetricValueInternal
  if ((result === null || result === undefined) && catalog.compute && catalog.compute.length > 0) {
    common.log(`getMetricValueInternal: прямой поиск не дал результата, пробуем compute через рекурсию`);
    let computeResult = null;
    let validCount = 0;
    
    for (const computeAlias of catalog.compute) {
      common.log(`getMetricValueInternal: получаем значение для алиаса ${computeAlias}`);
      const value = getMetricValueInternal(factsData, computeAlias, year, quarterParam, null, ticker);
      if (value !== null && value !== undefined) {
        if (catalog.operation === 'sum') {
          if (computeResult === null) computeResult = 0;
          computeResult += value;
          common.log(`getMetricValueInternal: сумма = ${computeResult}`);
        } else if (catalog.operation === 'subtract') {
          if (computeResult === null) computeResult = value;
          else computeResult -= value;
          common.log(`getMetricValueInternal: вычитание = ${computeResult}`);
        }
        validCount++;
      } else {
        common.log(`getMetricValueInternal: значение для алиаса ${computeAlias} не найдено`);
      }
    }
    
    if (validCount > 0 && computeResult !== null) {
      result = computeResult;
      common.log(`getMetricValueInternal: compute результат = ${result}`);
    }
  }
  
  common.log(`getMetricValueInternal: итоговый результат = ${result}`);
  return result !== null ? common.applyScale(result, scale) : null;
}

function searchValueInAllTags(factsData, catalog, year, quarterParam, isBalanceMetric, ticker) {
  const tags = catalog.tags;
  const isQuarterRequest = quarterParam !== undefined && quarterParam !== null && quarterParam !== 'annual' && quarterParam !== 'год';
  
  common.log(`searchValueInAllTags: start, year=${year}, quarterParam=${quarterParam}, isBalance=${isBalanceMetric}`);
  
  if (quarterParam === '4q' || quarterParam === 'q4') {
    common.log(`searchValueInAllTags: пропускаем ${quarterParam}`);
    return null;
  }
  
  for (const tag of tags) {
    common.log(`searchValueInAllTags: проверяем тег ${tag}`);
    
    const tagData = findTagData(factsData, [tag]);
    if (!tagData) {
      common.log(`searchValueInAllTags: тег ${tag} не найден в данных`);
      continue;
    }
    
    const values = getMetricValuesArray(factsData, tag);
    if (!values || values.length === 0) {
      common.log(`searchValueInAllTags: тег ${tag} не содержит значений`);
      continue;
    }
    
    const hasYearData = values.some(v => v.fy === year);
    if (!hasYearData) {
      common.log(`searchValueInAllTags: тег ${tag} не содержит данных за год ${year}`);
      continue;
    }
    
    if (isQuarterRequest && quarterParam !== 'q4' && quarterParam !== '4q') {
      const quarterInfo = common.parseQuarterStringCached(quarterParam);
      if (quarterInfo) {
        const targetFp = `Q${quarterInfo.num}`;
        const hasQuarterData = values.some(v => v.fy === year && v.fp === targetFp);
        if (!hasQuarterData) {
          common.log(`searchValueInAllTags: тег ${tag} не содержит данных за ${targetFp} ${year}`);
          continue;
        }
      }
    }
    
    const result = getValueFromTag(tagData.data, catalog.alias || Object.keys(catalogs.METRICS_CATALOG).find(k => catalogs.METRICS_CATALOG[k] === catalog), year, quarterParam, isBalanceMetric, ticker, factsData);
    if (result !== null && result !== undefined) {
      common.log(`searchValueInAllTags: найден результат в теге ${tag}: ${result}`);
      return result;
    }
  }
  
  // ИСПРАВЛЕНИЕ: compute через рекурсивный вызов getMetricValueInternal
  if (catalog.compute && catalog.compute.length > 0) {
    common.log(`searchValueInAllTags: переходим к compute через рекурсию`);
    let computeResult = null;
    let validCount = 0;
    
    for (const computeAlias of catalog.compute) {
      common.log(`searchValueInAllTags: получаем значение для алиаса ${computeAlias}`);
      const value = getMetricValueInternal(factsData, computeAlias, year, quarterParam, null, ticker);
      if (value !== null && value !== undefined) {
        if (catalog.operation === 'sum') {
          if (computeResult === null) computeResult = 0;
          computeResult += value;
          common.log(`searchValueInAllTags: сумма = ${computeResult}`);
        } else if (catalog.operation === 'subtract') {
          if (computeResult === null) computeResult = value;
          else computeResult -= value;
          common.log(`searchValueInAllTags: вычитание = ${computeResult}`);
        }
        validCount++;
      } else {
        common.log(`searchValueInAllTags: значение для алиаса ${computeAlias} не найдено`);
      }
    }
    
    if (validCount > 0 && computeResult !== null) {
      common.log(`searchValueInAllTags: результат compute: ${computeResult}`);
      return computeResult;
    }
  }
  
  common.log(`searchValueInAllTags: результат не найден`);
  return null;
}

function getTTMValue(factsData, submissionsData, metricName, scale, ticker) {
  const catalog = catalogs.METRICS_CATALOG[metricName];
  const ttmType = catalog?.ttm || 'sum';
  
  common.log(`getTTMValue: ticker=${ticker}, metric=${metricName}, ttmType=${ttmType}`);
  
  // 1. Проверяем наличие submissionsData
  if (!submissionsData || !submissionsData.filings || !submissionsData.filings.recent) {
    common.log(`getTTMValue: нет данных submissions для ${ticker}`);
    return null;
  }
  
  const recent = submissionsData.filings.recent;
  const forms = recent.form || [];
  const filingDates = recent.filingDate || [];
  
  // 2. Собираем все отчеты и сортируем по дате (свежие первыми)
  const allReports = [];
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    const filingDate = filingDates[i];
    
    // Пропускаем формы, которые не являются 10-K, 10-Q, 20-F, 40-F, 6-K
    if (!['10-K', '10-Q', '20-F', '40-F', '6-K'].includes(form)) continue;
    
    allReports.push({
      form: form,
      filingDate: filingDate,
      accessionNumber: recent.accessionNumber?.[i],
      primaryDocument: recent.primaryDocument?.[i]
    });
  }
  
  // Сортируем по дате подачи (свежие первыми)
  allReports.sort((a, b) => {
    const dateA = new Date(a.filingDate).getTime();
    const dateB = new Date(b.filingDate).getTime();
    return dateB - dateA;
  });
  
  if (allReports.length === 0) {
    common.log(`getTTMValue: нет подходящих отчетов для ${ticker}`);
    return null;
  }
  
  common.log(`getTTMValue: найдено ${allReports.length} отчетов`);
  
  // 3. Определяем целевые отчеты для TTM
  let targetReports = [];
  const latestForm = allReports[0].form;
  
  // Если последний отчет - годовой (10-K, 20-F, 40-F)
  if (latestForm === '10-K' || latestForm === '20-F' || latestForm === '40-F') {
    targetReports = [allReports[0]];
    common.log(`getTTMValue: последний отчет годовой (${latestForm}), берем его`);
  } 
  // Если последний отчет - квартальный (10-Q, 6-K)
  else if (latestForm === '10-Q' || latestForm === '6-K') {
    let quarterlyCount = 0;
    for (const report of allReports) {
      if (report.form === '10-Q' || report.form === '6-K') {
        targetReports.push(report);
        quarterlyCount++;
        if (quarterlyCount === 4) break;
      }
    }
    common.log(`getTTMValue: последний отчет квартальный (${latestForm}), берем ${targetReports.length} квартальных отчетов`);
  }
  
  if (targetReports.length === 0) {
    common.log(`getTTMValue: нет подходящих отчетов для TTM`);
    return null;
  }
  
  // 4. Для каждого целевого отчета получаем значение метрики
  const values = [];
  
  for (const report of targetReports) {
    // Ищем значение метрики, соответствующее этому отчету
    const value = getMetricValueForReport(factsData, catalog, report, ticker);
    if (value !== null && value !== undefined) {
      values.push({
        val: value,
        filingDate: report.filingDate,
        form: report.form
      });
      common.log(`getTTMValue: отчет ${report.form} от ${report.filingDate} -> значение = ${value}`);
    } else {
      common.log(`getTTMValue: отчет ${report.form} от ${report.filingDate} -> значение не найдено`);
    }
  }
  
  if (values.length === 0) {
    common.log(`getTTMValue: нет значений метрики ${metricName} в целевых отчетах`);
    return null;
  }
  
  // 5. Для балансовых метрик (ttmType === 'last') - берем последний отчет
  if (ttmType === 'last') {
    const result = values[0].val;
    common.log(`getTTMValue: балансовая метрика, значение из последнего отчета = ${result}`);
    return common.applyScale(result, scale);
  }
  
  // 6. Для отчетных метрик (ttmType === 'sum') - суммируем
  let sum = 0;
  for (const v of values) {
    sum += v.val;
  }
  common.log(`getTTMValue: сумма по ${values.length} отчетам = ${sum}`);
  return common.applyScale(sum, scale);
}

// Вспомогательная функция: получить значение метрики для конкретного отчета
function getMetricValueForReport(factsData, catalog, report, ticker) {
  // Пытаемся найти прямой тег
  for (const tag of catalog.tags) {
    const tagData = findTagData(factsData, [tag]);
    if (!tagData) continue;
    
    const units = tagData.data.units;
    const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                    Object.keys(units).find(k => k.includes('shares')) ||
                    Object.keys(units)[0];
    const values = units[unitKey];
    
    if (!values) continue;
    
    // Ищем значение, у которого filingDate совпадает с датой отчета
    const matchingValue = values.find(v => v.filed === report.filingDate);
    if (matchingValue) {
      common.log(`getMetricValueForReport: найден прямой тег ${tag} в отчете от ${report.filingDate}`);
      return matchingValue.val;
    }
  }
  
  // Если прямого тега нет, пробуем compute
  if (catalog.compute && catalog.compute.length > 0) {
    common.log(`getMetricValueForReport: прямого тега нет, пробуем compute для отчета от ${report.filingDate}`);
    let computeResult = null;
    let validCount = 0;
    
    for (const computeAlias of catalog.compute) {
      const subCatalog = catalogs.METRICS_CATALOG[computeAlias];
      if (!subCatalog) continue;
      
      const value = getMetricValueForReport(factsData, subCatalog, report, ticker);
      if (value !== null && value !== undefined) {
        if (catalog.operation === 'sum') {
          if (computeResult === null) computeResult = 0;
          computeResult += value;
        } else if (catalog.operation === 'subtract') {
          if (computeResult === null) computeResult = value;
          else computeResult -= value;
        }
        validCount++;
      }
    }
    
    if (validCount > 0 && computeResult !== null) {
      common.log(`getMetricValueForReport: compute результат = ${computeResult}`);
      return computeResult;
    }
  }
  
  return null;
}

// ============ 4. ОСНОВНАЯ ПУБЛИЧНАЯ ФУНКЦИЯ ==========

function getMetricValue(factsData, submissionsData, metric, year, quarterParam, scale, ticker) {
  const cacheKey = `${ticker}:${metric}:${year}:${quarterParam}`;
  
  if (cache.CACHE_CONFIG.metrics.enabled) {
    const cached = cache.getFromCache(cache.metricsCache, cacheKey, cache.CACHE_CONFIG.metrics.ttl);
    if (cached !== null) {
      common.log(`getMetricValue: кэш HIT для ${cacheKey}, значение = ${cached}`);
      return cached !== null ? common.applyScale(cached, scale) : null;
    }
    common.log(`getMetricValue: кэш MISS для ${cacheKey}`);
  }
  
  let value;
  if (year === undefined && quarterParam === undefined) {
    common.log(`getMetricValue: TTM режим`);
    value = getTTMValue(factsData, submissionsData, metric, scale, ticker);
  } else {
    common.log(`getMetricValue: обычный режим (год=${year}, квартал=${quarterParam})`);
    value = getMetricValueInternal(factsData, metric, year, quarterParam, scale, ticker);
  }
  
  if (cache.CACHE_CONFIG.metrics.enabled && value !== null) {
    cache.setToCache(cache.metricsCache, cacheKey, value, cache.CACHE_CONFIG.metrics.ttl, cache.CACHE_CONFIG.metrics.maxSize);
  }
  
  common.log(`getMetricValue: результат = ${value}`);
  return value !== null ? common.applyScale(value, scale) : null;
}

// ============ 5. ЭКСПОРТ ==========

module.exports = {
  getMetricValue,
  METRICS_CATALOG: catalogs.METRICS_CATALOG
};
