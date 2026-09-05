/**
 * SiteSentinel KV Storage Layer
 * Manages monitored websites, check history, and user preferences.
 */

import { DEFAULTS } from "./config.js";

const SITES_KEY = "sites_index";
const SETTINGS_KEY = "global_settings";

/**
 * Standardize and clean a URL
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("URL must be a non-empty string");
  }

  let cleaned = rawUrl.trim();
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  try {
    const parsed = new URL(cleaned);
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      throw new Error(`Invalid domain name: "${parsed.hostname}"`);
    }
    // Remove default port numbers & trailing slashes if path is empty
    let finalUrl = parsed.origin;
    if (parsed.pathname && parsed.pathname !== "/") {
      finalUrl += parsed.pathname;
    }
    if (parsed.search) {
      finalUrl += parsed.search;
    }
    return finalUrl;
  } catch (err) {
    throw new Error(`Invalid URL format: ${err.message}`);
  }
}

/**
 * Generate a clean, deterministic site ID from URL
 */
export function generateSiteId(url) {
  try {
    const parsed = new URL(url);
    const hostPart = parsed.hostname.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const pathPart = parsed.pathname.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 10);
    const hash = Math.abs(
      url.split("").reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)
    ).toString(36).slice(0, 6);
    return `${hostPart}_${pathPart ? pathPart + "_" : ""}${hash}`.replace(/_+/g, "_").replace(/^_|_$/g, "");
  } catch (e) {
    return `site_${Date.now().toString(36)}`;
  }
}

/**
 * Retrieve all monitored websites
 */
export async function getAllSites(kv) {
  if (!kv) return [];
  try {
    const data = await kv.get(SITES_KEY, { type: "json" });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Error reading sites index from KV:", err);
    return [];
  }
}

/**
 * Find a site by ID or URL
 */
export async function findSite(kv, idOrUrl) {
  const sites = await getAllSites(kv);
  if (!idOrUrl) return null;
  const target = idOrUrl.trim().toLowerCase();
  return sites.find(s => 
    s.id.toLowerCase() === target ||
    s.url.toLowerCase() === target ||
    s.url.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "") === target.replace(/^https?:\/\//, "").replace(/\/$/, "")
  ) || null;
}

/**
 * Add a new website to the monitoring list
 */
export async function addSite(kv, { url, name, checkIntervalMins = DEFAULTS.CHECK_INTERVAL_MINS }) {
  const cleanUrl = normalizeUrl(url);
  const sites = await getAllSites(kv);

  // Check for duplicate
  const existing = sites.find(s => s.url.toLowerCase() === cleanUrl.toLowerCase());
  if (existing) {
    throw new Error(`Website "${cleanUrl}" is already being monitored (ID: ${existing.id}).`);
  }

  const id = generateSiteId(cleanUrl);
  let parsedHost = "";
  try {
    parsedHost = new URL(cleanUrl).hostname;
  } catch (e) {}

  const newSite = {
    id,
    url: cleanUrl,
    name: name && name.trim() ? name.trim() : parsedHost,
    status: "PENDING", // PENDING, UP, DOWN
    paused: false,
    checkIntervalMins: Number(checkIntervalMins) || DEFAULTS.CHECK_INTERVAL_MINS,
    createdAt: new Date().toISOString(),
    lastChecked: null,
    lastStatusChange: null,
    downtimeStart: null,
    failureCount: 0,
    successCount: 0,
    totalChecks: 0,
    uptimeChecks: 0,
    lastLatency: null,
    lastStatusCode: null,
    lastError: null,
    lastColo: null,
    lastColoName: null
  };

  sites.push(newSite);
  await kv.put(SITES_KEY, JSON.stringify(sites));
  return newSite;
}

/**
 * Remove a website from monitoring
 */
export async function removeSite(kv, idOrUrl) {
  const sites = await getAllSites(kv);
  const siteToRemove = await findSite(kv, idOrUrl);
  if (!siteToRemove) {
    return { success: false, message: `Site "${idOrUrl}" not found.` };
  }

  const updatedSites = sites.filter(s => s.id !== siteToRemove.id);
  await kv.put(SITES_KEY, JSON.stringify(updatedSites));
  
  // Clean up history key asynchronously
  try {
    await kv.delete(`history:${siteToRemove.id}`);
  } catch (e) {}

  return { success: true, site: siteToRemove };
}

/**
 * Toggle pause status for a site
 */
export async function setSitePaused(kv, idOrUrl, paused) {
  const sites = await getAllSites(kv);
  const site = sites.find(s => s.id === idOrUrl || s.url === idOrUrl);
  if (!site) {
    return { success: false, message: `Site "${idOrUrl}" not found.` };
  }

  site.paused = Boolean(paused);
  await kv.put(SITES_KEY, JSON.stringify(sites));
  return { success: true, site };
}

/**
 * Update multiple fields on a site
 */
export async function updateSite(kv, siteId, patch) {
  const sites = await getAllSites(kv);
  const index = sites.findIndex(s => s.id === siteId);
  if (index === -1) return null;

  sites[index] = { ...sites[index], ...patch };
  await kv.put(SITES_KEY, JSON.stringify(sites));
  return sites[index];
}

/**
 * Update check interval for a site
 */
export async function updateSiteInterval(kv, idOrUrl, intervalMins) {
  const mins = Math.max(1, parseInt(intervalMins, 10) || DEFAULTS.CHECK_INTERVAL_MINS);
  const site = await findSite(kv, idOrUrl);
  if (!site) {
    return { success: false, message: `Site "${idOrUrl}" not found.` };
  }

  const updated = await updateSite(kv, site.id, { checkIntervalMins: mins });
  return { success: true, site: updated, intervalMins: mins };
}

/**
 * Record a check result, calculate transitions, and update history
 */
export async function recordCheckResult(kv, siteId, result) {
  const sites = await getAllSites(kv);
  const index = sites.findIndex(s => s.id === siteId);
  if (index === -1) return null;

  const site = sites[index];
  const nowIso = new Date().toISOString();
  const prevStatus = site.status;
  const isUp = result.isUp;
  const newStatus = isUp ? "UP" : "DOWN";
  const statusChanged = prevStatus !== newStatus;

  site.totalChecks = (site.totalChecks || 0) + 1;
  if (isUp) {
    site.uptimeChecks = (site.uptimeChecks || 0) + 1;
    site.successCount = (site.successCount || 0) + 1;
    site.failureCount = 0;
    if (statusChanged) {
      site.lastStatusChange = nowIso;
      site.downtimeStart = null;
    }
  } else {
    site.failureCount = (site.failureCount || 0) + 1;
    site.successCount = 0;
    if (statusChanged || !site.downtimeStart) {
      site.lastStatusChange = nowIso;
      site.downtimeStart = site.downtimeStart || nowIso;
    }
  }

  site.status = newStatus;
  site.lastChecked = nowIso;
  site.lastLatency = result.latencyMs;
  site.lastStatusCode = result.statusCode;
  site.lastError = result.error || null;
  site.lastColo = result.colo || null;
  site.lastColoName = result.coloName || null;

  sites[index] = site;
  await kv.put(SITES_KEY, JSON.stringify(sites));

  // Append to rolling history (max 20 entries)
  try {
    const historyKey = `history:${siteId}`;
    const history = (await kv.get(historyKey, { type: "json" })) || [];
    history.unshift({
      timestamp: nowIso,
      status: newStatus,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      colo: result.colo,
      error: result.error || null
    });
    const trimmed = history.slice(0, 20);
    await kv.put(historyKey, JSON.stringify(trimmed));
  } catch (err) {
    console.error(`Failed to write history for ${siteId}:`, err);
  }

  return {
    site,
    prevStatus,
    newStatus,
    statusChanged
  };
}

/**
 * Get or initialize global settings
 */
export async function getSettings(kv, env) {
  let settings = null;
  if (kv) {
    try {
      settings = await kv.get(SETTINGS_KEY, { type: "json" });
    } catch (e) {}
  }
  const rawRepeat = settings?.alertRepeatHours ?? env?.ALERT_REPEAT_INTERVAL_HOURS ?? DEFAULTS.ALERT_REPEAT_HOURS;

  return {
    checkIntervalMins: Number(settings?.checkIntervalMins ?? env?.CHECK_INTERVAL_MINS ?? DEFAULTS.CHECK_INTERVAL_MINS),
    timeoutMs: Number(settings?.timeoutMs ?? env?.DEFAULT_TIMEOUT_MS ?? DEFAULTS.TIMEOUT_MS),
    maxRetries: Number(settings?.maxRetries ?? env?.MAX_RETRIES ?? DEFAULTS.MAX_RETRIES),
    alertRepeatHours: Number(rawRepeat),
    onlyNotifyOnStatusChange: settings?.onlyNotifyOnStatusChange ?? (env?.NOTIFY_ON_STATUS_CHANGE_ONLY ? env.NOTIFY_ON_STATUS_CHANGE_ONLY === "true" : DEFAULTS.ONLY_NOTIFY_ON_STATUS_CHANGE),
    timezone: settings?.timezone || env?.TIMEZONE || DEFAULTS.TIMEZONE
  };
}

/**
 * Update global settings
 */
export async function saveSettings(kv, newSettings) {
  if (!kv) return false;
  const current = (await kv.get(SETTINGS_KEY, { type: "json" })) || {};
  const updated = { ...current, ...newSettings };
  await kv.put(SETTINGS_KEY, JSON.stringify(updated));
  return updated;
}
