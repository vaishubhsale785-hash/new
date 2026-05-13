// src/routes/webhook.js
// Replaces webhook.php — receives Telegram bot updates via POST /webhook.
// In production: set your Telegram webhook to https://yourdomain.com/webhook

const express = require('express');
const router = express.Router();
const bot = require('../config/bot');
const deviceStore = require('../config/deviceStore');
require('dotenv').config();

const VERIFICATION_URL = process.env.VERIFICATION_URL;
const HOME_URL = process.env.HOME_URL;

// ─────────────────────────────────────────────────────────────
// POST /webhook
// Telegram sends all bot updates here.
// ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const update = req.body;
  if (!update) return res.sendStatus(400);

  // Always respond 200 to Telegram immediately
  res.sendStatus(200);

  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
  }
});

// ─────────────────────────────────────────────────────────────
// Handle inline keyboard callbacks
// ─────────────────────────────────────────────────────────────
async function handleCallbackQuery(callback) {
  const chat_id = callback.message.chat.id;
  const message_id = callback.message.message_id;
  const data = callback.data;

  // Acknowledge immediately
  try {
    await bot.answerCallbackQuery(callback.id, { text: 'Processing...' });
  } catch (_) {}

  let text = '';
  let keyboard = [];

  switch (data) {
    case 'lock_session':
      text = '🔒 Session locked. Please re-verify to access again.';
      keyboard = [[{ text: '🔐 Re-verify Device', web_app: { url: VERIFICATION_URL } }]];
      break;

    case 'view_devices': {
      const devices = deviceStore.getByUser(chat_id);
      if (devices.length > 0) {
        text = '📱 <b>Your Verified Devices:</b>\n\n';
        devices.forEach((d) => {
          text += `• Device: <code>${String(d.device_id).substring(0, 20)}...</code>\n`;
          text += `  Verified: ${d.verified_at || 'Unknown'}\n\n`;
        });
      } else {
        text = 'No verified devices found.';
      }
      keyboard = [[{ text: '🏠 Go to Home', web_app: { url: HOME_URL } }]];
      break;
    }

    case 'help':
      text =
        '<b>Help & Support</b>\n\n' +
        '• Your device is secured with fingerprint authentication\n' +
        '• Each device must be verified separately\n' +
        '• Contact support for assistance\n\n' +
        '<i>Keep your verification session secure.</i>';
      keyboard = [[{ text: '🏠 Open Vault', web_app: { url: HOME_URL } }]];
      break;

    case 'retry_verification':
      text = '🔄 Please restart the verification process.';
      keyboard = [[{ text: '🔐 Start Verification', web_app: { url: VERIFICATION_URL } }]];
      break;

    case 'support':
      text = 'For support, please contact the administrator.';
      keyboard = [[{ text: '🔐 Verify Device', web_app: { url: VERIFICATION_URL } }]];
      break;

    default:
      text = 'Unknown action.';
      keyboard = [];
  }

  try {
    await bot.editMessageText(text, {
      chat_id,
      message_id,
      parse_mode: 'HTML',
      reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined,
    });
  } catch (e) {
    console.warn('[Webhook] editMessageText failed:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Handle regular text messages
// ─────────────────────────────────────────────────────────────
async function handleMessage(message) {
  const chat_id = message.chat.id;
  const text = message.text || '';
  const username = message.chat.username || '';
  const first_name = message.chat.first_name || '';

  console.log(`[Bot] Message from ${chat_id}: ${text}`);

  const verifyKeyboard = {
    inline_keyboard: [[{ text: '🔐 Verify Device', web_app: { url: VERIFICATION_URL } }]],
  };
  const homeKeyboard = {
    inline_keyboard: [[{ text: '🏠 Open Vault', web_app: { url: HOME_URL } }]],
  };

  if (text === '/start' || text.startsWith('/start ')) {
    // Extract referral code from deep link: /start REF_CODE
    const parts = text.split(' ');
    const refCode = parts[1] || null;

    const welcomeText =
      '<b>🔐 Secure Device Verification\n\n' +
      'Tap the button below to quickly verify your device.\n' +
      'It only takes a few seconds ⚡🔥</b>\n\n';

    // Pass referral code in VERIFICATION_URL as query param if provided
    const verifyUrl = refCode
      ? `${VERIFICATION_URL}?ref=${encodeURIComponent(refCode)}`
      : VERIFICATION_URL;

    await bot.sendMessage(chat_id, welcomeText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '🔐 Verify Device', web_app: { url: verifyUrl } }]],
      },
    });
  } else if (text === '/verify') {
    await bot.sendMessage(chat_id, '🔄 Tap the button below to start device verification:', {
      parse_mode: 'HTML',
      reply_markup: verifyKeyboard,
    });
  } else if (text === '/home') {
    await bot.sendMessage(chat_id, '🏠 Tap below to open your secure vault:', {
      parse_mode: 'HTML',
      reply_markup: homeKeyboard,
    });
  } else {
    // Default for any other message
    await bot.sendMessage(
      chat_id,
      '<b>🔐 Secure Device Verification\n\nTap the button below to quickly verify your device.\nIt only takes a few seconds ⚡🔥</b>\n\n',
      {
        parse_mode: 'HTML',
        reply_markup: verifyKeyboard,
      }
    );
  }
}

module.exports = router;
