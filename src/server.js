// src/server.js
// Main Express server — wires everything together.

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initDatabase } = require('./config/database');
const apiRouter = require('./routes/api');
const webhookRouter = require('./routes/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────────
// Static files — serves public/ folder
// index.html     → /           (device verification page)
// homepage.html  → /home       (user dashboard)
// withdraw.html  → /withdraw   (flash withdrawal page)
// ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─────────────────────────────────────────────────────────────
// Named page routes (so links like /home work cleanly)
// ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/homepage.html'));
});

app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/withdraw', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/withdraw.html'));
});

// ─────────────────────────────────────────────────────────────
// API Routes
// POST /api  → api.js  (verify / get_balance / withdraw)
// POST /webhook → webhook.js (Telegram bot updates)
// ─────────────────────────────────────────────────────────────
app.use('/api', apiRouter);
app.use('/webhook', webhookRouter);

// Also support legacy PHP-style URLs so existing links still work
app.use('/api.php', apiRouter);
app.use('/withdraw_api.php', apiRouter);

// ─────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDatabase();

    // In production, switch bot to webhook mode
    if (process.env.NODE_ENV === 'production' && process.env.BASE_URL) {
      const bot = require('./config/bot');
      const webhookUrl = `${process.env.BASE_URL}/webhook`;
      await bot.setWebHook(webhookUrl);
      console.log(`🔗 Telegram webhook set to: ${webhookUrl}`);
    }

    app.listen(PORT, () => {
      console.log(`\n🚀 Omni Cash server running on port ${PORT}`);
      console.log(`   → Verification: http://localhost:${PORT}/verify`);
      console.log(`   → Dashboard:    http://localhost:${PORT}/home`);
      console.log(`   → Withdraw:     http://localhost:${PORT}/withdraw`);
      console.log(`   → API:          http://localhost:${PORT}/api`);
      console.log(`   → Webhook:      http://localhost:${PORT}/webhook\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
