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
    let hash = 5381;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) + hash) + url.charCodeAt(i);
      hash = hash & hash;
    }
    const hexHash = Math.abs(hash).toString(36).padStart(6, "0").slice(0, 6);
    return `${hostPart}_${pathPart ? pathPart + "_" : ""}${hexHash}`.replace(/_+/g, "_").replace(/^_|_$/g, "");
  } catch (e) {
    return `site_${Date.now().toString(36)}`;
  }
}

/**
 * Retrieve a single site by ID from KV
 */
export async function getSite(kv, siteId) {
  if (!kv || !siteId) return null;
  try {
    return await kv.get(`site:${siteId}`, { type: "json" });
  } catch (e) {
    return null;
  }
}

/**
 * Retrieve all monitored websites (with automatic schema migration)
 */
export async function getAllSites(kv) {
  if (!kv) return [];
  try {
    const indexData = await kv.get(SITES_KEY, { type: "json" });
    if (!indexData || !Array.isArray(indexData)) return [];

    // Auto-migration: If index contains site objects instead of IDs (legacy format)
    if (indexData.length > 0 && typeof indexData[0] === "object" && indexData[0].id) {
      console.log(`[MIGRATION] Migrating ${indexData.length} sites from legacy monolithic blob to per-site KV keys...`);
      const idList = [];
      for (const oldSite of indexData) {
        if (oldSite && oldSite.id) {
          idList.push(oldSite.id);
          await kv.put(`site:${oldSite.id}`, JSON.stringify(oldSite));
        }
      }
      await kv.put(SITES_KEY, JSON.stringify(idList));
      return indexData;
    }

    // Modern format: indexData is string[] of site IDs
    const sitePromises = indexData.map(id => kv.get(`site:${id}`, { type: "json" }));
    const sites = await Promise.all(sitePromises);
    return sites.filter(Boolean);
  } catch (err) {
    console.error("Error reading sites from KV:", err);
    return [];
  }
}

/**
 * Find a site by ID or URL
 */
export async function findSite(kv, idOrUrl) {
  if (!kv || !idOrUrl) return null;
  const target = idOrUrl.trim().toLowerCase();

  // Try direct site:<id> lookup
  const direct = await getSite(kv, target);
  if (direct) return direct;

  // Fallback to checking URL match across sites
  const sites = await getAllSites(kv);
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
    lastAlertSent: null,
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

  // 1. Write individual site key
  await kv.put(`site:${id}`, JSON.stringify(newSite));

  // 2. Append ID to sites_index
  const indexData = (await kv.get(SITES_KEY, { type: "json" })) || [];
  const idList = Array.isArray(indexData)
    ? (typeof indexData[0] === "object" ? indexData.map(s => s.id) : indexData)
    : [];

  if (!idList.includes(id)) {
    idList.push(id);
    await kv.put(SITES_KEY, JSON.stringify(idList));
  }

  return newSite;
}

/**
 * Remove a website from monitoring
 */
export async function removeSite(kv, idOrUrl) {
  const siteToRemove = await findSite(kv, idOrUrl);
  if (!siteToRemove) {
    return { success: false, message: `Site "${idOrUrl}" not found.` };
  }

  // 1. Delete individual site key
  await kv.delete(`site:${siteToRemove.id}`);

  // 2. Clean up history key
  try {
    await kv.delete(`history:${siteToRemove.id}`);
  } catch (e) {}

  // 3. Remove ID from sites_index
  const indexData = (await kv.get(SITES_KEY, { type: "json" })) || [];
  const idList = Array.isArray(indexData)
    ? (typeof indexData[0] === "object" ? indexData.map(s => s.id) : indexData)
    : [];

  const updatedIds = idList.filter(id => id !== siteToRemove.id);
  await kv.put(SITES_KEY, JSON.stringify(updatedIds));

  return { success: true, site: siteToRemove };
}

/**
 * Toggle pause status for a site
 */
export async function setSitePaused(kv, idOrUrl, paused) {
  const site = await findSite(kv, idOrUrl);
  if (!site) {
    return { success: false, message: `Site "${idOrUrl}" not found.` };
  }

  site.paused = Boolean(paused);
  await kv.put(`site:${site.id}`, JSON.stringify(site));
  return { success: true, site };
}

/**
 * Update multiple fields on a site
 */
export async function updateSite(kv, siteId, patch) {
  const site = await getSite(kv, siteId);
  if (!site) return null;

  const updated = { ...site, ...patch };
  await kv.put(`site:${siteId}`, JSON.stringify(updated));
  return updated;
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
 * Record a check result, calculate transitions, and update history.
 * Modifies ONLY site:<siteId> and history:<siteId>, ensuring zero concurrent write collisions.
 */
export async function recordCheckResult(kv, siteId, result, extraPatch = {}) {
  const site = await getSite(kv, siteId);
  if (!site) return null;

  const nowIso = new Date().toISOString();
  const prevStatus = site.status;
  const isUp = result.isUp;
  const newStatus = isUp ? "UP" : "DOWN";
  const statusChanged = prevStatus !== "PENDING" && prevStatus !== newStatus;

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

  // Apply extra fields (like lastAlertSent) in this exact single write
  if (extraPatch && typeof extraPatch === "object") {
    Object.assign(site, extraPatch);
  }

  // Write ONLY to individual site key
  await kv.put(`site:${siteId}`, JSON.stringify(site));

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
