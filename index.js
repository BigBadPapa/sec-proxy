// ============ INDEX.JS - ТОЧКА ВХОДА (ROUTER) ============
// Этот файл только запускает сервер и подключает endpoints.js

const express = require('express');
const app = express();

// Подключаем все эндпоинты из endpoints.js
const endpoints = require('./endpoints');

// Монтируем все эндпоинты на корневой путь
app.use('/', endpoints);

// Health check (можно оставить здесь или перенести в endpoints.js)
app.get('/ping', (req, res) => {
  res.json({ 
    status: 'alive', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Простой логгер для отладки (опционально)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Обработка 404 (не найден)
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.url,
    method: req.method
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`SEC Proxy server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/ping`);
  console.log(`Metrics: http://localhost:${PORT}/metrics/AAPL?metrics=revenue`);
  console.log(`Info: http://localhost:${PORT}/info/AAPL`);
  console.log(`Catalog: http://localhost:${PORT}/catalog`);
  console.log(`========================================`);
});

module.exports = app; // для тестирования (опционально)
