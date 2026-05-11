const express = require('express');
const fetch = require('node-fetch');

const app = express();

// ============ КОНСТАНТЫ ============
const QUARTER_DAYS = {
  1: { min: 80, max: 100 },
  2: { min: 170, max: 190 },
  3: { min: 260, max: 280 },
  4: { min: 350, max: 370 }
};

// ============ КОНФИГУРАЦИЯ ============
const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// Кэши
let tickersCache = null;
let tickersCacheTime = 0;
const TICKERS_CACHE_TTL = 60 * 60 * 1000;

// Кэш метрик
const metricsCache = new Map();
const METRICS_CACHE_TTL = 60 * 60 * 1000; // 1 час

// ============ ПОЛНЫЙ СПРАВОЧНИК МЕТРИК ============
const METRICS_CATALOG = {
  revenue: { tags: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'TotalRevenues'], category: 'P&L', ttm: 'sum', ru: 'Выручка' },
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

  preferredstock: { tags: ['PreferredStockValue', 'PreferredStockSharesOutstanding'], category: 'Equity', ttm: 'last', ru: 'Привилегированные акции' },
  commonstock: { tags: ['CommonStockValue', 'CommonStocksIncludingAdditionalPaidInCapital'], category: 'Equity', ttm: 'last', ru: 'Обыкновенные акции' },
  additionalpaidincapital: { tags: ['AdditionalPaidInCapital'], category: 'Equity', ttm: 'last', ru: 'Дополнительный капитал' },
  retainedearnings: { tags: ['RetainedEarningsAccumulatedDeficit', 'RetainedEarnings'], category: 'Equity', ttm: 'last', ru: 'Нераспределённая прибыль' },
  accumulatedothercomprehensiveincome: { tags: ['AccumulatedOtherComprehensiveIncomeLossNetOfTax'], category: 'Equity', ttm: 'last', ru: 'Прочий совокупный доход' },
  treasurystock: { tags: ['TreasuryStockValue', 'TreasuryStockCommon'], category: 'Equity', ttm: 'last', ru: 'Казначейские акции' },
  totalequity: { tags: ['StockholdersEquity', 'PartnersCapital', 'MembersEquity', 'Equity'], category: 'Equity', ttm: 'last', ru: 'ВСЕГО КАПИТАЛ' },

  ocf: { tags: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations', 'CashFlowsFromUsedInOperatingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'OCF' },
  icf: { tags: ['NetCashProvidedByUsedInInvestingActivities', 'CashFlowsFromUsedInInvestingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'ICF' },
  fcf: { tags: ['NetCashProvidedByUsedInFinancingActivities', 'CashFlowsFromUsedInFinancingActivities'], category: 'CashFlow', ttm: 'sum', ru: 'FCF' },

  netchangeincash: { 
    tags: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect'], 
    compute: [
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseExcludingExchangeRateEffect',
      'EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
      'IncreaseDecreaseInCashAndCashEquivalentsBeforeEffectOfExchangeRateChanges',
      'EffectOfExchangeRateChangesOnCashAndCashEquivalents'
    ], 
    operation: 'sum', 
    category: 'CashFlow', 
    ttm: 'sum', 
    ru: 'Чистое изменение денег' 
  },
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

  sharesbasic: { tags: ['WeightedAverageNumberOfSharesOutstandingBasic'], category: 'PerShare', ttm: 'last', ru: 'Акции basic' },
  sharesdiluted: { tags: ['WeightedAverageNumberOfDilutedSharesOutstanding'], category: 'PerShare', ttm: 'last', ru: 'Акции diluted' },
  sharesoutstanding: { tags: ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'], category: 'PerShare', ttm: 'last', ru: 'Акции в обращении' },
  sharesissued: { tags: ['CommonStockSharesIssued'], category: 'PerShare', ttm: 'last', ru: 'Выпущенные акции' },
  epsbasic: { tags: ['EarningsPerShareBasic'], category: 'PerShare', ttm: 'sum', ru: 'EPS basic' },
  epsdiluted: { tags: ['EarningsPerShareDiluted'], category: 'PerShare', ttm: 'sum', ru: 'EPS diluted' },
  dividendspershare: { tags: ['CommonStockDividendsPerShareDeclared', 'DividendsPerShare'], category: 'PerShare', ttm: 'sum', ru: 'DPS' }
};

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

function parseQuarterString(quarterStr) {
  if (!quarterStr || typeof quarterStr !== 'string') return null;
  const lower = quarterStr.toLowerCase().trim();
  if (lower === 'q1') return { type: 'quarter', num: 1 };
  if (lower === 'q2') return { type: 'quarter', num: 2 };
  if (lower === 'q3') return { type: 'quarter', num: 3 };
  if (lower === 'q4') return { type: 'quarter', num: 4 };
  if (lower === '1q') return { type: 'ytd', num: 1 };
  if (lower === '2q') return { type: 'ytd', num: 2 };
  if (lower === '3q') return { type: 'ytd', num: 3 };
  if (lower === '4q') return { type: 'ytd', num: 4 };
  return null;
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

// ============ НОВАЯ ЛОГИКА ПОИСКА ТЕГОВ ============

function getAllTagData(factsData, tags) {
  const taxonomies = ['us-gaap', 'ifrs-full', 'srt'];
  const facts = factsData?.facts;
  if (!facts) return [];
  
  const results = [];
  
  for (const taxonomy of taxonomies) {
    const taxData = facts[taxonomy];
    if (!taxData) continue;
    
    for (const tag of tags) {
      const tagData = taxData[tag];
      if (!tagData) continue;
      
      const units = tagData.units;
      const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                      Object.keys(units).find(k => k.includes('shares')) ||
                      Object.keys(units).find(k => k.includes('pure')) ||
                      Object.keys(units)[0];
      const values = units[unitKey];
      if (!values || values.length === 0) continue;
      
      results.push({
        tag,
        taxonomy,
        data: tagData,
        values,
        latestFiling: values.reduce((latest, v) => {
          const date = new Date(v.filed || v.end);
          return (!latest || date > new Date(latest.filed || latest.end)) ? v : latest;
        }, null)
      });
    }
  }
  
  return results;
}

function getBestTagForYear(factsData, tags, year) {
  const allTags = getAllTagData(factsData, tags);
  if (allTags.length === 0) return null;
  
  let bestMatch = null;
  let bestScore = -1;
  
  for (const tagInfo of allTags) {
    // Ищем запись с нужным годом (по fy или по end)
    const match = tagInfo.values.find(v => {
      if (v.fy === year) return true;
      const endYear = v.end ? new Date(v.end).getFullYear() : null;
      return endYear === year;
    });
    
    if (match) {
      const score = (match.fy === year) ? 2 : 1;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { ...tagInfo, match };
      }
    }
  }
  
  return bestMatch;
}

function getBestTagForTTM(factsData, tags) {
  const allTags = getAllTagData(factsData, tags);
  if (allTags.length === 0) return null;
  
  let bestTag = null;
  let latestDate = null;
  
  for (const tagInfo of allTags) {
    if (tagInfo.latestFiling) {
      const date = new Date(tagInfo.latestFiling.filed || tagInfo.latestFiling.end);
      if (!latestDate || date > latestDate) {
        latestDate = date;
        bestTag = tagInfo;
      }
    }
  }
  
  return bestTag;
}

// ============ ЕДИНЫЙ ПОИСК ПО ТАКСОНОМИЯМ ============

function findTagData(factsData, tags) {
  const result = getBestTagForYear(factsData, tags, new Date().getFullYear());
  if (result) return { taxonomy: result.taxonomy, tag: result.tag, data: result.data };
  return null;
}

// ============ FETCH С RETRY ============
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        console.log(`Rate limited, waiting ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// ============ РАБОТА С SEC API ============
async function getCIK(ticker) {
  if (!tickersCache || Date.now() - tickersCacheTime > TICKERS_CACHE_TTL) {
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers.json`, {
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

async function getSubmissions(cik) {
  const url = `${DATA_BASE}/submissions/CIK${cik}.json`;
  const response = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) return null;
  return response.json();
}

async function getCompanyFacts(cik) {
  const url = `${DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;
  const response = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT }
  });
  if (!response.ok) return null;
  return response.json();
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ МЕТРИК ============

function getMetricValuesArray(factsData, tagOrAlias) {
  const catalog = METRICS_CATALOG[tagOrAlias];
  const facts = factsData?.facts;
  if (!facts) return null;
  
  if (catalog) {
    const allTags = getAllTagData(factsData, catalog.tags);
    if (allTags.length === 0) return null;
    const bestTag = allTags.sort((a, b) => {
      const dateA = new Date(a.latestFiling?.filed || a.latestFiling?.end);
      const dateB = new Date(b.latestFiling?.filed || b.latestFiling?.end);
      return dateB - dateA;
    })[0];
    return bestTag.values;
  }
  
  const allTags = getAllTagData(factsData, [tagOrAlias]);
  if (allTags.length === 0) return null;
  return allTags[0].values;
}

// ============ ОСНОВНАЯ ЛОГИКА ПОИСКА ЗНАЧЕНИЯ ============
function getValueFromTag(tagData, metricName, year, quarterParam, isBalanceMetric) {
  const catalog = METRICS_CATALOG[metricName];
  if (!catalog) return null;
  
  const units = tagData.units;
  const unitKey = Object.keys(units).find(k => k.includes('USD')) || 
                  Object.keys(units).find(k => k.includes('shares')) ||
                  Object.keys(units).find(k => k.includes('pure')) ||
                  Object.keys(units)[0];
  const values = units[unitKey];
  if (!values || values.length === 0) return null;
  
  let result = null;
  
  let sortedValues;
  if (isBalanceMetric) {
    sortedValues = sortByEndDesc(values);
  } else {
    sortedValues = sortByStartDesc(values);
  }
  
  if (year !== undefined && (quarterParam === undefined || quarterParam === 0 || quarterParam === 'annual' || quarterParam === 'год')) {
    const annual = findAnnualReport(sortedValues, year);
    result = annual?.val || null;
  }
  else if (year !== undefined && quarterParam) {
    const quarterInfo = parseQuarterString(quarterParam);
    if (!quarterInfo) return null;
    
    if (isBalanceMetric) {
      const targetFp = `Q${quarterInfo.num}`;
      if (quarterInfo.num === 4) {
        const annual = findAnnualReport(sortedValues, year);
        result = annual?.val || null;
      } else {
        const balanceValue = findQuarterlyReport(sortedValues, year, targetFp);
        result = balanceValue?.val || null;
      }
    }
    else {
      if (quarterInfo.num === 4) {
        if (quarterInfo.type === 'ytd') {
          const annual = findAnnualReport(sortedValues, year);
          result = annual?.val || null;
        } else {
          const annual10K = findAnnualReport(sortedValues, year);
          
          let ytdQ3 = null;
          const quarterForms = ['10-Q', '6-K'];
          for (const form of quarterForms) {
            ytdQ3 = sortedValues.find(v => {
              if (v.fy !== year) return false;
              if (v.fp !== 'Q3') return false;
              if (v.form !== form) return false;
              const days = (new Date(v.end) - new Date(v.start)) / (1000 * 60 * 60 * 24);
              return days >= QUARTER_DAYS[3].min && days <= QUARTER_DAYS[3].max;
            });
            if (ytdQ3) break;
          }
          
          if (annual10K && ytdQ3) {
            result = annual10K.val - ytdQ3.val;
          } else {
            result = null;
          }
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
            const days = (new Date(v.end) - new Date(v.start)) / (1000 * 60 * 60 * 24);
            return days >= QUARTER_DAYS[1].min && days <= QUARTER_DAYS[1].max;
          });
          
          if (!quarterValue && (quarterInfo.num === 2 || quarterInfo.num === 3)) {
            const ytdCurrent = candidates.find(v => {
              const days = (new Date(v.end) - new Date(v.start)) / (1000 * 60 * 60 * 24);
              return days >= QUARTER_DAYS[quarterInfo.num].min && days <= QUARTER_DAYS[quarterInfo.num].max;
            });
            const prevFp = `Q${quarterInfo.num - 1}`;
            const ytdPrev = findQuarterlyReport(sortedValues, year, prevFp);
            
            if (ytdCurrent && ytdPrev) {
              quarterValue = { val: ytdCurrent.val - ytdPrev.val };
            } else if (ytdCurrent) {
              quarterValue = ytdCurrent;
            }
          }
          
          result = quarterValue?.val || null;
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
              const days = (new Date(v.end) - new Date(v.start)) / (1000 * 60 * 60 * 24);
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
              const days = (new Date(v.end) - new Date(v.start)) / (1000 * 60 * 60 * 24);
              return days >= QUARTER_DAYS[quarterInfo.num].min && days <= QUARTER_DAYS[quarterInfo.num].max;
            });
          }
          
          result = ytdValue?.val || null;
        }
      }
    }
  }
  
  return result;
}

// ============ ОСНОВНАЯ ЛОГИКА ПОИСКА (ВНУТРЕННЯЯ) ============
function getMetricValueInternal(factsData, metric, year, quarterParam, scale) {
  const catalog = METRICS_CATALOG[metric];
  if (!catalog) return null;
  
  const isBalanceMetric = catalog.ttm === 'last';
  let result = null;
  
  let bestTag = null;
  if (year !== undefined) {
    bestTag = getBestTagForYear(factsData, catalog.tags, year);
  } else {
    bestTag = getBestTagForTTM(factsData, catalog.tags);
  }
  
  if (bestTag) {
    result = getValueFromTag(bestTag.data, metric, year, quarterParam, isBalanceMetric);
  }
  
  if ((result === null || result === undefined) && catalog.compute && catalog.compute.length > 0) {
    let sum = null;
    let validCount = 0;
    
    for (const computeTag of catalog.compute) {
      let computeBestTag = null;
      if (year !== undefined) {
        computeBestTag = getBestTagForYear(factsData, [computeTag], year);
      } else {
        computeBestTag = getBestTagForTTM(factsData, [computeTag]);
      }
      
      if (computeBestTag) {
        const computeResult = getValueFromTag(computeBestTag.data, metric, year, quarterParam, isBalanceMetric);
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
    }
    
    if (validCount > 0 && sum !== null) {
      result = sum;
    }
  }
  
  return result !== null ? applyScale(result, scale) : null;
}

// ============ ОСНОВНАЯ ФУНКЦИЯ ПОИСКА (ОБЁРТКА) ============
function getMetricValue(factsData, metric, year, quarterParam, scale) {
  const cacheKey = `${metric}:${year}:${quarterParam}`;
  if (metricsCache.has(cacheKey)) {
    const cached = metricsCache.get(cacheKey);
    if (Date.now() - cached.time < METRICS_CACHE_TTL) {
      const value = cached.value !== null ? applyScale(cached.value, scale) : null;
      return value;
    }
  }
  
  let result;
  if (year === undefined && quarterParam === undefined) {
    result = getTTMValue(factsData, metric, scale);
  } else {
    result = getMetricValueInternal(factsData, metric, year, quarterParam, scale);
  }
  
  metricsCache.set(cacheKey, { value: result !== null ? result : null, time: Date.now() });
  return result;
}

// ============ TTM ФУНКЦИЯ ============
function getTTMValue(factsData, metricName, scale) {
  const catalog = METRICS_CATALOG[metricName];
  const ttmType = catalog?.ttm || 'sum';
  
  let bestTag = getBestTagForTTM(factsData, catalog.tags);
  
  if (bestTag && bestTag.values) {
    const values = bestTag.values;
    
    if (ttmType === 'last') {
      const sortedValues = sortByEndDesc(values);
      return applyScale(sortedValues[0]?.val, scale);
    }
    
    const quarterly = values.filter(v => v.fp && v.fp !== 'FY');
    const sortedQuarterly = [...quarterly].sort((a, b) => new Date(b.end) - new Date(a.end));
    const last4 = sortedQuarterly.slice(0, 4);
    
    if (last4.length === 0) return null;
    const sum = last4.reduce((acc, v) => acc + v.val, 0);
    return applyScale(sum, scale);
  }
  
  return null;
}

// ============ ЛОГИКА ДЛЯ ОТЧЁТОВ ============
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
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/catalog', async (req, res) => {
  try {
    const list = [];
    for (const [key, val] of Object.entries(METRICS_CATALOG)) {
      list.push({ alias: key, ru: val.ru, category: val.category, ttm: val.ttm, tags: val.tags });
    }
    res.json({ metrics: list, count: list.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/validate/:metric', async (req, res) => {
  try {
    const resolved = resolveMetric(req.params.metric);
    if (!resolved) {
      const available = Object.keys(METRICS_CATALOG).slice(0, 20).join(', ');
      return res.status(404).json({ error: 'Метрика не найдена', available, count: Object.keys(METRICS_CATALOG).length });
    }
    res.json({ valid: true, metric: resolved, info: METRICS_CATALOG[resolved] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/metrics/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const year = req.query.year ? parseInt(req.query.year) : undefined;
    const quarter = req.query.quarter !== undefined ? String(req.query.quarter) : undefined;
    const scale = normalizeScale(req.query.scale);
    
    let rawMetrics = req.query.metrics || req.query.metric;
    if (!rawMetrics) {
      return res.status(400).json({ error: 'Укажите metric или metrics', hint: 'Используйте /catalog для списка метрик' });
    }
    
    const metricsList = rawMetrics.split('/').map(m => m.trim());
    const resolvedMetrics = [];
    const notFound = [];
    
    for (const m of metricsList) {
      const resolved = resolveMetric(m);
      if (resolved) resolvedMetrics.push(resolved);
      else notFound.push(m);
    }
    
    if (resolvedMetrics.length === 0) {
      return res.status(404).json({ error: 'Метрики не найдены', notFound, available: Object.keys(METRICS_CATALOG).slice(0, 20).join(', ') + '...', totalAvailable: Object.keys(METRICS_CATALOG).length });
    }
    
    const cik = await getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    const factsData = await getCompanyFacts(cik);
    if (!factsData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    const results = {};
    for (const metric of resolvedMetrics) {
      const value = getMetricValue(factsData, metric, year, quarter, scale);
      results[metric] = value !== null ? value : null;
    }
    
    res.json({ ticker, year: year || null, quarter: quarter || null, scale, metrics: results, notFound: notFound.length > 0 ? notFound : undefined });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/info/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
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
      
      if (form === '10-K' && year && !available10k.includes(year)) available10k.push(year);
      if (form === '10-Q' && year) {
        if (!available10q[year]) available10q[year] = [];
        const quarter = getQuarterFromDate(date);
        if (quarter && !available10q[year].includes(quarter)) available10q[year].push(quarter);
      }
    }
    
    const last10K = getReportByOrder(recent, '10-K', 0, null);
    const last10Q = getReportByOrder(recent, '10-Q', 0, null);
    
    res.json({
      cik: subData.cik, name: subData.entityName, ein: subData.ein || null, description: subData.description || null,
      category: subData.category || null, fiscalYearEnd: subData.fiscalYearEnd || null,
      stateOfIncorporation: subData.stateOfIncorporation || null, phone: subData.phone || null,
      website: subData.website || null, investorWebsite: subData.investorWebsite || null,
      businessAddress: subData.addresses?.business || null, mailingAddress: subData.addresses?.mailing || null,
      formerNames: subData.formerNames || [],
      reports: { available_10k_years: available10k.sort((a, b) => b - a), available_10q_years: available10q, last_10K: last10K, last_10Q: last10Q }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/submissions/:identifier', async (req, res) => {
  try {
    let identifier = req.params.identifier;
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/actions/reports/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
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
    res.status(500).json({ error: error.message });
  }
});

app.get('/companyfacts/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const cik = await getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    const factsData = await getCompanyFacts(cik);
    if (!factsData) return res.status(500).json({ error: 'Ошибка получения данных' });
    res.json(factsData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/company-tickers', async (req, res) => {
  try {
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers.json`, { headers: { 'User-Agent': USER_AGENT } });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SEC Proxy server running on port ${PORT}`);
  console.log(`Endpoints available: /catalog, /validate/:metric, /metrics/:ticker, /info/:ticker, /submissions/:identifier, /actions/reports/:ticker, /companyfacts/:ticker, /company-tickers, /ping`);
});
