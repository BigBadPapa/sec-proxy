// ============ EDGAR_INFO.JS - ЛОГИКА ДЛЯ /INFO И СВЯЗАННЫХ ЭНДПОИНТОВ ==========
// Этот файл содержит логику для статической информации о компаниях

const catalogs = require('./catalogs');
const common = require('./edgar_common');

// ============ 1. ПЕРЕМЕННЫЕ КЭШЕЙ (СПЕЦИФИЧНЫЕ ДЛЯ INFO) ==========
const companyMetaCache = common.companyMetaCache;

// ============ 2. ФУНКЦИЯ РАЗРЕШЕНИЯ АЛИАСОВ ДЛЯ ПОЛЕЙ INFO ==========

function resolveInfoField(alias) {
  if (!alias) return null;
  const normalized = alias.toString().trim().toLowerCase();
  
  if (catalogs.ALIASES[normalized]) {
    return catalogs.ALIASES[normalized];
  }
  
  return alias.toString().trim();
}

// ============ 3. ОСНОВНЫЕ ФУНКЦИИ (ХЭНДЛЕРЫ ДЛЯ ЭНДПОИНТОВ) ==========

async function getInfo(req, res) {
  const tickerRaw = req.params.ticker;
  const fieldRaw = req.query.field;
  
  const ticker = common.normalizeTicker(tickerRaw);
  
  common.log(`GET /info/${ticker}${fieldRaw ? `?field=${fieldRaw}` : ''}`);
  
  try {
    const cik = await common.getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    const subData = await common.getSubmissionsData(cik);
    if (!subData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    if (fieldRaw) {
      const resolvedField = resolveInfoField(fieldRaw);
      const keys = resolvedField.split('.');
      let value = subData;
      for (const key of keys) {
        if (value === null || value === undefined) {
          return res.json({ field: resolvedField, value: null });
        }
        value = value[key];
      }
      return res.json({ field: resolvedField, value: value !== null && value !== undefined ? value : null });
    }
    
    res.json({
      cik: subData.cik,
      name: subData.entityName,
      ein: subData.ein || null,
      entityType: subData.entityType || null,
      description: subData.description || null,
      tickers: subData.tickers || [],
      exchanges: subData.exchanges || [],
      sic: subData.sic || null,
      sicDescription: subData.sicDescription || null,
      category: subData.category || null,
      stateOfIncorporation: subData.stateOfIncorporation || null,
      fiscalYearEnd: subData.fiscalYearEnd || null,
      phone: subData.phone || null,
      website: subData.website || null,
      businessAddress: subData.addresses?.business || null,
      mailingAddress: subData.addresses?.mailing || null,
      formerNames: subData.formerNames || [],
      flags: subData.flags || null
    });
  } catch (error) {
    common.log(`GET /info error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getSubmissions(req, res) {
  const identifier = req.params.identifier;
  common.log(`GET /submissions/${identifier}`);
  
  try {
    let cik;
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await common.getCIK(common.normalizeTicker(identifier));
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const data = await common.getSubmissionsData(cik);
    if (!data) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    res.json(data);
  } catch (error) {
    common.log(`GET /submissions error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyFacts(req, res) {
  const identifier = req.params.identifier;
  common.log(`GET /companyfacts/${identifier}`);
  
  try {
    let cik;
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await common.getCIK(common.normalizeTicker(identifier));
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const data = await common.getCompanyFacts(cik);
    if (!data) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    res.json(data);
  } catch (error) {
    common.log(`GET /companyfacts error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyMeta(req, res) {
  const tickerRaw = req.params.ticker;
  const ticker = common.normalizeTicker(tickerRaw);
  common.log(`GET /company-meta/${ticker}`);
  
  try {
    const cik = await common.getCIK(ticker);
    if (!cik) return res.status(404).json({ error: 'Тикер не найден' });
    
    if (common.CACHE_CONFIG.companyMeta.enabled) {
      const cached = common.getFromCache(companyMetaCache, cik, common.CACHE_CONFIG.companyMeta.ttl);
      if (cached) return res.json(cached);
    }
    
    const subData = await common.getSubmissionsData(cik);
    if (!subData) return res.status(500).json({ error: 'Ошибка получения данных' });
    
    const meta = {
      fiscalYearEnd: subData.fiscalYearEnd || null,
      name: subData.entityName || null,
      category: subData.category || null,
      stateOfIncorporation: subData.stateOfIncorporation || null,
      ticker: ticker,
      sic: subData.sic || null,
      sicDescription: subData.sicDescription || null
    };
    
    if (common.CACHE_CONFIG.companyMeta.enabled) {
      common.setToCache(companyMetaCache, cik, meta, common.CACHE_CONFIG.companyMeta.ttl, common.CACHE_CONFIG.companyMeta.maxSize);
    }
    
    res.json(meta);
  } catch (error) {
    common.log(`GET /company-meta error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyTickers(req, res) {
  common.log('GET /company-tickers');
  try {
    const response = await common.fetchWithRetry(`${common.SEC_BASE}/files/company_tickers.json`, {
      headers: { 'User-Agent': common.USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /company-tickers error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyTickersMF(req, res) {
  common.log('GET /company-tickers-mf');
  try {
    const response = await common.fetchWithRetry(`${common.SEC_BASE}/files/company_tickers_mf.json`, {
      headers: { 'User-Agent': common.USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /company-tickers-mf error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyTickersExchange(req, res) {
  common.log('GET /company-tickers-exchange');
  try {
    const response = await common.fetchWithRetry(`${common.SEC_BASE}/files/company_tickers_exchange.json`, {
      headers: { 'User-Agent': common.USER_AGENT }
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /company-tickers-exchange error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getCompanyConcept(req, res) {
  const identifier = req.params.identifier;
  const taxonomy = req.params.taxonomy;
  const tag = req.params.tag;
  common.log(`GET /companyconcept/${identifier}/${taxonomy}/${tag}`);
  
  try {
    let cik;
    if (/^\d{1,10}$/.test(identifier)) {
      cik = identifier.replace(/^0+/, '').padStart(10, '0');
    } else {
      cik = await common.getCIK(common.normalizeTicker(identifier));
    }
    
    if (!cik) return res.status(404).json({ error: 'Тикер или CIK не найден' });
    
    const url = `${common.DATA_BASE}/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`;
    const response = await common.fetchWithRetry(url, { headers: { 'User-Agent': common.USER_AGENT } });
    if (!response.ok) return res.status(response.status).json({ error: 'Данные не найдены' });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /companyconcept error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

async function getFrames(req, res) {
  const taxonomy = req.params.taxonomy;
  const tag = req.params.tag;
  const unit = req.params.unit;
  const period = req.params.period;
  common.log(`GET /frames/${taxonomy}/${tag}/${unit}/${period}`);
  
  try {
    const url = `${common.DATA_BASE}/api/xbrl/frames/${taxonomy}/${tag}/${unit}/${period}.json`;
    const response = await common.fetchWithRetry(url, { headers: { 'User-Agent': common.USER_AGENT } });
    if (!response.ok) return res.status(response.status).json({ error: 'Данные не найдены' });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    common.log(`GET /frames error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

// ============ 4. ЭКСПОРТ ФУНКЦИЙ ==========

module.exports = {
  getInfo,
  getSubmissions,
  getCompanyFacts,
  getCompanyMeta,
  getCompanyTickers,
  getCompanyTickersMF,
  getCompanyTickersExchange,
  getCompanyConcept,
  getFrames
};
