import test from "node:test";
import assert from "node:assert/strict";

import { normalizeUrl, generateSiteId, addSite, recordCheckResult, getSettings } from "../src/store.js";
import { extractColoFromRay, extractHtmlTitle, checkWebsite, detectContentIssues } from "../src/checker.js";
import { isIndianColo, getColoDisplayName, formatDuration } from "../src/config.js";

test("normalizeUrl handles various inputs", () => {
  assert.equal(normalizeUrl("google.com"), "https://google.com");
  assert.equal(normalizeUrl("http://example.com/"), "http://example.com");
  assert.equal(normalizeUrl("https://example.com/path?foo=bar"), "https://example.com/path?foo=bar");
  assert.throws(() => normalizeUrl("invalid-no-dot"), /Invalid domain/);
});

test("generateSiteId generates deterministic safe id", () => {
  const id1 = generateSiteId("https://google.com");
  const id2 = generateSiteId("https://google.com");
  assert.equal(id1, id2);
  assert.match(id1, /^[a-z0-9_]+$/);
});

test("extractColoFromRay extracts airport code", () => {
  assert.equal(extractColoFromRay("8db474f88b022e3c-DEL"), "DEL");
  assert.equal(extractColoFromRay("9ab123-BOM"), "BOM");
  assert.equal(extractColoFromRay(null), null);
});

test("extractHtmlTitle parses page title correctly", () => {
  const html = "<html><head><title>  My Test Website | Online </title></head></html>";
  assert.equal(extractHtmlTitle(html), "My Test Website | Online");
  assert.equal(extractHtmlTitle("no title"), "");
});

test("detectContentIssues catches Account Suspended soft-200", () => {
  const issue = detectContentIssues("Account Suspended", "<h1>Account Suspended</h1><p>Due to abuse</p>");
  assert.ok(issue);
  assert.equal(issue.isUp, false);
  assert.equal(issue.category, "SUSPENDED");
});

test("detectContentIssues catches Database Connection Error", () => {
  const issue = detectContentIssues("Database Error", "<h1>Error establishing a database connection</h1>");
  assert.ok(issue);
  assert.equal(issue.isUp, false);
  assert.equal(issue.category, "DATABASE_ERROR");
});

test("detectContentIssues allows healthy websites", () => {
  const issue = detectContentIssues("Welcome to My Shop", "<h1>Welcome to the best clothes shop</h1>");
  assert.equal(issue, null);
});

test("Indian Colo detection", () => {
  assert.equal(isIndianColo("DEL"), true);
  assert.equal(isIndianColo("BOM"), true);
  assert.equal(isIndianColo("BLR"), true);
  assert.equal(isIndianColo("SFO"), false);
  assert.equal(getColoDisplayName("DEL"), "DEL (New Delhi, India 🇮🇳)");
});

test("formatDuration converts ms to readable string", () => {
  assert.equal(formatDuration(45000), "45s");
  assert.equal(formatDuration(90000), "1m 30s");
  assert.equal(formatDuration(3665000), "1h 1m 5s");
});

test("checkWebsite detects live Account Suspended on desifakes.com", async () => {
  const res = await checkWebsite("https://desifakes.com", { timeoutMs: 8000, maxRetries: 0 });
  assert.equal(res.isUp, false);
  assert.equal(res.category, "SUSPENDED");
  assert.ok(res.error.includes("suspended"));
});

function createMockKV() {
  const store = new Map();
  return {
    async get(key, opt) {
      const val = store.get(key);
      if (!val) return null;
      if (opt?.type === "json") return JSON.parse(val);
      return val;
    },
    async put(key, val) {
      store.set(key, String(val));
    },
    async delete(key) {
      store.delete(key);
    }
  };
}

test("recordCheckResult only flags statusChanged on genuine transitions", async () => {
  const kv = createMockKV();
  const site = await addSite(kv, { url: "https://test-example.com", name: "Test Site" });
  
  // 1. Initial check marks it UP
  const res1 = await recordCheckResult(kv, site.id, { isUp: true, statusCode: 200, latencyMs: 50 });
  assert.equal(res1.site.status, "UP");
  
  // 2. Next check still UP -> statusChanged should be false
  const res2 = await recordCheckResult(kv, site.id, { isUp: true, statusCode: 200, latencyMs: 55 });
  assert.equal(res2.statusChanged, false);
  assert.equal(res2.site.status, "UP");

  // 3. Site goes DOWN -> statusChanged should be true (Alert triggered)
  const res3 = await recordCheckResult(kv, site.id, { isUp: false, statusCode: 500, latencyMs: 200, error: "Server Error" });
  assert.equal(res3.statusChanged, true);
  assert.equal(res3.site.status, "DOWN");

  // 4. Site stays DOWN -> statusChanged should be false (NO message sent!)
  const res4 = await recordCheckResult(kv, site.id, { isUp: false, statusCode: 500, latencyMs: 220, error: "Server Error" });
  assert.equal(res4.statusChanged, false);
  assert.equal(res4.site.status, "DOWN");

  // 5. Site RECOVERS -> statusChanged should be true (Recovery message sent!)
  const res5 = await recordCheckResult(kv, site.id, { isUp: true, statusCode: 200, latencyMs: 40 });
  assert.equal(res5.statusChanged, true);
  assert.equal(res5.site.status, "UP");

  // 6. Site stays UP -> statusChanged should be false (Silence!)
  const res6 = await recordCheckResult(kv, site.id, { isUp: true, statusCode: 200, latencyMs: 42 });
  assert.equal(res6.statusChanged, false);
  assert.equal(res6.site.status, "UP");
});

test("getSettings defaults to onlyNotifyOnStatusChange: true and alertRepeatHours: 0", async () => {
  const kv = createMockKV();
  const settings = await getSettings(kv, {});
  assert.equal(settings.onlyNotifyOnStatusChange, true);
  assert.equal(settings.alertRepeatHours, 0);
});

