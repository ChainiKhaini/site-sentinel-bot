/**
 * SiteSentinel Web Status Dashboard
 * Renders a glassmorphic, real-time status page displaying fleet health,
 * outage durations, failure counts, HTTP status codes, and instant edge probe triggers.
 */

import { formatIST, formatDuration, escapeHtml, getColoDisplayName } from "./config.js";

export function renderDashboardHtml(sites = [], workerColo = "DEL") {
  const total = sites.length;
  const up = sites.filter(s => s.status === "UP" && !s.paused).length;
  const down = sites.filter(s => s.status === "DOWN" && !s.paused).length;
  const paused = sites.filter(s => s.paused).length;

  const validLatencies = sites.filter(s => s.lastLatency && s.lastLatency > 0).map(s => s.lastLatency);
  const avgLatency = validLatencies.length > 0
    ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
    : 0;

  const nowMs = Date.now();
  const generationTimeIst = formatIST(new Date(nowMs));
  const coloDisplay = getColoDisplayName(workerColo);

  const siteCardsHtml = sites.length === 0
    ? `<div class="empty-state">
        <div class="empty-icon">🌐</div>
        <h3>No websites being monitored yet</h3>
        <p>Send <code>/add https://your-website.com</code> to your Telegram bot <a href="https://t.me/SiteSentinalBot" target="_blank" rel="noopener">@SiteSentinalBot</a> to start monitoring.</p>
      </div>`
    : sites.map((site, index) => {
        let statusClass = "status-up";
        let statusBadgeText = "ONLINE";
        let isDown = false;

        if (site.paused) {
          statusClass = "status-paused";
          statusBadgeText = "PAUSED";
        } else if (site.status === "DOWN") {
          statusClass = "status-down";
          isDown = true;
          statusBadgeText = site.lastStatusCode ? `OFFLINE (HTTP ${site.lastStatusCode})` : "OFFLINE";
        } else if (site.status === "PENDING") {
          statusClass = "status-pending";
          statusBadgeText = "CHECKING";
        } else {
          statusBadgeText = site.lastStatusCode ? `ONLINE (${site.lastStatusCode} OK)` : "ONLINE";
        }

        const latency = site.lastLatency ? `${site.lastLatency} ms` : "—";
        const colo = site.lastColoName || getColoDisplayName(site.lastColo);
        const lastCheck = site.lastChecked ? formatIST(site.lastChecked) : "Never";
        const uptimePct = site.totalChecks > 0
          ? Math.round(((site.uptimeChecks || 0) / site.totalChecks) * 100)
          : 100;

        // Calculate downtime duration if currently down
        let downtimeHtml = "";
        if (isDown) {
          const downtimeMs = site.downtimeStart ? Math.max(0, nowMs - new Date(site.downtimeStart).getTime()) : null;
          const downtimeFormatted = downtimeMs ? formatDuration(downtimeMs) : "Active";
          const downtimeStartIst = site.downtimeStart ? formatIST(site.downtimeStart) : "Recent";
          const failStreak = site.failureCount || 1;

          downtimeHtml = `
          <div class="outage-panel">
            <div class="outage-header">
              <span class="outage-tag">🔴 OUTAGE ACTIVE</span>
              <span class="outage-duration">Down for <b>${escapeHtml(downtimeFormatted)}</b></span>
            </div>
            <div class="outage-details">
              <div>📅 <b>Down Since:</b> ${escapeHtml(downtimeStartIst)}</div>
              <div>⚡ <b>Streak:</b> ${failStreak} consecutive failure${failStreak === 1 ? "" : "s"} (${site.totalChecks || 0} total checks)</div>
            </div>
          </div>
          `;
        }

        return `
        <div class="site-card ${statusClass}" id="card-${index}">
          <div class="site-header">
            <div class="site-title-box">
              <span class="pulse-indicator"></span>
              <h3 class="site-name" title="${escapeHtml(site.name || site.url)}">${escapeHtml(site.name || site.url)}</h3>
            </div>
            <span class="status-badge ${statusClass}">${escapeHtml(statusBadgeText)}</span>
          </div>

          <div class="site-url">
            <a href="${escapeHtml(site.url)}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(site.url)} ↗
            </a>
          </div>

          ${downtimeHtml}

          ${site.lastError ? `
          <div class="error-banner">
            <span class="error-icon">⚠️</span>
            <span class="error-msg">${escapeHtml(site.lastError)}</span>
          </div>` : ""}

          <div class="metrics-grid">
            <div class="metric">
              <span class="metric-label">Latency</span>
              <span class="metric-val ${site.lastLatency > 800 ? "warn" : ""}" id="lat-${index}">${latency}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Uptime</span>
              <span class="metric-val">${uptimePct}%</span>
            </div>
            <div class="metric">
              <span class="metric-label">Tested From</span>
              <span class="metric-val" title="${escapeHtml(colo)}">${escapeHtml(site.lastColo || "IN")}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Interval</span>
              <span class="metric-val">Every ${site.checkIntervalMins || 15}m</span>
            </div>
          </div>

          <div class="card-actions">
            <button class="btn btn-action" onclick="probeSiteLive('${escapeHtml(site.url)}', ${index}, this)">
              ⚡ Test Live Now
            </button>
            <a href="${escapeHtml(site.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">
              🌐 Open Site
            </a>
          </div>

          <div class="site-footer">
            <span class="last-checked">🕒 Checked: <b>${lastCheck}</b></span>
            <span class="site-id"><code>${escapeHtml(site.id)}</code></span>
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
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111726;
      --card-inner: #0b101c;
      --border: #1e293b;
      --border-subtle: rgba(255, 255, 255, 0.06);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 32px 20px;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 1120px;
      margin: 0 auto;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 28px;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-icon {
      font-size: 32px;
      background: #172136;
      border: 1px solid var(--border);
      padding: 8px 12px;
      border-radius: 12px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .brand-title h1 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .live-dot {
      display: inline-block;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 10px var(--success);
    }
    .brand-title p {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 2px;
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
      transition: all 0.2s ease;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
    }
    .btn:hover { background: #1e293b; border-color: #334155; }
    .btn-tg {
      background: #2563eb;
      border-color: #3b82f6;
      color: white;
    }
    .btn-tg:hover { background: #1d4ed8; }

    /* Summary Bar */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 14px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 18px 20px;
      border-radius: 12px;
      position: relative;
    }
    .summary-card .label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
      margin-bottom: 6px;
      font-weight: 600;
    }
    .summary-card .value {
      font-size: 26px;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
    }
    .summary-card.up .value { color: var(--success); }
    .summary-card.down .value { color: var(--danger); }
    .summary-card.latency .value { color: var(--accent); }

    /* Fleet Section */
    .fleet-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 20px;
    }
    .site-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 22px;
      transition: transform 0.2s, box-shadow 0.2s;
      position: relative;
      display: flex;
      flex-direction: column;
    }
    .site-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 30px -8px rgba(0, 0, 0, 0.5);
    }
    .site-card.status-up { border-left: 5px solid var(--success); }
    .site-card.status-down { border-left: 5px solid var(--danger); }
    .site-card.status-paused { border-left: 5px solid var(--warning); }

    .site-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      gap: 12px;
    }
    .site-title-box {
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 65%;
    }
    .site-name {
      font-size: 16px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .pulse-indicator {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-up .pulse-indicator { background: var(--success); box-shadow: 0 0 8px var(--success); }
    .status-down .pulse-indicator { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
    .status-paused .pulse-indicator { background: var(--warning); }

    .status-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      letter-spacing: 0.5px;
      white-space: nowrap;
      font-family: 'JetBrains Mono', monospace;
    }
    .status-badge.status-up { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .status-badge.status-down { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .status-badge.status-paused { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }

    .site-url {
      margin-bottom: 14px;
    }
    .site-url a {
      font-size: 13px;
      color: var(--text-muted);
      text-decoration: none;
      word-break: break-all;
      transition: color 0.15s;
    }
    .site-url a:hover { color: var(--accent); text-decoration: underline; }

    /* Outage Alert Box */
    .outage-panel {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.28);
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 14px;
    }
    .outage-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      gap: 8px;
    }
    .outage-tag {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: #f87171;
    }
    .outage-duration {
      font-size: 12px;
      color: #fecaca;
    }
    .outage-duration b {
      color: #fff;
    }
    .outage-details {
      font-size: 11px;
      color: #cbd5e1;
      line-height: 1.5;
    }

    .error-banner {
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.25);
      color: #fcd34d;
      font-size: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 14px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .error-icon { flex-shrink: 0; }
    .error-msg { word-break: break-word; font-family: 'JetBrains Mono', monospace; font-size: 11px; }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 12px;
      background: var(--card-inner);
      border-radius: 10px;
      margin-bottom: 14px;
      border: 1px solid var(--border-subtle);
    }
    .metric {
      text-align: center;
    }
    .metric-label {
      display: block;
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .metric-val {
      font-size: 12px;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
    }
    .metric-val.warn { color: var(--warning); }

    .card-actions {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }
    .btn-action {
      flex: 1;
      justify-content: center;
      background: #172136;
      border-color: #2e3e5b;
      font-size: 12px;
      padding: 8px 12px;
    }
    .btn-action:hover { background: #1e2c48; }
    .btn-outline {
      justify-content: center;
      font-size: 12px;
      padding: 8px 12px;
      background: transparent;
      border-color: var(--border);
    }
    .btn-outline:hover { background: #172136; }

    .site-footer {
      margin-top: auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--text-muted);
      border-top: 1px solid var(--border-subtle);
      padding-top: 12px;
    }
    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
      color: #94a3b8;
    }

    /* Toast Notification */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1e293b;
      color: #fff;
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 13px;
      border: 1px solid #334155;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      display: none;
      z-index: 1000;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
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
          <h1>SiteSentinel <span class="live-dot" title="Live Monitoring Active"></span></h1>
          <p>Cloudflare Workers Multi-Website Monitor • Indian Anycast Edge 🇮🇳</p>
        </div>
      </div>
      <div class="header-actions">
        <a href="https://t.me/SiteSentinalBot" target="_blank" rel="noopener" class="btn btn-tg">
          💬 Telegram Bot
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
        Auto-refreshes every 60s • ${escapeHtml(generationTimeIst)}
      </span>
    </div>

    <div class="cards-grid">
      ${siteCardsHtml}
    </div>

    <footer>
      <div>
        Running on <b>Cloudflare Workers Edge</b> • Cron Trigger: <code>*/5 * * * *</code>
      </div>
      <div class="footer-badge">
        📍 Edge POP: <b>${escapeHtml(workerColo)}</b> (${escapeHtml(coloDisplay)})
      </div>
    </footer>
  </div>

  <div id="toast"></div>

  <script>
    function showToast(message, isError = false) {
      const toast = document.getElementById("toast");
      toast.innerText = message;
      toast.style.borderColor = isError ? "#ef4444" : "#10b981";
      toast.style.display = "block";
      setTimeout(() => { toast.style.display = "none"; }, 3500);
    }

    async function probeSiteLive(url, index, btn) {
      if (!btn) return;
      const originalText = btn.innerText;
      btn.disabled = true;
      btn.innerText = "⏳ Probing...";
      try {
        const res = await fetch('/check?url=' + encodeURIComponent(url));
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        
        // Update latency
        const latEl = document.getElementById("lat-" + index);
        if (latEl && data.latencyMs) {
          latEl.innerText = data.latencyMs + " ms";
        }

        const statusLabel = data.statusLabel || (data.isUp ? "ONLINE" : "OFFLINE");
        showToast(statusLabel + " (" + (data.latencyMs || 0) + "ms) via " + (data.colo || "Edge"));
      } catch (err) {
        showToast("Probe failed: " + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerText = originalText;
      }
    }
  </script>
</body>
</html>`;
}
