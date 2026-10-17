/**
 * Browser smoke test: the whole product path in one real Chromium session
 * against the real server with fixture upstreams. Search → analyze → every
 * report section → save → timeline/diff → watch → notification config →
 * Space tab → previews → settings → deep links → plots → clear.
 *
 * Map tiles and web fonts are blocked (speed, politeness); CesiumJS and
 * satellite.js still load from their CDNs.
 */
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const pageErrors = [];
test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  await page.route(/basemaps\.cartocdn\.com|server\.arcgisonline\.com|fonts\.g(oogleapis|static)\.com/, (route) => route.abort());
  page.on("pageerror", (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
  expect(pageErrors, "uncaught exceptions in the page").toEqual([]);
});

async function analyzeSpringfield(page) {
  await page.goto("/");
  await page.fill("#searchInput", "Springfield");
  const first = page.locator("#searchResults button").first();
  await expect(first).toContainText("Springfield, Sangamon County");
  await first.click();
  await expect(page.locator("#readoutStatus")).toContainText("target locked");
  await expect(page.locator("#analyzeBtn")).toBeEnabled();
  await page.click("#analyzeBtn");
  await expect(page.locator(".status-board.all-good")).toBeVisible({ timeout: 40_000 });
}

test("the globe loads and the instrument strip is idle", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#globe canvas")).toBeVisible();
  await expect(page.locator("#readoutStatus")).toHaveText("hover the globe");
  await expect(page.locator("#analyzeBtn")).toBeDisabled();
  await expect(page.locator("#radiusOut")).toHaveText("25 mi / 40 km");
});

test("search → analyze renders every section from all twelve sources", async ({ page }) => {
  await analyzeSpringfield(page);
  await expect(page.locator(".r-place")).toHaveText("Springfield");
  await expect(page.locator(".r-context")).toContainText("Sangamon County · Illinois · United States");
  await expect(page.locator("p.summary")).toContainText("largest being Springfield");
  await expect(page.locator(".status-board h3")).toContainText("12/12");
  await expect(page.locator("#readoutStatus")).toHaveText("report complete");
  expect(page.url()).toMatch(/#@39\.78170,-89\.65010,25$/);

  const n = (sec) => page.locator(`details[data-sec="${sec}"] summary .n`).first();
  await expect(n("settlements")).toHaveText("3");
  await expect(n("surveillance")).toHaveText("4 · 1 ALPR");
  await expect(n("quakes")).toHaveText("2");
  // 2 headlines per place query; the extra settlement names only join the
  // query when Overpass has answered before the geocode did, so 4 or 6
  await expect(n("news")).toHaveText(/^(4|6)$/);
  await expect(n("people")).toHaveText("2");
  await expect(n("landmarks")).toHaveText("2");
  await expect(n("air")).toContainText("42 Good");
  await expect(n("weather")).toContainText("mostly clear");

  await page.click('[data-secall="open"]');
  await expect(page.locator('details[data-sec="location"] dd').first()).toContainText("Springfield, Sangamon County, Illinois, 62701");
  await expect(page.locator('details[data-sec="location"]')).toContainText("United States dollar (USD · $)");
  await expect(page.locator('details[data-sec="time"] .clock-zone')).toContainText("America/Chicago");
  await expect(page.locator('details[data-sec="settlements"] tbody tr')).toHaveCount(3);
  await expect(page.locator('details[data-sec="infrastructure"] .chip').first()).toContainText("2");
  await expect(page.locator('details[data-sec="history"] .hist-chart')).toBeVisible();
  expect(await page.locator('details[data-sec="news"] .person').count()).toBeGreaterThanOrEqual(4);
});

test("a settlement name opens a verified Wikipedia preview in the panel", async ({ page }) => {
  await analyzeSpringfield(page);
  await page.click('[data-secall="open"]');
  await page.locator('details[data-sec="settlements"] .wiki-peek').first().click();
  await expect(page.locator("#wikiView")).toBeVisible();
  await expect(page.locator(".wiki-title")).toHaveText("Springfield, Illinois");
  await expect(page.locator(".wiki-foot .tag")).toContainText("verified via OSM wikipedia tag"); // the tag outranks the QID
  await page.keyboard.press("Escape");
  await expect(page.locator("#wikiView")).toBeHidden();
  await expect(page.locator("#exploreView")).toBeVisible();
});

test("save → timeline → new snapshot → diff, then delete", async ({ page }) => {
  await analyzeSpringfield(page);
  await page.click("#saveBtn");
  await expect(page.locator("#saveBtn")).toHaveText("Saved ✓");
  await expect(page.locator("#savedCount")).toHaveText("(1)");

  await page.click("#tabSaved");
  await expect(page.locator("#savedList .card")).toHaveCount(1);
  await expect(page.locator(".card-place")).toContainText("Springfield");
  await page.click(".view-snap");
  await expect(page.locator(".snap-report .r-place")).toHaveText("Springfield");
  await expect(page.locator(".snap-report #saveBtn")).toHaveCount(0, "stored snapshots carry no live actions");

  await page.click(".snap-btn"); // ＋ New snapshot re-runs the exact spot
  await expect(page.locator(".status-board.all-good")).toBeVisible({ timeout: 40_000 });
  await expect(page.locator("#radiusOut")).toHaveText("25 mi / 40 km");
  await page.click("#saveBtn");
  await expect(page.locator("#saveBtn")).toHaveText("Snapshot 2 added ✓");

  await page.click("#tabSaved");
  await expect(page.locator(".snap-row")).toHaveCount(2);
  await page.locator(".diff-snap").first().click();
  const detail = page.locator('.snap-detail[data-mode="diff"]');
  await expect(detail.locator(".snap-banner")).toContainText("Δ comparing");
  await expect(detail).toContainText("No changes in the slow-moving data");
  await page.click(".diff-all-btn");
  await expect(page.locator(".diff-all")).toContainText("Moment-in-time readings");

  await page.click(".del-btn");
  await expect(page.locator("#savedList")).toContainText("Nothing saved yet");
  await expect(page.locator("#savedCount")).toHaveText("");
});

test("watch an area: baseline, notification channel, test delivery, check now, stop", async ({ page }) => {
  await analyzeSpringfield(page);
  await page.click("#watchBtn");
  await expect(page.locator("#watchBtn")).toHaveText("Watching ✓");

  await page.click("#tabWatch");
  await expect(page.locator("#watchList .card")).toHaveCount(1);
  await expect(page.locator(".card-place")).toContainText("Springfield");
  await expect(page.locator(".wm.on")).toHaveCount(9);
  await expect(page.locator(".feed-empty")).toContainText("No changes recorded yet");

  await page.click(".notify-btn");
  await page.fill(".notify-url", "https://ntfy.sh/geoscope-e2e");
  await page.click(".notify-save");
  await expect(page.locator(".notify-btn")).toHaveText("🔔 On");
  await expect(page.locator(".notify-cfg")).toBeVisible();
  await page.click(".notify-test");
  await expect(page.locator(".notify-test")).toHaveText("Delivered ✓");

  await page.locator(".wm", { hasText: "News" }).click();
  await expect(page.locator(".wm", { hasText: "News" })).not.toHaveClass(/on/);

  // the baseline tick kicked off on creation finishes within seconds; the
  // card only re-renders when the tab is (re)opened, so poll by reopening it
  await expect.poll(async () => {
    await page.click("#tabWatch");
    return page.locator(".watch-status").textContent();
  }, { timeout: 30_000, intervals: [1000] }).toContain("next check");
  await expect(page.locator(".wm", { hasText: "News" })).not.toHaveClass(/on/, { timeout: 5_000 }); // the toggle persisted
  await page.click(".check-btn");
  await expect(page.locator(".watch-status")).toContainText("last activity none yet", { timeout: 30_000 });

  await page.click(".del-btn");
  await expect(page.locator("#watchList")).toContainText("Nothing watched yet");
});

test("Space tab: live ISS readouts, catalog-number previews, follow mode, object search", async ({ page }) => {
  await page.goto("/");
  await page.click("#tabSpace");
  await expect(page.locator("#spaceBody .card-place", { hasText: "ISS — live" })).toBeVisible();
  await expect(page.locator('[data-iss="alt"]')).not.toHaveText("—", { timeout: 10_000 });
  await expect(page.locator("#spaceBody")).toContainText("Humans in space right now");
  await expect(page.locator("#spaceBody")).toContainText("Jane Orbit");
  await expect(page.locator("#spaceBody .block").first()).toContainText("TIANGONG");

  await page.locator(".sat-wiki", { hasText: "ISS (ZARYA)" }).click();
  await expect(page.locator(".wiki-title")).toHaveText("International Space Station");
  await expect(page.locator(".wiki-foot .tag")).toContainText("satellite catalog number 25544");
  await page.keyboard.press("Escape");

  await page.locator(".astro-wiki", { hasText: "Jane Orbit" }).click();
  await expect(page.locator(".wiki-title")).toHaveText("Jane Orbit");
  await expect(page.locator(".wiki-foot .tag")).toContainText("Launch Library curated link");
  await page.keyboard.press("Escape");

  await page.locator(".sat-fly").first().click();
  await expect(page.locator("#trackStop")).toHaveText("✕ Stop following ISS (ZARYA)");
  await page.keyboard.press("Escape");
  await expect(page.locator("#trackStop")).toBeHidden();

  await expect(page.locator("#searchInput")).toHaveAttribute("placeholder", "Search a satellite to track");
  await page.fill("#searchInput", "hst");
  await page.locator("#searchResults button", { hasText: "HST" }).click();
  await expect(page.locator("#trackStop")).toHaveText("✕ Stop following HST");

  await page.click("#tabExplore");
  await expect(page.locator("#trackStop")).toBeHidden();
  await expect(page.locator("#searchInput")).toHaveAttribute("placeholder", "Search a place or paste lat, lon");
});

test("settings re-render units; coordinates typed into search drop the circle", async ({ page }) => {
  await page.goto("/");
  await page.click("#settingsBtn");
  await page.click('[data-setting="dist"] [data-val="km"]');
  await expect(page.locator("#radiusOut")).toHaveText("40 km");
  await page.click('[data-setting="dist"] [data-val="both"]');
  await expect(page.locator("#radiusOut")).toHaveText("25 mi / 40 km");
  await page.keyboard.press("Escape");

  await page.fill("#searchInput", "39.78, -89.65");
  await page.press("#searchInput", "Enter");
  await expect(page.locator("#readoutStatus")).toContainText("target locked · 39.7800°N 89.6500°W");
});

test("a deep link runs the analysis; flyovers compute in the browser; plots and clear", async ({ page }) => {
  await page.goto("/#@39.7817,-89.6501,10");
  await expect(page.locator("#radiusOut")).toHaveText("10 mi / 16 km");
  await expect(page.locator(".status-board.all-good")).toBeVisible({ timeout: 40_000 });
  await expect(page.locator(".r-place")).toHaveText("Springfield");

  await page.locator('details[data-sec="flyovers"] summary').click();
  await expect(page.locator('details[data-sec="flyovers"]')).toContainText(/pass(es)? above 10°|No passes above 15°/, { timeout: 60_000 });

  await page.locator('details[data-sec="infrastructure"] summary').click();
  await page.locator('.chip-click[data-cat="Hospitals"]').click();
  await expect(page.locator("#infraLegend")).toBeVisible();
  await expect(page.locator("#infraLegend .il-n")).toHaveText("2");
  await expect(page.locator("#readoutStatus")).toContainText("2 hospitals highlighted");
  await page.click("#infraLegend .il-clear");
  await expect(page.locator("#infraLegend")).toBeHidden();

  await page.click(".infra-all-btn");
  await expect(page.locator("#infraLegend h4")).toHaveText("Facilities in the circle");
  await expect(page.locator("#infraLegend .il-row")).toHaveCount(5);
  await expect(page.locator(".infra-all-btn")).toHaveText("✕ Clear plotted points");

  await page.locator('details[data-sec="surveillance"] summary').click();
  await page.click(".surv-plot-btn");
  await expect(page.locator("#infraLegend h4")).toHaveText("Surveillance devices");
  await expect(page.locator("#infraLegend .il-row")).toHaveCount(4);

  await page.click("#clearReportBtn");
  await expect(page.locator("#emptyState")).toBeVisible();
  await expect(page.locator("#analyzeBtn")).toBeDisabled();
  await expect(page.locator("#infraLegend")).toBeHidden();
  await expect(page.locator("#readoutStatus")).toHaveText("hover the globe");
  expect(new URL(page.url()).hash).toBe("");
});
