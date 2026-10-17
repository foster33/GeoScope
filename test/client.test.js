/**
 * Frontend logic tests: the browser modules that have no DOM or Cesium
 * dependency run as-is under Node — formatting, the snapshot differ, the
 * flyover astronomy, permalinks, the report model — plus the cross-checks
 * that keep client tables in sync with their server counterparts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { settings, tInfra, localized, INFRA_LABEL_ORDER, INFRA_I18N } from "../public/js/settings.js";
import * as F from "../public/js/format.js";
import { diffReports, renderDiffHtml, renderCompareHtml } from "../public/js/diff.js";
import { sunEciKm, satSunlit, scanPasses, EARTH_R_KM, AU_KM } from "../public/js/astro.js";
import { permalinkFor, parseLocationHash } from "../public/js/permalink.js";
import { newReport, serializableReport, sumPopulation, SOURCES, INITIAL_SOURCES, SURV_CATS } from "../public/js/report-model.js";
import { WMO as SERVER_WMO, aqiBand } from "../lib/format.js";
import { INFRA_CATS } from "../sources/infrastructure.js";

const withSettings = (patch, fn) => {
  const saved = { ...settings };
  Object.assign(settings, patch);
  try { return fn(); } finally { Object.assign(settings, saved); }
};

/* ---------------------------------------------------------- settings */

test("infrastructure labels match the server's categories, and every translation table is complete", () => {
  assert.deepEqual(INFRA_LABEL_ORDER, INFRA_CATS.map(([label]) => label));
  for (const [lang, rows] of Object.entries(INFRA_I18N)) assert.equal(rows.length, INFRA_LABEL_ORDER.length, lang);
  assert.equal(tInfra("Hospitals"), "Hospitals", "off by default");
  withSettings({ infraLang: "on", lang: "de" }, () => assert.equal(tInfra("Hospitals"), "Krankenhäuser"));
  withSettings({ infraLang: "on", lang: "xx" }, () => assert.equal(tInfra("Hospitals"), "Hospitals"));
  assert.equal(localized("Wien", "Vienna"), "Vienna (Wien)");
  assert.equal(localized("Paris", "Paris"), "Paris");
  assert.equal(localized("Paris", null), "Paris");
});

/* ------------------------------------------------------------ format */

test("the client's weather-code table is identical to the server's", () => {
  assert.deepEqual(F.WMO, SERVER_WMO);
  assert.equal(F.wmo(999), "mixed");
});

test("AQI bands agree with the server classifier and carry the right colors", () => {
  for (const aqi of [0, 50, 51, 100, 150, 200, 300, 301]) assert.equal(F.aqiInfo(aqi).band, aqiBand(aqi));
  assert.equal(F.aqiInfo(10).color, "var(--teal)");
  assert.equal(F.aqiInfo(120).color, "var(--brass)");
  assert.equal(F.aqiInfo(250).color, "var(--coral)");
});

test("unit formatters follow the display settings", () => {
  withSettings({ temp: "both", dist: "both" }, () => {
    assert.equal(F.tempStr(20), "20°C / 68°F");
    assert.equal(F.tempStr(null), "—");
    assert.equal(F.distKm(16.09344), "10 mi / 16 km");
    assert.equal(F.distMi(10), "10 mi / 16 km");
    assert.equal(F.windStr(16), "16 km/h (10 mph)");
    assert.equal(F.areaStr(1), "1 mi² / 3 km²");
    assert.equal(F.distUnit(), "mi");
  });
  withSettings({ temp: "f", dist: "mi" }, () => {
    assert.equal(F.tempStr(20), "68°F");
    assert.equal(F.distKm(16.09344), "10 mi");
    assert.equal(F.windStr(16), "10 mph");
    assert.equal(F.areaStr(100), "100 mi²");
  });
  withSettings({ temp: "c", dist: "km" }, () => {
    assert.equal(F.tempStr(20.26), "20.3°C");
    assert.equal(F.distKm(16.09344), "16 km");
    assert.equal(F.windStr(16), "16 km/h");
    assert.equal(F.distUnit(), "km");
    assert.equal(F.distCell(10), 10);
  });
  withSettings({ dist: "mi" }, () => assert.equal(F.distCell(16.09344), 10));
});

test("coordinates, compass, escaping, misc", () => {
  assert.equal(F.fmtLat(39.78171), "39.7817°N");
  assert.equal(F.fmtLat(-33.9), "33.9000°S");
  assert.equal(F.fmtLon(-89.6501), "89.6501°W");
  assert.equal(F.compass(0), "N");
  assert.equal(F.compass(359), "N");
  assert.equal(F.compass(-90), "W");
  assert.equal(F.compass(202.5), "SSW");
  assert.equal(F.esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(F.num(null), "—");
  assert.equal(F.F(100), 212);
  assert.equal(F.flagEmoji("US"), "🇺🇸");
  assert.equal(F.flagEmoji("USA"), "");
  assert.equal(F.placeTitle({ location: { ocean: true } }), "Open water");
  assert.equal(F.placeTitle({ location: { county: "Kent" } }), "Kent");
  assert.equal(F.placeTitle({}), "Unnamed area");
});

test("coordinate input parsing", () => {
  assert.deepEqual(F.parseCoordInput("40.7, -74"), { lat: 40.7, lon: -74 });
  assert.deepEqual(F.parseCoordInput(" 40.7 -74.0 "), { lat: 40.7, lon: -74 });
  assert.equal(F.parseCoordInput("95, 10"), null, "latitude out of range");
  assert.equal(F.parseCoordInput("Springfield"), null);
  assert.equal(F.parseCoordInput("40.7"), null);
});

test("time helpers: clock style, relative time, zone offsets and DST", () => {
  withSettings({ clock: "12" }, () => {
    assert.equal(F.fmtHM("07:05"), "7:05 AM");
    assert.equal(F.fmtHM("18:20"), "6:20 PM");
    assert.equal(F.fmtHM("00:00"), "12:00 AM");
  });
  withSettings({ clock: "24" }, () => assert.equal(F.fmtHM("18:20"), "18:20"));
  const now = Date.UTC(2026, 0, 1);
  assert.equal(F.rel(new Date(now - 30_000).toISOString(), now), "moments ago");
  assert.equal(F.rel(new Date(now - 5 * 60_000).toISOString(), now), "5 min ago");
  assert.equal(F.rel(new Date(now + 3 * 3600_000).toISOString(), now), "in 3h");
  assert.equal(F.rel(new Date(now - 3 * 86400_000).toISOString(), now), "3d ago");
  assert.equal(F.rel(null), "—");
  assert.equal(F.utcOffStr(-300), "UTC−05:00");
  assert.equal(F.utcOffStr(330), "UTC+05:30");

  const jul = new Date(Date.UTC(2026, 6, 1, 12));
  const jan = new Date(Date.UTC(2026, 0, 1, 12));
  assert.equal(F.tzOffsetMin("America/New_York", jul), -240);
  assert.equal(F.tzOffsetMin("America/New_York", jan), -300);
  const ny = F.dstInfo("America/New_York", jul);
  assert.deepEqual({ observed: ny.observed, active: ny.active, offsetMin: ny.offsetMin, stdMin: ny.stdMin }, { observed: true, active: true, offsetMin: -240, stdMin: -300 });
  const syd = F.dstInfo("Australia/Sydney", jan);
  assert.equal(syd.active, true, "southern hemisphere: DST in January");
  assert.equal(syd.stdMin, 600);
  assert.equal(F.dstInfo("Asia/Tokyo", jul).observed, false);
});

/* -------------------------------------------------------------- diff */

const rep = (over = {}) => ({
  estimatedPopulation: 1000,
  settlements: [{ name: "A", type: "city", population: 1000 }],
  infrastructure: [{ label: "Hospitals", count: 2 }],
  surveillance: { counts: { alpr: 1, camera: 0, speed: 0, gunshot: 0 } },
  landmarks: [{ title: "Tower" }],
  people: [{ name: "Ada" }],
  quakes: { count: 1, largest: { mag: 3, date: "2020-01-01" } },
  weather: { current: { temperature_2m: 10 } },
  air: { us_aqi: 40 },
  ...over,
});

test("diffReports: identical reports differ only in moment-in-time readings", () => {
  const d = diffReports(rep(), rep());
  assert.equal(d.length, 1);
  assert.equal(d[0].dim, true);
  assert.match(renderDiffHtml({ takenAt: "2026-01-01T00:00:00Z", report: rep() }, { takenAt: "2026-01-03T00:00:00Z", report: rep() }), /No changes in the slow-moving data.*2 days apart|2 days apart/s);
});

test("diffReports: every slow-moving section reports its own kind of change", () => {
  const b = rep({
    estimatedPopulation: 1500,
    settlements: [{ name: "A", type: "city", population: 1500 }, { name: "B", type: "village", population: null }],
    infrastructure: [{ label: "Hospitals", count: 3 }, { label: "Parks", count: 9 }],
    surveillance: { counts: { alpr: 2, camera: 0, speed: 0, gunshot: 0 } },
    landmarks: [{ title: "Bridge" }],
    people: [{ name: "Ada" }, { name: "Alan" }],
    quakes: { count: 2, largest: { mag: 4, date: "2025-01-01" } },
    weather: { current: { temperature_2m: 12 } },
    air: { us_aqi: 60 },
  });
  const d = diffReports(rep(), b);
  const by = Object.fromEntries(d.map((s) => [s.title, s.rows]));
  assert.deepEqual(by["Population estimate"], [{ s: "Δ", t: "1,000 → 1,500 (+500)" }]);
  assert.deepEqual(by.Settlements.map((r) => r.s + r.t), ["+B (village)", "ΔA: population 1,000 → 1,500 (+500)"]);
  assert.deepEqual(by.Infrastructure, [{ s: "Δ", t: "Hospitals: 2 → 3 (+1)" }], "a category without a baseline is not a change");
  assert.deepEqual(by["Surveillance devices"], [{ s: "Δ", t: "License plate readers (ALPR): 1 → 2 (+1)" }]);
  assert.deepEqual(by.Landmarks.map((r) => r.s + r.t), ["+Bridge", "−Tower"]);
  assert.deepEqual(by["Notable people"].map((r) => r.s + r.t), ["+Alan"]);
  assert.equal(by.Seismicity.length, 2);
  assert.match(by.Seismicity[1].t, /M3 \(2020-01-01\) → M4 \(2025-01-01\)/);
  const dim = d.find((s) => s.dim);
  assert.equal(dim.rows.length, 2);
  assert.match(renderCompareHtml({ label: "X", lat: 1, lon: 2, radiusMi: 5, report: rep() }, { label: "Y", lat: 3, lon: 4, radiusMi: 5, report: b }), /Area A.*Area B/s);
  assert.equal(diffReports({}, {}).length, 0, "empty reports: nothing to say");
});

/* ------------------------------------------------------------- astro */

test("sunEciKm: about one AU away, on the equator at the equinoxes, north in June", () => {
  const equinox = sunEciKm(new Date(Date.UTC(2026, 2, 20, 14, 46)));
  const dist = Math.hypot(equinox.x, equinox.y, equinox.z);
  assert.ok(Math.abs(dist / AU_KM - 1) < 0.02, `distance ${dist}`);
  assert.ok(Math.abs(equinox.z) / dist < 0.01, "declination ~0 at the March equinox");
  const june = sunEciKm(new Date(Date.UTC(2026, 5, 21)));
  assert.ok(june.z > 0, "northern summer: Sun north of the equator");
  assert.ok(Math.abs(Math.asin(june.z / Math.hypot(june.x, june.y, june.z)) * 180 / Math.PI - 23.44) < 0.3);
});

test("satSunlit: the sunward side is lit, the anti-sun axis is in shadow, offset from it is lit", () => {
  const sun = { x: AU_KM, y: 0, z: 0 };
  assert.equal(satSunlit({ x: 7000, y: 0, z: 0 }, sun), true);
  assert.equal(satSunlit({ x: -7000, y: 0, z: 0 }, sun), false);
  assert.equal(satSunlit({ x: -7000, y: EARTH_R_KM + 1, z: 0 }, sun), true);
  assert.equal(satSunlit({ x: -7000, y: 0, z: EARTH_R_KM - 1 }, sun), false);
});

test("scanPasses: splits a synthetic elevation curve into passes with a naked-eye window per pass", () => {
  // elevation rises to 40° at t=5, dips, rises to 20° at t=15; nothing at t=20+
  const curve = { 3: 12, 4: 30, 5: 40, 6: 25, 7: 5, 13: 11, 14: 18, 15: 20, 16: 12 };
  let visibilityChecks = 0;
  // sunlit under a dark sky only while climbing in the first pass: t=3..4
  const sample = (t) => (t > 19 ? null : { el: curve[t] ?? 0, az: t * 10, visible: () => { visibilityChecks++; return t === 3 || t === 4; } });
  const passes = scanPasses(sample, { t0: 0, tEnd: 25, stepMs: 1, minEl: 10, meta: { name: "X" } });
  assert.equal(passes.length, 2);
  assert.deepEqual(passes.map((p) => [p.start, p.startAz, p.end, p.endAz, p.peakEl, p.peakAz, p.peakT]), [
    [3, 30, 6, 60, 40, 50, 5],
    [13, 130, 16, 160, 20, 150, 15],
  ]);
  assert.equal(passes[0].name, "X");
  assert.equal(passes[0].visible, true, "visible somewhere in the pass, even though the peak is in shadow");
  assert.deepEqual([passes[0].visStart, passes[0].visEnd, passes[0].visPeakEl, passes[0].visPeakAz], [3, 4, 30, 40]);
  assert.equal(passes[1].visible, false);
  assert.deepEqual([passes[1].visStart, passes[1].visEnd, passes[1].visPeakEl], [null, null, null]);
  assert.equal(visibilityChecks, 8, "once per sample inside a pass, never between passes");
  assert.ok(!("samples" in passes[0]), "scratch state is not leaked");
});

test("scanPasses: refinement pins rise, set and peak to the fine step", () => {
  // a smooth triangular pass: 30° peak at t=200 s, above 10° from t=100 s to t=300 s
  const el = (t) => 30 - Math.abs(t - 200_000) / 5000;
  const sample = (t) => ({ el: el(t), az: 180, visible: false });
  const [coarse] = scanPasses(sample, { t0: 0, tEnd: 600_000, stepMs: 30_000, minEl: 10 });
  assert.deepEqual([coarse.start, coarse.end, coarse.peakT, coarse.peakEl], [120_000, 300_000, 210_000, 28], "the grid clips the pass");
  const [fine] = scanPasses(sample, { t0: 0, tEnd: 600_000, stepMs: 30_000, minEl: 10, refineMs: 1000 });
  assert.deepEqual([fine.start, fine.end, fine.peakT, fine.peakEl], [100_000, 300_000, 200_000, 30]);
  // a pass already in progress at t0 keeps t0 as its start
  const [live] = scanPasses(sample, { t0: 150_000, tEnd: 600_000, stepMs: 30_000, minEl: 10, refineMs: 1000 });
  assert.equal(live.start, 150_000);
});

/* --------------------------------------------------------- permalink */

test("permalink round-trips and rejects malformed or off-globe hashes", () => {
  const h = permalinkFor(39.781712, -89.65009, 10.4);
  assert.equal(h, "#@39.78171,-89.65009,10");
  assert.deepEqual(parseLocationHash(h), { lat: 39.78171, lon: -89.65009, radius: 10 });
  assert.equal(parseLocationHash("#@91,0,5"), null);
  assert.equal(parseLocationHash("#@1,2"), null);
  assert.equal(parseLocationHash("#foo"), null);
  assert.equal(parseLocationHash(""), null);
});

/* ------------------------------------------------------ report model */

test("newReport starts every source queued, with dependents noting what they wait for", () => {
  const r = newReport(1, 2, 25, new Date(Date.UTC(2026, 0, 1)));
  assert.equal(r.radiusKm, 40.2);
  assert.equal(r.queriedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(r.pending.size, 0);
  assert.equal(r.sourceStatus.news.note, "waits for geocode");
  assert.ok(!INITIAL_SOURCES.includes("news") && SOURCES.includes("news"));
  assert.deepEqual(SURV_CATS.map(([k]) => k), ["alpr", "camera", "speed", "gunshot"]);
});

test("serializableReport strips transient UI state; sumPopulation ignores untagged places", () => {
  const r = newReport(1, 2, 25);
  r._open = new Set(["weather"]);
  r._fly = { state: "done" };
  r.finalized = true;
  r.summary = "s";
  const out = serializableReport(r);
  assert.deepEqual(Object.keys(out).filter((k) => ["pending", "sourceStatus", "_open", "_fly", "finalized"].includes(k)), []);
  assert.equal(out.summary, "s");
  assert.equal(sumPopulation([{ population: 10 }, { population: null }, {}]), 10);
  assert.equal(sumPopulation([]), null);
});
