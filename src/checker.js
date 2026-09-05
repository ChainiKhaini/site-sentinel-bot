/**
 * SiteSentinel Health & Diagnostic Probe Engine
 * Features HTTP status verification and deep content inspection (Soft-200 detection)
 */

import { DEFAULTS, getColoDisplayName, isIndianColo } from "./config.js";

export const MODERN_BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1"
};

/**
 * Extract Cloudflare colo code from CF-Ray header
 * Format: 8db474f88b022e3c-DEL -> DEL
 */
export function extractColoFromRay(cfRay) {
  if (!cfRay) return null;
  const parts = String(cfRay).split("-");
  return parts.length > 1 ? parts[1].trim().toUpperCase() : null;
}

/**
 * Extract <title> from HTML snippet
 */
export function extractHtmlTitle(html) {
  if (!html || typeof html !== "string") return "";
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim().replace(/\s+/g, " ") : "";
}

/**
 * Inspect HTML content for "Soft-200" downtime
 * Detects: Account Suspended, Domain Seized, Database Errors, Maintenance Mode, Parked Domains
 */
export function detectContentIssues(title = "", htmlSnippet = "") {
  const cleanTitle = (title || "").toLowerCase().trim();
  const lowerSnippet = (htmlSnippet || "").toLowerCase();
  const combined = `${cleanTitle} ${lowerSnippet}`;

  // 1. Account Suspensions & Policy Violations
  const suspensionTitles = [
    "account suspended",
    "website suspended",
    "site suspended",
    "service suspended",
    "domain suspended",
    "hosting suspended",
    "account disabled",
    "account inactive"
  ];
  for (const st of suspensionTitles) {
    if (cleanTitle.includes(st)) {
      return {
        isUp: false,
        category: "SUSPENDED",
        label: "DOWN / SUSPENDED (Account Suspended)",
        error: "Website is suspended (Account Suspended due to abuse/policy violation)",
        note: "Server returned HTTP 200, but page content indicates account suspension."
      };
    }
  }

  // Check body for explicit suspension banners (especially on small placeholder pages)
  if (lowerSnippet.length < 15000) {
    const bodySuspensions = [
      "this account has been suspended",
      "account has been suspended due to abuse",
      "this website is suspended",
      "account suspended by administrator",
      "cgi-sys/suspendedpage.cgi"
    ];
    for (const bs of bodySuspensions) {
      if (lowerSnippet.includes(bs)) {
        return {
          isUp: false,
          category: "SUSPENDED",
          label: "DOWN / SUSPENDED (Account Suspended)",
          error: "Website is suspended (Account Suspended banner detected)",
          note: "Server returned HTTP 200, but page content indicates account suspension."
        };
      }
    }
  }

  // 2. Law Enforcement / Domain Seizures
  const seizureKeywords = [
    "this domain has been seized",
    "domain has been seized",
    "seized by law enforcement",
    "fbi seizure"
  ];
  for (const sk of seizureKeywords) {
    if (cleanTitle.includes(sk) || lowerSnippet.includes(sk)) {
      return {
        isUp: false,
        category: "SEIZED",
        label: "DOWN / SEIZED (Domain Seized)",
        error: "Domain seized by law enforcement / authorities",
        note: "Domain seizure notice detected in page content."
      };
    }
  }

  // 3. Database Crashes (WordPress / PHP soft-200 errors)
  const dbErrors = [
    "error establishing a database connection",
    "database connection error",
    "could not connect to the database",
    "fatal database error"
  ];
  for (const dbe of dbErrors) {
    if (cleanTitle.includes(dbe) || lowerSnippet.includes(dbe)) {
      return {
        isUp: false,
        category: "DATABASE_ERROR",
        label: "DOWN / DATABASE ERROR",
        error: "Database connection failed (Error establishing database connection)",
        note: "Database outage banner detected in response body."
      };
    }
  }

  // 4. Domain Parked / Expired Placeholders
  const parkedTitles = [
    "domain is parked",
    "parked domain",
    "buy this domain",
    "this domain is for sale",
    "domain registration expired"
  ];
  for (const pt of parkedTitles) {
    if (cleanTitle.includes(pt)) {
      return {
        isUp: false,
        category: "PARKED",
        label: "DOWN / PARKED (Domain Expired/For Sale)",
        error: "Domain is parked, expired, or listed for sale",
        note: "Domain parking or expiration page detected."
      };
    }
  }

  // 5. Maintenance Mode
  const maintenanceKeywords = [
    "down for maintenance",
    "site under maintenance",
    "website under maintenance",
    "temporarily under maintenance",
    "scheduled maintenance in progress"
  ];
  for (const mk of maintenanceKeywords) {
    if (cleanTitle.includes(mk) || (cleanTitle.length < 50 && lowerSnippet.includes(mk))) {
      return {
        isUp: false,
        category: "MAINTENANCE",
        label: "DOWN / MAINTENANCE (Under Maintenance)",
        error: "Website is temporarily offline for maintenance",
        note: "Maintenance mode notice detected in page content."
      };
    }
  }

  return null;
}

/**
 * Categorize HTTP status codes for monitoring
 */
export function categorizeStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 400) {
    return { isUp: true, category: "UP", label: "UP / ONLINE", error: null };
  }
  // 401, 403, 429 indicate the web server is online & running anti-bot or auth
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
    const desc = statusCode === 429 ? "Rate-Limited / Bot-Shield" : "Access Restricted";
    return {
      isUp: true,
      category: "RESTRICTED",
      label: `UP / ONLINE (HTTP ${statusCode} ${desc})`,
      error: null,
      note: `Server is active and responding (HTTP ${statusCode}). Anti-bot or auth challenge detected.`
    };
  }
  // 404 and other 4xx client errors
  if (statusCode >= 400 && statusCode < 500) {
    return {
      isUp: true,
      category: "CLIENT_ERROR",
      label: `ONLINE (HTTP ${statusCode})`,
      error: `HTTP ${statusCode} (Resource Not Found / Client Error)`
    };
  }
  // 5xx server errors
  if (statusCode >= 500) {
    return {
      isUp: false,
      category: "SERVER_ERROR",
      label: `DOWN / ERROR (HTTP ${statusCode})`,
      error: `HTTP ${statusCode} Server Error`
    };
  }
  // No status code (network/dns/timeout failure)
  return {
    isUp: false,
    category: "NETWORK_ERROR",
    label: "DOWN / UNREACHABLE",
    error: "Connection Failed"
  };
}

/**
 * Perform a single HTTP/HTTPS check
 */
async function singleCheck(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULTS.TIMEOUT_MS;
  const workerColo = options.workerColo || null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startTime = Date.now();
  let response = null;
  let title = "";
  let htmlChunk = "";
  let errorMsg = null;
  let errorType = null;

  try {
    response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        ...MODERN_BROWSER_HEADERS,
        ...(options.headers || {})
      }
    });

    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    // Detect colo: check if target is behind CF, otherwise use worker colo
    const targetRayColo = extractColoFromRay(response.headers.get("cf-ray"));
    const detectedColo = targetRayColo || workerColo || "EDGE";

    // Read partial body for title & content inspection if HTML
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      try {
        const reader = response.body?.getReader();
        if (reader) {
          const { value } = await reader.read();
          if (value) {
            htmlChunk = new TextDecoder().decode(value.slice(0, 32768));
            title = extractHtmlTitle(htmlChunk);
          }
          await reader.cancel();
        }
      } catch (e) {}
    }

    let classification = categorizeStatus(response.status);

    // Deep content inspection: check for Soft-200 downtime (Suspended, Seized, DB Error, etc.)
    if (classification.isUp && (title || htmlChunk)) {
      const contentIssue = detectContentIssues(title, htmlChunk);
      if (contentIssue) {
        classification = contentIssue;
      }
    }

    return {
      isUp: classification.isUp,
      category: classification.category,
      statusLabel: classification.label,
      statusCode: response.status,
      statusText: response.statusText,
      latencyMs,
      title,
      colo: detectedColo,
      coloName: getColoDisplayName(detectedColo),
      isIndia: isIndianColo(detectedColo),
      server: response.headers.get("server") || "Unknown",
      contentType,
      error: classification.error,
      note: classification.note || null
    };
  } catch (err) {
    clearTimeout(timer);
    const latencyMs = Date.now() - startTime;

    const isTimeout = err.name === "AbortError" || 
      (err.message && err.message.toLowerCase().includes("timeout")) ||
      (err.cause?.name && String(err.cause.name).toLowerCase().includes("timeout")) ||
      (err.cause?.code && String(err.cause.code).toLowerCase().includes("timeout"));

    if (isTimeout) {
      errorMsg = `Connection timed out after ${Math.round(timeoutMs / 1000)}s`;
      errorType = "TIMEOUT";
    } else if (err.message && (err.message.includes("ENOTFOUND") || err.message.includes("getaddrinfo"))) {
      errorMsg = "DNS resolution failed (Domain not found)";
      errorType = "DNS_ERROR";
    } else if (err.message && (err.message.includes("SSL") || err.message.includes("certificate"))) {
      errorMsg = `SSL/TLS handshake error: ${err.message}`;
      errorType = "SSL_ERROR";
    } else {
      errorMsg = err.message || "Network unreachable / Connection refused";
      errorType = "NETWORK_ERROR";
    }

    const fallbackColo = workerColo || "EDGE";
    return {
      isUp: false,
      category: "DOWN",
      statusLabel: "DOWN / UNREACHABLE",
      statusCode: 0,
      statusText: errorType,
      latencyMs,
      title: "",
      colo: fallbackColo,
      coloName: getColoDisplayName(fallbackColo),
      isIndia: isIndianColo(fallbackColo),
      server: "N/A",
      contentType: "",
      error: errorMsg,
      note: null
    };
  }
}

/**
 * Probe website with automatic retries before confirming failure
 */
export async function checkWebsite(url, options = {}) {
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : DEFAULTS.MAX_RETRIES;
  
  let result = await singleCheck(url, options);
  if (result.isUp || maxRetries <= 0) {
    return result;
  }

  // Retry on genuine network failures (timeouts/connection errors), but not on clear content suspensions
  if (result.category === "SUSPENDED" || result.category === "SEIZED") {
    return result; // Explicit suspension page is already deterministic
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await new Promise(r => setTimeout(r, 600));
    const retryResult = await singleCheck(url, options);
    if (retryResult.isUp) {
      return retryResult;
    }
    result = retryResult;
  }

  return result;
}
