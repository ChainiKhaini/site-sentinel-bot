import test from "node:test";
import assert from "node:assert/strict";

import { normalizeUrl, generateSiteId, addSite, recordCheckResult, getSettings, getAllSites, getSite, setSitePaused } from "../src/store.js";
import { extractColoFromRay, extractHtmlTitle, checkWebsite, detectContentIssues, categorizeStatus } from "../src/checker.js";
import { isIndianColo, getColoDisplayName, formatDuration, escapeHtml } from "../src/config.js";

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

test("checkWebsite detects Account Suspended soft-200 with mocked probe", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><head><title>Account Suspended</title></head><body><h1>Account Suspended</h1><p>Due to terms violation</p></body></html>", {
    status: 200,
    headers: { "Content-Type": "text/html", "cf-ray": "8db474f88b022e3c-DEL" }
  });
  try {
    const res = await checkWebsite("https://mock-suspended-domain.com", { timeoutMs: 1000, maxRetries: 0 });
    assert.equal(res.isUp, false);
    assert.equal(res.category, "SUSPENDED");
    assert.ok(res.error.includes("suspended"));
    assert.equal(res.colo, "DEL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("escapeHtml sanitizes unsafe special characters", () => {
  assert.equal(escapeHtml('<script>alert("xss")&\'</script>'), "&lt;script&gt;alert(&quot;xss&quot;)&amp;&#039;&lt;/script&gt;");
  assert.equal(escapeHtml(null), "");
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
    },
    _dump() {
      return store;
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
  const res3 = await recordCheckResult(kv, site.id, { isUp: false, statusCode: 500, latencyMs: 200, error: "Server Error" }, { lastAlertSent: new Date().toISOString() });
  assert.equal(res3.statusChanged, true);
  assert.equal(res3.site.status, "DOWN");
  assert.ok(res3.site.lastAlertSent);

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

test("per-site KV keys prevent concurrent write collisions", async () => {
  const kv = createMockKV();
  const site1 = await addSite(kv, { url: "https://site-one.com", name: "Site One" });
  const site2 = await addSite(kv, { url: "https://site-two.com", name: "Site Two" });

  // Simulate concurrent checks updating both sites simultaneously
  await Promise.all([
    recordCheckResult(kv, site1.id, { isUp: true, statusCode: 200, latencyMs: 110 }),
    recordCheckResult(kv, site2.id, { isUp: false, statusCode: 503, latencyMs: 450, error: "Unavailable" })
  ]);

  const readSite1 = await getSite(kv, site1.id);
  const readSite2 = await getSite(kv, site2.id);

  assert.equal(readSite1.status, "UP");
  assert.equal(readSite1.lastLatency, 110);
  assert.equal(readSite2.status, "DOWN");
  assert.equal(readSite2.lastStatusCode, 503);

  // Verify allSites retrieves both
  const all = await getAllSites(kv);
  assert.equal(all.length, 2);
});

test("getAllSites automatically migrates legacy monolithic blob to per-site keys", async () => {
  const kv = createMockKV();
  const legacySites = [
    { id: "legacy_site_1", url: "https://legacy1.com", name: "Legacy 1", status: "UP", totalChecks: 10 },
    { id: "legacy_site_2", url: "https://legacy2.com", name: "Legacy 2", status: "DOWN", totalChecks: 5 }
  ];

  // Store in legacy monolithic blob format
  await kv.put("sites_index", JSON.stringify(legacySites));

  // Trigger migration
  const migratedSites = await getAllSites(kv);
  assert.equal(migratedSites.length, 2);

  // Verify individual site keys were created
  const s1 = await getSite(kv, "legacy_site_1");
  const s2 = await getSite(kv, "legacy_site_2");
  assert.ok(s1);
  assert.equal(s1.name, "Legacy 1");
  assert.ok(s2);
  assert.equal(s2.name, "Legacy 2");

  // Verify sites_index was converted to array of string IDs
  const index = await kv.get("sites_index", { type: "json" });
  assert.deepEqual(index, ["legacy_site_1", "legacy_site_2"]);
});

test("setSitePaused performs protocol-agnostic case-insensitive match", async () => {
  const kv = createMockKV();
  const site = await addSite(kv, { url: "https://example.org", name: "Example" });

  const res1 = await setSitePaused(kv, "EXAMPLE.ORG", true);
  assert.equal(res1.success, true);
  assert.equal(res1.site.paused, true);

  const res2 = await setSitePaused(kv, "example.org", false);
  assert.equal(res2.success, true);
  assert.equal(res2.site.paused, false);
});

test("getSettings defaults to onlyNotifyOnStatusChange: true and alertRepeatHours: 0", async () => {
  const kv = createMockKV();
  const settings = await getSettings(kv, {});
  assert.equal(settings.onlyNotifyOnStatusChange, true);
  assert.equal(settings.alertRepeatHours, 0);
});

test("categorizeStatus accurately flags 404, 410, and 5xx as DOWN, and 200/429 as UP", () => {
  assert.equal(categorizeStatus(200).isUp, true);
  assert.equal(categorizeStatus(429).isUp, true); // Rate limited / Bot shield
  assert.equal(categorizeStatus(404).isUp, false); // Not Found
  assert.equal(categorizeStatus(404).category, "NOT_FOUND");
  assert.equal(categorizeStatus(410).isUp, false); // Gone
  assert.equal(categorizeStatus(400).isUp, false); // Bad Request
  assert.equal(categorizeStatus(500).isUp, false); // Server Error
  assert.equal(categorizeStatus(502).isUp, false); // Bad Gateway
});

test("detectContentIssues catches Apache Tomcat 404 error page", () => {
  const title = "HTTP Status 404 – Not Found";
  const body = "<h1>HTTP Status 404 – Not Found</h1><p>Type Status Report</p><p>Description The origin server did not find a current representation for the target resource</p><h3>Apache Tomcat/9.0.41</h3>";
  const issue = detectContentIssues(title, body);
  assert.ok(issue);
  assert.equal(issue.isUp, false);
  assert.equal(issue.category, "NOT_FOUND");
});

test("checkWebsite flags 404 Not Found response as DOWN", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html><head><title>HTTP Status 404 – Not Found</title></head><body>Apache Tomcat/9.0.41</body></html>", {
    status: 404,
    headers: { "Content-Type": "text/html", "cf-ray": "8db474f88b022e3c-DEL" }
  });
  try {
    const res = await checkWebsite("https://dtcpass.delhi.gov.in/apply", { timeoutMs: 1000, maxRetries: 0 });
    assert.equal(res.isUp, false);
    assert.equal(res.statusCode, 404);
    assert.equal(res.category, "NOT_FOUND");
    assert.ok(res.statusLabel.includes("NOT FOUND"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});



