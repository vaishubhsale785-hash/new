require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN;
const BASE_URL  = process.env.BASE_URL; // MUST be set in Render

if (!BOT_TOKEN || !BASE_URL) {
  console.error("❌ BOT_TOKEN or BASE_URL missing in .env");
  process.exit(1);
}

const VERIFICATION_URL = `${BASE_URL}/verify`;
const HOME_URL         = `${BASE_URL}/home`;

const SIGNUP_BONUS   = 5;
const REFERRAL_BONUS = 5;
const MIN_WITHDRAWAL = 10;
const DAILY_LIMIT    = 1;

// ================= DB =================
const DB_PATH = path.join(__dirname, 'data', 'db.json');

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { users: {}, transactions: [], devices: {} };
  }
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function now() { return new Date().toISOString(); }
function fmt(n) { return parseFloat(n || 0).toFixed(2); }

function genRefCode(tg_id) {
  return 'REF' + crypto.createHash('md5')
    .update(tg_id + Date.now())
    .digest('hex').slice(0, 8).toUpperCase();
}

// ================= BOT =================
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

async function sendMsg(chat_id, text, keyboard = null) {
  try {
    await bot.sendMessage(chat_id, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
    });
  } catch (e) {
    console.log("Bot error:", e.message);
  }
}

// /start
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chat_id = msg.chat.id;
  const ref = (match[1] || '').trim();

  const url = ref
    ? `${VERIFICATION_URL}?ref=${encodeURIComponent(ref)}`
    : VERIFICATION_URL;

  await sendMsg(
    chat_id,
    "✅ Welcome!\n\nClick below to verify your device",
    [[{ text: "🔐 Verify Device", web_app: { url } }]]
  );
});

// fallback
bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/start')) return;

  await sendMsg(
    msg.chat.id,
    "Click below to verify",
    [[{ text: "🔐 Verify", web_app: { url: VERIFICATION_URL } }]]
  );
});

// ================= EXPRESS =================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/verify', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'public/homepage.html')));
app.get('/withdraw', (req, res) => res.sendFile(path.join(__dirname, 'public/withdraw.html')));

// ================= WEBHOOK =================

// DEBUG ROUTE
app.get('/webhook', (req, res) => {
  res.send("Webhook working ✅");
});

// TELEGRAM WEBHOOK
app.post('/webhook', (req, res) => {
  console.log("🔥 Update:", req.body); // debug log
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ================= API (MINIMAL) =================
app.post('/api', (req, res) => {
  const { action, tg_id, device_id } = req.body;

  const db = readDB();

  if (action === "verify") {
    if (!db.users[tg_id]) {
      db.users[tg_id] = {
        tg_id,
        balance: SIGNUP_BONUS,
        referral_code: genRefCode(tg_id),
        created_at: now()
      };
    }

    db.devices[`${tg_id}_${device_id}`] = {
      tg_id,
      device_id,
      verified: true
    };

    writeDB(db);

    return res.json({
      status: "success",
      balance: fmt(db.users[tg_id].balance)
    });
  }

  if (action === "get_balance") {
    return res.json({
      status: "success",
      balance: fmt(db.users[tg_id]?.balance || 0)
    });
  }

  res.json({ status: "error" });
});

// ================= START =================
app.listen(PORT, async () => {
  console.log("🚀 Server running on port", PORT);

  try {
    await bot.setWebHook(`${BASE_URL}/webhook`);
    console.log("✅ Webhook set:", `${BASE_URL}/webhook`);
  } catch (e) {
    console.log("❌ Webhook error:", e.message);
  }
});
