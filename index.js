const express = require('express');
const fetch = require('node-fetch');

const app = express();

// Конфигурация
const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// Кэши
let tickersCache = null;
let tickersCacheTime = 0;
const TICKERS_CACHE_TTL = 3600000;

const metricsCache = new Map();
const METRICS_CACHE_TTL = 3600000;

// ============ ПОЛНЫЙ СПРАВОЧНИК МЕТРИК ============
const METRICS_CATALOG = {
  // P&L
  Revenue: { tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'TotalRevenues'], category: 'P&L', ttm: 'sum', ru: 'Выручка' },
  COGS: { tags: ['CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfSales'], category: 'P&L', ttm: 'sum', ru: 'Себестоимость' },
  GrossProfit: { tags: ['GrossProfit'], category: 'P&L', ttm: 'sum', ru: 'Валовая прибыль' },
  RD: { tags: ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessResearchAndDevelopment'], category: 'P&L', ttm: 'sum', ru: 'R&D расходы' },
  SGA: { tags: ['SellingGeneralAndAdministrativeExpense'], category: 'P&L', ttm: 'sum', ru: 'SG&A расходы' },
  OperatingExpenses: { tags: ['OperatingExpenses'], category: 'P&L', ttm: 'sum', ru: 'Операционные расходы' },
  OperatingIncome: { tags: ['OperatingIncomeLoss'], category: 'P&L', ttm: 'sum', ru: 'Операционная прибыль' },
  InterestIncome: { tags: ['InvestmentIncomeInterest', 'InterestIncome'], category: 'P&L', ttm: 'sum', ru: 'Процентный доход' },
  InterestExpense: { tags: ['InterestExpense'], category: 'P&L', ttm: 'sum', ru: 'Процентные расходы' },
  OtherIncome: { tags: ['OtherIncome', 'OtherNonoperatingIncomeExpense'], category: 'P&L', ttm: 'sum', ru: 'Прочие доходы/расходы' },
  IncomeBeforeTax: { tags: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxes', 'IncomeBeforeTax'], category: 'P&L', ttm: 'sum', ru: 'Прибыль до налога' },
  TaxExpense: { tags: ['IncomeTaxExpenseBenefit'], category: 'P&L', ttm: 'sum', ru: 'Налог на прибыль' },
  NetIncome: { tags: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ComprehensiveIncomeNetOfTax'], category: 'P&L', ttm: 'sum', ru: 'Чистая прибыль' },

  // Balance Sheet - Assets
  CurrentAssets: { tags: ['AssetsCurrent'], category: 'Balance', ttm: 'last', ru: 'Оборотные активы' },
  CashAndEquivalents: { tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalentsAtFairValue', 'CashCashEquivalentsAndShortTermInvestments', 'CashAndDueFromBanks'], category: 'Balance', ttm: 'last', ru: 'Деньги и эквиваленты' },
  ShortTermInvestments: { tags: ['ShortTermInvestments', 'MarketableSecuritiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Краткосрочные инвестиции' },
  AccountsReceivable: { tags: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'], category: 'Balance', ttm: 'last', ru: 'Дебиторская задолженность' },
  Inventory: { tags: ['InventoryNet', 'InventoryFinishedGoods', 'InventoryRawMaterialsAndSupplies', 'InventoryWorkInProcessAndFinishedGoods'], category: 'Balance', ttm: 'last', ru: 'Запасы' },
  PrepaidExpenses: { tags: ['PrepaidExpenseCurrent', 'OtherAssetsCurrent'], category: 'Balance', ttm: 'last', ru: 'Предоплаченные расходы' },
  OtherCurrentAssets: { tags: ['OtherAssetsCurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие оборотные активы' },
  PPE: { tags: ['PropertyPlantAndEquipmentNet', 'PropertyPlantAndEquipmentGross'], category: 'Balance', ttm: 'last', ru: 'Основные средства' },
  AccumulatedDepreciation: { tags: ['AccumulatedDepreciationDepletionAndAmortizationPropertyPlantAndEquipment'], category: 'Balance', ttm: 'last', ru: 'Накопленная амортизация' },
  IntangibleAssets: { tags: ['IntangibleAssetsNetExcludingGoodwill', 'IntangibleAssetsNetIncludingGoodwill'], category: 'Balance', ttm: 'last', ru: 'Нематериальные активы' },
  Goodwill: { tags: ['Goodwill'], category: 'Balance', ttm: 'last', ru: 'Гудвилл' },
  LongTermInvestments: { tags: ['LongTermInvestments', 'MarketableSecuritiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Долгосрочные инвестиции' },
  DeferredTaxAssets: { tags: ['DeferredTaxAssetsNet'], category: 'Balance', ttm: 'last', ru: 'Отложенные налоговые активы' },
  OtherNonCurrentAssets: { tags: ['OtherAssetsNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие внеоборотные активы' },
  TotalAssets: { tags: ['Assets'], category: 'Balance', ttm: 'last', ru: 'ВСЕГО АКТИВЫ' },

  // Balance Sheet - Liabilities
  AccountsPayable: { tags: ['AccountsPayableCurrent', 'AccountsPayableAndAccruedLiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Кредиторская задолженность' },
  AccruedLiabilities: { tags: ['AccruedLiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Начисленные обязательства' },
  ShortTermDebt: { tags: ['ShortTermBorrowings', 'LongTermDebtCurrent', 'CurrentPortionOfLongTermDebt', 'ShortTermBankBorrowings'], category: 'Balance', ttm: 'last', ru: 'Краткосрочный долг' },
  DeferredRevenue: { tags: ['DeferredRevenueCurrent', 'ContractWithCustomerLiabilityCurrent'], category: 'Balance', ttm: 'last', ru: 'Деферредный доход' },
  OtherCurrentLiabilities: { tags: ['OtherLiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие краткосрочные обязательства' },
  TotalCurrentLiabilities: { tags: ['LiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Итого краткосрочные обязательства' },
  LongTermDebt: { tags: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'], category: 'Balance', ttm: 'last', ru: 'Долгосрочный долг' },
  DeferredTaxLiabilities: { tags: ['DeferredTaxLiabilitiesNet'], category: 'Balance', ttm: 'last', ru: 'Отложенные налоговые обязательства' },
  DeferredRevenueNonCurrent: { tags: ['DeferredRevenueNoncurrent', 'ContractWithCustomerLiabilityNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Деферредный доход долгосрочный' },
  PensionLiabilities: { tags: ['PensionAndOtherPostretirementDefinedBenefitPlansLiabilitiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Пенсионные обязательства' },
  OtherNonCurrentLiabilities: { tags: ['OtherLiabilitiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие долгосрочные обязательства' },
  TotalNonCurrentLiabilities: { tags: ['LiabilitiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Итого долгосрочные обязательства' },
  TotalLiabilities: { tags: ['Liabilities'], category: 'Balance', ttm: 'last', ru: 'ВСЕГО ОБЯЗАТЕЛЬСТВА' },

  // Equity
  PreferredStock: { tags: ['PreferredStockValue', 'PreferredStockSharesOutstanding'], category: 'Equity', ttm: 'last', ru: 'Привилегированные акции' },
  CommonStock: { tags: ['CommonStockValue', 'CommonStocksIncludingAdditionalPaidInCapital'], category: 'Equity', ttm: 'last', ru: 'Обыкновенные акции' },
  AdditionalPaidInCapital: { tags: ['AdditionalPaidInCapital'], category: 'Equity', ttm: 'last', ru: 'Дополнительный капитал' },
  RetainedEarnings: { tags: ['RetainedEarningsAccumulatedDeficit', 'RetainedEarnings'], category: 'Equity', ttm: 'last', ru: 'Нераспределённая прибыль' },
  AccumulatedOtherComprehensiveIncome: { tags: ['AccumulatedOtherComprehensiveIncomeLossNetOfTax'], category: 'Equity', ttm: 'last', ru: 'Прочий совокупный доход' },
  TreasuryStock: { tags: ['TreasuryStockValue', 'TreasuryStockCommon'], category: 'Equity', ttm: 'last', ru: 'Казначейские акции' },
  TotalEquity: { tags: ['StockholdersEquity', 'PartnersCapital', 'MembersEquity', 'Equity'], category: 'Equity', ttm: 'last', ru: 'ВСЕГО КАПИТАЛ' },

  // Cash Flow
  NetIncomeCF: { tags: ['NetIncomeLoss'], category: 'CashFlow', ttm: 'sum', ru: 'Чистая прибыль (для CF)' },
  DA: { tags: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'], category: 'CashFlow', ttm: 'sum', ru: 'Амортизация и износ' },
  StockBasedCompensation: { tags: ['ShareBasedCompensation'], category: 'CashFlow', ttm: 'sum', ru: 'Вознаграждение акциями' },
  DeferredTax: { tags: ['DeferredIncomeTaxExpenseBenefit'], category: 'CashFlow', ttm: 'sum', ru: 'Отложенные налоги' },
  WorkingCapitalChanges: { tags: ['IncreaseDecreaseInOperatingCapital'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение оборотного капитала' },
  AccountsReceivableChange: { tags: ['IncreaseDecreaseInAccountsReceivable'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение дебиторки' },
  InventoryChange: { tags: ['IncreaseDecreaseInInventories'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение запасов' },
  AccountsPayableChange: { tags: ['IncreaseDecreaseInAccountsPayable'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение кредиторки' },
  OtherOperatingActivities: { tags: ['OtherOperatingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'Прочие операционные' },
  OperatingCashFlow: { tags: ['NetCashProvidedByUsedInOperatingActivities', 'CashGeneratedFromOperatingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'OCF' },
  CapEx: { tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'CapitalExpendituresIncurredButNotYetPaid', 'PurchaseOfPropertyPlantAndEquipment'], category: 'CashFlow', ttm: 'sum', ru: 'Капекс' },
  Acquisitions: { tags: ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'AcquisitionsNetOfCashAcquired'], category: 'CashFlow', ttm: 'sum', ru: 'Приобретения' },
  PurchaseOfInvestments: { tags: ['PaymentsToAcquireInvestments'], category: 'CashFlow', ttm: 'sum', ru: 'Покупка инвестиций' },
  SaleOfInvestments: { tags: ['ProceedsFromSaleAndMaturityOfInvestments'], category: 'CashFlow', ttm: 'sum', ru: 'Продажа инвестиций' },
  OtherInvestingActivities: { tags: ['OtherInvestingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'Прочие инвестиционные' },
  InvestingCashFlow: { tags: ['NetCashProvidedByUsedInInvestingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'ICF' },
  DebtIssuance: { tags: ['ProceedsFromIssuanceOfLongTermDebt', 'ProceedsFromBorrowings'], category: 'CashFlow', ttm: 'sum', ru: 'Выпуск долга' },
  DebtRepayment: { tags: ['RepaymentsOfLongTermDebt', 'RepaymentsOfDebt'], category: 'CashFlow', ttm: 'sum', ru: 'Погашение долга' },
  StockIssuance: { tags: ['ProceedsFromIssuanceOfCommonStock'], category: 'CashFlow', ttm: 'sum', ru: 'Выпуск акций' },
  Buybacks: { tags: ['PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity'], category: 'CashFlow', ttm: 'sum', ru: 'Выкуп акций' },
  DividendsPaid: { tags: ['PaymentsOfDividends', 'PaymentsOfDividendsToNoncontrollingInterests'], category: 'CashFlow', ttm: 'sum', ru: 'Дивиденды' },
  OtherFinancingActivities: { tags: ['OtherFinancingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'Прочие финансовые' },
  FinancingCashFlow: { tags: ['NetCashProvidedByUsedInFinancingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'FCF' },
  EffectOfExchangeRate: { tags: ['EffectOfExchangeRateOnCashAndCashEquivalents'], category: 'CashFlow', ttm: 'sum', ru: 'Влияние курсов валют' },
  NetChangeInCash: { tags: ['CashAndCashEquivalentsPeriodIncreaseDecrease'], category: 'CashFlow', ttm: 'sum', ru: 'Чистое изменение денег' },
  BeginningCash: { tags: ['CashAndCashEquivalentsAtBeginningOfPeriod'], category: 'CashFlow', ttm: 'last', ru: 'Деньги на начало' },
  EndingCash: { tags: ['CashAndCashEquivalentsAtEndOfPeriod'], category: 'CashFlow', ttm: 'last', ru: 'Деньги на конец' },

  // Per Share
  SharesBasic: { tags: ['WeightedAverageNumberOfSharesOutstandingBasic'], category: 'PerShare', ttm: 'last', ru: 'Акции basic' },
  SharesDiluted: { tags: ['WeightedAverageNumberOfDilutedSharesOutstanding'], category: 'PerShare', ttm: 'last', ru: 'Акции diluted' },
  SharesOutstanding: { tags: ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'], category: 'PerShare', ttm: 'last', ru: 'Акции в обращении' },
  SharesIssued: { tags: ['CommonStockSharesIssued'], category: 'PerShare', ttm: 'last', ru: 'Выпущенные акции' },
  EPSBasic: { tags: ['EarningsPerShareBasic'], category: 'PerShare', ttm: 'sum', ru: 'EPS basic' },
  EPSDiluted: { tags: ['EarningsPerShareDiluted'], category: 'PerShare', ttm: 'sum', ru: 'EPS diluted' },
  DividendsPerShare: { tags: ['CommonStockDividendsPerShareDeclared', 'DividendsPerShare'], category: 'PerShare', ttm: 'sum', ru: 'DPS' }
};

// Русские алиасы
const RU_ALIASES = {
  'выручка': 'Revenue',
  'себестоимость': 'COGS',
  'валоваяприбыль': 'GrossProfit',
  'операционнаяприбыль': 'OperatingIncome',
  'чистаяприбыль': 'NetIncome',
  'активы': 'TotalAssets',
  'обязательства': 'TotalLiabilities',
  'капитал': 'TotalEquity',
  'деньги': 'CashAndEquivalents',
  'долг': 'LongTermDebt',
  'акции': 'SharesOutstanding',
  'ocf': 'OperatingCashFlow',
  'fcf': 'FreeCashFlow',
  'капекс': 'CapEx',
  'выручка': 'Revenue',
  'амортизация': 'DA'
};

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============

function resolveMetric(alias) {
  const normalized = alias.toString().trim();
  const lower = normalized.toLowerCase();
  
  // Прямое совпадение
  if (METRICS_CATALOG[normalized]) return normalized;
  
  // Русский алиас
  if (RU_ALIASES[lower]) return RU_ALIASES[lower];
  
  // Поиск по русскому названию
  for (const [key, val] of Object.entries(METRICS_CATALOG)) {
    if (val.ru.toLowerCase() === lower) return key;
  }
  
  return null;
}

function getTTMValue(values, metricName) {
  const catalog = METRICS_CATALOG[metricName];
  const ttmType = catalog?.ttm || 'sum';
  
  if (ttmType === 'last') {
    // Balance Sheet, Equity, EndingCash — последнее значение
    const sorted = values.sort((a, b) => new Date(b.end) - new Date(a.end));
    return sorted[0]?.val || null;
  }
  
  // P&L, Cash Flow — сумма последних 4 кварталов
  const quarterly = values.filter(v => v.fp && v.fp !== 'FY');
  const sorted = quarterly.sort((a, b) => new Date(b.end) - new Date(a.end));
  const last4 = sorted.slice(0, 4);
  if (last4.length === 0) return null;
  return last4.reduce((acc, v) => acc + v.val, 0);
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

// Форматирование с запятой
function formatNumber(value) {
  if (value === null || value === undefined) return null;
  // Заменяем точку на запятую для десятичного разделителя
  return value.toString().replace('.', ',');
}

// ============ ENDPOINTS ============

// Справочник метрик (Вариант А)
app.get('/catalog', (req, res) => {
  const list = [];
  for (const [key, val] of Object.entries(METRICS_CATALOG)) {
    list.push({
      alias: key,
      ru: val.ru,
      category: val.category,
      ttm: val.ttm,
      tags: val.tags
    });
  }
  res.json({ metrics: list, count: list.length });
});

// Проверка метрики (Вариант В)
app.get('/validate/:metric', (req, res) => {
  const resolved = resolveMetric(req.params.metric);
  if (!resolved) {
    const available = Object.keys(METRICS_CATALOG).join(', ');
    return res.status(404).json({ 
      error: 'Метрика не найдена',
      available: available,
      count: Object.keys(METRICS_CATALOG).length
    });
  }
  res.json({ 
    valid: true, 
    metric: resolved,
    info: METRICS_CATALOG[resolved]
  });
});

// Основной endpoint для метрик
app.get('/metrics/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const year = req.query.year ? parseInt(req.query.year) : undefined;
    const quarter = req.query.quarter !== undefined ? parseInt(req.query.quarter) : undefined;
    const scale = req.query.scale || null;
    const compare = req.query.compare || null; // yoy, qoq, ytd
    
    // Разбираем метрики
    let rawMetrics = req.query.metrics || req.query.metric;
    if (!rawMetrics) {
      return res.status(400).json({ 
        error: 'Укажите metric или metrics',
        hint: 'Используйте /catalog для списка метрик'
      });
    }
    
    const metricsList = rawMetrics.split('/').map(m => m.trim());
    const resolvedMetrics = [];
    const notFound = [];
    
    for (const m of metricsList) {
      const resolved = resolveMetric(m);
      if (resolved) {
        resolvedMetrics.push(resolved);
      } else {
        notFound.push(m);
      }
    }
    
    if (resolvedMetrics.length === 0) {
      return res.status(404).json({
        error: 'Метрики не найдены',
        notFound: notFound,
        available: Object.keys(METRICS_CATALOG).slice(0, 20).join(', ') + '...',
        totalAvailable: Object.keys(METRICS_CATALOG).length
      });
    }
    
    // Получаем данные
    const cik = await getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    const factsData = await getCompanyFacts(cik);
    if (!factsData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    const results = {};
    
    for (const metric of resolvedMetrics) {
      const value = await getMetricValueWithCache(cik, metric, year, quarter, scale, factsData);
      
      // Сравнение периодов
      if (compare && value !== null) {
        const compareValue = await getCompareValue(cik, metric, year, quarter, scale, compare, factsData);
        results[metric] = {
          value: formatNumber(value),
          compare: compare,
          compareValue: compareValue !== null ? formatNumber(compareValue) : null,
          change: compareValue !== null ? formatNumber((value - compareValue) / Math.abs(compareValue)) : null
        };
      } else {
        results[metric] = formatNumber(value);
      }
    }
    
    res.json({
      ticker: ticker,
      year: year || null,
      quarter: quarter || null,
      scale: scale,
      metrics: results,
      notFound: notFound.length > 0 ? notFound : undefined
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ОСТАЛЬНЫЕ ФУНКЦИИ ============

async function getCIK(ticker) {
  if (!tickersCache || Date.now() - tickersCacheTime > TICKERS_CACHE_TTL) {
    const response = await fetch(`${SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    tickersCache = await response.json();
    tickersCacheTime = Date.now();
  }
  
  const entry = Object.values(tickersCache).find(
    t => t.ticker === ticker.toUpperCase()
  );
  
  if (!entry) return null;
  return entry.cik_str.toString().padStart(10, '0');
}

async function getCompanyFacts(cik) {
  const url = `${DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) return null;
  return response.json();
}

async function getMetricValueWithCache(cik, metric, year, quarter, scale, factsData) {
  const cacheKey = `${cik}:${metric}:${year}:${quarter}:${scale}`;
  const cached = metricsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.time < METRICS_CACHE_TTL) {
    return cached.data;
  }
  
  const value = getMetricValue(factsData, metric, year, quarter, scale);
  metricsCache.set(cacheKey, { data: value, time: Date.now() });
  return value;
}

function getMetricValue(factsData, metric, year, quarter, scale) {
  const catalog = METRICS_CATALOG[metric];
  if (!catalog) return null;
  
  const usGaap = factsData?.facts?.['us-gaap'];
  if (!usGaap) return null;
  
  // Ищем по всем тегам
  let tagData = null;
  for (const tag of catalog.tags) {
    if (usGaap[tag]) {
      tagData = usGaap[tag];
      break;
    }
  }
  
  if (!tagData) return null;
  
  const units = tagData.units;
  const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                  Object.keys(units).find(k => k.includes('shares')) ||
                  Object.keys(units).find(k => k.includes('pure')) ||
                  Object.keys(units)[0];
  const values = units[unitKey];
  if (!values || values.length === 0) return null;
  
  let result = null;
  
  // TTM
  if (year === undefined && quarter === undefined) {
    result = getTTMValue(values, metric);
  } else if (quarter === undefined || quarter === 0) {
    // Годовой
    const annual = values.find(v => v.fy === year && v.form === '10-K');
    result = annual?.val || null;
  } else {
    // Квартальный
    const quarterMap = { 1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4' };
    const fp = quarterMap[quarter];
    const q = values.find(v => v.fy === year && v.fp === fp && v.form === '10-Q');
    result = q?.val || null;
  }
  
  return applyScale(result, scale);
}

async function getCompareValue(cik, metric, year, quarter, scale, compare, factsData) {
  if (!year) return null;
  
  if (compare === 'yoy') {
    return getMetricValue(factsData, metric, year - 1, quarter, scale);
  }
  
  if (compare === 'qoq' && quarter && quarter > 1) {
    return getMetricValue(factsData, metric, year, quarter - 1, scale);
  }
  
  if (compare === 'qoq' && quarter === 1) {
    // Q1 vs Q4 прошлого года
    return getMetricValue(factsData, metric, year - 1, 4, scale);
  }
  
  return null;
}

// Health check
app.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
