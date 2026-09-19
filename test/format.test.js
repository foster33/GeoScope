import { test } from "node:test";
import assert from "node:assert/strict";
import { WMO, SEVERE_WX, aqiBand, quakeKey, bestName, labelFor, xmlEsc } from "../lib/format.js";

test("aqiBand maps each EPA breakpoint to its band", () => {
  assert.equal(aqiBand(0), "Good");
  assert.equal(aqiBand(50), "Good");
  assert.equal(aqiBand(51), "Moderate");
  assert.equal(aqiBand(100), "Moderate");
  assert.equal(aqiBand(150), "Unhealthy for sensitive groups");
  assert.equal(aqiBand(200), "Unhealthy");
  assert.equal(aqiBand(300), "Very unhealthy");
  assert.equal(aqiBand(301), "Hazardous");
  assert.equal(aqiBand(999), "Hazardous");
});

test("SEVERE_WX flags thunderstorms/heavy precip but not calm codes", () => {
  assert.ok(SEVERE_WX.has(95)); // thunderstorm
  assert.ok(SEVERE_WX.has(75)); // heavy snow
  assert.ok(!SEVERE_WX.has(0)); // clear sky
  assert.ok(!SEVERE_WX.has(61)); // light rain
});

test("WMO has human text for severe codes", () => {
  assert.equal(WMO[95], "thunderstorm");
  assert.equal(WMO[0], "clear sky");
});

test("quakeKey is stable and identifies an event", () => {
  const e = { date: "2024-01-02", mag: 4.1, place: "10km N of Town" };
  assert.equal(quakeKey(e), "2024-01-02|M4.1|10km N of Town");
  // same event -> same key (dedup across re-fetches)
  assert.equal(quakeKey({ ...e }), quakeKey(e));
  // missing place doesn't throw
  assert.equal(quakeKey({ date: "2024-01-02", mag: 4.1 }), "2024-01-02|M4.1|");
});

test("bestName falls through localized tags", () => {
  assert.equal(bestName({ name: "Paris" }), "Paris");
  assert.equal(bestName({ "name:en": "Bangkok" }, null), "Bangkok");
  assert.equal(bestName({ "name:th": "กรุงเทพ" }, "th"), "กรุงเทพ");
  assert.equal(bestName({ int_name: "Kyiv" }), "Kyiv");
  assert.equal(bestName({ "name:fr": "Genève" }), "Genève"); // any name:* as last resort
  assert.equal(bestName(null), null);
  assert.equal(bestName({ foo: "bar" }), null);
});

test("labelFor derives the most specific place name", () => {
  assert.equal(labelFor({ location: { locality: "Springfield", state: "Illinois" } }), "Springfield");
  assert.equal(labelFor({ location: { state: "Texas", country: "USA" } }), "Texas");
  assert.equal(labelFor({ location: { ocean: true } }), "Open water");
  assert.equal(labelFor({}), "Unnamed area");
  assert.equal(labelFor(null), "Unnamed area");
});

test("xmlEsc escapes the five XML entities", () => {
  assert.equal(xmlEsc(`a & b < c > d "e" 'f'`), "a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;");
  assert.equal(xmlEsc(null), "");
  assert.equal(xmlEsc(42), "42");
});
