const express = require('express');
const fetch = require('node-fetch');

const app = express();

app.get('/company/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    
    const tickersRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': 'MySECProxy contact@example.com' }
    });
    
    const tickers = await tickersRes.json();
    const entry = Object.values(tickers).find(t => t.ticker === ticker);
    
    if (!entry) return res.status(404).json({error: 'Ticker not found'});
    
    const cik = entry.cik_str.toString().padStart(10, '0');
    
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': 'MySECProxy contact@example.com' }
    });
    
    const data = await subRes.json();
    
    res.json({
      cik: cik,
      name: data.entityName,
      investorWebsite: data.investorWebsite || null,
      website: data.website || null,
      category: data.category || null
    });
    
  } catch (error) {
    res.status(500).json({error: error.message});
  }
});

app.get('/ping', (req, res) => {
  res.json({status: 'alive'});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
