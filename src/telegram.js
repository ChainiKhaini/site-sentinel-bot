/**
 * SiteSentinel Telegram UI & Bot API Wrapper
 */

import { formatIST, formatDuration } from "./config.js";

/**
 * Escape HTML special characters for Telegram HTML mode
 */
export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(botToken, chatId, text, options = {}) {
  if (!botToken || !chatId) {
    console.error("sendTelegramMessage: Missing botToken or chatId");
    return null;
  }

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: options.disablePreview !== false,
    ...options
  };

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!data.ok) {
      console.error("Telegram API Error:", data.description);
    }
    return data;
  } catch (err) {
    console.error("Failed to send Telegram message:", err.message);
    return null;
  }
}

/**
 * Edit an existing message
 */
export async function editTelegramMessage(botToken, chatId, messageId, text, inlineKeyboard = null) {
  if (!botToken || !chatId || !messageId) return null;

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };

  if (inlineKeyboard) {
    payload.reply_markup = { inline_keyboard: inlineKeyboard };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.error("Failed to edit Telegram message:", err.message);
    return null;
  }
}

/**
 * Acknowledge Telegram callback query
 */
export async function answerCallbackQuery(botToken, callbackQueryId, text = "", showAlert = false) {
  if (!botToken || !callbackQueryId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert
      })
    });
  } catch (err) {
    console.error("Failed to answer callback query:", err.message);
  }
}

/**
 * Build /help and /start message
 */
export function buildHelpMessage() {
  return `🛡️ <b>SiteSentinel — Multi-Website Uptime Monitor</b>
━━━━━━━━━━━━━━━━━━━━
Monitors websites 24/7 on Cloudflare Workers with Indian edge intelligence.

⚡ <b>Instant Diagnostics:</b>
• <code>/check &lt;url&gt;</code> — Live status check (latency, SSL, edge colo)

📋 <b>Watchlist Management:</b>
• <code>/add &lt;url&gt; [name] [interval_mins]</code> — Add website (e.g. <code>/add mysite.com Blog 5</code>)
• <code>/interval &lt;id or url&gt; &lt;minutes&gt;</code> — Change check frequency (e.g. 5, 10, 15, 30, 60)
• <code>/remove &lt;url or id&gt;</code> — Stop monitoring and remove site
• <code>/stop &lt;url or id&gt;</code> — Alias for remove
• <code>/list</code> — View all monitored sites & current status
• <code>/status</code> — Fleet summary (Total, UP, DOWN, avg latency)
• <code>/pause &lt;url or id&gt;</code> — Pause automated checks
• <code>/resume &lt;url or id&gt;</code> — Resume automated checks

⚙️ <b>Preferences & Control:</b>
• <code>/settings</code> — View and adjust global defaults
• <code>/help</code> — Show this manual

💡 <i>Custom check intervals supported per website! When a site goes down, SiteSentinel continues checking on schedule and alerts you upon recovery!</i>`;
}

/**
 * Build instant /check response
 */
export function buildCheckResultMessage(url, result, isMonitored = false, siteId = null) {
  let statusIcon = "🟢";
  if (result.category === "RESTRICTED") statusIcon = "🟡";
  else if (!result.isUp) statusIcon = "🔴";

  const statusBadge = result.statusLabel || (result.isUp ? "UP / ONLINE" : "DOWN / OFFLINE");
  const titleLine = result.title ? `\n🏷 <b>Page Title:</b> ${escapeHtml(result.title)}` : "";
  const serverLine = result.server && result.server !== "Unknown" && result.server !== "N/A"
    ? `\n💻 <b>Server:</b> <code>${escapeHtml(result.server)}</code>`
    : "";
  const errorLine = !result.isUp && result.error
    ? `\n⚠️ <b>Error:</b> <code>${escapeHtml(result.error)}</code>`
    : "";
  const noteLine = result.note
    ? `\n💡 <b>Note:</b> <i>${escapeHtml(result.note)}</i>`
    : "";

  return `${statusIcon} <b>Website Diagnostic Result</b>
━━━━━━━━━━━━━━━━━━━━
🌐 <b>Target:</b> <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>
📊 <b>Status:</b> <b>${escapeHtml(statusBadge)}</b>
⏱ <b>Response Time:</b> <b>${result.latencyMs}ms</b>
📍 <b>Checked From:</b> <b>${escapeHtml(result.coloName)}</b>${titleLine}${serverLine}${errorLine}${noteLine}
🕒 <b>Checked At:</b> ${formatIST(new Date())}
━━━━━━━━━━━━━━━━━━━━
${isMonitored ? "✅ <i>This website is in your monitoring watchlist.</i>" : "💡 <i>Use <code>/add " + escapeHtml(url) + " [name] [minutes]</code> to monitor this site.</i>"}`;
}

/**
 * Build /list message with status badges
 */
export function buildSiteListMessage(sites) {
  if (!sites || sites.length === 0) {
    return `📋 <b>Monitored Websites (0)</b>
━━━━━━━━━━━━━━━━━━━━
You don't have any websites in your monitoring watchlist yet.

👉 Add one now:
<code>/add https://example.com My Website 15</code>`;
  }

  let text = `📋 <b>Monitored Websites (${sites.length})</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;

  sites.forEach((site, index) => {
    let icon = "🟢";
    let stateDesc = "UP";
    if (site.paused) {
      icon = "⏸️";
      stateDesc = "PAUSED";
    } else if (site.status === "DOWN") {
      icon = "🔴";
      stateDesc = `DOWN (${site.failureCount || 1} fails)`;
    } else if (site.status === "PENDING") {
      icon = "⏳";
      stateDesc = "PENDING";
    }

    const latency = site.lastLatency ? `${site.lastLatency}ms` : "—";
    const colo = site.lastColo ? site.lastColo : "Edge";
    const lastCheck = site.lastChecked ? formatIST(site.lastChecked).split(", ")[1] : "Not yet";
    const interval = site.checkIntervalMins || 15;

    text += `${index + 1}. ${icon} <b>${escapeHtml(site.name || site.url)}</b>\n`;
    text += `   🔗 <a href="${escapeHtml(site.url)}">${escapeHtml(site.url)}</a>\n`;
    text += `   📊 State: <b>${stateDesc}</b> | ⏱ ${latency} | ⏰ Every ${interval}m\n`;
    text += `   🕒 Last: ${lastCheck} | 🆔 <code>${site.id}</code>\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💡 <i>Commands: <code>/check &lt;id&gt;</code> | <code>/interval &lt;id&gt; &lt;mins&gt;</code> | <code>/pause &lt;id&gt;</code> | <code>/remove &lt;id&gt;</code></i>`;
  return text;
}

/**
 * Build /status fleet overview
 */
export function buildFleetStatusMessage(sites, settings) {
  const total = sites.length;
  const up = sites.filter(s => s.status === "UP" && !s.paused).length;
  const down = sites.filter(s => s.status === "DOWN" && !s.paused).length;
  const paused = sites.filter(s => s.paused).length;
  const pending = sites.filter(s => s.status === "PENDING" && !s.paused).length;

  const validLatencies = sites.filter(s => s.lastLatency && s.lastLatency > 0).map(s => s.lastLatency);
  const avgLatency = validLatencies.length > 0
    ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
    : 0;

  return `📊 <b>SiteSentinel Fleet Status</b>
━━━━━━━━━━━━━━━━━━━━
🌐 <b>Total Websites:</b> ${total}
🟢 <b>Online / UP:</b> <b>${up}</b>
🔴 <b>Offline / DOWN:</b> <b>${down}</b>
⏸️ <b>Paused:</b> ${paused}
⏳ <b>Pending Checks:</b> ${pending}
⏱ <b>Average Latency:</b> ${avgLatency > 0 ? `${avgLatency}ms` : "N/A"}
⏰ <b>Check Interval:</b> Every ${settings.checkIntervalMins} minutes
📍 <b>Indian Data Centers:</b> DEL / BOM / BLR / MAA / HYD
🕒 <b>System Time:</b> ${formatIST(new Date())}
━━━━━━━━━━━━━━━━━━━━
${down > 0 ? `🚨 <b>Attention:</b> ${down} website(s) currently down!` : "✅ All monitored active websites are healthy."}`;
}

/**
 * Build high-priority DOWNTIME alert
 */
export function buildDowntimeAlertMessage(site, result) {
  const downtimeDuration = site.downtimeStart
    ? formatDuration(Date.now() - new Date(site.downtimeStart).getTime())
    : "Just now";

  const interval = site.checkIntervalMins || 15;

  return `🚨 <b>WEBSITE DOWN ALERT!</b>
━━━━━━━━━━━━━━━━━━━━
❌ <b>Target:</b> <a href="${escapeHtml(site.url)}">${escapeHtml(site.name || site.url)}</a>
🔗 <b>URL:</b> <code>${escapeHtml(site.url)}</code>
⚠️ <b>Reason:</b> <b>${escapeHtml(result.error || "Connection failed")}</b>
📊 <b>Status Code:</b> ${result.statusCode ? `HTTP ${result.statusCode}` : "No Response (0)"}
⏱ <b>Latency:</b> ${result.latencyMs}ms
📍 <b>Detected From:</b> ${escapeHtml(result.coloName)}
⏳ <b>Downtime So Far:</b> ${downtimeDuration}
🔄 <b>Consecutive Failures:</b> ${site.failureCount || 1}
⏰ <b>Check Interval:</b> Every ${interval} minutes
🕒 <b>Triggered At:</b> ${formatIST(new Date())}
━━━━━━━━━━━━━━━━━━━━
🔄 <i>SiteSentinel will continue checking this site every ${interval} minutes. You will only receive a message when the status changes.</i>`;
}

/**
 * Build RECOVERY alert
 */
export function buildRecoveryAlertMessage(site, result, downtimeMs) {
  const durationText = downtimeMs ? formatDuration(downtimeMs) : "Unknown duration";

  return `✅ <b>WEBSITE RECOVERED!</b>
━━━━━━━━━━━━━━━━━━━━
🎉 <b>Target:</b> <a href="${escapeHtml(site.url)}">${escapeHtml(site.name || site.url)}</a>
🔗 <b>URL:</b> <code>${escapeHtml(site.url)}</code>
🟢 <b>Status:</b> <b>HTTP ${result.statusCode} OK</b>
⏱ <b>Response Time:</b> <b>${result.latencyMs}ms</b>
📍 <b>Checked From:</b> ${escapeHtml(result.coloName)}
⌛ <b>Total Downtime:</b> <b>${durationText}</b>
🕒 <b>Recovered At:</b> ${formatIST(new Date())}
━━━━━━━━━━━━━━━━━━━━
✨ <i>The website is fully accessible again. SiteSentinel will continue monitoring and only notify you if the status changes.</i>`;
}

/**
 * Build /settings message
 */
export function buildSettingsMessage(settings) {
  const alertModeText = settings.onlyNotifyOnStatusChange
    ? "Status Change Only (quiet while unchanged) ✅"
    : (settings.alertRepeatHours > 0 ? `Every ${settings.alertRepeatHours}h while down` : "Status Change Only ✅");

  return `⚙️ <b>SiteSentinel Configuration</b>
━━━━━━━━━━━━━━━━━━━━
⏱ <b>Default Interval:</b> Every ${settings.checkIntervalMins} minutes
🔔 <b>Alert Mode:</b> ${alertModeText}
⌛ <b>Request Timeout:</b> ${settings.timeoutMs / 1000} seconds
🔄 <b>Max Retries:</b> ${settings.maxRetries} (to prevent false alarms)
🌍 <b>Timezone:</b> ${settings.timezone}
━━━━━━━━━━━━━━━━━━━━
💡 <i>Change default interval anytime with <code>/settings interval &lt;minutes&gt;</code> or customize individual sites with <code>/interval &lt;id&gt; &lt;minutes&gt;</code>.</i>`;
}

/**
 * Build inline keyboard for downtime alert
 */
export function buildDowntimeKeyboard(siteId, url) {
  return [
    [
      { text: "🔄 Re-check Now", callback_data: `check:${siteId}` },
      { text: "⏱ Change Interval", callback_data: `pickint:${siteId}` }
    ],
    [
      { text: "⏸ Pause", callback_data: `pause:${siteId}` },
      { text: "🛑 Stop Monitoring", callback_data: `remove:${siteId}` }
    ],
    [
      { text: "🌐 Open Site", url: url }
    ]
  ];
}

/**
 * Build interval selector keyboard
 */
export function buildIntervalSelectionKeyboard(siteId) {
  return [
    [
      { text: "⚡ 5 Min", callback_data: `setint:${siteId}:5` },
      { text: "⏱ 10 Min", callback_data: `setint:${siteId}:10` },
      { text: "⏰ 15 Min", callback_data: `setint:${siteId}:15` }
    ],
    [
      { text: "🕐 30 Min", callback_data: `setint:${siteId}:30` },
      { text: "⌛ 1 Hour", callback_data: `setint:${siteId}:60` },
      { text: "📅 2 Hours", callback_data: `setint:${siteId}:120` }
    ],
    [
      { text: "🔙 Cancel", callback_data: `cancel_interval:${siteId}` }
    ]
  ];
}

/**
 * Build inline keyboard for site list
 */
export function buildSiteActionsKeyboard(sites) {
  if (!sites || sites.length === 0) return null;

  const buttons = [];
  const topSites = sites.slice(0, 3);
  const row1 = topSites.map(s => ({
    text: `🔄 ${s.name ? s.name.slice(0, 10) : s.id.slice(0, 8)}`,
    callback_data: `check:${s.id}`
  }));
  buttons.push(row1);

  const row2 = topSites.map(s => ({
    text: `⏱ ${s.name ? s.name.slice(0, 8) : s.id.slice(0, 6)} (${s.checkIntervalMins || 15}m)`,
    callback_data: `pickint:${s.id}`
  }));
  buttons.push(row2);

  buttons.push([
    { text: "📊 Refresh Status", callback_data: "fleet_status" }
  ]);

  return buttons;
}
