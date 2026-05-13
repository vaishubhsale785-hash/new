// src/config/bot.js
// Telegram Bot instance (shared across the app)

const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  // Use webhook in production, polling in dev
  polling: process.env.NODE_ENV !== 'production',
});

module.exports = bot;
