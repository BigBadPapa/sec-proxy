// ============ EDGAR_METRICS.JS - ЛОГИКА ДЛЯ /METRICS ЭНДПОИНТОВ ===========
// Этот файл содержит ТОЛЬКО логику метрик, без дублирования общих утилит

const common = require('./edgar_common');

// ============ 1. КОНСТАНТЫ (СПЕЦИФИЧНЫЕ ДЛЯ МЕТРИК) ==========

// Константы для длительности кварталов (в днях) - эвристика для metrics
const QUARTER_DAYS = {
  1: { min: 60, max: 120 },   // Q1: 3 месяца
  2: { min: 150, max: 210 },  // Q2: 6 месяцев (YTD)
  3: { min: 240, max: 300 },  // Q3: 9 месяцев (YTD)
  4: { min: 350, max: 370 }   // Q4: 12 месяцев
};

// ============ 2. ПЕРЕМЕННЫЕ КЭШЕЙ (СПЕЦИФИЧНЫЕ ДЛЯ МЕТРИК) ==========
// Используем общие кэши из common, но добавляем специфичные для metrics
const durationCache = new Map();      // Кэш для разницы в днях
const collectAllTagValuesCache = new Map();  // Кэш для collectAllTagValues
const getMetricValuesArrayCache = new Map(); // Кэш для getMetricValuesArray

// ============ 3. ПОЛНЫЙ СПРАВОЧНИК МЕТРИК ==========
const METRICS_CATALOG = {
  // P&L
  revenue: { tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense', 'RegulatedAndUnregulatedOperatingRevenue', 'RegulatedOperatingRevenue', 'InvestmentBankingRevenue', 'GrossInvestmentIncomeOperating'], compute: ['InterestIncomeExpenseNet', 'NoninterestIncome'], operation: 'sum', category: 'P&L', ttm: 'sum', ru: 'Выручка' },
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
  aaa: { tags: ['ExciseAndSalesTaxes'], category: 'P&L', ttm: 'sum', ru: 'Акцизы' },
  
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

// ============ 4. РУССКИЕ АЛИАСЫ ==========
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

// ============ 5. СПЕЦИФИЧНЫЕ ДЛЯ МЕТРИК УТИЛИТЫ ==========

function getDaysDifference(start, end) {
  // Отключённый кэш пока не используем, оставляем как было
  return (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24);
}

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

// ============ 6. ФУНКЦИИ ДЛЯ РАБОТЫ С МЕТРИКАМИ ==========

function getMetricValuesArray(factsData, tagOrAlias) {
  const catalog = METRICS_CATALOG[tagOrAlias];
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
  const catalog = METRICS_CATALOG[metricName];
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
  
  // Годовой отчёт (включая 4q)
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
  
  // Квартальные данные
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
    
    const result = getValueFromTag(tagData.data, catalog.alias || Object.keys(METRICS_CATALOG).find(k => METRICS_CATALOG[k] === catalog), year, quarterParam, isBalanceMetric, ticker, factsData);
    if (result !== null && result !== undefined) {
      common.log(`searchValueInAllTags: найден результат в теге ${tag}: ${result}`);
      return result;
    }
  }
  
  if (catalog.compute && catalog.compute.length > 0) {
    common.log(`searchValueInAllTags: переходим к compute-тегам`);
    let sum = null;
    let validCount = 0;
    
    for (const computeTag of catalog.compute) {
      common.log(`searchValueInAllTags: проверяем compute-тег ${computeTag}`);
      const computeFound = findTagData(factsData, [computeTag]);
      if (!computeFound) {
        common.log(`searchValueInAllTags: compute-тег ${computeTag} не найден`);
        continue;
      }
      
      const computeResult = getValueFromTag(computeFound.data, catalog.alias || Object.keys(METRICS_CATALOG).find(k => METRICS_CATALOG[k] === catalog), year, quarterParam, isBalanceMetric, ticker, factsData);
      if (computeResult !== null && computeResult !== undefined) {
        if (catalog.operation === 'sum') {
          if (sum === null) sum = 0;
          sum += computeResult;
          common.log(`searchValueInAllTags: добавлено ${computeResult}, сумма=${sum}`);
        } else if (catalog.operation === 'subtract') {
          if (sum === null) sum = computeResult;
          else sum -= computeResult;
          common.log(`searchValueInAllTags: вычитание, результат=${sum}`);
        }
        validCount++;
      }
    }
    
    if (validCount > 0 && sum !== null) {
      common.log(`searchValueInAllTags: результат compute: ${sum}`);
      return sum;
    }
  }
  
  common.log(`searchValueInAllTags: результат не найден`);
  return null;
}

function getMetricValueInternal(factsData, metric, year, quarterParam, scale, ticker) {
  const catalog = METRICS_CATALOG[metric];
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
  
  if ((result === null || result === undefined) && catalog.compute && catalog.compute.length > 0) {
    common.log(`getMetricValueInternal: прямой поиск не дал результата, пробуем compute`);
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
      common.log(`getMetricValueInternal: compute результат = ${result}`);
    }
  }
  
  common.log(`getMetricValueInternal: итоговый результат = ${result}`);
  return result !== null ? common.applyScale(result, scale) : null;
}

function getTTMValue(factsData, metricName, scale, ticker) {
  const catalog = METRICS_CATALOG[metricName];
  const ttmType = catalog?.ttm || 'sum';
  
  common.log(`getTTMValue: ticker=${ticker}, metric=${metricName}, ttmType=${ttmType}`);
  
  let allTagValues = collectAllTagValues(factsData, catalog.tags);
  
  if ((!allTagValues || allTagValues.length === 0) && catalog.compute && catalog.compute.length > 0) {
    common.log(`getTTMValue: нет прямых тегов, собираем compute-теги`);
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
    common.log(`getTTMValue: нет значений для метрики ${metricName}`);
    return null;
  }
  
  if (ttmType === 'last') {
    const sortedValues = common.sortByEndDesc(allTagValues);
    const result = sortedValues[0]?.val;
    common.log(`getTTMValue: баланс, последнее значение = ${result}`);
    return common.applyScale(result, scale);
  }
  
  const allReports = common.filterReportsWithFiled(allTagValues);
  if (allReports.length === 0) {
    common.log(`getTTMValue: нет отчётов с filed`);
    return null;
  }
  
  const sortedReports = common.sortByEndDesc(allReports);
  const lastReport = sortedReports[0];
  common.log(`getTTMValue: последний отчёт: form=${lastReport.form}, fy=${lastReport.fy}, fp=${lastReport.fp}, filed=${lastReport.filed}`);
  
  if (lastReport.form === '10-K' || lastReport.form === '20-F' || lastReport.form === '40-F') {
    const annualValue = getMetricValueInternal(factsData, metricName, lastReport.fy, undefined, null, ticker);
    common.log(`getTTMValue: годовой отчёт, значение = ${annualValue}`);
    return common.applyScale(annualValue, scale);
  }
  
  const quarterMatch = lastReport.fp?.match(/^Q([1-4])$/);
  if (!quarterMatch) {
    common.log(`getTTMValue: не удалось определить квартал из fp=${lastReport.fp}`);
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
  common.log(`getTTMValue: собираем кварталы: ${JSON.stringify(quarters)}`);
  
  let sum = 0;
  let validCount = 0;
  
  for (const q of quarters) {
    const quarterParam = `q${q.quarterNum}`;
    const value = getMetricValueInternal(factsData, metricName, q.year, quarterParam, null, ticker);
    common.log(`getTTMValue: квартал ${q.year} Q${q.quarterNum} = ${value}`);
    if (value !== null) {
      sum += value;
      validCount++;
    }
  }
  
  if (validCount === 0) {
    common.log(`getTTMValue: не найдено ни одного квартала`);
    return null;
  }
  
  common.log(`getTTMValue: сумма = ${sum}, validCount=${validCount}`);
  return common.applyScale(sum, scale);
}

function getMetricValue(factsData, metric, year, quarterParam, scale, ticker) {
  const cacheKey = `${ticker}:${metric}:${year}:${quarterParam}`;
  
  if (common.CACHE_CONFIG.metrics.enabled) {
    const cached = common.getFromCache(common.metricsCache, cacheKey, common.CACHE_CONFIG.metrics.ttl);
    if (cached !== null) {
      common.log(`getMetricValue: кэш HIT для ${cacheKey}, значение = ${cached}`);
      return cached !== null ? common.applyScale(cached, scale) : null;
    }
    common.log(`getMetricValue: кэш MISS для ${cacheKey}`);
  }
  
  let value;
  if (year === undefined && quarterParam === undefined) {
    common.log(`getMetricValue: TTM режим`);
    value = getTTMValue(factsData, metric, scale, ticker);
  } else {
    common.log(`getMetricValue: обычный режим (год=${year}, квартал=${quarterParam})`);
    value = getMetricValueInternal(factsData, metric, year, quarterParam, scale, ticker);
  }
  
  if (common.CACHE_CONFIG.metrics.enabled && value !== null) {
    common.setToCache(common.metricsCache, cacheKey, value, common.CACHE_CONFIG.metrics.ttl, common.CACHE_CONFIG.metrics.maxSize);
  }
  
  common.log(`getMetricValue: результат = ${value}`);
  return value !== null ? common.applyScale(value, scale) : null;
}

// ============ 7. ОСНОВНЫЕ ФУНКЦИИ (ХЭНДЛЕРЫ ДЛЯ ЭНДПОИНТОВ) ==========

async function getMetric(req, res) {
  const ticker = req.params.ticker.toUpperCase();
  const year = req.query.year ? parseInt(req.query.year) : undefined;
  const quarter = req.query.quarter !== undefined ? String(req.query.quarter) : undefined;
  const scale = common.normalizeScale(req.query.scale);
  
  common.log(`GET /metrics/${ticker}?year=${year}&quarter=${quarter}&scale=${scale}`);
  
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
    
    const cik = await common.getCIK(ticker);
    if (!cik) {
      common.log(`getCIK вернул null для тикера ${ticker}`);
      return res.status(404).json({ error: 'Тикер не найден' });
    }
    
    const factsData = await common.getCompanyFacts(cik);
    if (!factsData) {
      common.log(`getCompanyFacts вернул null для CIK ${cik}`);
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
    common.log(`GET /metrics error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCatalog(req, res) {
  common.log('GET /catalog');
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
    common.log(`GET /catalog error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function validateMetric(req, res) {
  common.log(`GET /validate/${req.params.metric}`);
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
    common.log(`GET /validate error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// ============ 8. ЭКСПОРТ ФУНКЦИЙ ==========

module.exports = {
  getMetric,
  getCatalog,
  validateMetric,
  // Экспортируем для будущих модулей (ratios, reports)
  getMetricValue,
  METRICS_CATALOG
};
