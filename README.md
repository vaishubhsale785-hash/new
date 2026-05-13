# Omni Cash — Node.js Telegram Mini App

A complete rewrite of the PHP-based Omni Cash Telegram bot + mini-app in **Node.js + Express**.

---

## Project Structure

```
omni-cash/
├── .env                        # All config — update this first!
├── package.json
├── data/
│   └── verified_devices.json   # Device registry (auto-created)
├── public/                     # Static frontend (served by Express)
│   ├── index.html              # Device verification page  (/verify or /)
│   ├── homepage.html           # User dashboard            (/home)
│   └── withdraw.html           # Flash withdraw page       (/withdraw)
└── src/
    ├── server.js               # Express app entry point
    ├── config/
    │   ├── database.js         # MySQL pool + table init
    │   ├── bot.js              # Telegram bot instance
    │   ├── deviceStore.js      # Verified devices JSON store
    │   └── helpers.js          # Shared utilities
    └── routes/
        ├── api.js              # POST /api  (verify / get_balance / withdraw)
        └── webhook.js          # POST /webhook  (Telegram updates)
```

---

## How All Files Link Together

```
Telegram User
    │
    │  /start command
    ▼
webhook.js  ──► sends "Verify Device" button (web_app URL → /verify)
    │
    │  User taps button
    ▼
public/index.html  (device verification mini-app)
    │
    │  POST /api  { action: 'verify', tg_id, device_id, referral_code }
    ▼
src/routes/api.js  handleVerify()
    │  ├── Creates user in MySQL (users table)
    │  ├── Adds signup_bonus transaction
    │  ├── Processes referral → credits referrer → notifies via bot
    │  └── Registers device in data/verified_devices.json
    │
    │  Redirects to /home on success
    ▼
public/homepage.html  (dashboard)
    │
    │  POST /api  { action: 'get_balance', tg_id, device_id }
    ▼
src/routes/api.js  handleGetBalance()
    │
    │  User clicks Withdraw
    ▼
public/withdraw.html  (flash withdraw)
    │
    │  POST /api  { action: 'withdraw', tg_id, device_id, upi_id, amount }
    ▼
src/routes/api.js  handleWithdraw()
    └── Deducts balance, records transaction, returns new_balance
```

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure `.env`
Edit `.env` and update:
- `BOT_TOKEN` — your Telegram bot token from @BotFather
- `BOT_USERNAME` — your bot's username (without @)
- `BASE_URL` — your server's public HTTPS URL
- `VERIFICATION_URL` — full URL to your verify page
- `HOME_URL` — full URL to your homepage
- Database credentials

### 3. Set up MySQL
Import the provided SQL file into your MySQL database:
```bash
mysql -u your_user -p your_database < dhmorqom_patil1.sql
```
Or let the app auto-create tables on first start.

### 4. Run

**Development** (with auto-reload):
```bash
npm run dev
```

**Production**:
```bash
npm start
```

---

## Setting the Telegram Webhook (Production)

In production, the server automatically sets the webhook when `NODE_ENV=production` and `BASE_URL` is set.

Or set it manually:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -d "url=https://yourdomain.com/webhook"
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api` | Main API (verify / get_balance / withdraw) |
| `POST` | `/webhook` | Telegram bot webhook receiver |
| `GET` | `/` or `/verify` | Device verification page |
| `GET` | `/home` | User dashboard |
| `GET` | `/withdraw` | Flash withdraw page |
| `GET` | `/health` | Server health check |

> Legacy PHP URLs (`/api.php`, `/withdraw_api.php`) are also supported for backward compatibility.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | `development` or `production` | `development` |
| `BOT_TOKEN` | Telegram bot token | — |
| `BOT_USERNAME` | Bot username (no @) | — |
| `BASE_URL` | Public HTTPS URL of your server | — |
| `VERIFICATION_URL` | Full URL to verify page | — |
| `HOME_URL` | Full URL to dashboard | — |
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | — |
| `DB_PASS` | MySQL password | — |
| `DB_NAME` | MySQL database name | — |
| `SIGNUP_BONUS` | Signup bonus amount (₹) | `5.00` |
| `REFERRAL_BONUS` | Referral bonus amount (₹) | `5.00` |
| `MIN_WITHDRAWAL` | Minimum withdrawal amount (₹) | `10.00` |
| `DAILY_WITHDRAWAL_LIMIT` | Max withdrawals per day | `1` |
