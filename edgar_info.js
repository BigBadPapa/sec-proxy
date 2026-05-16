const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// ============ КОНФИГУРАЦИЯ ============
const USER_AGENT = 'GoogleSheetsSEC contact@example.com';
const SEC_BASE = 'https://www.sec.gov';
const DATA_BASE = 'https://data.sec.gov';

// ============ ПРОСТОЙ КЭШ (только для CIK) ============
let tickersCache = null;
let tickersCacheTime = 0;
const TICKERS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`[${timestamp}] ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        log(`Rate limited, waiting ${delay}ms...`);
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

// ============ ЭНДПОИНТ INFO ============
router.get('/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  log(`GET /info/${ticker}`);
  
  try {
    const cik = await getCIK(ticker);
    if (!cik) {
      return res.status(404).json({ error: 'Тикер не найден' });
    }
    
    const subData = await getSubmissions(cik);
    if (!subData) {
      return res.status(500).json({ error: 'Ошибка получения данных' });
    }
    
    // Формируем ответ (сейчас только базовая информация)
    const response = {
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
      tickers: subData.tickers || [],
      exchanges: subData.exchanges || [],
      sic: subData.sic || null,
      sicDescription: subData.sicDescription || null,
      entityType: subData.entityType || null,
      flags: subData.flags || null
    };
    
    res.json(response);
    
  } catch (error) {
    log(`GET /info error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
