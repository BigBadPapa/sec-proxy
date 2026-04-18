const express = require('express');
const fetch = require('node-fetch');

const app = express();

app.get('/company/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    
    // 1. Получаем CIK
    const tickersRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': 'MySECProxy contact@example.com' }
    });
    
    const tickers = await tickersRes.json();
    const entry = Object.values(tickers).find(t => t.ticker === ticker);
    
    if (!entry) return res.status(404).json({error: 'Ticker not found'});
    
    const cik = entry.cik_str.toString().padStart(10, '0');
    
    // 2. Получаем submissions (метаданные)
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': 'MySECProxy contact@example.com' }
    });
    
    const subData = await subRes.json();
    
    // 3. Получаем company facts (финансовые данные)
    const factsRes = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { 'User-Agent': 'MySECProxy contact@example.com' }
    });
    
    const factsData = await factsRes.json();
    
    // 4. Извлекаем последние отчёты
    const recentFilings = subData.filings?.recent || {};
    const forms = recentFilings.form || [];
    const filingDates = recentFilings.filingDate || [];
    const reportDates = recentFilings.reportDate || [];
    const accessionNumbers = recentFilings.accessionNumber || [];
    const primaryDocuments = recentFilings.primaryDocument || [];
    
    // Находим последние 10-K и 10-Q
    let last10K = null;
    let last10Q = null;
    
    for (let i = 0; i < forms.length; i++) {
      if (!last10K && forms[i] === '10-K') {
        last10K = {
          form: forms[i],
          filingDate: filingDates[i],
          reportDate: reportDates[i],
          accessionNumber: accessionNumbers[i],
          primaryDocument: primaryDocuments[i]
        };
      }
      if (!last10Q && forms[i] === '10-Q') {
        last10Q = {
          form: forms[i],
          filingDate: filingDates[i],
          reportDate: reportDates[i],
          accessionNumber: accessionNumbers[i],
          primaryDocument: primaryDocuments[i]
        };
      }
      if (last10K && last10Q) break;
    }
    
    // 5. Извлекаем ключевые финансовые показатели из facts
    const usGaap = factsData.facts?.['us-gaap'] || {};
    
    function getLatestValue(tag) {
      const tagData = usGaap[tag];
      if (!tagData) return null;
      
      const units = tagData.units;
      if (!units) return null;
      
      // Берём USD или первую доступную валюту
      const unitKey = Object.keys(units).find(k => k.includes('USD')) || Object.keys(units)[0];
      const values = units[unitKey];
      
      if (!values || values.length === 0) return null;
      
      // Сортируем по дате подачи и берём последнее
      const sorted = values.sort((a, b) => new Date(b.filed) - new Date(a.filed));
      return {
        value: sorted[0].val,
        unit: unitKey,
        filed: sorted[0].filed,
        form: sorted[0].form,
        fy: sorted[0].fy,
        fp: sorted[0].fp
      };
    }
    
    res.json({
      // Основные данные
      cik: cik,
      ticker: ticker,
      name: subData.entityName,
      ein: subData.ein || null,
      description: subData.description || null,
      category: subData.category || null,
      fiscalYearEnd: subData.fiscalYearEnd || null,
      stateOfIncorporation: subData.stateOfIncorporation || null,
      phone: subData.phone || null,
      
      // Адреса
      businessAddress: subData.addresses?.business || null,
      mailingAddress: subData.addresses?.mailing || null,
      
      // Сайты (если есть)
      website: subData.website || null,
      investorWebsite: subData.investorWebsite || null,
      
      // Последние отчёты
      last10K: last10K,
      last10Q: last10Q,
      
      // Финансовые показатели (последние доступные)
      financials: {
        assets: getLatestValue('Assets'),
        liabilities: getLatestValue('Liabilities'),
        stockholdersEquity: getLatestValue('StockholdersEquity'),
        revenue: getLatestValue('Revenues') || getLatestValue('RevenueFromContractWithCustomerExcludingAssessedTax'),
        netIncome: getLatestValue('NetIncomeLoss'),
        operatingIncome: getLatestValue('OperatingIncomeLoss'),
        cashAndEquivalents: getLatestValue('CashAndCashEquivalentsAtCarryingValue'),
        totalDebt: getLatestValue('LongTermDebt') || getLatestValue('DebtLongtermAndShorttermCombinedAmount'),
        sharesOutstanding: getLatestValue('CommonStockSharesOutstanding') || getLatestValue('CommonStockSharesIssued')
      }
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({error: error.message, stack: error.stack});
  }
});

app.get('/ping', (req, res) => {
  res.json({status: 'alive'});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
