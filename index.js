const express = require('express');
const fetch = require('node-fetch');

const app = express();

// ============ КОНФИГУРАЦИЯ ============
const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// Кэши
let tickersCache = null;
let tickersCacheTime = 0;
const TICKERS_CACHE_TTL = 3600000; // 1 час

const metricsCache = new Map();
const METRICS_CACHE_TTL = 3600000; // 1 час

// ============ ПОЛНЫЙ СПРАВОЧНИК МЕТРИК ============
const METRICS_CATALOG = {
  // P&L
  revenue: { tags: ['Revenues'], category: 'P&L', ttm: 'sum', ru: 'Выручка' },
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

// ============ ЛОГИКА ПОИСКА МЕТРИК ============
function getTTMValue(sortedValues, metricName) {
  const catalog = METRICS_CATALOG[metricName];
  const ttmType = catalog?.ttm || 'sum';
  
  if (ttmType === 'last') {
    return sortedValues[0]?.val || null;
  }
  
  const quarterly = sortedValues.filter(v => v.fp && v.fp !== 'FY');
  const last4 = quarterly.slice(0, 4);
  if (last4.length === 0) return null;
  return last4.reduce((acc, v) => acc + v.val, 0);
}

function getMetricValue(factsData, metric, year, quarter, scale) {
  const catalog = METRICS_CATALOG[metric];
  if (!catalog) return null;
  
  const usGaap = factsData?.facts?.['us-gaap'];
  if (!usGaap) return null;
  
  function getMetricValue(factsData, metric, year, quarter, scale) {
  const catalog = METRICS_CATALOG[metric];
  if (!catalog) return null;
  
  const usGaap = factsData?.facts?.['us-gaap'];
  if (!usGaap) return null;

  console.log('=== DEBUG getMetricValue ===');
  console.log('Looking for metric:', metric);
  console.log('Tags to try:', catalog.tags);
  console.log('Available tags in us-gaap (first 20):', Object.keys(usGaap).slice(0, 20));
  
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
  
  const sorted = values.sort((a, b) => new Date(b.end) - new Date(a.end));
  
  let result = null;
  
  if (year === undefined && quarter === undefined) {
    result = getTTMValue(sorted, metric);
  } else if (quarter === undefined || quarter === 0 || quarter === null) {
    const annual = sorted.find(v => v.fy === year && v.form === '10-K');
    result = annual?.val || null;
  } else {
    const quarterMap = { 1: 'Q1', 2: 'Q2', 3: 'Q3', 4: 'Q4' };
    const fp = quarterMap[quarter];
    const q = sorted.find(v => v.fy === year && v.fp === fp && v.form === '10-Q');
    result = q?.val || null;
  }
  
  return applyScale(result, scale);
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

// Каталог метрик
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

// Валидация метрики
app.get('/validate/:metric', (req, res) => {
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
});

// Основной эндпоинт для метрик
app.get('/metrics/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const year = req.query.year ? parseInt(req.query.year) : undefined;
    const quarter = req.query.quarter !== undefined ? parseInt(req.query.quarter) : undefined;
    const scale = normalizeScale(req.query.scale);
    
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
      const value = getMetricValue(factsData, metric, year, quarter, scale);
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
    res.status(500).json({ error: error.message });
  }
});

// Информация о компании
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
    res.status(500).json({ error: error.message });
  }
});

// Универсальный эндпоинт для submissions (работает и с тикером, и с CIK)
app.get('/submissions/:identifier', async (req, res) => {
  try {
    let identifier = req.params.identifier;
    let cik = null;
    
    // Если identifier — это CIK (10 цифр, возможно с ведущими нулями)
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } 
    // Иначе считаем, что это тикер
    else {
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

// Отчёты (actions)
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

// Прямой доступ к companyfacts по тикеру
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

// Прямой доступ к company-tickers
app.get('/company-tickers', async (req, res) => {
  try {
    const response = await fetchWithRetry(`${SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

// ============ ЗАПУСК СЕРВЕРА ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SEC Proxy server running on port ${PORT}`);
  console.log(`Endpoints available:`);
  console.log(`  GET /catalog`);
  console.log(`  GET /validate/:metric`);
  console.log(`  GET /metrics/:ticker`);
  console.log(`  GET /info/:ticker`);
  console.log(`  GET /submissions/:identifier  (тикер или CIK)`);
  console.log(`  GET /actions/reports/:ticker`);
  console.log(`  GET /companyfacts/:ticker`);
  console.log(`  GET /company-tickers`);
  console.log(`  GET /ping`);
});
