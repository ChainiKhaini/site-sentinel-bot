/**
 * SiteSentinel — Cloudflare Worker Entry Point
 * Multi-Website Uptime Monitor & Telegram Bot
 */

import {
  getAllSites,
  findSite,
  addSite,
  removeSite,
  setSitePaused,
  updateSiteInterval,
  getSettings,
  saveSettings,
  recordCheckResult
} from "./store.js";
import { checkWebsite } from "./checker.js";
import { performScheduledMonitoring } from "./monitor.js";
import {
  sendTelegramMessage,
  editTelegramMessage,
  answerCallbackQuery,
  buildHelpMessage,
  buildCheckResultMessage,
  buildSiteListMessage,
  buildFleetStatusMessage,
  buildSettingsMessage,
  buildDowntimeKeyboard,
  buildIntervalSelectionKeyboard,
  buildSiteActionsKeyboard,
  escapeHtml
} from "./telegram.js";
import { renderDashboardHtml } from "./dashboard.js";
import { formatIST, getColoDisplayName } from "./config.js";

// ─── Telegram Webhook Dispatcher ────────────────────────────

async function handleTelegramUpdate(update, env, ctx, workerColo) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const configuredChatId = String(env.TELEGRAM_CHAT_ID || "");

  // 1. Handle Inline Button Clicks (Callback Queries)
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = String(cq.message?.chat?.id || "");
    const messageId = cq.message?.message_id;
    const data = cq.data || "";

    if (configuredChatId && chatId !== configuredChatId) {
      await answerCallbackQuery(botToken, cq.id, "Unauthorized user", true);
      return;
    }

    if (data.startsWith("check:")) {
      const siteId = data.replace("check:", "");
      const site = await findSite(env.SITE_SENTINEL_STORE, siteId);
      if (!site) {
        await answerCallbackQuery(botToken, cq.id, "Site not found", true);
        return;
      }

      await answerCallbackQuery(botToken, cq.id, `Checking ${site.name || site.url}...`);
      try {
        const result = await checkWebsite(site.url, { workerColo, timeoutMs: 6000, maxRetries: 0 });
        await recordCheckResult(env.SITE_SENTINEL_STORE, site.id, result);
        const text = buildCheckResultMessage(site.url, result, true, site.id);
        await sendTelegramMessage(botToken, chatId, text, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Re-check Again", callback_data: `check:${site.id}` }],
              [{ text: "🌐 Open Site", url: site.url }]
            ]
          }
        });
      } catch (err) {
        await sendTelegramMessage(botToken, chatId, `❌ <b>Check Failed:</b> ${escapeHtml(err.message || "Connection timed out")}`);
      }
      return;
    }

    if (data.startsWith("pause:")) {
      const siteId = data.replace("pause:", "");
      const res = await setSitePaused(env.SITE_SENTINEL_STORE, siteId, true);
      if (res.success) {
        await answerCallbackQuery(botToken, cq.id, `Paused monitoring for ${res.site.name || res.site.url}`);
        await sendTelegramMessage(botToken, chatId, `⏸️ <b>Monitoring paused</b> for <code>${escapeHtml(res.site.url)}</code>.\nUse <code>/resume ${res.site.id}</code> to resume.`);
      } else {
        await answerCallbackQuery(botToken, cq.id, res.message, true);
      }
      return;
    }

    if (data.startsWith("remove:")) {
      const siteId = data.replace("remove:", "");
      const res = await removeSite(env.SITE_SENTINEL_STORE, siteId);
      if (res.success) {
        await answerCallbackQuery(botToken, cq.id, `Stopped monitoring ${res.site.name || res.site.url}`);
        await sendTelegramMessage(botToken, chatId, `🛑 <b>Stopped monitoring</b> and removed <code>${escapeHtml(res.site.url)}</code>.`);
      } else {
        await answerCallbackQuery(botToken, cq.id, res.message, true);
      }
      return;
    }

    if (data.startsWith("pickint:")) {
      const siteId = data.replace("pickint:", "");
      const site = await findSite(env.SITE_SENTINEL_STORE, siteId);
      if (!site) {
        await answerCallbackQuery(botToken, cq.id, "Site not found", true);
        return;
      }
      await answerCallbackQuery(botToken, cq.id, "Select frequency");
      await sendTelegramMessage(botToken, chatId, `⏱ <b>Select check frequency for ${escapeHtml(site.name || site.url)}:</b>\nCurrent schedule: Every <b>${site.checkIntervalMins || 15} minutes</b>`, {
        reply_markup: { inline_keyboard: buildIntervalSelectionKeyboard(site.id) }
      });
      return;
    }

    if (data.startsWith("setint:")) {
      const parts = data.split(":");
      const siteId = parts[1];
      const mins = parseInt(parts[2], 10) || 15;
      const res = await updateSiteInterval(env.SITE_SENTINEL_STORE, siteId, mins);
      if (res.success) {
        await answerCallbackQuery(botToken, cq.id, `Updated to ${mins}m!`);
        await sendTelegramMessage(botToken, chatId, `⏱ <b>Check Frequency Updated!</b>\nTarget: <b>${escapeHtml(res.site.name || res.site.url)}</b>\n⏰ <b>New Schedule:</b> Checking every <b>${mins} minutes</b>.`);
      } else {
        await answerCallbackQuery(botToken, cq.id, res.message, true);
      }
      return;
    }

    if (data.startsWith("cancel_interval:")) {
      await answerCallbackQuery(botToken, cq.id, "Cancelled");
      return;
    }

    if (data === "fleet_status") {
      const sites = await getAllSites(env.SITE_SENTINEL_STORE);
      const settings = await getSettings(env.SITE_SENTINEL_STORE, env);
      const statusMsg = buildFleetStatusMessage(sites, settings);
      await answerCallbackQuery(botToken, cq.id, "Status refreshed");
      await sendTelegramMessage(botToken, chatId, statusMsg, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Refresh Status", callback_data: "fleet_status" }],
            [{ text: "📋 View All Sites", callback_data: "view_list" }]
          ]
        }
      });
      return;
    }

    if (data === "view_list") {
      const sites = await getAllSites(env.SITE_SENTINEL_STORE);
      const listMsg = buildSiteListMessage(sites);
      const keyboard = buildSiteActionsKeyboard(sites);
      await answerCallbackQuery(botToken, cq.id, "Fleet list loaded");
      await sendTelegramMessage(botToken, chatId, listMsg, {
        reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
      });
      return;
    }

    if (data === "add_site") {
      await answerCallbackQuery(botToken, cq.id, "Send /add <url>");
      await sendTelegramMessage(botToken, chatId, "💡 <b>To add to monitoring watchlist:</b>\nType: <code>/add &lt;url&gt; [name] [interval_mins]</code>\n\nExamples:\n• <code>/add example.com 5</code> (checks every 5m)\n• <code>/add example.com 15</code> (checks every 15m)");
      return;
    }

    await answerCallbackQuery(botToken, cq.id, "Action processed");
    return;
  }

  // 2. Handle Text Messages & Commands
  const msg = update?.message;
  if (!msg || !msg.text || !msg.chat) return;

  const chatId = String(msg.chat.id);

  // Authorization check
  if (configuredChatId && chatId !== configuredChatId) {
    console.warn(`Unauthorized command from chat ID: ${chatId}`);
    await sendTelegramMessage(botToken, chatId, "⛔ <b>Access Denied:</b> You are not authorized to use this SiteSentinel instance.");
    return;
  }

  const rawText = msg.text.trim();
  const parts = rawText.split(/\s+/);
  const command = parts[0].toLowerCase().replace(/@.+$/, "");
  const arg = parts.slice(1).join(" ").trim();

  // /start and /help
  if (command === "/start" || command === "/help") {
    await sendTelegramMessage(botToken, chatId, buildHelpMessage());
    return;
  }

  // /check <url or id> — Instant diagnostic check
  if (command === "/check") {
    if (!arg) {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Please specify a website URL.</b>\nExample: <code>/check https://google.com</code> or <code>/check mydomain.in</code>");
      return;
    }

    const existingSite = await findSite(env.SITE_SENTINEL_STORE, arg);
    const targetUrl = existingSite ? existingSite.url : (arg.startsWith("http") ? arg : `https://${arg}`);
    const coloDisplayName = getColoDisplayName(workerColo);

    await sendTelegramMessage(botToken, chatId, `🔍 <b>Probing website via Cloudflare Edge...</b>\n📍 Edge Location: <b>${escapeHtml(coloDisplayName)}</b>\n🌐 Target: <code>${escapeHtml(targetUrl)}</code>`);

    try {
      const result = await checkWebsite(targetUrl, { workerColo, timeoutMs: 6000, maxRetries: 0 });
      const isMonitored = Boolean(existingSite);
      const responseText = buildCheckResultMessage(targetUrl, result, isMonitored, existingSite?.id);

      const keyboard = [];
      if (!isMonitored) {
        keyboard.push([{ text: "➕ Add to Monitor", callback_data: `add_site` }]);
      } else {
        keyboard.push([{ text: "🔄 Re-check Again", callback_data: `check:${existingSite.id}` }]);
      }
      keyboard.push([{ text: "🌐 Open Site", url: targetUrl }]);

      await sendTelegramMessage(botToken, chatId, responseText, {
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (err) {
      console.error("Check command error:", err);
      await sendTelegramMessage(botToken, chatId, `🔴 <b>Check Failed:</b> Connection timed out or unreachable\n🌐 Target: <code>${escapeHtml(targetUrl)}</code>\n⚠️ <i>${escapeHtml(err.message || "Host did not respond")}</i>`);
    }
    return;
  }

  // /add <url> [name] [interval_mins] — Add to watchlist
  if (command === "/add") {
    if (!arg) {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Usage:</b> <code>/add &lt;url&gt; [name] [interval_mins]</code>\nExamples:\n• <code>/add https://myshop.in 5</code> (checks every 5m)\n• <code>/add https://myshop.in My Shop 10</code> (checks every 10m)\n• <code>/add https://myshop.in</code> (uses default interval)");
      return;
    }

    const tokens = arg.split(/\s+/);
    const inputUrl = tokens[0];
    let customName = "";
    let customInterval = null;

    if (tokens.length > 1) {
      const lastToken = tokens[tokens.length - 1];
      const parsedMins = parseInt(lastToken.replace(/m(in(s)?)?$/i, ""), 10);
      if (!isNaN(parsedMins) && parsedMins > 0 && parsedMins <= 1440 && (tokens.length > 2 || !lastToken.includes("."))) {
        customInterval = parsedMins;
        customName = tokens.slice(1, tokens.length - 1).join(" ").trim();
      } else {
        customName = tokens.slice(1).join(" ").trim();
      }
    }

    const settings = await getSettings(env.SITE_SENTINEL_STORE, env);
    const intervalMins = customInterval || settings.checkIntervalMins || 15;

    try {
      const newSite = await addSite(env.SITE_SENTINEL_STORE, {
        url: inputUrl,
        name: customName,
        checkIntervalMins: intervalMins
      });

      await sendTelegramMessage(botToken, chatId, `⏳ Adding <b>${escapeHtml(newSite.name)}</b> and performing initial health check...`);

      // Run initial check immediately with fast timeout
      const initialResult = await checkWebsite(newSite.url, { workerColo, timeoutMs: 6000, maxRetries: 0 });
      await recordCheckResult(env.SITE_SENTINEL_STORE, newSite.id, initialResult);

      const statusIcon = initialResult.isUp ? "🟢" : "🔴";
      const reply = `✅ <b>Website Added to Watchlist!</b>
━━━━━━━━━━━━━━━━━━━━
🏷 <b>Name:</b> ${escapeHtml(newSite.name)}
🌐 <b>URL:</b> <a href="${escapeHtml(newSite.url)}">${escapeHtml(newSite.url)}</a>
🆔 <b>ID:</b> <code>${newSite.id}</code>
📊 <b>Initial Status:</b> ${statusIcon} <b>${initialResult.statusLabel || (initialResult.isUp ? "UP / ONLINE" : "DOWN / OFFLINE")}</b> (${initialResult.latencyMs}ms)
📍 <b>Checked From:</b> ${escapeHtml(initialResult.coloName)}
⏰ <b>Check Interval:</b> Every <b>${intervalMins} minutes</b>
━━━━━━━━━━━━━━━━━━━━
💡 <i>SiteSentinel will check this site every ${intervalMins} minutes. Tap below to change frequency anytime.</i>`;

      await sendTelegramMessage(botToken, chatId, reply, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "⏱ Change Interval", callback_data: `pickint:${newSite.id}` },
              { text: "🔄 Re-check", callback_data: `check:${newSite.id}` }
            ]
          ]
        }
      });
    } catch (err) {
      await sendTelegramMessage(botToken, chatId, `❌ <b>Failed to add website:</b> ${escapeHtml(err.message)}`);
    }
    return;
  }

  // /interval <id or url> [minutes] — Change check interval
  if (command === "/interval" || command === "/setinterval" || command === "/freq") {
    if (!arg) {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Usage:</b> <code>/interval &lt;id or url&gt; [minutes]</code>\nExamples:\n• <code>/interval example_com 5</code>\n• <code>/interval https://example.com</code> (opens picker)\nUse <code>/list</code> to find website IDs.");
      return;
    }

    const parts = arg.split(/\s+/);
    const target = parts[0];
    const site = await findSite(env.SITE_SENTINEL_STORE, target);
    if (!site) {
      await sendTelegramMessage(botToken, chatId, `❌ <b>Site not found:</b> "${escapeHtml(target)}"\nUse <code>/list</code> to see all monitored websites.`);
      return;
    }

    if (parts.length < 2) {
      await sendTelegramMessage(botToken, chatId, `⏱ <b>Select check interval for ${escapeHtml(site.name || site.url)}:</b>\nCurrent schedule: Every <b>${site.checkIntervalMins || 15} minutes</b>.`, {
        reply_markup: { inline_keyboard: buildIntervalSelectionKeyboard(site.id) }
      });
      return;
    }

    const mins = parseInt(parts[1].replace(/m(in(s)?)?$/i, ""), 10);
    if (isNaN(mins) || mins < 1 || mins > 1440) {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Invalid interval:</b> Please specify a duration between 1 and 1440 minutes (e.g. <code>5</code>, <code>10</code>, <code>15</code>, <code>30</code>, <code>60</code>).");
      return;
    }

    const res = await updateSiteInterval(env.SITE_SENTINEL_STORE, site.id, mins);
    if (res.success) {
      await sendTelegramMessage(botToken, chatId, `⏱ <b>Interval Updated!</b>\nTarget: <b>${escapeHtml(res.site.name || res.site.url)}</b>\n⏰ <b>New Schedule:</b> Checking every <b>${mins} minutes</b>.`);
    } else {
      await sendTelegramMessage(botToken, chatId, `❌ ${escapeHtml(res.message)}`);
    }
    return;
  }

  // /remove <url or id> or /stop <url or id>
  if (command === "/remove" || command === "/stop" || command === "/delete") {
    if (!arg) {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Please specify the URL or ID to remove.</b>\nExample: <code>/remove https://example.com</code> or <code>/remove example_com_a1b2c3</code>\nUse <code>/list</code> to see IDs.");
      return;
    }

    const result = await removeSite(env.SITE_SENTINEL_STORE, arg);
    if (result.success) {
      await sendTelegramMessage(botToken, chatId, `🗑 <b>Website removed from monitoring:</b>\n<code>${escapeHtml(result.site.url)}</code> (${escapeHtml(result.site.name)})`);
    } else {
      await sendTelegramMessage(botToken, chatId, `❌ ${escapeHtml(result.message)}`);
    }
    return;
  }

  // /list — List all monitored sites
  if (command === "/list") {
    const sites = await getAllSites(env.SITE_SENTINEL_STORE);
    const listMsg = buildSiteListMessage(sites);
    const keyboard = buildSiteActionsKeyboard(sites);
    await sendTelegramMessage(botToken, chatId, listMsg, {
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined
    });
    return;
  }

  // /status — Fleet overview
  if (command === "/status") {
    const sites = await getAllSites(env.SITE_SENTINEL_STORE);
    const settings = await getSettings(env.SITE_SENTINEL_STORE, env);
    const statusMsg = buildFleetStatusMessage(sites, settings);
    await sendTelegramMessage(botToken, chatId, statusMsg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 Refresh Status", callback_data: "fleet_status" }],
          [{ text: "📋 View All Sites", callback_data: "view_list" }]
        ]
      }
    });
    return;
  }

  // /pause <url or id>
  if (command === "/pause") {
    if (!arg) {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Specify the website to pause:</b> <code>/pause &lt;url or id&gt;</code>");
      return;
    }
    const res = await setSitePaused(env.SITE_SENTINEL_STORE, arg, true);
    if (res.success) {
      await sendTelegramMessage(botToken, chatId, `⏸️ <b>Monitoring paused</b> for <b>${escapeHtml(res.site.name || res.site.url)}</b>.`);
    } else {
      await sendTelegramMessage(botToken, chatId, `❌ ${escapeHtml(res.message)}`);
    }
    return;
  }

  // /resume <url or id>
  if (command === "/resume") {
    if (!arg) {
      await sendTelegramMessage(botToken, chatId, "⚠️ <b>Specify the website to resume:</b> <code>/resume &lt;url or id&gt;</code>");
      return;
    }
    const res = await setSitePaused(env.SITE_SENTINEL_STORE, arg, false);
    if (res.success) {
      await sendTelegramMessage(botToken, chatId, `▶️ <b>Monitoring resumed</b> for <b>${escapeHtml(res.site.name || res.site.url)}</b>.`);
    } else {
      await sendTelegramMessage(botToken, chatId, `❌ ${escapeHtml(res.message)}`);
    }
    return;
  }

  // /settings
  // /settings [interval <minutes>]
  if (command === "/settings") {
    if (arg && arg.toLowerCase().startsWith("interval")) {
      const parts = arg.split(/\s+/);
      const mins = parseInt(parts[1]?.replace(/m(in(s)?)?$/i, ""), 10);
      if (isNaN(mins) || mins < 1 || mins > 1440) {
        await sendTelegramMessage(botToken, chatId, "⚠️ <b>Invalid interval:</b> Please enter minutes between 1 and 1440 (e.g. <code>/settings interval 10</code>).");
        return;
      }
      await saveSettings(env.SITE_SENTINEL_STORE, { checkIntervalMins: mins });
      await sendTelegramMessage(botToken, chatId, `⚙️ <b>Default Interval Updated!</b>\nNew default check frequency: Every <b>${mins} minutes</b>.`);
      return;
    }

    const settings = await getSettings(env.SITE_SENTINEL_STORE, env);
    await sendTelegramMessage(botToken, chatId, buildSettingsMessage(settings));
    return;
  }

  // If user simply pastes a URL
  if (/^https?:\/\//i.test(rawText) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/i.test(rawText)) {
    const targetUrl = rawText.startsWith("http") ? rawText : `https://${rawText}`;
    try {
      const result = await checkWebsite(targetUrl, { workerColo, timeoutMs: 6000, maxRetries: 0 });
      const existing = await findSite(env.SITE_SENTINEL_STORE, targetUrl);
      const text = buildCheckResultMessage(targetUrl, result, Boolean(existing), existing?.id);
      await sendTelegramMessage(botToken, chatId, text, {
        reply_markup: {
          inline_keyboard: [
            existing
              ? [{ text: "🔄 Re-check", callback_data: `check:${existing.id}` }]
              : [{ text: "➕ Add to Monitor", callback_data: `add_site` }],
            [{ text: "🌐 Open Site", url: targetUrl }]
          ]
        }
      });
    } catch (err) {
      await sendTelegramMessage(botToken, chatId, `🔴 <b>Check Failed:</b> Connection timed out or unreachable\n🌐 Target: <code>${escapeHtml(targetUrl)}</code>\n⚠️ <i>${escapeHtml(err.message || "Host did not respond")}</i>`);
    }
    return;
  }

  // Unknown command fallback
  await sendTelegramMessage(botToken, chatId, `❓ Unknown command: <code>${escapeHtml(command)}</code>\nUse <code>/help</code> for available commands.`);
}

// ─── Worker Default Export ──────────────────────────────────

export default {
  /**
   * Cloudflare Cron Trigger (Fires every 15 minutes)
   */
  async scheduled(event, env, ctx) {
    console.log(`[CRON] Trigger fired: "${event.cron}" at ${new Date().toISOString()}`);
    ctx.waitUntil(
      performScheduledMonitoring(env, ctx, { workerColo: "DEL" }).catch(err => {
        console.error("[CRON] Scheduled monitoring failure:", err);
      })
    );
  },

  /**
   * HTTP Request Router
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const workerColo = request.cf?.colo || "DEL";

    // 1. Telegram Webhook Endpoint
    if (url.pathname === "/webhook" || url.pathname === "/telegram-webhook") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405 });
      }

      // Verify Webhook Secret if configured
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");
        if (receivedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
          console.warn("Invalid webhook secret token received");
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
      }

      try {
        const update = await request.json();
        ctx.waitUntil(handleTelegramUpdate(update, env, ctx, workerColo));
      } catch (err) {
        console.error("Failed to parse Telegram webhook update:", err);
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Webhook Setup Helper
    if (url.pathname === "/setup-webhook") {
      const webhookUrl = `${url.origin}/webhook`;
      const secret = env.TELEGRAM_WEBHOOK_SECRET || "";
      const botToken = env.TELEGRAM_BOT_TOKEN;

      if (!botToken) {
        return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN is not configured" }), { status: 500 });
      }

      const tgUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}&secret_token=${encodeURIComponent(secret)}`;
      const tgRes = await fetch(tgUrl);
      const tgData = await tgRes.json();

      return new Response(JSON.stringify({ webhookUrl, telegramResponse: tgData }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. Manual Cron Trigger
    if (url.pathname === "/trigger-cron") {
      const summary = await performScheduledMonitoring(env, ctx, { workerColo });
      return new Response(JSON.stringify({ status: "Executed", summary }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 4. Instant On-Demand JSON Check API: /check?url=https://example.com
    if (url.pathname === "/check") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: "Missing 'url' query parameter" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }

      const result = await checkWebsite(targetUrl, { workerColo, timeoutMs: 6000, maxRetries: 0 });
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 5. Fleet Status JSON API
    if (url.pathname === "/api/status" || url.pathname === "/status") {
      const sites = await getAllSites(env.SITE_SENTINEL_STORE);
      const settings = await getSettings(env.SITE_SENTINEL_STORE, env);
      return new Response(JSON.stringify({ sites, settings, workerColo }, null, 2), {
        headers: { "Content-Type": "application/json", "Cache-Control": "max-age=10" }
      });
    }

    // 6. Web Status Dashboard (Default /)
    const sites = await getAllSites(env.SITE_SENTINEL_STORE);
    return new Response(renderDashboardHtml(sites, workerColo), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "max-age=15"
      }
    });
  }
};
