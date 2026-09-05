# 🛡️ SiteSentinel — Multi-Website Uptime Monitor & Telegram Bot

A serverless website health and uptime monitoring system built on **Cloudflare Workers**, **Cloudflare KV**, and **Cron Triggers**, specifically engineered with **India Edge (DEL / BOM / BLR / MAA) detection** and Telegram bot controls.

---

## 🌟 Key Capabilities

- 🤖 **Interactive Telegram Bot**: Instant website diagnostics, adding/removing websites, pausing/resuming, and fleet status updates.
- ⚡ **Cloudflare India Edge Routing**: Detects execution datacenter colo (`request.cf.colo`, e.g., DEL - New Delhi, BOM - Mumbai, BLR - Bengaluru) and shows latency from the Indian edge.
- ⏰ **15-Minute Continuous Loop**: Cloudflare Workers Cron Trigger runs every 15 minutes (`*/15 * * * *`).
- 🚨 **Autonomous Downtime Recovery Engine**:
  - If a website fails: Sends an instant high-priority **DOWNTIME ALERT** with HTTP error, latency, and interactive buttons (`[🔄 Recheck Now]`, `[⏸ Pause]`, `[🛑 Stop Monitoring]`, `[🌐 Open Site]`).
  - Automatically re-checks the down site every 15 minutes.
  - When the website recovers: Sends an immediate **RECOVERY ALERT** with total downtime duration (e.g. `Down for 45m 12s`).
- 👥 **Multi-Website Support**: Monitors dozens of websites simultaneously with rolling latency and uptime history.
- 🖥️ **Live Web Dashboard**: Modern responsive status page showing real-time health cards, response times, and status badges.
- 🔒 **Secure**: Restricts bot access to your authorized Telegram Chat ID (`TELEGRAM_CHAT_ID`) and supports webhook secret tokens.
- 🔕 **Status-Change Alerting**: Only alerts when status actually changes (UP ➔ DOWN or DOWN ➔ UP), remaining silent and spam-free while unchanged.

---

## 🕹️ Telegram Commands

| Command | Description | Example |
| :--- | :--- | :--- |
| `/start` or `/help` | Show command guide and help manual | `/help` |
| `/check <url>` | Instant live check of any website right now | `/check https://google.com` |
| `/add <url> [name] [interval]` | Add website to the monitor with custom interval | `/add https://myapi.in API Server 5` |
| `/interval <id\|url> [minutes]` | View or change check frequency (5m, 10m, 15m, 30m, 1h, 2h) | `/interval myapi 10` |
| `/remove <id\|url>` | Stop monitoring and remove website | `/remove https://myapi.in` |
| `/stop <id\|url>` | Alias for `/remove` | `/stop site_myapi_in_xyz` |
| `/list` | Show all monitored websites & status badges | `/list` |
| `/status` | Fleet health summary & average latency | `/status` |
| `/pause <id\|url>` | Temporarily pause automated checks | `/pause myapi.in` |
| `/resume <id\|url>` | Resume automated checks | `/resume myapi.in` |
| `/settings` | View active check intervals and timeouts | `/settings` |

---

## 🛠️ Project Structure

```
site-sentinel-bot/
├── src/
│   ├── index.js       # Main Cloudflare Worker router & Webhook handler
│   ├── monitor.js     # 15-minute scheduled monitoring engine
│   ├── checker.js     # Latency probe, DNS/SSL/HTTP diagnostics & retries
│   ├── store.js       # Cloudflare KV store layer for websites & history
│   ├── telegram.js    # Telegram Bot API client & HTML UI builders
│   ├── dashboard.js   # Embedded Web Status Dashboard HTML/CSS
│   └── config.js      # Indian Colos map (DEL/BOM/BLR), intervals & defaults
├── tests/
│   └── checker.test.js# Automated test suite
├── wrangler.toml      # Cloudflare Worker configuration & Cron triggers
├── package.json       # Scripts & dependencies
└── .dev.vars          # Local environment secrets
```

---

## 🚀 Deployment & Setup

### 1. Set Secrets in Cloudflare
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# Enter your Telegram Bot Token (from @BotFather)

npx wrangler secret put TELEGRAM_CHAT_ID
# Enter your Telegram Chat ID

npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# Enter your random secure webhook secret token
```

### 2. Deploy Worker
```bash
npm run deploy
```

### 3. Register Telegram Webhook
Open in your browser:
```
https://<YOUR_WORKER_SUBDOMAIN>.workers.dev/setup-webhook
```
Or use the Telegram API:
```bash
curl -F "url=https://<YOUR_WORKER_SUBDOMAIN>.workers.dev/webhook" \
     -F "secret_token=<YOUR_WEBHOOK_SECRET>" \
     https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook
```
