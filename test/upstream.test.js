/**
 * Source and network tests against the fake upstream: the parsing each
 * source does, the resilience rules in lib/net.js (timeouts, WDQS retry,
 * Overpass mirror failover and remark detection), and the notification
 * payloads for each channel.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installFakeUpstream, FIX } from "../fixtures/upstream.js";
import { fetchJson, wdqs, overpass, OVERPASS_MIRRORS } from "../lib/net.js";
import { settlementsWithin, enclosingPlaces } from "../sources/settlements.js";
import { surveillance } from "../sources/surveillance.js";
import { indexCountries, reverseGeocode, forwardGeocode } from "../sources/geocode.js";
import { weatherHistory, airQuality } from "../sources/weather.js";
import { noradToQid, astronautQid, wikiSummaryInLang, satFallback } from "../sources/wiki.js";
import { infrastructure } from "../sources/infrastructure.js";
import { loadSpace } from "../sources/space.js";
import { sendNotification, notifyKind } from "../watch/notify.js";

const { lat: LAT, lon: LON } = FIX.center;
let fake;
before(() => { fake = installFakeUpstream(); });
after(() => fake.restore());
beforeEach(() => fake.reset());

/* --------------------------------------------------------------- net */

test("fetchJson times out with a readable message", async () => {
  fake.delay("elevation", 200);
  await assert.rejects(
    () => fetchJson("https://api.open-meteo.com/v1/elevation?latitude=1&longitude=1", {}, 20),
    /Timed out after 0s — api.open-meteo.com/,
  );
});

test("fetchJson reports HTTP errors with the host", async () => {
  fake.fail("elevation", 503);
  await assert.rejects(() => fetchJson("https://api.open-meteo.com/v1/elevation?latitude=1&longitude=1"), /HTTP 503 from api.open-meteo.com/);
});

test("wdqs retries transient errors and gives up on others", async () => {
  let n = 0;
  fake.respond("wdqs", () => (++n < 3 ? new Response("busy", { status: 503 }) : { results: { bindings: [] } }));
  const j = await wdqs("SELECT 1", 5000);
  assert.deepEqual(j.results.bindings, []);
  assert.equal(n, 3);

  n = 0;
  fake.respond("wdqs", () => { n++; return new Response("bad query", { status: 400 }); });
  await assert.rejects(() => wdqs("SELECT 1"), /HTTP 400/);
  assert.equal(n, 1, "a 400 is not retried");
});

test("overpass fails over to the next mirror on errors and on server-side timeouts hidden in a 200", async () => {
  fake.respond("overpass", (url) => {
    if (url.host === new URL(OVERPASS_MIRRORS[0]).host) return new Response("down", { status: 504 });
    if (url.host === new URL(OVERPASS_MIRRORS[1]).host) return { elements: [], remark: "runtime error: Query timed out in \"query\"" };
    return { elements: [{ type: "node", id: 1 }] };
  });
  const j = await overpass("[out:json];node(1);out;");
  assert.equal(j.elements.length, 1);
  const hosts = fake.calls.filter((c) => c.name === "overpass").map((c) => new URL(c.url).host);
  assert.deepEqual(hosts, OVERPASS_MIRRORS.map((m) => new URL(m).host), "every mirror tried in order");

  fake.respond("overpass", () => new Response("down", { status: 502 }));
  await assert.rejects(() => overpass("[out:json];node(1);out;"), /HTTP 502/);
});

/* ----------------------------------------------------------- sources */

test("settlements: ranked by place type then population, with localized names", async () => {
  const list = await settlementsWithin(LAT, LON, 16000, "es");
  assert.deepEqual(list.map((s) => s.type), ["city", "village", "hamlet"]);
  assert.equal(list[2].name, "Nameless Corner", "falls back to name:en");
  assert.equal(list[0].localName, null, "no name:es tag -> null");
  const encl = await enclosingPlaces(LAT, LON, "es");
  assert.deepEqual(encl.map((p) => p.adminLevel), [8, 6]);
});

test("surveillance: devices are classified from OSM tags", async () => {
  const s = await surveillance(LAT, LON, 16000);
  const byCat = Object.fromEntries(s.points.map((p) => [p.cat, p]));
  assert.equal(byCat.alpr.operator, "City");
  assert.equal(byCat.camera.zone, "public");
  assert.equal(byCat.camera.cameraType, "dome");
  assert.equal(byCat.gunshot.lat, 39.76, "ways use their center");
  assert.equal(byCat.speed.cat, "speed");
});

test("infrastructure: two half-queries on rotated mirrors, partial results not cached", async () => {
  const counts = await infrastructure(LAT, LON, 16000);
  assert.equal(counts.length, 12);
  const hosts = fake.calls.filter((c) => c.name === "overpass").map((c) => new URL(c.url).host);
  assert.equal(hosts.length, 2);
  assert.notEqual(hosts[0], hosts[1], "the two halves start on different mirrors");

  fake.reset();
  fake.respond("overpass", (_u, opts) => {
    const q = decodeURIComponent(String(opts.body));
    // the second half times out on every mirror: count statements come back truncated
    if (q.includes("supermarket")) return { elements: [{ type: "count", tags: { total: "9" } }], remark: "runtime error: Query timed out" };
    return { elements: Array.from({ length: 6 }, () => ({ type: "count", tags: { total: "1" } })) };
  });
  const partial = await infrastructure(40, -100, 16000);
  assert.equal(partial.filter((c) => c.count == null).length, 5, "nulls on the truncated tail");
  assert.equal(partial[6].count, 9);
  fake.reset();
  await infrastructure(40, -100, 16000);
  assert.ok(fake.calls.some((c) => c.name === "overpass"), "an incomplete census is re-queried, not served from cache");
});

test("geocode: dataset indexing, ocean detection, forward search filtering", async () => {
  const idx = indexCountries([
    { cca2: "US", currencies: { USD: { name: "Dollar", symbol: "$" } }, languages: { eng: "English" } },
    { cca2: "AQ" }, { currencies: {} },
  ]);
  assert.deepEqual(idx.currencies, { US: { code: "USD", name: "Dollar", symbol: "$" } });
  assert.deepEqual(idx.languages, { US: ["English"] });
  assert.throws(() => indexCountries([]), /empty country dataset/);

  assert.deepEqual(await reverseGeocode(0, -140), { ocean: true, displayName: "Open water / unpopulated area" });
  const land = await reverseGeocode(LAT, LON);
  assert.equal(land.postcode, "62701");
  const hits = await forwardGeocode("Springfield", "de");
  assert.equal(hits.length, 2, "rows without numeric coordinates are dropped");
  assert.match(fake.calls.find((c) => c.name === "nominatim-search").url, /accept-language=de/);
});

test("weather: monthly aggregation and extremes; air quality tolerates a missing block", async () => {
  const h = await weatherHistory(LAT, LON);
  assert.equal(h.months.length, 12);
  for (const m of h.months) {
    assert.ok(m.avgHighC > m.avgLowC, `${m.month} high above low`);
    assert.equal(typeof m.precipMm, "number");
  }
  assert.ok(h.extremes.daysOver30 > 0 && h.extremes.daysBelow0 > 0);
  assert.equal(h.extremes.wettest.precipMm, 3.2);
  fake.respond("airquality", () => ({}));
  assert.equal(await airQuality(1, 1), null);
  fake.respond("archive", () => ({ daily: { time: [] } }));
  assert.deepEqual(await weatherHistory(1, 1), { months: [] });
});

test("wiki: catalog-number and astronaut resolvers cache their answers; name input is sanitized", async () => {
  assert.equal(await noradToQid("25544"), "Q25271");
  assert.equal(await noradToQid("25544"), "Q25271");
  assert.equal(fake.calls.filter((c) => c.name === "wdqs").length, 1, "second lookup served from cache");
  assert.equal(await noradToQid("1"), null);

  assert.equal(await astronautQid('Jane "Orbit"\\'), "Q900", "quotes and backslashes are stripped before the exact label match");
  const q = decodeURIComponent(new URL(fake.calls.at(-1).url).searchParams.get("query"));
  assert.ok(!q.includes('\\"') && q.includes('"Jane Orbit"@en'), "SPARQL string is clean");
  assert.equal(await astronautQid("Jane Orbit"), "Q900");
  assert.equal(fake.calls.filter((c) => c.name === "wdqs").length, 3, "the sanitized name shares the cache entry");
  assert.equal(await astronautQid(""), null);

  const es = await wikiSummaryInLang("en", "Springfield, Illinois", "es");
  assert.equal(es.title, "Springfield (Illinois)");
  const same = await wikiSummaryInLang("en", "Springfield, Illinois", "en");
  assert.equal(same.langFallback, false);
  await assert.rejects(() => wikiSummaryInLang("en", "Nope Nope", "en"), /HTTP 404|Article not found/);

  const fb = await satFallback("20580", "HST", "Q2513", "en");
  assert.equal(fb.urlLabel, "Wikidata");
  assert.equal(fb.facts.find((f) => f.kind === "minutes").value, 95.4);
  assert.equal(await satFallback("1", "X", null, "en"), null, "no record and no entity -> nothing to show");
});

test("space: a stale TLE cache beats an outage; crew fetch failure keeps the satellites", async () => {
  const first = await loadSpace();
  assert.equal(first.satellites.length, 3);
  assert.equal(first.astros.number, 2);
  fake.fail("celestrak-tle");
  fake.fail("ll2");
  const again = await loadSpace();
  assert.equal(again.satellites.length, 3, "served from the in-memory cache");
});

/* ------------------------------------------------------------ notify */

test("notifyKind: explicit format wins, else URL sniffing", () => {
  assert.equal(notifyKind({ url: "https://ntfy.sh/x", format: "json" }), "json");
  assert.equal(notifyKind({ url: "https://discord.com/api/webhooks/1/abc", format: "auto" }), "discord");
  assert.equal(notifyKind({ url: "https://ntfy.example.org/topic" }), "ntfy");
  assert.equal(notifyKind({ url: "https://hooks.example.com/geo" }), "json");
});

test("sendNotification: ntfy headers (RFC 2047 for non-ASCII), Discord embeds, generic JSON", async () => {
  const w = { id: "w1", label: "Zürich", lat: 47.3769, lon: 8.5417, radiusMi: 5 };
  const change = { id: "c1", at: "2026-01-01T00:00:00.000Z", source: "earthquakes", summary: "1 new earthquake recorded", items: [{ text: "M4.1 — near Zürich", detail: "2026-01-01 · 9 km deep" }] };

  await sendNotification({ url: "https://ntfy.sh/topic", format: "auto" }, w, change);
  const ntfy = fake.calls.at(-1);
  assert.match(ntfy.headers.Title, /^=\?UTF-8\?B\?/, "non-latin title is MIME-encoded");
  assert.equal(ntfy.headers.Tags, "warning");
  assert.match(ntfy.body, /^1 new earthquake recorded\n• M4.1 — near Zürich — 2026-01-01 · 9 km deep$/);

  await sendNotification({ url: "https://discord.com/api/webhooks/1/abc", format: "auto" }, w, change);
  const discord = JSON.parse(fake.calls.at(-1).body);
  assert.equal(discord.embeds[0].title, "Zürich (5 mi / 8 km radius): 1 new earthquake recorded");
  assert.match(discord.embeds[0].footer.text, /47\.3769, 8\.5417 · source: earthquakes/);

  await sendNotification({ url: "https://hooks.example.com/geo", format: "auto" }, w, change);
  const json = JSON.parse(fake.calls.at(-1).body);
  assert.equal(json.event, "watch.change");
  assert.deepEqual(json.watch, { id: "w1", label: "Zürich", lat: 47.3769, lon: 8.5417, radiusMi: 5 });
  assert.deepEqual(json.change, change);

  fake.fail("notify", 500);
  await assert.rejects(() => sendNotification({ url: "https://ntfy.sh/topic" }, w, change), /HTTP 500 from ntfy.sh/);
});
