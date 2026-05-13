// src/routes/api.js
// Replaces api.php — handles verify, get_balance, withdraw actions.

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const deviceStore = require('../config/deviceStore');
const { generateReferralCode, fmt, fmtDate } = require('../config/helpers');
const bot = require('../config/bot');
require('dotenv').config();

const HOME_URL = process.env.HOME_URL;
const SIGNUP_BONUS = parseFloat(process.env.SIGNUP_BONUS || 5);
const REFERRAL_BONUS = parseFloat(process.env.REFERRAL_BONUS || 5);
const MIN_WITHDRAWAL = parseFloat(process.env.MIN_WITHDRAWAL || 10);

// ─────────────────────────────────────────────────────────────
// POST /api
// Body: { action, tg_id, ... }
// ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const action = req.body.action || '';

  try {
    switch (action) {
      case 'verify':
        return await handleVerify(req, res);
      case 'get_balance':
        return await handleGetBalance(req, res);
      case 'withdraw':
        return await handleWithdraw(req, res);
      default:
        return res.json({ status: 'error', msg: 'Invalid action' });
    }
  } catch (err) {
    console.error(`[API] Error in action "${action}":`, err);
    return res.json({ status: 'error', msg: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// ACTION: verify
// Called from index.html when a user opens the mini-app.
// Creates the user if new, handles referrals, registers device.
// ─────────────────────────────────────────────────────────────
async function handleVerify(req, res) {
  const { tg_id, tg_username = '', tg_first_name = 'User', device_id, referral_code = '' } = req.body;

  if (!tg_id || !device_id) {
    return res.json({ status: 'error', msg: 'Missing required parameters' });
  }

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT * FROM users WHERE tg_id = ?', [tg_id]);
    const isNewUser = rows.length === 0;

    if (isNewUser) {
      const newRefCode = generateReferralCode(tg_id);

      await conn.query(
        `INSERT INTO users (tg_id, first_name, username, referral_code, balance, total_earned, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [tg_id, tg_first_name, tg_username, newRefCode, SIGNUP_BONUS, 0]
      );

      // Signup bonus transaction
      await conn.query(
        `INSERT INTO transactions (tg_id, amount, type, description, created_at)
         VALUES (?, ?, 'signup_bonus', 'Welcome signup bonus', NOW())`,
        [tg_id, SIGNUP_BONUS]
      );

      // Process referral
      if (referral_code) {
        const [refRows] = await conn.query(
          'SELECT tg_id, first_name FROM users WHERE referral_code = ?',
          [referral_code]
        );

        if (refRows.length > 0) {
          const referrer = refRows[0];

          // Credit referrer
          await conn.query(
            `UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE tg_id = ?`,
            [REFERRAL_BONUS, REFERRAL_BONUS, referrer.tg_id]
          );

          await conn.query(
            `INSERT INTO transactions (tg_id, amount, type, description, created_at)
             VALUES (?, ?, 'referral_bonus', ?, NOW())`,
            [referrer.tg_id, REFERRAL_BONUS, `Referral bonus for inviting ${tg_first_name}`]
          );

          // Mark new user's referred_by
          await conn.query(
            'UPDATE users SET referred_by = ? WHERE tg_id = ?',
            [referral_code, tg_id]
          );

          // Notify referrer via Telegram
          try {
            await bot.sendMessage(
              referrer.tg_id,
              `🎉 <b>Referral Bonus!</b>\n\nYour friend ${tg_first_name} joined using your link!\n💰 You earned ₹${REFERRAL_BONUS}.00 bonus!\n\n<b>Your Referral Code:</b> ${referral_code}`,
              { parse_mode: 'HTML' }
            );
          } catch (e) {
            console.warn('[Bot] Could not notify referrer:', e.message);
          }
        }
      }

      // Welcome message to new user
      try {
        await bot.sendMessage(
          tg_id,
          `✅ <b>Welcome ${tg_first_name}!</b>\n\n💰 ₹${SIGNUP_BONUS} Signup Bonus Added!\n💵 Balance: ₹${SIGNUP_BONUS}.00\n\n👇 Click below to start earning!`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{ text: '🏠 Open Dashboard', web_app: { url: HOME_URL } }]],
            },
          }
        );
      } catch (e) {
        console.warn('[Bot] Could not send welcome message:', e.message);
      }
    }

    // Register device if not already verified
    if (!deviceStore.isVerified(tg_id, device_id)) {
      deviceStore.register(tg_id, device_id, tg_username, tg_first_name, req.ip);
    }

    // Fetch final user data
    const [userRows] = await conn.query('SELECT * FROM users WHERE tg_id = ?', [tg_id]);
    const user = userRows[0];

    // Transaction history (last 50)
    const [historyRows] = await conn.query(
      'SELECT type, amount, created_at FROM transactions WHERE tg_id = ? ORDER BY created_at DESC LIMIT 50',
      [tg_id]
    );

    const history = historyRows.map((tx) => ({
      type: tx.type,
      amount: fmt(tx.amount),
      created_at: fmtDate(tx.created_at),
    }));

    return res.json({
      status: 'success',
      is_new_user: isNewUser,
      data: {
        balance: fmt(user.balance),
        first_name: user.first_name,
        username: user.username,
        referral_code: user.referral_code,
        total_earned: fmt(user.total_earned),
        total_withdrawn: fmt(user.total_withdrawn),
        referred_by: user.referred_by,
      },
      history,
    });
  } finally {
    conn.release();
  }
}

// ─────────────────────────────────────────────────────────────
// ACTION: get_balance
// Called from homepage.php / withdrawa.html refresh button.
// ─────────────────────────────────────────────────────────────
async function handleGetBalance(req, res) {
  const { tg_id, device_id } = req.body;

  if (!tg_id) return res.json({ status: 'error', msg: 'Missing user ID' });

  if (!deviceStore.isVerified(tg_id, device_id)) {
    return res.json({ status: 'error', msg: 'Device not verified' });
  }

  const [rows] = await pool.query(
    'SELECT balance, total_earned, total_withdrawn FROM users WHERE tg_id = ?',
    [tg_id]
  );

  if (!rows.length) return res.json({ status: 'error', msg: 'User not found' });

  const u = rows[0];
  return res.json({
    status: 'success',
    balance: fmt(u.balance),
    total_earned: fmt(u.total_earned),
    total_withdrawn: fmt(u.total_withdrawn),
  });
}

// ─────────────────────────────────────────────────────────────
// ACTION: withdraw
// Called from withdrawa.html submit form.
// ─────────────────────────────────────────────────────────────
async function handleWithdraw(req, res) {
  const { tg_id, device_id, upi_id, amount } = req.body;
  const withdrawAmount = parseFloat(amount) || MIN_WITHDRAWAL;

  if (!tg_id || !upi_id) return res.json({ status: 'error', msg: 'Missing parameters' });

  if (!deviceStore.isVerified(tg_id, device_id)) {
    return res.json({ status: 'error', msg: 'Device not verified' });
  }

  const conn = await pool.getConnection();
  try {
    // Check daily withdrawal limit
    const [todayRows] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM transactions
       WHERE tg_id = ? AND type = 'withdraw'
         AND DATE(created_at) = CURDATE()`,
      [tg_id]
    );
    if (todayRows[0].cnt >= parseInt(process.env.DAILY_WITHDRAWAL_LIMIT || 1)) {
      return res.json({ status: 'error', msg: 'Daily withdrawal limit reached. Try again tomorrow.' });
    }

    // Check balance
    const [userRows] = await conn.query('SELECT balance FROM users WHERE tg_id = ?', [tg_id]);
    if (!userRows.length) return res.json({ status: 'error', msg: 'User not found' });

    const balance = parseFloat(userRows[0].balance);
    if (balance < withdrawAmount) {
      return res.json({ status: 'error', msg: `Insufficient balance. You have ₹${fmt(balance)}` });
    }

    // Deduct balance
    await conn.query(
      `UPDATE users
       SET balance = balance - ?, total_withdrawn = total_withdrawn + ?
       WHERE tg_id = ?`,
      [withdrawAmount, withdrawAmount, tg_id]
    );

    // Record transaction
    await conn.query(
      `INSERT INTO transactions (tg_id, amount, type, status, description, created_at)
       VALUES (?, ?, 'withdraw', 'completed', ?, NOW())`,
      [tg_id, withdrawAmount, `UPI withdrawal to ${upi_id}`]
    );

    const [updated] = await conn.query('SELECT balance FROM users WHERE tg_id = ?', [tg_id]);

    return res.json({
      status: 'success',
      msg: 'Withdrawal successful',
      new_balance: fmt(updated[0].balance),
    });
  } finally {
    conn.release();
  }
}

module.exports = router;
