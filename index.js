const express = require('express');
const fetch = require('node-fetch');

const app = express();

// ============ КОНСТАНТЫ ============
// Константы для длительности кварталов (в днях)
const QUARTER_DAYS = {
  1: { min: 80, max: 100 },   // Q1: 3 месяца
  2: { min: 160, max: 200 },  // Q2: 6 месяцев (YTD)
  3: { min: 250, max: 290 },  // Q3: 9 месяцев (YTD)
  4: { min: 350, max: 370 }   // Q4: 12 месяцев
};

// ============ НАСТРОЙКИ КЭШЕЙ ============
// Каждый кэш можно включить/выключить, настроить TTL и максимальный размер
const CACHE_CONFIG = {
  // Список всех компаний (тикер → CIK)
  tickersCache: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 1 }, //24 часа
  // Быстрые контакты (тикер → CIK) для частых запросов
  cikCache: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 500 },
  // Полные финансовые данные компании (companyfacts) - САМЫЙ ВАЖНЫЙ
  factsCache: { enabled: true, ttl: 6 * 60 * 60 * 1000, maxSize: 20 },
  // Результаты конкретных запросов (тикер+метрика+год+квартал → значение)
  metricsCache: { enabled: true, ttl: 5 * 60 * 1000, maxSize: 1000 },
  // История всех отчётов компании (submissions)
  submissionsCache: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 20 },
  // Метаданные компании (только fiscalYearEnd, name и т.д.)
  companyMetaCache: { enabled: true, ttl: 24 * 60 * 60 * 1000, maxSize: 500 },
  // Перевод строки квартала в объект (q1 → {type:'quarter', num:1})
  quarterParseCache: { enabled: true, ttl: Infinity, maxSize: 50 },
  // Вычисление количества дней между датами (пока отключён)
  durationCache: { enabled: false, ttl: Infinity, maxSize: 1000 },
  // Все значения метрики из всех тегов (дублирует factsCache, отключён)
  collectAllTagValuesCache: { enabled: false, ttl: 6 * 60 * 60 * 1000, maxSize: 50 },
  // Значения одного конкретного тега (дублирует factsCache, отключён)
  getMetricValuesArrayCache: { enabled: false, ttl: 6 * 60 * 60 * 1000, maxSize: 200 }
};

// ============ КОНФИГУРАЦИЯ ============
const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// Кэши (переменные)
let tickersCache = null;
let tickersCacheTime = 0;

const cikCache = new Map();              // тикер → CIK
const factsCache = new Map();            // CIK → companyfacts JSON
const metricsCache = new Map();          // ключ → значение метрики
const submissionsCache = new Map();      // CIK → submissions JSON
const companyMetaCache = new Map();      // CIK → { fiscalYearEnd, name, category, stateOfIncorporation }
const quarterParseCache = new Map();     // строка → объект квартала
const durationCache = new Map();         // start|end → количество дней
const collectAllTagValuesCache = new Map(); // ключ → массив значений
const getMetricValuesArrayCache = new Map(); // ключ → массив значений

// ============ ПОЛНЫЙ СПРАВОЧНИК МЕТРИК ============
const METRICS_CATALOG = {
  // P&L
  revenue: { tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenue', 'RevenuesNetOfInterestExpense'], compute: ['InterestIncomeExpenseNet', 'NoninterestIncome'], operation: 'sum', category: 'P&L', ttm: 'sum', ru: 'Выручка' },
  cogs: { tags: ['CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfSales', 'CostsAndExpenses', 'CostOfServices'], category: 'P&L', ttm: 'sum', ru: 'Себестоимость' },
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
  totalassets: { tags: ['Assets'], category: 'Balance', ttm: 'last', ru: 'ВСЕГО АКТИВЫ' },
  currentassets: { tags: ['AssetsCurrent'], category: 'Balance', ttm: 'last', ru: 'Оборотные активы' },
  cashandequivalents: { tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalentsAtFairValue', 'CashCashEquivalentsAndShortTermInvestments', 'CashAndDueFromBanks'], category: 'Balance', ttm: 'last', ru: 'Деньги и эквиваленты' },
  shortterminvestments: { tags: ['MarketableSecuritiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Краткосрочные инвестиции' },
  accountsreceivable: { tags: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'], category: 'Balance', ttm: 'last', ru: 'Дебиторская задолженность' },
  inventory: { tags: ['InventoryNet', 'InventoryFinishedGoods', 'InventoryRawMaterialsAndSupplies', 'InventoryWorkInProcessAndFinishedGoods'], category: 'Balance', ttm: 'last', ru: 'Запасы' },
  prepaidexpenses: { tags: ['PrepaidExpenseCurrent', 'OtherAssetsCurrent'], category: 'Balance', ttm: 'last', ru: 'Предоплаченные расходы' },
  othercurrentassets: { tags: ['OtherAssetsCurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие оборотные активы' },
    
  noncurrentassets: { tags: ['AssetsNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Внеоборотные активы' },
  ppe: { tags: ['PropertyPlantAndEquipmentNet', 'PropertyPlantAndEquipmentAndOperatingLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization', 'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization'], category: 'Balance', ttm: 'last', ru: 'Основные средства' },
  intangibleassets: { tags: ['IntangibleAssetsNetExcludingGoodwill', 'IntangibleAssetsNetIncludingGoodwill'], category: 'Balance', ttm: 'last', ru: 'Нематериальные активы' },
  goodwill: { tags: ['Goodwill'], category: 'Balance', ttm: 'last', ru: 'Гудвилл' }, 
  longterminvestments: { tags: ['LongTermInvestments', 'MarketableSecuritiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Долгосрочные инвестиции' },
  accumulateddepreciation: { tags: ['AccumulatedDepreciationDepletionAndAmortizationPropertyPlantAndEquipment'], category: 'Balance', ttm: 'last', ru: 'Накопленная амортизация' },
  deferredtaxassets: { tags: ['DeferredTaxAssetsNet'], category: 'Balance', ttm: 'last', ru: 'Отложенные налоговые активы' },
  othernoncurrentassets: { tags: ['OtherAssetsNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие внеоборотные активы' },

  // Balance Sheet - Liabilities
  totalliabilities: { tags: ['Liabilities'], category: 'Balance', ttm: 'last', ru: 'ВСЕГО ОБЯЗАТЕЛЬСТВА' },
  totalcurrentliabilities: { tags: ['LiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Итого краткосрочные обязательства' },
  accountspayable: { tags: ['AccountsPayableCurrent'], category: 'Balance', ttm: 'last', ru: 'Кредиторская задолженность' },
  accruedliabilities: { tags: ['AccruedLiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Начисленные обязательства' },
  apal: { tags: ['AccountsPayableAndAccruedLiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Кредиторская задолженность и начисленные обязательства' },
  shorttermdebt: { tags: ['ShortTermBorrowings', 'LongTermDebtCurrent', 'CurrentPortionOfLongTermDebt', 'ShortTermBankBorrowings'], category: 'Balance', ttm: 'last', ru: 'Краткосрочный долг' },
  deferredrevenue: { tags: ['DeferredRevenueCurrent', 'ContractWithCustomerLiabilityCurrent'], category: 'Balance', ttm: 'last', ru: 'Деферредный доход' },
  othercurrentliabilities: { tags: ['OtherLiabilitiesCurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие краткосрочные обязательства' },
  
  totalnoncurrentliabilities: { tags: ['LiabilitiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Итого долгосрочные обязательства' },
  longtermdebt: { tags: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'], category: 'Balance', ttm: 'last', ru: 'Долгосрочный долг' },
  deferredtaxliabilities: { tags: ['DeferredTaxLiabilitiesNet'], category: 'Balance', ttm: 'last', ru: 'Отложенные налоговые обязательства' },
  deferredrevenuenoncurrent: { tags: ['DeferredRevenueNoncurrent', 'ContractWithCustomerLiabilityNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Деферредный доход долгосрочный' },
  pensionliabilities: { tags: ['PensionAndOtherPostretirementDefinedBenefitPlansLiabilitiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Пенсионные обязательства' },
  othernoncurrentliabilities: { tags: ['OtherLiabilitiesNoncurrent'], category: 'Balance', ttm: 'last', ru: 'Прочие долгосрочные обязательства' },
  
  // Equity
  preferredstock: { tags: ['PreferredStockValue', 'PreferredStockSharesOutstanding'], category: 'Equity', ttm: 'last', ru: 'Привилегированные акции' },
  commonstock: { tags: ['CommonStockValue', 'CommonStocksIncludingAdditionalPaidInCapital'], category: 'Equity', ttm: 'last', ru: 'Обыкновенные акции' },
  additionalpaidincapital: { tags: ['AdditionalPaidInCapital'], category: 'Equity', ttm: 'last', ru: 'Дополнительный капитал' },
  retainedearnings: { tags: ['RetainedEarningsAccumulatedDeficit', 'RetainedEarnings'], category: 'Equity', ttm: 'last', ru: 'Нераспределённая прибыль' },
  accumulatedothercomprehensiveincome: { tags: ['AccumulatedOtherComprehensiveIncomeLossNetOfTax'], category: 'Equity', ttm: 'last', ru: 'Прочий совокупный доход' },
  treasurystock: { tags: ['TreasuryStockValue', 'TreasuryStockCommon'], category: 'Equity', ttm: 'last', ru: 'Казначейские акции' },
  totalequity: { tags: ['StockholdersEquity', 'PartnersCapital', 'MembersEquity', 'Equity'], category: 'Equity', ttm: 'last', ru: 'ВСЕГО КАПИТАЛ' },

  // Cash Flow
  ocf: { tags: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'CashFlowsFromUsedInOperatingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'OCF' },
  icf: { tags: ['NetCashProvidedByUsedInInvestingActivities', 'CashFlowsFromUsedInInvestingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'ICF' },
  fcf: { tags: ['NetCashProvidedByUsedInFinancingActivities', 'CashFlowsFromUsedInFinancingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'FCF' },

  netchangeincash: { tags: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect'], compute: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseExcludingExchangeRateEffect', 'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'IncreaseDecreaseInCashAndCashEquivalentsBeforeEffectOfExchangeRateChanges', 'EffectOfExchangeRateChangesOnCashAndCashEquivalents'], operation: 'sum', category: 'CashFlow', ttm: 'sum', ru: 'Чистое изменение денег' },
  da: { tags: ['DepreciationDepletionAndAmortization', 'Depreciation', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'DepreciationAndAmortizationExcludingDebtIssuanceCosts', 'AmortizationOfIntangibleAssets', 'DepreciationAmortizationDecommissioning'], category: 'CashFlow', ttm: 'sum', ru: 'Амортизация и износ' },
  
  netincomecf: { tags: ['NetIncomeLoss'], category: 'CashFlow', ttm: 'sum', ru: 'Чистая прибыль (для CF)' },
 
  stockbasedcompensation: { tags: ['ShareBasedCompensation'], category: 'CashFlow', ttm: 'sum', ru: 'Вознаграждение акциями' },
  deferredtax: { tags: ['DeferredIncomeTaxExpenseBenefit'], category: 'CashFlow', ttm: 'sum', ru: 'Отложенные налоги' },
  workingcapitalchanges: { tags: ['IncreaseDecreaseInOperatingCapital'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение оборотного капитала' },
  accountsreceivablechange: { tags: ['IncreaseDecreaseInAccountsReceivable'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение дебиторки' },
  inventorychange: { tags: ['IncreaseDecreaseInInventories'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение запасов' },
  accountspayablechange: { tags: ['IncreaseDecreaseInAccountsPayable'], category: 'CashFlow', ttm: 'sum', ru: 'Изменение кредиторки' },
  otheroperatingactivities: { tags: ['OtherOperatingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'Прочие операционные' },
  capex: { tags: ['PaymentsToAcquirePropertyPlantAndEquipment', 'CapitalExpendituresIncurredButNotYetPaid', 'PurchaseOfPropertyPlantAndEquipment'], category: 'CashFlow', ttm: 'sum', ru: 'Капекс' },
  acquisitions: { tags: ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'AcquisitionsNetOfCashAcquired'], category: 'CashFlow', ttm: 'sum', ru: 'Приобретения' },
  purchaseofinvestments: { tags: ['PaymentsToAcquireInvestments'], category: 'CashFlow', ttm: 'sum', ru: 'Покупка инвестиций' },
  saleofinvestments: { tags: ['ProceedsFromSaleAndMaturityOfInvestments'], category: 'CashFlow', ttm: 'sum', ru: 'Продажа инвестиций' },
  otherinvestingactivities: { tags: ['OtherInvestingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'Прочие инвестиционные' },
  
  debtissuance: { tags: ['ProceedsFromIssuanceOfLongTermDebt', 'ProceedsFromBorrowings'], category: 'CashFlow', ttm: 'sum', ru: 'Выпуск долга' },
  debtrepayment: { tags: ['RepaymentsOfLongTermDebt', 'RepaymentsOfDebt'], category: 'CashFlow', ttm: 'sum', ru: 'Погашение долга' },
  stockissuance: { tags: ['ProceedsFromIssuanceOfCommonStock'], category: 'CashFlow', ttm: 'sum', ru: 'Выпуск акций' },
  buybacks: { tags: ['PaymentsForRepurchaseOfCommonStock', 'PaymentsForRepurchaseOfEquity'], category: 'CashFlow', ttm: 'sum', ru: 'Выкуп акций' },
  dividendspaid: { tags: ['PaymentsOfDividends', 'PaymentsOfDividendsToNoncontrollingInterests'], category: 'CashFlow', ttm: 'sum', ru: 'Дивиденды' },
  otherfinancingactivities: { tags: ['OtherFinancingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'Прочие финансовые' },
  
  effectofexchangerate: { tags: ['EffectOfExchangeRateOnCashAndCashEquivalents'], category: 'CashFlow', ttm: 'sum', ru: 'Влияние курсов валют' },
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
  ocf: 'ocf',
  fcf: 'fcf',
  капекс: 'capex',
  амортизация: 'da'
};

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============

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

function filterReportsWithFiled(values) {
  const reportForms = ['10-K', '10-Q', '20-F', '40-F', '6-K'];
  return values.filter(v => reportForms.includes(v.form) && v.filed);
}

function findAnnualReport(values, year) {
  const forms = ['10-K', '20-F', '40-F'];
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

// Дедупликация записей по ключу (выбираем запись с самой свежей filed)
function deduplicateByKey(values, getKey) {
  const map = new Map();
  for (const v of values) {
    const key = getKey(v);
    const existing = map.get(key);
    if (!existing || safeDateValue(v.filed) > safeDateValue(existing.filed)) {
      map.set(key, v);
    }
  }
  return Array.from(map.values());
}

// Безопасное получение дней между датами (с кэшем)
function getDaysDifference(start, end) {
  if (!CACHE_CONFIG.durationCache.enabled) {
    return (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24);
  }
  
  const key = `${start}|${end}`;
  const cached = durationCache.get(key);
  if (cached) return cached;
  
  const days = (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24);
  if (durationCache.size < CACHE_CONFIG.durationCache.maxSize) {
    durationCache.set(key, days);
  }
  return days;
}

// Парсинг строки квартала с кэшем
function parseQuarterStringCached(quarterStr) {
  if (!quarterStr || typeof quarterStr !== 'string') return null;
  
  if (CACHE_CONFIG.quarterParseCache.enabled) {
    const cached = quarterParseCache.get(quarterStr);
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
  
  if (result && CACHE_CONFIG.quarterParseCache.enabled && quarterParseCache.size < CACHE_CONFIG.quarterParseCache.maxSize) {
    quarterParseCache.set(quarterStr, result);
  }
  
  return result;
}

// ============ ПОИСК ТЕГОВ И ЗНАЧЕНИЙ ============

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

function getQuarterFromDate(dateStr) {
  if (!dateStr) return null;
  const month = parseInt(dateStr.substring(5, 7));
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

function buildFilingUrl(cik, accessionNumber, primaryDocument) {
  const cleanCik = cik.replace(/^0+/, '');
  const cleanAcc = accessionNumber.replace(/-/g, '');
  if (primaryDocument) {
    return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/${primaryDocument}`;
  }
  return `https://www.sec.gov/Archives/edgar/data/${cleanCik}/${cleanAcc}/`;
}

// ============ ФУНКЦИИ-ХЕЛПЕРЫ ДЛЯ КЭШИРОВАНИЯ ============

function isCacheValid(cached, ttl) {
  return cached && (Date.now() - cached.time < ttl);
}

function getFromCache(map, key, ttl) {
  if (!map.has(key)) return null;
  const cached = map.get(key);
  if (isCacheValid(cached, ttl)) return cached.data;
  map.delete(key);
  return null;
}

function setToCache(map, key, data, ttl, maxSize) {
  if (map.size >= maxSize) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  map.set(key, { data, time: Date.now() });
}

// ============ ЕДИНЫЙ ПОИСК ПО ТАКСОНОМИЯМ ============

function findTagData(factsData, tags) {
  const taxonomies = ['us-gaap', 'ifrs-full', 'srt'];
  const facts = factsData?.facts;
  if (!facts) {
    log('findTagData: factsData.facts отсутствует');
    return null;
  }

  for (const taxonomy of taxonomies) {
    const taxData = facts[taxonomy];
    if (!taxData) continue;
    for (const tag of tags) {
      if (taxData[tag]) {
        log(`findTagData: найден тег ${tag} в таксономии ${taxonomy}`);
        return { taxonomy, tag, data: taxData[tag] };
      }
    }
  }
  log(`findTagData: теги ${tags.join(', ')} не найдены ни в одной таксономии`);
  return null;
}

// ============ ФУНКЦИИ ДЛЯ РАБОТЫ С МЕТРИКАМИ ============

function getMetricValuesArray(factsData, tagOrAlias) {
  // Кэширование для этого метода отключено (CACHE_CONFIG.getMetricValuesArrayCache.enabled = false)
  const catalog = METRICS_CATALOG[tagOrAlias];
  const facts = factsData?.facts;
  if (!facts) {
    log('getMetricValuesArray: factsData.facts отсутствует');
    return null;
  }
  
  if (catalog) {
    const found = findTagData(factsData, catalog.tags);
    if (!found) {
      log(`getMetricValuesArray: теги для алиаса ${tagOrAlias} не найдены`);
      return null;
    }
    
    const units = found.data.units;
    const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                    Object.keys(units).find(k => k.includes('shares')) ||
                    Object.keys(units).find(k => k.includes('pure')) ||
                    Object.keys(units)[0];
    log(`getMetricValuesArray: для ${tagOrAlias} найдено ${units[unitKey]?.length || 0} значений`);
    return units[unitKey] || null;
  }
  
  const found = findTagData(factsData, [tagOrAlias]);
  if (!found) {
    log(`getMetricValuesArray: прямой тег ${tagOrAlias} не найден`);
    return null;
  }
  
  const units = found.data.units;
  const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                  Object.keys(units).find(k => k.includes('shares')) ||
                  Object.keys(units).find(k => k.includes('pure')) ||
                  Object.keys(units)[0];
  log(`getMetricValuesArray: для тега ${tagOrAlias} найдено ${units[unitKey]?.length || 0} значений`);
  return units[unitKey] || null;
}

// Сбор значений из всех тегов (для TTM) - кэш отключён
function collectAllTagValues(factsData, tags) {
  // Кэш для этого метода отключён (CACHE_CONFIG.collectAllTagValuesCache.enabled = false)
  log(`collectAllTagValues: начинаем сбор для тегов [${tags.join(', ')}]`);
  const allValues = [];
  
  for (const tag of tags) {
    const found = findTagData(factsData, [tag]);
    if (!found) continue;
    
    const units = found.data.units;
    const unitKey = Object.keys(units).find(k => k.includes('USD')) || Object.keys(units)[0];
    const values = units[unitKey];
    if (values && values.length > 0) {
      log(`collectAllTagValues: из тега ${tag} добавлено ${values.length} значений`);
      allValues.push(...values);
    }
  }
  
  // Дедупликация по периоду (берём запись с самой свежей датой подачи)
  const unique = new Map();
  for (const v of allValues) {
    const key = `${v.fy || ''}|${v.fp || ''}|${v.form || ''}|${v.end || ''}|${v.start || ''}|${v.filed || ''}`;
    const existing = unique.get(key);
    if (!existing || safeDateValue(v.filed) > safeDateValue(existing.filed)) {
      unique.set(key, v);
    }
  }
  
  const result = Array.from(unique.values());
  log(`collectAllTagValues: после дедупликации осталось ${result.length} значений`);
  return result;
}

// Сбор значений метрики (прямые теги + compute) - кэш отключён
function collectMetricValues(factsData, metricName) {
  const catalog = METRICS_CATALOG[metricName];
  if (!catalog) {
    log(`collectMetricValues: метрика ${metricName} не найдена в каталоге`);
    return null;
  }
  
  let values = getMetricValuesArray(factsData, metricName);
  
  if ((!values || values.length === 0) && catalog.compute && catalog.compute.length > 0) {
    log(`collectMetricValues: прямой тег не найден, переходим к compute-тегам`);
    const filingsMap = new Map();
    for (const computeTag of catalog.compute) {
      const tagValues = getMetricValuesArray(factsData, computeTag);
      if (tagValues && tagValues.length > 0) {
        for (const v of tagValues) {
          const key = [
            v.fy || '',
            v.fp || '',
            v.form || '',
            v.end || '',
            v.start || '',
            v.filed || ''
          ].join('|');
          if (!filingsMap.has(key)) filingsMap.set(key, v);
        }
      }
    }
    values = filingsMap.size > 0 ? Array.from(filingsMap.values()) : null;
  }
  
  return values;
}

// Новая унифицированная функция поиска значения по всем тегам
function searchValueInAllTags(factsData, catalog, year, quarterParam, isBalanceMetric, ticker) {
  const tags = catalog.tags;
  const isQuarterRequest = quarterParam !== undefined && quarterParam !== null && quarterParam !== 'annual' && quarterParam !== 'год';
  
  log(`searchValueInAllTags: start, year=${year}, quarterParam=${quarterParam}, isBalance=${isBalanceMetric}`);
  
  // 4q и q4 не обрабатываем через compute и прямые теги
  if (quarterParam === '4q' || quarterParam === 'q4') {
    log(`searchValueInAllTags: пропускаем ${quarterParam}`);
    return null;
  }
  
  // 1. Перебираем все прямые теги в порядке приоритета
  for (const tag of tags) {
    log(`searchValueInAllTags: проверяем тег ${tag}`);
    
    const tagData = findTagData(factsData, [tag]);
    if (!tagData) {
      log(`searchValueInAllTags: тег ${tag} не найден в данных`);
      continue;
    }
    
    const values = getMetricValuesArray(factsData, tag);
    if (!values || values.length === 0) {
      log(`searchValueInAllTags: тег ${tag} не содержит значений`);
      continue;
    }
    
    // Проверяем, есть ли в этом теге данные за запрошенный год
    const hasYearData = values.some(v => v.fy === year);
    if (!hasYearData) {
      log(`searchValueInAllTags: тег ${tag} не содержит данных за год ${year}`);
      continue;
    }
    
    // Если запрошен квартал (но не q4), проверяем наличие данных за этот квартал
    if (isQuarterRequest && quarterParam !== 'q4' && quarterParam !== '4q') {
      const quarterInfo = parseQuarterStringCached(quarterParam);
      if (quarterInfo) {
        const targetFp = `Q${quarterInfo.num}`;
        const hasQuarterData = values.some(v => v.fy === year && v.fp === targetFp);
        if (!hasQuarterData) {
          log(`searchValueInAllTags: тег ${tag} не содержит данных за ${targetFp} ${year}`);
          continue;
        }
      }
    }
    
    // Если дошли сюда — в теге есть нужные данные, пытаемся получить значение
    const result = getValueFromTag(tagData.data, catalog.alias || Object.keys(METRICS_CATALOG).find(k => METRICS_CATALOG[k] === catalog), year, quarterParam, isBalanceMetric, ticker, factsData);
    if (result !== null && result !== undefined) {
      log(`searchValueInAllTags: найден результат в теге ${tag}: ${result}`);
      return result;
    }
  }
  
  // 2. Если не нашли ни в одном прямом теге — переходим к compute-тегам
  if (catalog.compute && catalog.compute.length > 0) {
    log(`searchValueInAllTags: переходим к compute-тегам`);
    let sum = null;
    let validCount = 0;
    
    for (const computeTag of catalog.compute) {
      log(`searchValueInAllTags: проверяем compute-тег ${computeTag}`);
      const computeFound = findTagData(factsData, [computeTag]);
      if (!computeFound) {
        log(`searchValueInAllTags: compute-тег ${computeTag} не найден`);
        continue;
      }
      
      const computeResult = getValueFromTag(computeFound.data, catalog.alias || Object.keys(METRICS_CATALOG).find(k => METRICS_CATALOG[k] === catalog), year, quarterParam, isBalanceMetric, ticker, factsData);
      if (computeResult !== null && computeResult !== undefined) {
        if (catalog.operation === 'sum') {
          if (sum === null) sum = 0;
          sum += computeResult;
          log(`searchValueInAllTags: добавлено ${computeResult}, сумма=${sum}`);
        } else if (catalog.operation === 'subtract') {
          if (sum === null) sum = computeResult;
          else sum -= computeResult;
          log(`searchValueInAllTags: вычитание, результат=${sum}`);
        }
        validCount++;
      }
    }
    
    if (validCount > 0 && sum !== null) {
      log(`searchValueInAllTags: результат compute: ${sum}`);
      return sum;
    }
  }
  
  log(`searchValueInAllTags: результат не найден`);
  return null;
}

// ============ ОСНОВНАЯ ЛОГИКА ПОИСКА ЗНАЧЕНИЯ ИЗ ТЕГА ============

function getValueFromTag(tagData, metricName, year, quarterParam, isBalanceMetric, ticker, factsData) {
  const catalog = METRICS_CATALOG[metricName];
  if (!catalog) {
    log(`getValueFromTag: метрика ${metricName} не найдена`);
    return null;
  }
  
  const units = tagData.units;
  const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                  Object.keys(units).find(k => k.includes('shares')) ||
                  Object.keys(units).find(k => k.includes('pure')) ||
                  Object.keys(units)[0];
  const values = units[unitKey];
  if (!values || values.length === 0) {
    log(`getValueFromTag: нет значений для метрики ${metricName}`);
    return null;
  }
  
  let result = null;
  
  // Сортировка
  let sortedValues;
  if (isBalanceMetric) {
    sortedValues = sortByEndDesc(values);
  } else {
    sortedValues = sortByStartDesc(values);
  }
  

  // Годовой отчёт
  if (year !== undefined && (quarterParam === undefined || quarterParam === 0 || quarterParam === 'annual' || quarterParam === 'год' || quarterParam === '4q')) {
    // Ищем записи с длительностью для Q4 (12 месяцев = 350-370 дней)
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
      log(`getValueFromTag: найден годовой отчёт за ${year}: ${annual.val}`);
      result = annual.val;
    } else {
      log(`getValueFromTag: годовой отчёт за ${year} не найден`);
    }
  }
  
  // Квартальные данные
  else if (year !== undefined && quarterParam) {
    const quarterInfo = parseQuarterStringCached(quarterParam);
    if (!quarterInfo) {
      log(`getValueFromTag: не удалось распарсить quarterParam=${quarterParam}`);
      return null;
    }
    
    if (isBalanceMetric) {
      const targetFp = `Q${quarterInfo.num}`;
      if (quarterInfo.num === 4) {
        const annual = findAnnualReport(sortedValues, year);
        result = annual?.val || null;
        log(`getValueFromTag: баланс Q4 -> годовой отчёт: ${result}`);
      } else {
        const balanceValue = findQuarterlyReport(sortedValues, year, targetFp);
        result = balanceValue?.val || null;
        log(`getValueFromTag: баланс ${targetFp}: ${result}`);
      }
    }
    else {
      // Q1, Q2, Q3 (блок Q4 удалён)
      const targetFp = `Q${quarterInfo.num}`;
      
      if (quarterInfo.type === 'quarter') {
        // q1, q2, q3: ищем 10-Q или 6-K
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
        
        // Ищем запись за 3 месяца (80-100 дней)
        let quarterValue = candidates.find(v => {
          const days = getDaysDifference(v.start, v.end);
          return days >= QUARTER_DAYS[1].min && days <= QUARTER_DAYS[1].max;
        });
        
        // Для q2, q3: если нет 3-месячной записи, вычисляем через YTD
        if (!quarterValue && (quarterInfo.num === 2 || quarterInfo.num === 3)) {
          const ytdCurrent = candidates.find(v => {
            const days = getDaysDifference(v.start, v.end);
            return days >= QUARTER_DAYS[quarterInfo.num].min && days <= QUARTER_DAYS[quarterInfo.num].max;
          });
          const prevFp = `Q${quarterInfo.num - 1}`;
          const ytdPrev = findQuarterlyReport(sortedValues, year, prevFp);
          
          if (ytdCurrent && ytdPrev) {
            quarterValue = { val: ytdCurrent.val - ytdPrev.val };
            log(`getValueFromTag: вычислен ${targetFp} через YTD: ${ytdCurrent.val} - ${ytdPrev.val} = ${quarterValue.val}`);
          } else if (ytdCurrent) {
            quarterValue = ytdCurrent;
            log(`getValueFromTag: взят YTD ${targetFp} как есть: ${quarterValue.val}`);
          }
        }
        
        result = quarterValue?.val || null;
        log(`getValueFromTag: ${quarterParam} -> ${result}`);
      }
      else if (quarterInfo.type === 'ytd') {
        // 1q, 2q, 3q: YTD
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
        log(`getValueFromTag: ${quarterParam} (YTD) -> ${result}`);
      }
    }
  }
  
  return result;
}

// ============ ОСНОВНАЯ ЛОГИКА ПОИСКА (ВНУТРЕННЯЯ) ============

function getMetricValueInternal(factsData, metric, year, quarterParam, scale, ticker) {
  const catalog = METRICS_CATALOG[metric];
  if (!catalog) {
    log(`getMetricValueInternal: метрика ${metric} не найдена в каталоге`);
    return null;
  }
  
  const isBalanceMetric = catalog.ttm === 'last';
  
  log(`getMetricValueInternal: ticker=${ticker}, metric=${metric}, year=${year}, quarterParam=${quarterParam}, isBalance=${isBalanceMetric}`);
  
  // q4 = 4q − 3q
  if (quarterParam === 'q4') {
    const annual = getMetricValueInternal(factsData, metric, year, '4q', null, ticker);
    const ytdQ3 = getMetricValueInternal(factsData, metric, year, '3q', null, ticker);
    const result = (annual !== null && ytdQ3 !== null) ? annual - ytdQ3 : null;
    return result !== null ? applyScale(result, scale) : null;
  }
  
  // Используем унифицированную функцию поиска
  let result = searchValueInAllTags(factsData, catalog, year, quarterParam, isBalanceMetric, ticker);
  
  // Если не нашли и есть compute, пробуем вычислить через compute-теги
  if ((result === null || result === undefined) && catalog.compute && catalog.compute.length > 0) {
    log(`getMetricValueInternal: прямой поиск не дал результата, пробуем compute`);
    let sum = null;
    let validCount = 0;
    
    for (const computeTag of catalog.compute) {
      const computeFound = findTagData(factsData, [computeTag]);
      if (!computeFound) continue;
      
      const computeResult = getValueFromTag(computeFound.data, metric, year, quarterParam, isBalanceMetric, ticker, factsData);
      if (computeResult !== null && computeResult !== undefined) {
        if (catalog.operation === 'sum') {
          if (sum === null) sum = 0;
          sum += computeResult;
        } else if (catalog.operation === 'subtract') {
          if (sum === null) sum = computeResult;
          else sum -= computeResult;
        }
        validCount++;
      }
    }
    
    if (validCount > 0 && sum !== null) {
      result = sum;
      log(`getMetricValueInternal: compute результат = ${result}`);
    }
  }
  
  log(`getMetricValueInternal: итоговый результат = ${result}`);
  return result !== null ? applyScale(result, scale) : null;
}

// ============ TTM ФУНКЦИЯ ============

function getTTMValue(factsData, metricName, scale, ticker) {
  const catalog = METRICS_CATALOG[metricName];
  const ttmType = catalog?.ttm || 'sum';
  
  log(`getTTMValue: ticker=${ticker}, metric=${metricName}, ttmType=${ttmType}`);
  
  // Собираем значения из ВСЕХ тегов
  let allTagValues = collectAllTagValues(factsData, catalog.tags);
  
  // Если нет прямых тегов, пробуем compute
  if ((!allTagValues || allTagValues.length === 0) && catalog.compute && catalog.compute.length > 0) {
    log(`getTTMValue: нет прямых тегов, собираем compute-теги`);
    const valuesMap = new Map();
    for (const computeTag of catalog.compute) {
      const tagValues = getMetricValuesArray(factsData, computeTag);
      if (tagValues && tagValues.length > 0) {
        for (const v of tagValues) {
          const key = `${v.fy || ''}|${v.fp || ''}|${v.form || ''}|${v.end || ''}|${v.start || ''}|${v.filed || ''}`;
          if (!valuesMap.has(key)) valuesMap.set(key, v);
        }
      }
    }
    allTagValues = valuesMap.size > 0 ? Array.from(valuesMap.values()) : null;
  }
  
  if (!allTagValues || allTagValues.length === 0) {
    log(`getTTMValue: нет значений для метрики ${metricName}`);
    return null;
  }
  
  if (ttmType === 'last') {
    const sortedValues = sortByEndDesc(allTagValues);
    const result = sortedValues[0]?.val;
    log(`getTTMValue: баланс, последнее значение = ${result}`);
    return applyScale(result, scale);
  }
  
  // P&L и Cash Flow
  const allReports = filterReportsWithFiled(allTagValues);
  if (allReports.length === 0) {
    log(`getTTMValue: нет отчётов с filed`);
    return null;
  }
  
  const sortedReports = sortByEndDesc(allReports);
  const lastReport = sortedReports[0];
  log(`getTTMValue: последний отчёт: form=${lastReport.form}, fy=${lastReport.fy}, fp=${lastReport.fp}, filed=${lastReport.filed}`);
  
  if (lastReport.form === '10-K' || lastReport.form === '20-F' || lastReport.form === '40-F') {
    const annualValue = getMetricValueInternal(factsData, metricName, lastReport.fy, undefined, null, ticker);
    log(`getTTMValue: годовой отчёт, значение = ${annualValue}`);
    return applyScale(annualValue, scale);
  }
  
  const quarterMatch = lastReport.fp?.match(/^Q([1-4])$/);
  if (!quarterMatch) {
    log(`getTTMValue: не удалось определить квартал из fp=${lastReport.fp}`);
    return null;
  }
  
  const lastQuarterNum = parseInt(quarterMatch[1]);
  const lastYear = lastReport.fy;
  
  const quarters = [];
  for (let i = 3; i >= 0; i--) {
    let quarterNum = lastQuarterNum - i;
    let year = lastYear;
    if (quarterNum <= 0) {
      quarterNum += 4;
      year -= 1;
    }
    quarters.push({ year, quarterNum });
  }
  log(`getTTMValue: собираем кварталы: ${JSON.stringify(quarters)}`);
  
  let sum = 0;
  let validCount = 0;
  
  for (const q of quarters) {
    const quarterParam = `q${q.quarterNum}`;
    const value = getMetricValueInternal(factsData, metricName, q.year, quarterParam, null, ticker);
    log(`getTTMValue: квартал ${q.year} Q${q.quarterNum} = ${value}`);
    if (value !== null) {
      sum += value;
      validCount++;
    }
  }
  
  if (validCount === 0) {
    log(`getTTMValue: не найдено ни одного квартала`);
    return null;
  }
  
  log(`getTTMValue: сумма = ${sum}, validCount=${validCount}`);
  return applyScale(sum, scale);
}

// ============ ОСНОВНАЯ ФУНКЦИЯ ПОИСКА (ОБЁРТКА) ============

function getMetricValue(factsData, metric, year, quarterParam, scale, ticker) {
  const cacheKey = `${ticker}:${metric}:${year}:${quarterParam}`;
  
  if (CACHE_CONFIG.metricsCache.enabled) {
    const cached = getFromCache(metricsCache, cacheKey, CACHE_CONFIG.metricsCache.ttl);
    if (cached !== null) {
      log(`getMetricValue: кэш HIT для ${cacheKey}, значение = ${cached}`);
      return cached !== null ? applyScale(cached, scale) : null;
    }
    log(`getMetricValue: кэш MISS для ${cacheKey}`);
  }
  
  let value;
  if (year === undefined && quarterParam === undefined) {
    log(`getMetricValue: TTM режим`);
    value = getTTMValue(factsData, metric, scale, ticker);
  } else {
    log(`getMetricValue: обычный режим (год=${year}, квартал=${quarterParam})`);
    value = getMetricValueInternal(factsData, metric, year, quarterParam, scale, ticker);
  }
  
  if (CACHE_CONFIG.metricsCache.enabled && value !== null) {
    setToCache(metricsCache, cacheKey, value, CACHE_CONFIG.metricsCache.ttl, CACHE_CONFIG.metricsCache.maxSize);
  }
  
  log(`getMetricValue: результат = ${value}`);
  return value !== null ? applyScale(value, scale) : null;
}

// ============ FETCH С RETRY ============

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

// ============ РАБОТА С SEC API ============

async function getCIK(ticker) {
  log(`getCIK: поиск CIK для тикера ${ticker}`);
  
  // Проверяем cikCache
  if (CACHE_CONFIG.cikCache.enabled) {
    const cached = getFromCache(cikCache, ticker, CACHE_CONFIG.cikCache.ttl);
    if (cached !== null) {
      log(`getCIK: кэш HIT для ${ticker} -> ${cached}`);
      return cached;
    }
  }
  
  // Проверяем tickersCache
  let cik = null;
  if (tickersCache && isCacheValid({ time: tickersCacheTime }, CACHE_CONFIG.tickersCache.ttl)) {
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
  
  if (CACHE_CONFIG.cikCache.enabled && cik) {
    setToCache(cikCache, ticker, cik, CACHE_CONFIG.cikCache.ttl, CACHE_CONFIG.cikCache.maxSize);
  }
  
  return cik;
}

async function getCompanyMeta(cik, ticker) {
  log(`getCompanyMeta: получение метаданных для CIK ${cik}`);
  
  if (CACHE_CONFIG.companyMetaCache.enabled) {
    const cached = getFromCache(companyMetaCache, cik, CACHE_CONFIG.companyMetaCache.ttl);
    if (cached !== null) {
      log(`getCompanyMeta: кэш HIT для ${cik}`);
      return cached;
    }
  }
  
  const subData = await getSubmissions(cik);
  if (!subData) return null;
  
  const meta = {
    fiscalYearEnd: subData.fiscalYearEnd || null,
    name: subData.entityName || null,
    category: subData.category || null,
    stateOfIncorporation: subData.stateOfIncorporation || null,
    ticker: ticker
  };
  
  if (CACHE_CONFIG.companyMetaCache.enabled) {
    setToCache(companyMetaCache, cik, meta, CACHE_CONFIG.companyMetaCache.ttl, CACHE_CONFIG.companyMetaCache.maxSize);
  }
  
  return meta;
}

async function getSubmissions(cik) {
  log(`getSubmissions: загрузка submissions для CIK ${cik}`);
  
  if (CACHE_CONFIG.submissionsCache.enabled) {
    const cached = getFromCache(submissionsCache, cik, CACHE_CONFIG.submissionsCache.ttl);
    if (cached !== null) {
      log(`getSubmissions: кэш HIT для ${cik}`);
      return cached;
    }
    log(`getSubmissions: кэш EXPIRED или MISS для ${cik}`);
  }
  
  const url = `${DATA_BASE}/submissions/CIK${cik}.json`;
  const response = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) {
    log(`getSubmissions: ошибка загрузки, status=${response.status}`);
    return null;
  }
  
  const data = await response.json();
  
  if (CACHE_CONFIG.submissionsCache.enabled) {
    setToCache(submissionsCache, cik, data, CACHE_CONFIG.submissionsCache.ttl, CACHE_CONFIG.submissionsCache.maxSize);
  }
  
  log(`getSubmissions: загружено и закэшировано`);
  return data;
}

async function getCompanyFacts(cik) {
  log(`getCompanyFacts: загрузка companyfacts для CIK ${cik}`);
  
  if (CACHE_CONFIG.factsCache.enabled) {
    const cached = getFromCache(factsCache, cik, CACHE_CONFIG.factsCache.ttl);
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
  
  if (CACHE_CONFIG.factsCache.enabled) {
    setToCache(factsCache, cik, data, CACHE_CONFIG.factsCache.ttl, CACHE_CONFIG.factsCache.maxSize);
  }
  
  log(`getCompanyFacts: загружено и закэшировано`);
  return data;
}

// ============ ФУНКЦИИ ДЛЯ ОТЧЁТОВ ============

function getReportByOrder(recent, reportType, n, field) {
  const forms = recent.form || [];
  const filingDates = recent.filingDate || [];
  const reportDates = recent.reportDate || [];
  const accessionNumbers = recent.accessionNumber || [];
  const primaryDocuments = recent.primaryDocument || [];
  
  let foundIndex = -1;
  let count = 0;
  
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === reportType) {
      if (count === n) {
        foundIndex = i;
        break;
      }
      count++;
    }
  }
  
  if (foundIndex === -1) return null;
  
  const filingDate = filingDates[foundIndex];
  const reportDate = reportDates[foundIndex];
  const accessionNumber = accessionNumbers[foundIndex];
  const primaryDocument = primaryDocuments[foundIndex];
  const cik = recent.cik;
  
  const report = {
    form: reportType,
    filingDate: filingDate,
    reportDate: reportDate,
    accessionNumber: accessionNumber,
    primaryDocument: primaryDocument,
    url: buildFilingUrl(cik, accessionNumber, primaryDocument),
    year: parseInt(filingDate?.substring(0, 4)),
    quarter: reportType === '10-Q' ? getQuarterFromDate(filingDate) : null
  };
  
  if (field && report[field] !== undefined) {
    return report[field];
  }
  
  return report;
}

function getReportByDate(recent, reportType, year, quarter, field) {
  const forms = recent.form || [];
  const filingDates = recent.filingDate || [];
  const reportDates = recent.reportDate || [];
  const accessionNumbers = recent.accessionNumber || [];
  const primaryDocuments = recent.primaryDocument || [];
  const cik = recent.cik;
  
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== reportType) continue;
    
    const filingYear = parseInt(filingDates[i]?.substring(0, 4));
    if (filingYear !== year) continue;
    
    if (reportType === '10-K') {
      if (quarter === undefined || quarter === 0 || quarter === null) {
        const report = {
          form: reportType,
          filingDate: filingDates[i],
          reportDate: reportDates[i],
          accessionNumber: accessionNumbers[i],
          primaryDocument: primaryDocuments[i],
          url: buildFilingUrl(cik, accessionNumbers[i], primaryDocuments[i]),
          year: year,
          quarter: null
        };
        return field ? report[field] : report;
      }
    } else if (reportType === '10-Q') {
      const reportQuarter = getQuarterFromDate(filingDates[i]);
      if (quarter !== undefined && reportQuarter === quarter) {
        const report = {
          form: reportType,
          filingDate: filingDates[i],
          reportDate: reportDates[i],
          accessionNumber: accessionNumbers[i],
          primaryDocument: primaryDocuments[i],
          url: buildFilingUrl(cik, accessionNumbers[i], primaryDocuments[i]),
          year: year,
          quarter: reportQuarter
        };
        return field ? report[field] : report;
      }
    }
  }
  
  return null;
}

// ============ ENDPOINTS ============

app.get('/ping', (req, res) => {
  log('GET /ping');
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/catalog', async (req, res) => {
  log('GET /catalog');
  try {
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
  } catch (error) {
    log(`GET /catalog error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/validate/:metric', async (req, res) => {
  log(`GET /validate/${req.params.metric}`);
  try {
    const resolved = resolveMetric(req.params.metric);
    if (!resolved) {
      const available = Object.keys(METRICS_CATALOG).slice(0, 20).join(', ');
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
  } catch (error) {
    log(`GET /validate error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/metrics/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const year = req.query.year ? parseInt(req.query.year) : undefined;
  const quarter = req.query.quarter !== undefined ? String(req.query.quarter) : undefined;
  const scale = normalizeScale(req.query.scale);
  
  log(`GET /metrics/${ticker}?year=${year}&quarter=${quarter}&scale=${scale}`);
  
  try {
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
    if (!cik) {
      log(`getCIK вернул null для тикера ${ticker}`);
      return res.status(404).json({ error: 'Тикер не найден' });
    }
    
    const factsData = await getCompanyFacts(cik);
    if (!factsData) {
      log(`getCompanyFacts вернул null для CIK ${cik}`);
      return res.status(500).json({ error: 'Ошибка получения данных' });
    }
    
    const results = {};
    for (const metric of resolvedMetrics) {
      const value = getMetricValue(factsData, metric, year, quarter, scale, ticker);
      results[metric] = value !== null ? value : null;
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
    log(`GET /metrics error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/info/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  log(`GET /info/${ticker}`);
  
  try {
    const cik = await getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    const subData = await getSubmissions(cik);
    if (!subData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    const recent = subData.filings?.recent || {};
    recent.cik = cik;
    
    const forms = recent.form || [];
    const filingDates = recent.filingDate || [];
    const available10k = [];
    const available10q = {};
    
    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];
      const date = filingDates[i];
      const year = date ? parseInt(date.substring(0, 4)) : null;
      
      if (form === '10-K' && year && !available10k.includes(year)) {
        available10k.push(year);
      }
      if (form === '10-Q' && year) {
        if (!available10q[year]) available10q[year] = [];
        const quarter = getQuarterFromDate(date);
        if (quarter && !available10q[year].includes(quarter)) {
          available10q[year].push(quarter);
        }
      }
    }
    
    const last10K = getReportByOrder(recent, '10-K', 0, null);
    const last10Q = getReportByOrder(recent, '10-Q', 0, null);
    
    res.json({
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
      reports: {
        available_10k_years: available10k.sort((a, b) => b - a),
        available_10q_years: available10q,
        last_10K: last10K,
        last_10Q: last10Q
      }
    });
  } catch (error) {
    log(`GET /info error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/submissions/:identifier', async (req, res) => {
  const identifier = req.params.identifier;
  log(`GET /submissions/${identifier}`);
  
  try {
    let cik = null;
    
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await getCIK(identifier.toUpperCase());
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const subData = await getSubmissions(cik);
    if (!subData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    res.json(subData);
  } catch (error) {
    log(`GET /submissions error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/actions/reports/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  log(`GET /actions/reports/${ticker}`);
  
  try {
    const cik = await getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    const subData = await getSubmissions(cik);
    if (!subData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    const recent = subData.filings?.recent || {};
    recent.cik = cik;
    
    const reportType = req.query.type;
    if (!reportType) return res.status(400).json({ error: 'Укажите type (10-K, 10-Q, 8-K)' });
    
    const mode = req.query.mode;
    const n = req.query.n ? parseInt(req.query.n) : null;
    const year = req.query.year ? parseInt(req.query.year) : null;
    const quarter = req.query.quarter ? parseInt(req.query.quarter) : null;
    const field = req.query.field || null;
    
    let result = null;
    
    if (mode === 'last' && n !== null) {
      result = getReportByOrder(recent, reportType, n, field);
    } else if (mode === 'date' && year !== null) {
      result = getReportByDate(recent, reportType, year, quarter, field);
    } else {
      return res.status(400).json({ error: 'Неверные параметры. Используйте mode=last&n=N или mode=date&year=YYYY' });
    }
    
    if (!result) return res.status(404).json({ error: 'Отчёт не найден' });
    res.json(result);
  } catch (error) {
    log(`GET /actions/reports error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/companyfacts/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  log(`GET /companyfacts/${ticker}`);
  
  try {
    const cik = await getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    const factsData = await getCompanyFacts(cik);
    if (!factsData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    res.json(factsData);
  } catch (error) {
    log(`GET /companyfacts error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/company-tickers', async (req, res) => {
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
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SEC Proxy server running on port ${PORT}`);
  console.log(`Endpoints available:`);
  console.log(`  GET /catalog`);
  console.log(`  GET /validate/:metric`);
  console.log(`  GET /metrics/:ticker`);
  console.log(`  GET /info/:ticker`);
  console.log(`  GET /submissions/:identifier`);
  console.log(`  GET /actions/reports/:ticker`);
  console.log(`  GET /companyfacts/:ticker`);
  console.log(`  GET /company-tickers`);
  console.log(`  GET /ping`);
  console.log(`Кэш TTL: tickers=24ч, cik=24ч, facts=6ч, metrics=5мин, submissions=24ч, companyMeta=24ч, quarterParse=∞`);
});
