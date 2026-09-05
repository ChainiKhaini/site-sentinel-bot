/**
 * SiteSentinel Autonomous 15-Minute Monitoring Engine
 */

import { getAllSites, recordCheckResult, getSettings, updateSite } from "./store.js";
import { checkWebsite } from "./checker.js";
import {
  sendTelegramMessage,
  buildDowntimeAlertMessage,
  buildRecoveryAlertMessage,
  buildDowntimeKeyboard
} from "./telegram.js";

/**
 * Execute health checks for all active websites
 */
export async function performScheduledMonitoring(env, ctx, options = {}) {
  const startTime = Date.now();
  const kv = env.SITE_SENTINEL_STORE;
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  const workerColo = options.workerColo || "DEL"; // Default to Indian colo DEL if unspecified

  const sites = await getAllSites(kv);
  const settings = await getSettings(kv, env);
  const now = Date.now();
  const isForce = options.force === true;

  // Filter sites that are active and due for their individual interval
  const activeSites = sites.filter(s => {
    if (s.paused) return false;
    if (isForce) return true;
    const intervalMins = Number(s.checkIntervalMins) || settings.checkIntervalMins || 15;
    const intervalMs = intervalMins * 60 * 1000;
    const lastCheckedMs = s.lastChecked ? new Date(s.lastChecked).getTime() : 0;
    // Due if never checked or elapsed time >= interval (with 30s grace buffer)
    return (now - lastCheckedMs) >= (intervalMs - 30000);
  });

  if (activeSites.length === 0) {
    console.log("No active websites due for monitoring check.");
    return { total: sites.length, checked: 0, up: 0, down: 0 };
  }

  const results = [];

  // Batch process sites in chunks of 5 to respect Cloudflare subrequest limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < activeSites.length; i += BATCH_SIZE) {
    const batch = activeSites.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async site => {
      try {
        const checkResult = await checkWebsite(site.url, {
          timeoutMs: settings.timeoutMs,
          maxRetries: settings.maxRetries,
          workerColo
        });

        const prevStatus = site.status;
        const record = await recordCheckResult(kv, site.id, checkResult);
        const updatedSite = record.site;

        // Transition 1: UP -> DOWN (or initial PENDING -> DOWN) — STATUS CHANGED
        if (!checkResult.isUp && (prevStatus === "UP" || prevStatus === "PENDING")) {
          console.warn(`[ALERT] Site ${site.url} went DOWN (status changed from ${prevStatus}): ${checkResult.error}`);
          if (botToken && chatId) {
            const alertText = buildDowntimeAlertMessage(updatedSite, checkResult);
            const keyboard = buildDowntimeKeyboard(site.id, site.url);
            await sendTelegramMessage(botToken, chatId, alertText, {
              reply_markup: { inline_keyboard: keyboard }
            });
            // Record timestamp of this alert
            await updateSite(kv, site.id, { lastAlertSent: new Date().toISOString() });
          }
          return { site: updatedSite, checkResult, stateChange: "NEWLY_DOWN" };
        }

        // Transition 2: STILL DOWN — STATUS UNCHANGED (Silence unless explicit repeat requested)
        if (!checkResult.isUp && prevStatus === "DOWN") {
          console.log(`[MONITOR] Site ${site.url} is still DOWN (Failures: ${updatedSite.failureCount}) — status unchanged, no message sent.`);

          // Only send reminder if repeat alerts are explicitly enabled and status-change-only mode is off
          const shouldRepeat = !settings.onlyNotifyOnStatusChange && settings.alertRepeatHours > 0;
          if (shouldRepeat && botToken && chatId) {
            const lastAlertTime = site.lastAlertSent ? new Date(site.lastAlertSent).getTime() : 0;
            const repeatIntervalMs = settings.alertRepeatHours * 60 * 60 * 1000;
            const isReminderDue = Date.now() - lastAlertTime >= repeatIntervalMs;

            if (isReminderDue) {
              const reminderText = `⏳ <b>Downtime Reminder:</b> ${site.name || site.url} is still unreachable!\n` +
                buildDowntimeAlertMessage(updatedSite, checkResult);
              const keyboard = buildDowntimeKeyboard(site.id, site.url);
              await sendTelegramMessage(botToken, chatId, reminderText, {
                reply_markup: { inline_keyboard: keyboard }
              });
              await updateSite(kv, site.id, { lastAlertSent: new Date().toISOString() });
            }
          }

          return { site: updatedSite, checkResult, stateChange: "STILL_DOWN" };
        }

        // Transition: DOWN -> UP (Recovered!)
        if (checkResult.isUp && prevStatus === "DOWN") {
          console.log(`[RECOVERY] Site ${site.url} has RECOVERED!`);
          const downtimeMs = site.downtimeStart ? Date.now() - new Date(site.downtimeStart).getTime() : null;

          if (botToken && chatId) {
            const recoveryText = buildRecoveryAlertMessage(updatedSite, checkResult, downtimeMs);
            await sendTelegramMessage(botToken, chatId, recoveryText);
          }

          return { site: updatedSite, checkResult, stateChange: "RECOVERED" };
        }

        // UP -> UP (Healthy)
        return { site: updatedSite, checkResult, stateChange: "STABLE_UP" };
      } catch (err) {
        console.error(`Error monitoring site ${site.url}:`, err);
        return { site, error: err.message, stateChange: "ERROR" };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  const durationMs = Date.now() - startTime;
  const summary = {
    total: sites.length,
    active: activeSites.length,
    up: results.filter(r => r.checkResult?.isUp).length,
    down: results.filter(r => r.checkResult && !r.checkResult.isUp).length,
    newlyDown: results.filter(r => r.stateChange === "NEWLY_DOWN").length,
    recovered: results.filter(r => r.stateChange === "RECOVERED").length,
    durationMs
  };

  console.log(`[MONITOR] Finished cycle in ${durationMs}ms:`, summary);
  return summary;
}
