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
  revenue: { tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'TotalRevenues'], category: 'P&L', ttm: 'sum', ru: 'Выручка' },
  cogs: { tags: ['CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfSales'], category: 'P&L', ttm: 'sum', ru: 'Себестоимость' },
  grossprofit: { tags: ['GrossProfit'], category: 'P&L', ttm: 'sum', ru: 'Валовая прибыль' },
  rd: { tags: ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessResearchAndDevelopment'], category: 'P&L', ttm: 'sum', ru: 'R&D расходы' },
  sga: { tags: ['SellingGeneralAndAdministrativeExpense'], category: 'P&L', ttm: 'sum', ru: 'SG&A расходы' },
  operatingexpenses: { tags: ['OperatingExpenses'], category: 'P&L', ttm: 'sum', ru: 'Операционные расходы' },
  operatingincome: { tags: ['OperatingIncomeLoss'], category: 'P&L', ttm: 'sum', ru: 'Операционная прибыль' },
  interestincome: { tags: ['InvestmentIncomeInterest', 'InterestIncome'], category: 'P&L', ttm: 'sum', ru: 'Процентный доход' },
  interestexpense: { tags: ['InterestExpense'], category: 'P&L', ttm: 'sum', ru: 'Процентные расходы' },
  otherincome: { tags: ['OtherIncome', 'OtherNonoperatingIncomeExpense'], category: 'P&L', ttm: 'sum', ru: 'Прочие доходы/расходы' },
  incomebeforetax: { tags: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxes', 'IncomeBeforeTax'], category: 'P&L', ttm: 'sum', ru: 'Прибыль до налога' },
  taxexpense: { tags: ['IncomeTaxExpenseBenefit'], category: 'P&L', ttm: 'sum', ru: 'Налог на прибыль' },
  netincome: { tags: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ComprehensiveIncomeNetOfTax'], category: 'P&L', ttm: 'sum', ru: 'Чистая прибыль' },

  // Balance Sheet - Assets
  currentassets: { tags: ['AssetsCurrent'], category: 'Balance', ttm: 'last', ru: 'Оборотные активы' },
  cashandequivalents: { tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalentsAtFairValue', 'CashCashEquivalentsAndShortTermInvestments', 'CashAndDueFromBanks'], category: 'Balance', ttm: 'last', ru: 'Деньги и эквиваленты' },
  shortterminvestments: { tags: ['ShortTermInvestments', 'MarketableSecuritiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Краткосрочные инвестиции' },
  accountsreceivable: { tags: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'], category: 'Balance', ttm: 'last', ru: 'Дебиторская задолженность' },
  inventory: { tags: ['InventoryNet', 'InventoryFinishedGoods', 'InventoryRawMaterialsAndSupplies', 'InventoryWorkInProcessAndFinishedGoods'], category: 'Balance', ttm: 'last', ru: 'Запасы' },
  prepaidexpenses: { tags: ['PrepaidExpenseCurrent', 'OtherAssetsCurrent'], category: 'Balance', ttm: 'last', ru: 'Предоплаченные расходы' },
  othercurrentassets: { tags: ['OtherAssetsCurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие оборотные активы' },
  ppe: { tags: ['PropertyPlantAndEquipmentNet', 'PropertyPlantAndEquipmentGross'], category: 'Balance', ttm: 'last', ru: 'Основные средства' },
  accumulateddepreciation: { tags: ['AccumulatedDepreciationDepletionAndAmortizationPropertyPlantAndEquipment'], category: 'Balance', ttm: 'last', ru: 'Накопленная амортизация' },
  intangibleassets: { tags: ['IntangibleAssetsNetExcludingGoodwill', 'IntangibleAssetsNetIncludingGoodwill'], category: 'Balance', ttm: 'last', ru: 'Нематериальные активы' },
  goodwill: { tags: ['Goodwill'], category: 'Balance', ttm: 'last', ru: 'Гудвилл' },
  longterminvestments: { tags: ['LongTermInvestments', 'MarketableSecuritiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Долгосрочные инвестиции' },
  deferredtaxassets: { tags: ['DeferredTaxAssetsNet'], category: 'Balance', ttm: 'last', ru: 'Отложенные налоговые активы' },
  othernoncurrentassets: { tags: ['OtherAssetsNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие внеоборотные активы' },
  totalassets: { tags: ['Assets'], category: 'Balance', ttm: 'last', ru: 'ВСЕГО АКТИВЫ' },

  // Balance Sheet - Liabilities
  accountspayable: { tags: ['AccountsPayableCurrent', 'AccountsPayableAndAccruedLiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Кредиторская задолженность' },
  accruedliabilities: { tags: ['AccruedLiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Начисленные обязательства' },
  shorttermdebt: { tags: ['ShortTermBorrowings', 'LongTermDebtCurrent', 'CurrentPortionOfLongTermDebt', 'ShortTermBankBorrowings'], category: 'Balance', ttm: 'last', ru: 'Краткосрочный долг' },
  deferredrevenue: { tags: ['DeferredRevenueCurrent', 'ContractWithCustomerLiabilityCurrent'], category: 'Balance', ttm: 'last', ru: 'Деферредный доход' },
  othercurrentliabilities: { tags: ['OtherLiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие краткосрочные обязательства' },
  totalcurrentliabilities: { tags: ['LiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Итого краткосрочные обязательства' },
  longtermdebt: { tags: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'], category: 'Balance', ttm: 'last', ru: 'Долгосрочный долг' },
  deferredtaxliabilities: { tags: ['DeferredTaxLiabilitiesNet'], category: 'Balance', ttm: 'last', ru: 'Отложенные налоговые обязательства' },
  deferredrevenuenoncurrent: { tags: ['DeferredRevenueNoncurrent', 'ContractWithCustomerLiabilityNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Деферредный доход долгосрочный' },
  pensionliabilities: { tags: ['PensionAndOtherPostretirementDefinedBenefitPlansLiabilitiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Пенсионные обязательства' },
  othernoncurrentliabilities: { tags: ['OtherLiabilitiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие долгосрочные обязательства' },
  totalnoncurrentliabilities: { tags: ['LiabilitiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Итого долгосрочные обязательства' },
  totalliabilities: { tags: ['Liabilities'], category: 'Balance', ttm: 'last', ru: 'ВСЕГО ОБЯЗАТЕЛЬСТВА' },

  // Equity
  preferredstock: { tags: ['PreferredStockValue', 'PreferredStockSharesOutstanding'], category: 'Equity', ttm: 'last', ru: 'Привилегированные акции' },
  commonstock: { tags: ['CommonStockValue', 'CommonStocksIncludingAdditionalPaidInCapital'], category: 'Equity', ttm: 'last', ru: 'Обыкновенные акции' },
  additionalpaidincapital: { tags: ['AdditionalPaidInCapital'], category: 'Equity', ttm: 'last', ru: 'Дополнительный капитал' },
  retainedearnings: { tags: ['RetainedEarningsAccumulatedDeficit', 'RetainedEarnings'], category: 'Equity', ttm: 'last', ru: 'Нераспределённая прибыль' },
  accumulatedothercomprehensiveincome: { tags: ['AccumulatedOtherComprehensiveIncomeLossNetOfTax'], category: 'Equity', ttm: 'last', ru: 'Прочий совокупный доход' },
  treasurystock: { tags: ['TreasuryStockValue', 'TreasuryStockCommon'], category: 'Equity', ttm: 'last', ru: 'Казначейские акции' },
  totalequity: { tags: ['StockholdersEquity', 'PartnersCapital', 'MembersEquity', 'Equity'], category: 'Equity', ttm: 'last', ru: 'ВСЕГО КАПИТАЛ' },

  // Cash Flow
  netincomecf: { tags: ['NetIncomeLoss'], category: 'CashFlow', ttm: 'sum', ru: 'Чистая прибыль (для CF)' },
  da: { tags: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'], category: 'CashFlow', ttm: 'sum', ru: 'Амортизация и износ' },
  stockbasedcompensation: { tags: ['ShareBasedCompensation'], category: 'CashFlow', ttm: 'sum', ru: 'Вознаграждение акциями' },
  deferredtax: { tags: ['DeferredIncomeTaxExpenseBenefit'], category: 'CashFlow', ttm: 'sum', ru: 'Отложенные налоги' },
  workingcapitalchanges: { tags: ['IncreaseDecreaseInOperatingCapital'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение оборотного капитала' },
  accountsreceivablechange: { tags: ['IncreaseDecreaseInAccountsReceivable'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение дебиторки' },
  inventorychange: { tags: ['IncreaseDecreaseInInventories'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение запасов' },
  accountspayablechange: { tags: ['IncreaseDecreaseInAccountsPayable'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение кредиторки' },
  otheroperatingactivities: { tags: ['OtherOperatingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'Прочие операционные' },
  operatingcashflow: { tags: ['NetCashProvidedByUsedInOperatingActivities', 'CashGeneratedFromOperatingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'OCF' },
  capex: { tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'CapitalExpendituresIncurredButNotYetPaid', 'PurchaseOfPropertyPlantAndEquipment'], category: 'CashFlow', ttm: 'sum', ru: 'Капекс' },
  acquisitions: { tags: ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'AcquisitionsNetOfCashAcquired'], category: 'CashFlow', ttm: 'sum', ru: 'Приобретения' },
  purchaseofinvestments: { tags: ['PaymentsToAcquireInvestments'], category: 'CashFlow', ttm: 'sum', ru: 'Покупка инвестиций' },
  saleofinvestments: { tags: ['ProceedsFromSaleAndMaturityOfInvestments'], category: 'CashFlow', ttm: 'sum', ru: 'Продажа инвестиций' },
  otherinvestingactivities: { tags: ['OtherInvestingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'Прочие инвестиционные' },
  investingcashflow: { tags: ['NetCashProvidedByUsedInInvestingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'ICF' },
  debtissuance: { tags: ['ProceedsFromIssuanceOfLongTermDebt', 'ProceedsFromBorrowings'], category: 'CashFlow', ttm: 'sum', ru: 'Выпуск долга' },
  debtrepayment: { tags: ['RepaymentsOfLongTermDebt', 'RepaymentsOfDebt'], category: 'CashFlow', ttm: 'sum', ru: 'Погашение долга' },
  stockissuance: { tags: ['ProceedsFromIssuanceOfCommonStock'], category: 'CashFlow', ttm: 'sum', ru: 'Выпуск акций' },
  buybacks: { tags: ['PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity'], category: 'CashFlow', ttm: 'sum', ru: 'Выкуп акций' },
  dividendspaid: { tags: ['PaymentsOfDividends', 'PaymentsOfDividendsToNoncontrollingInterests'], category: 'CashFlow', ttm: 'sum', ru: 'Дивиденды' },
  otherfinancingactivities: { tags: ['OtherFinancingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'Прочие финансовые' },
  financingcashflow: { tags: ['NetCashProvidedByUsedInFinancingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'FCF' },
  effectofexchangerate: { tags: ['EffectOfExchangeRateOnCashAndCashEquivalents'], category: 'CashFlow', ttm: 'sum', ru: 'Влияние курсов валют' },
  netchangeincash: { tags: ['CashAndCashEquivalentsPeriodIncreaseDecrease'], category: 'CashFlow', ttm: 'sum', ru: 'Чистое изменение денег' },
  beginningcash: { tags: ['CashAndCashEquivalentsAtBeginningOfPeriod'], category: 'CashFlow', ttm: 'last', ru: 'Деньги на начало' },
  endingcash: { tags: ['CashAndCashEquivalentsAtEndOfPeriod'], category: 'CashFlow', ttm: 'last', ru: 'Деньги на конец' },

  // Per Share
  sharesbasic: { tags: ['WeightedAverageNumberOfSharesOutstandingBasic'], category: 'PerShare', ttm: 'last', ru: 'Акции basic' },
  sharesdiluted: { tags: ['WeightedAverageNumberOfDilutedSharesOutstanding'], category: 'PerShare', ttm: 'last', ru: 'Акции diluted' },
  sharesoutstanding: { tags: ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'], category: 'PerShare', ttm: 'last', ru: 'Акции в обращении' },
  sharesissued: { tags: ['CommonStockSharesIssued'], category: 'PerShare', ttm: 'last', ru: 'Выпущенные акции' },
  epsbasic: { tags: ['EarningsPerShareBasic'], category: 'PerShare', ttm: 'sum', ru: 'EPS basic' },
  epsdiluted: { tags: ['EarningsPerShareDiluted'], category: 'PerShare', ttm: 'sum', ru: 'EPS diluted' },
  dividendspershare: { tags: ['CommonStockDividendsPerShareDeclared', 'DividendsPerShare'], category: 'PerShare', ttm: 'sum', ru: 'DPS' }
};

// Русские алиасы
const RU_ALIASES = {
  выручка: 'revenue',
  себестоимость: 'cogs',
  валоваяприбыль: 'grossprofit',
  операционнаяприбыль: 'operatingincome',
  чистаяприбыль: 'netincome',
  активы: 'totalassets',
  обязательства: 'totalliabilities',
  капитал: 'totalequity',
  деньги: 'cashandequivalents',
  долг: 'longtermdebt',
  акции: 'sharesoutstanding',
  ocf: 'operatingcashflow',
  fcf: 'financingcashflow',
  капекс: 'capex',
  амортизация: 'da'
};

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============

function resolveMetric(alias) {
  const normalized = alias.toString().trim().toLowerCase().replace(/[\s_-]/g, '');
  
  if (METRICS_CATALOG[normalized]) return normalized;
  if (RU_ALIASES[normalized]) return RU_ALIASES[normalized];
  
  for (const [key, val] of Object.entries(METRICS_CATALOG)) {
    const ruClean = val.ru.toLowerCase().replace(/[\s_]/g, '');
    if (ruClean === normalized) return key;
  }
  
  return null;
}

function normalizeScale(scale) {
  if (!scale) return null;
  const str = String(scale).toLowerCase().trim();
  if (str === 'k' || str === 'т' || str === 'тысячи') return 'k';
  if (str === 'kk' || str === 'м' || str === 'миллионы') return 'kk';
  if (str === 'kkk' || str === 'млрд' || str === 'миллиарды') return 'kkk';
  return null;
}

function normalizeCompare(compare) {
  if (!compare) return null;
  const str = String(compare).toLowerCase().trim();
  if (['yoy', 'yearoveryear', 'годкгоду'].includes(str)) return 'yoy';
  if (['qoq', 'quarteroverquarter', 'квккв'].includes(str)) return 'qoq';
  if (['ytd', 'yeartodate'].includes(str)) return 'ytd';
  return null;
}

// ============ ИСПРАВЛЕННАЯ TTM ЛОГИКА ============

function getTTMValue(sortedValues, metricName) {
  const catalog = METRICS_CATALOG[metricName];
  const ttmType = catalog?.ttm || 'sum';
  
  if (ttmType === 'last') {
    // Balance Sheet — первый элемент (самый свежий, уже отсортирован)
    return sortedValues[0]?.val || null;
  }
  
  // P&L, Cash Flow — сумма первых 4 кварталов (уже отсортированы по дате)
  const quarterly = sortedValues.filter(v => v.fp && v.fp !== 'FY');
  const last4 = quarterly.slice(0, 4);
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

function formatNumber(value) {
  if (value === null || value === undefined) return null;
  return value.toString().replace('.', ',');
}

// ============ РАБОТА С SEC ============

async function getCIK(ticker) {
  if (!tickersCache || Date.now() - tickersCacheTime > TICKERS_CACHE_TTL) {
    const response = await fetch(`${SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    tickersCache = await response.json();
    tickersCacheTime = Date.now();
  }
  
  const upperTicker = ticker.toUpperCase();
  const entry = Object.values(tickersCache).find(t => t.ticker === upperTicker);
  
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

// ============ ИСПРАВЛЕННАЯ ФУНКЦИЯ ПОИСКА ============
function getMetricValue(factsData, metric, year, quarter, scale) {
  const catalog = METRICS_CATALOG[metric];
  if (!catalog) return null;
  
  const usGaap = factsData?.facts?.['us-gaap'];
  if (!usGaap) return null;
  
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
  
  // 🔴 КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: сортируем по дате окончания периода (свежие первые)
  const sorted = values.sort((a, b) => new Date(b.end) - new Date(a.end));
  
  let result = null;
  
  if (year === undefined && quarter === undefined) {
    // TTM — передаём уже отсортированный массив
    result = getTTMValue(sorted, metric);
  } else if (quarter === undefined || quarter === 0 || quarter === null) {
    // Годовой — ищем в ОТСОРТИРОВАННОМ массиве (свежие первые)
    const annual = sorted.find(v => v.fy === year && v.form === '10-K');
    result = annual?.val || null;
  } else {
    // Квартальный — ищем в ОТСОРТИРОВАННОМ массиве
    const quarterMap = { 1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4' };
    const fp = quarterMap[quarter];
    const q = sorted.find(v => v.fy === year && v.fp === fp && v.form === '10-Q');
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
    return getMetricValue(factsData, metric, year - 1, 4, scale);
  }
  
  return null;
}

// ============ ENDPOINTS ============

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

app.get('/metrics/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const year = req.query.year ? parseInt(req.query.year) : undefined;
    const quarter = req.query.quarter !== undefined ? parseInt(req.query.quarter) : undefined;
    const scale = normalizeScale(req.query.scale);
    const compare = normalizeCompare(req.query.compare);
    
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
    
    const cik = await getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    const factsData = await getCompanyFacts(cik);
    if (!factsData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    const results = {};
    
    for (const metric of resolvedMetrics) {
      const value = await getMetricValueWithCache(cik, metric, year, quarter, scale, factsData);
      
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

app.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
