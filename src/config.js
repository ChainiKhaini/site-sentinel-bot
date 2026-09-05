/**
 * SiteSentinel Configuration & Constants
 */

export const INDIAN_COLOS = {
  DEL: "New Delhi, India 🇮🇳",
  BOM: "Mumbai, India 🇮🇳",
  BLR: "Bengaluru, India 🇮🇳",
  MAA: "Chennai, India 🇮🇳",
  HYD: "Hyderabad, India 🇮🇳",
  CCU: "Kolkata, India 🇮🇳",
  PNQ: "Pune, India 🇮🇳",
  AMD: "Ahmedabad, India 🇮🇳",
  COK: "Kochi, India 🇮🇳",
  NAG: "Nagpur, India 🇮🇳"
};

export const GLOBAL_COLOS = {
  SIN: "Singapore 🇸🇬",
  DXB: "Dubai, UAE 🇦🇪",
  LHR: "London, UK 🇬🇧",
  FRA: "Frankfurt, Germany 🇩🇪",
  NRT: "Tokyo, Japan 🇯🇵",
  IAD: "Washington DC, USA 🇺🇸",
  SFO: "San Francisco, USA 🇺🇸"
};

export function getColoDisplayName(coloCode) {
  if (!coloCode) return "Cloudflare Edge";
  const code = String(coloCode).toUpperCase();
  if (INDIAN_COLOS[code]) return `${code} (${INDIAN_COLOS[code]})`;
  if (GLOBAL_COLOS[code]) return `${code} (${GLOBAL_COLOS[code]})`;
  return `${code} (Global Edge 🌐)`;
}

export function isIndianColo(coloCode) {
  if (!coloCode) return false;
  return Boolean(INDIAN_COLOS[String(coloCode).toUpperCase()]);
}

export const DEFAULTS = {
  TIMEOUT_MS: 6000,
  CHECK_INTERVAL_MINS: 15,
  MAX_RETRIES: 1,
  ALERT_REPEAT_HOURS: 0,
  ONLY_NOTIFY_ON_STATUS_CHANGE: true,
  TIMEZONE: "Asia/Kolkata",
  USER_AGENT: "SiteSentinel/1.0 (UptimeMonitor; +https://t.me/SiteSentinalBot)"
};

/**
 * Format timestamp into human-readable IST string
 * Example: "03 Sep 2026, 08:30 PM IST"
 */
export function formatIST(date = new Date(), timeZone = "Asia/Kolkata") {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "Unknown Date";

  try {
    const formatter = new Intl.DateTimeFormat("en-IN", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
    return `${formatter.format(d)} IST`;
  } catch (e) {
    return d.toISOString();
  }
}

/**
 * Format milliseconds into human-readable duration
 * Example: 3661000 -> "1h 1m 1s"
 */
export function formatDuration(ms) {
  if (!ms || ms <= 0) return "0s";
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Safely escape text for Telegram HTML and Web Dashboard
 */
export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

