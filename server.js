// ============================================================
//  OMNI CASH — server.js
//  Single-file Node.js backend
//  DB   → data/db.json  (flat-file, no MySQL)
//  Bot  → Telegram via node-telegram-bot-api
//  API  → POST /api   (verify | get_balance | withdraw)
//  Hook → POST /webhook  (Telegram updates)
//  Pages→ GET /  /home  /withdraw
// ============================================================

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT            = process.env.PORT            || 3000;
const BOT_TOKEN       = process.env.BOT_TOKEN;
const BOT_USERNAME    = process.env.BOT_USERNAME    || 'yourbot';
const BASE_URL        = process.env.BASE_URL        || `http://localhost:${PORT}`;
const VERIFICATION_URL= process.env.VERIFICATION_URL|| `${BASE_URL}/verify`;
const HOME_URL        = process.env.HOME_URL        || `${BASE_URL}/home`;
const SIGNUP_BONUS    = parseFloat(process.env.SIGNUP_BONUS    || 5);
const REFERRAL_BONUS  = parseFloat(process.env.REFERRAL_BONUS  || 5);
const MIN_WITHDRAWAL  = parseFloat(process.env.MIN_WITHDRAWAL  || 10);
const DAILY_LIMIT     = parseInt(process.env.DAILY_WITHDRAWAL_LIMIT || 1);

// ──────────────────────────────────────────────────────────────
//  FLAT-FILE DATABASE  (data/db.json)
//  Schema:
//    users: { [tg_id]: { tg_id, first_name, username,
//                        referral_code, balance, total_earned,
//                        total_withdrawn, referred_by, created_at } }
//    transactions: [ { id, tg_id, amount, type, status,
//                      description, created_at } ]
//    devices: { ["tg_id_deviceId"]: { tg_id, device_id,
//                                     username, first_name,
//                                     verified, verified_at, ip } }
// ──────────────────────────────────────────────────────────────
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

// Helpers
function fmt(n)  { return parseFloat(n || 0).toFixed(2); }
function now()   { return new Date().toISOString(); }
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}
function genRefCode(tg_id) {
  return 'REF' + crypto.createHash('md5')
    .update(tg_id + Date.now() + Math.random())
    .digest('hex').toUpperCase().slice(0, 8);
}
function genTxId() {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

// DB helpers
function getUser(db, tg_id)   { return db.users[String(tg_id)] || null; }
function saveUser(db, user)   { db.users[String(user.tg_id)] = user; }
function addTx(db, tx)        { db.transactions.push({ id: genTxId(), ...tx, created_at: now() }); }
function userTxs(db, tg_id)  {
  return db.transactions
    .filter(t => String(t.tg_id) === String(tg_id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50);
}
function todayWithdrawals(db, tg_id) {
  const today = new Date().toDateString();
  return db.transactions.filter(t =>
    String(t.tg_id) === String(tg_id) &&
    t.type === 'withdraw' &&
    new Date(t.created_at).toDateString() === today
  ).length;
}
function isDeviceVerified(db, tg_id, device_id) {
  return db.devices[`${tg_id}_${device_id}`]?.verified === true;
}
function registerDevice(db, tg_id, device_id, username, first_name, ip) {
  db.devices[`${tg_id}_${device_id}`] = {
    tg_id, device_id, username, first_name,
    verified: true, verified_at: now(), ip
  };
}

// ──────────────────────────────────────────────────────────────
//  TELEGRAM BOT
// ──────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, {
  polling: process.env.NODE_ENV !== 'production'
});

async function sendMsg(chat_id, text, keyboard = null) {
  try {
    const opts = { parse_mode: 'HTML' };
    if (keyboard) opts.reply_markup = { inline_keyboard: keyboard };
    await bot.sendMessage(chat_id, text, opts);
  } catch (e) {
    console.warn('[Bot] sendMsg failed:', e.message);
  }
}

// Bot: handle /start (with optional deep-link referral)
bot.onText(/\/start(.*)/, async (msg, match) => {
  const chat_id  = msg.chat.id;
  const refCode  = (match[1] || '').trim() || null;
  const verifyUrl = refCode
    ? `${VERIFICATION_URL}?ref=${encodeURIComponent(refCode)}`
    : VERIFICATION_URL;

  await sendMsg(
    chat_id,
    '<b>🔐 Secure Device Verification\n\nTap the button below to quickly verify your device.\nIt only takes a few seconds ⚡🔥</b>',
    [[{ text: '🔐 Verify Device', web_app: { url: verifyUrl } }]]
  );
});

bot.onText(/\/home/, async (msg) => {
  await sendMsg(msg.chat.id, '🏠 Tap below to open your dashboard:',
    [[{ text: '🏠 Open Dashboard', web_app: { url: HOME_URL } }]]
  );
});

bot.on('message', async (msg) => {
  const text = msg.text || '';
  if (text.startsWith('/start') || text === '/home') return; // handled above
  await sendMsg(msg.chat.id,
    '<b>🔐 Secure Device Verification\n\nTap below to verify your device ⚡🔥</b>',
    [[{ text: '🔐 Verify Device', web_app: { url: VERIFICATION_URL } }]]
  );
});

bot.on('callback_query', async (cb) => {
  const chat_id    = cb.message.chat.id;
  const message_id = cb.message.message_id;
  const data       = cb.data;

  try { await bot.answerCallbackQuery(cb.id, { text: 'Processing...' }); } catch (_) {}

  let text = '', kb = [];

  switch (data) {
    case 'lock_session':
      text = '🔒 Session locked. Please re-verify to access again.';
      kb   = [[{ text: '🔐 Re-verify Device', web_app: { url: VERIFICATION_URL } }]];
      break;
    case 'view_devices': {
      const db = readDB();
      const devs = Object.values(db.devices).filter(d => String(d.tg_id) === String(chat_id));
      text = devs.length
        ? '📱 <b>Your Verified Devices:</b>\n\n' +
          devs.map(d => `• <code>${String(d.device_id).slice(0,20)}...</code>\n  Verified: ${d.verified_at||'Unknown'}`).join('\n\n')
        : 'No verified devices found.';
      kb = [[{ text: '🏠 Go to Home', web_app: { url: HOME_URL } }]];
      break;
    }
    case 'help':
      text = '<b>Help & Support</b>\n\n• Each device must be verified separately\n• Contact support for assistance\n\n<i>Keep your session secure.</i>';
      kb   = [[{ text: '🏠 Open Vault', web_app: { url: HOME_URL } }]];
      break;
    case 'retry_verification':
      text = '🔄 Please restart the verification process.';
      kb   = [[{ text: '🔐 Start Verification', web_app: { url: VERIFICATION_URL } }]];
      break;
    default:
      text = 'Unknown action.';
  }

  try {
    await bot.editMessageText(text, {
      chat_id, message_id, parse_mode: 'HTML',
      reply_markup: kb.length ? { inline_keyboard: kb } : undefined
    });
  } catch (e) { console.warn('[Bot] editMessage failed:', e.message); }
});

// ──────────────────────────────────────────────────────────────
//  EXPRESS MIDDLEWARE
// ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────────────────────
//  PAGE ROUTES
// ──────────────────────────────────────────────────────────────
const pub = (f) => path.join(__dirname, 'public', f);

app.get('/',         (_, res) => res.sendFile(pub('index.html')));
app.get('/verify',   (_, res) => res.sendFile(pub('index.html')));
app.get('/home',     (_, res) => res.sendFile(pub('homepage.html')));
app.get('/withdraw', (_, res) => res.sendFile(pub('withdraw.html')));
app.get('/health',   (_, res) => res.json({ status: 'ok', time: now() }));

// ──────────────────────────────────────────────────────────────
//  API  —  POST /api   (also accepts /api.php for legacy)
//  Body: { action: 'verify' | 'get_balance' | 'withdraw', ... }
// ──────────────────────────────────────────────────────────────
async function handleAPI(req, res) {
  const action = req.body.action || '';

  // ── verify ────────────────────────────────────────────────
  if (action === 'verify') {
    const { tg_id, tg_username='', tg_first_name='User', device_id, referral_code='' } = req.body;
    if (!tg_id || !device_id)
      return res.json({ status:'error', msg:'Missing required parameters' });

    const db = readDB();
    let user = getUser(db, tg_id);
    const isNewUser = !user;

    if (isNewUser) {
      user = {
        tg_id       : String(tg_id),
        first_name  : tg_first_name,
        username    : tg_username,
        referral_code: genRefCode(tg_id),
        balance     : SIGNUP_BONUS,
        total_earned: 0,
        total_withdrawn: 0,
        referred_by : null,
        created_at  : now()
      };
      saveUser(db, user);
      addTx(db, { tg_id, amount: SIGNUP_BONUS, type:'signup_bonus',
                  status:'completed', description:'Welcome signup bonus' });

      // Handle referral
      if (referral_code) {
        const referrer = Object.values(db.users).find(u => u.referral_code === referral_code);
        if (referrer && String(referrer.tg_id) !== String(tg_id)) {
          referrer.balance      += REFERRAL_BONUS;
          referrer.total_earned += REFERRAL_BONUS;
          saveUser(db, referrer);
          addTx(db, { tg_id: referrer.tg_id, amount: REFERRAL_BONUS,
                      type:'referral_bonus', status:'completed',
                      description:`Referral bonus for inviting ${tg_first_name}` });
          user.referred_by = referral_code;
          saveUser(db, user);

          // Notify referrer
          sendMsg(referrer.tg_id,
            `🎉 <b>Referral Bonus!</b>\n\nYour friend ${tg_first_name} joined!\n💰 You earned ₹${REFERRAL_BONUS} bonus!\n\n<b>Your Code:</b> ${referral_code}`,
            [[{ text:'🏠 Open Dashboard', web_app:{ url: HOME_URL } }]]
          );
        }
      }

      // Welcome new user
      sendMsg(tg_id,
        `✅ <b>Welcome ${tg_first_name}!</b>\n\n💰 ₹${SIGNUP_BONUS} Signup Bonus Added!\n💵 Balance: ₹${fmt(SIGNUP_BONUS)}\n\n👇 Click below to start earning!`,
        [[{ text:'🏠 Open Dashboard', web_app:{ url: HOME_URL } }]]
      );
    }

    // Register device if new
    if (!isDeviceVerified(db, tg_id, device_id)) {
      registerDevice(db, tg_id, device_id, tg_username, tg_first_name, req.ip || 'unknown');
    }

    writeDB(db);

    // Re-read fresh user after all mutations
    const freshUser = getUser(db, tg_id);
    const history   = userTxs(db, tg_id).map(t => ({
      type      : t.type,
      amount    : fmt(t.amount),
      created_at: fmtDate(t.created_at)
    }));

    return res.json({
      status: 'success',
      is_new_user: isNewUser,
      data: {
        balance        : fmt(freshUser.balance),
        first_name     : freshUser.first_name,
        username       : freshUser.username,
        referral_code  : freshUser.referral_code,
        total_earned   : fmt(freshUser.total_earned),
        total_withdrawn: fmt(freshUser.total_withdrawn),
        referred_by    : freshUser.referred_by
      },
      history
    });
  }

  // ── get_balance ───────────────────────────────────────────
  if (action === 'get_balance') {
    const { tg_id, device_id } = req.body;
    if (!tg_id) return res.json({ status:'error', msg:'Missing user ID' });

    const db = readDB();
    if (!isDeviceVerified(db, tg_id, device_id))
      return res.json({ status:'error', msg:'Device not verified' });

    const user = getUser(db, tg_id);
    if (!user) return res.json({ status:'error', msg:'User not found' });

    return res.json({
      status          : 'success',
      balance         : fmt(user.balance),
      total_earned    : fmt(user.total_earned),
      total_withdrawn : fmt(user.total_withdrawn)
    });
  }

  // ── withdraw ──────────────────────────────────────────────
  if (action === 'withdraw') {
    const { tg_id, device_id, upi_id, amount } = req.body;
    const withdrawAmt = parseFloat(amount) || MIN_WITHDRAWAL;

    if (!tg_id || !upi_id)
      return res.json({ status:'error', msg:'Missing parameters' });

    const db = readDB();

    if (!isDeviceVerified(db, tg_id, device_id))
      return res.json({ status:'error', msg:'Device not verified' });

    const user = getUser(db, tg_id);
    if (!user) return res.json({ status:'error', msg:'User not found' });

    if (todayWithdrawals(db, tg_id) >= DAILY_LIMIT)
      return res.json({ status:'error', msg:'Daily withdrawal limit reached. Try again tomorrow.' });

    if (user.balance < withdrawAmt)
      return res.json({ status:'error', msg:`Insufficient balance. You have ₹${fmt(user.balance)}` });

    user.balance         -= withdrawAmt;
    user.total_withdrawn += withdrawAmt;
    saveUser(db, user);
    addTx(db, { tg_id, amount: withdrawAmt, type:'withdraw',
                status:'completed', description:`UPI withdrawal to ${upi_id}` });
    writeDB(db);

    return res.json({
      status     : 'success',
      msg        : 'Withdrawal successful',
      new_balance: fmt(user.balance)
    });
  }

  return res.json({ status:'error', msg:'Invalid action' });
}

// Mount API on both paths (legacy support)
app.post('/api',              handleAPI);
app.post('/api.php',          handleAPI);
app.post('/withdraw_api.php', handleAPI);

// ──────────────────────────────────────────────────────────────
//  WEBHOOK  —  POST /webhook  (Telegram sends updates here in prod)
// ──────────────────────────────────────────────────────────────
app.post('/webhook', (req, res) => {
  res.sendStatus(200);
  bot.processUpdate(req.body); // hand off to node-telegram-bot-api
});

// ──────────────────────────────────────────────────────────────
//  START
// ──────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 Omni Cash running on port ${PORT}`);
  console.log(`   Verify  → http://localhost:${PORT}/verify`);
  console.log(`   Home    → http://localhost:${PORT}/home`);
  console.log(`   Withdraw→ http://localhost:${PORT}/withdraw`);
  console.log(`   API     → POST http://localhost:${PORT}/api`);
  console.log(`   DB      → data/db.json\n`);

  if (process.env.NODE_ENV === 'production') {
    try {
      await bot.setWebHook(`${BASE_URL}/webhook`);
      console.log(`🔗 Webhook set → ${BASE_URL}/webhook`);
    } catch (e) {
      console.warn('⚠️  Webhook setup failed:', e.message);
    }
  }
});
