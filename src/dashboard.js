/**
 * SiteSentinel Web Status Dashboard
 */

import { formatIST } from "./config.js";

export function renderDashboardHtml(sites = [], workerColo = "DEL") {
  const total = sites.length;
  const up = sites.filter(s => s.status === "UP" && !s.paused).length;
  const down = sites.filter(s => s.status === "DOWN" && !s.paused).length;
  const paused = sites.filter(s => s.paused).length;

  const validLatencies = sites.filter(s => s.lastLatency && s.lastLatency > 0).map(s => s.lastLatency);
  const avgLatency = validLatencies.length > 0
    ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
    : 0;

  const siteCardsHtml = sites.length === 0
    ? `<div class="empty-state">
        <div class="empty-icon">🌐</div>
        <h3>No websites being monitored yet</h3>
        <p>Send <code>/add https://your-website.com</code> to your Telegram bot <a href="https://t.me/SiteSentinalBot" target="_blank">@SiteSentinalBot</a> to get started!</p>
      </div>`
    : sites.map(site => {
        let statusClass = "status-up";
        let statusText = "ONLINE";
        if (site.paused) {
          statusClass = "status-paused";
          statusText = "PAUSED";
        } else if (site.status === "DOWN") {
          statusClass = "status-down";
          statusText = "OFFLINE";
        } else if (site.status === "PENDING") {
          statusClass = "status-pending";
          statusText = "CHECKING";
        }

        const latency = site.lastLatency ? `${site.lastLatency} ms` : "—";
        const colo = site.lastColoName || (site.lastColo ? `${site.lastColo} (Edge)` : "Cloudflare Edge");
        const lastCheck = site.lastChecked ? formatIST(site.lastChecked) : "Never";
        const uptimePct = site.totalChecks > 0
          ? Math.round((site.uptimeChecks / site.totalChecks) * 100)
          : 100;

        return `
        <div class="site-card ${statusClass}">
          <div class="site-header">
            <div class="site-title-box">
              <span class="pulse-indicator"></span>
              <h3 class="site-name">${escapeHtml(site.name || site.url)}</h3>
            </div>
            <span class="status-badge ${statusClass}">${statusText}</span>
          </div>

          <div class="site-url">
            <a href="${escapeHtml(site.url)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(site.url)} ↗
            </a>
          </div>

          <div class="metrics-grid">
            <div class="metric">
              <span class="metric-label">Latency</span>
              <span class="metric-val ${site.lastLatency > 800 ? "warn" : ""}">${latency}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Uptime</span>
              <span class="metric-val">${uptimePct}%</span>
            </div>
            <div class="metric">
              <span class="metric-label">Location</span>
              <span class="metric-val" title="${escapeHtml(colo)}">${escapeHtml(site.lastColo || "IN")}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Checks</span>
              <span class="metric-val">${site.totalChecks || 0}</span>
            </div>
          </div>

          ${site.lastError ? `<div class="error-banner">⚠️ ${escapeHtml(site.lastError)}</div>` : ""}

          <div class="site-footer">
            <span class="last-checked">🕒 ${lastCheck}</span>
            <span class="site-id">⏰ Every <b>${site.checkIntervalMins || 15}m</b> | <code>${site.id}</code></span>
          </div>
        </div>
        `;
      }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SiteSentinel — Live Website Fleet Status</title>
  <meta http-equiv="refresh" content="60">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111726;
      --border: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --glow-success: rgba(16, 185, 129, 0.2);
      --glow-danger: rgba(239, 68, 68, 0.2);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 32px 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
      gap: 16px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon {
      font-size: 32px;
      background: #1e293b;
      padding: 8px;
      border-radius: 12px;
      line-height: 1;
    }
    .brand-title h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .brand-title p {
      font-size: 13px;
      color: var(--text-muted);
    }
    .header-actions {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 9px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
    }
    .btn:hover { background: #1e293b; }
    .btn-tg {
      background: #2563eb;
      border-color: #3b82f6;
      color: white;
    }
    .btn-tg:hover { background: #1d4ed8; }

    /* Summary Bar */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .summary-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 18px;
      border-radius: 12px;
      position: relative;
      overflow: hidden;
    }
    .summary-card .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .summary-card .value {
      font-size: 28px;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
    }
    .summary-card.up .value { color: var(--success); }
    .summary-card.down .value { color: var(--danger); }
    .summary-card.latency .value { color: var(--accent); }

    /* Cards Grid */
    .fleet-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
      gap: 20px;
    }
    .site-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
      transition: transform 0.2s, box-shadow 0.2s;
      position: relative;
    }
    .site-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .site-card.status-up { border-left: 4px solid var(--success); }
    .site-card.status-down { border-left: 4px solid var(--danger); }
    .site-card.status-paused { border-left: 4px solid var(--warning); }

    .site-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .site-title-box {
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 70%;
    }
    .site-name {
      font-size: 16px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pulse-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-up .pulse-indicator { background: var(--success); box-shadow: 0 0 8px var(--success); }
    .status-down .pulse-indicator { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
    .status-paused .pulse-indicator { background: var(--warning); }

    .status-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 6px;
      letter-spacing: 0.5px;
    }
    .status-badge.status-up { background: rgba(16, 185, 129, 0.15); color: var(--success); }
    .status-badge.status-down { background: rgba(239, 68, 68, 0.15); color: var(--danger); }
    .status-badge.status-paused { background: rgba(245, 158, 11, 0.15); color: var(--warning); }

    .site-url {
      margin-bottom: 16px;
    }
    .site-url a {
      font-size: 13px;
      color: var(--text-muted);
      text-decoration: none;
      word-break: break-all;
    }
    .site-url a:hover { color: var(--accent); text-decoration: underline; }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 12px;
      background: #0d121f;
      border-radius: 10px;
      margin-bottom: 12px;
      border: 1px solid rgba(255, 255, 255, 0.04);
    }
    .metric {
      text-align: center;
    }
    .metric-label {
      display: block;
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .metric-val {
      font-size: 13px;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }
    .metric-val.warn { color: var(--warning); }

    .error-banner {
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      margin-bottom: 12px;
    }

    .site-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--text-muted);
      border-top: 1px solid rgba(255, 255, 255, 0.04);
      padding-top: 10px;
    }
    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 5px;
      border-radius: 4px;
    }

    /* Empty state */
    .empty-state {
      grid-column: 1 / -1;
      text-align: center;
      padding: 60px 20px;
      background: var(--card-bg);
      border-radius: 16px;
      border: 1px dashed var(--border);
    }
    .empty-icon { font-size: 48px; margin-bottom: 16px; }
    .empty-state h3 { font-size: 18px; margin-bottom: 8px; }
    .empty-state p { color: var(--text-muted); font-size: 14px; }
    .empty-state a { color: var(--accent); }

    footer {
      margin-top: 48px;
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      border-top: 1px solid var(--border);
      padding-top: 24px;
    }
    .footer-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #1e293b;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-icon">🛡️</div>
        <div class="brand-title">
          <h1>SiteSentinel</h1>
          <p>Cloudflare Workers Multi-Website Monitor • India Edge</p>
        </div>
      </div>
      <div class="header-actions">
        <a href="https://t.me/SiteSentinalBot" target="_blank" class="btn btn-tg">
          💬 Open Telegram Bot
        </a>
        <button onclick="location.reload()" class="btn">
          🔄 Refresh
        </button>
      </div>
    </header>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">Total Monitored</div>
        <div class="value">${total}</div>
      </div>
      <div class="summary-card up">
        <div class="label">Online / Up</div>
        <div class="value">${up}</div>
      </div>
      <div class="summary-card down">
        <div class="label">Offline / Down</div>
        <div class="value">${down}</div>
      </div>
      <div class="summary-card">
        <div class="label">Paused</div>
        <div class="value">${paused}</div>
      </div>
      <div class="summary-card latency">
        <div class="label">Avg Latency</div>
        <div class="value">${avgLatency > 0 ? avgLatency + "ms" : "—"}</div>
      </div>
    </div>

    <div class="fleet-title">
      <span>Fleet Overview (${total})</span>
      <span style="font-size: 12px; color: var(--text-muted); font-weight: normal;">
        Auto-refreshes every 60s
      </span>
    </div>

    <div class="cards-grid">
      ${siteCardsHtml}
    </div>

    <footer>
      <div>
        Running on <b>Cloudflare Workers Edge</b> • Cron Trigger: <code>*/15 * * * *</code>
      </div>
      <div class="footer-badge">
        📍 Executed from: <b>${escapeHtml(workerColo)}</b>
      </div>
    </footer>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
