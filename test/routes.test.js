/**
 * Route tests: the full Express app on an ephemeral port, every upstream
 * service replaced by fixtures (fixtures/upstream.js). These pin the public
 * contract of every endpoint — status codes, error messages, cache headers
 * and response shapes — so a refactor can't silently change what the
 * frontend receives.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootTestApp } from "../fixtures/testapp.js";
import { FIX } from "../fixtures/upstream.js";

const { lat: LAT, lon: LON } = FIX.center;
const P = `lat=${LAT}&lon=${LON}&radius_mi=10`;

let t;
before(async () => { t = await bootTestApp({ engine: { maxWatches: 2 } }); });
after(async () => { await t.close(); });
beforeEach(() => t.fake.reset());

/* ------------------------------------------------------------ /api/part */

test("part: geocode returns the address hierarchy plus currency and languages", async () => {
  const r = await t.get(`/api/part/geocode?${P}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-geoscope-cache"), "miss");
  const d = r.body.data;
  assert.equal(d.ocean, false);
  assert.equal(d.locality, "Springfield");
  assert.equal(d.county, "Sangamon County");
  assert.equal(d.state, "Illinois");
  assert.equal(d.countryCode, "US");
  assert.deepEqual(d.currency, { code: "USD", name: "United States dollar", symbol: "$", perUsd: 1 });
  assert.deepEqual(d.languages, ["English"]);
});

test("part: a repeat request within the TTL is a cache hit and makes no upstream call", async () => {
  await t.get(`/api/part/geocode?${P}`);
  t.fake.reset();
  const r = await t.get(`/api/part/geocode?${P}`);
  assert.equal(r.headers.get("x-geoscope-cache"), "hit");
  assert.equal(t.fake.calls.length, 0);
});

test("part: settlements are ranked city-first and fall back to localized name tags", async () => {
  const r = await t.get(`/api/part/settlements?${P}`);
  const { list, enclosing } = r.body.data;
  assert.equal(enclosing, null, "no enclosing-boundary lookup at a 10 mi radius");
  assert.deepEqual(list.map((s) => s.name), ["Springfield", "Rochester", "Nameless Corner"]);
  assert.equal(list[0].population, 116250);
  assert.equal(list[0].wikidata, "Q28515");
  assert.equal(typeof list[0].distanceKm, "number");
});

test("part: a small radius anchors settlements on enclosing boundaries, most specific first", async () => {
  const r = await t.get(`/api/part/settlements?lat=${LAT}&lon=${LON}&radius_mi=2&lang=es`);
  const { enclosing } = r.body.data;
  assert.deepEqual(enclosing.map((p) => p.adminLevel), [8, 6]);
  assert.equal(enclosing[0].name, "Springfield");
  assert.equal(enclosing[0].localName, "Springfield");
  assert.equal(enclosing[0].population, 116250);
});

test("part: weather trims the forecast to current/daily/timezone", async () => {
  const r = await t.get(`/api/part/weather?${P}`);
  assert.deepEqual(Object.keys(r.body.data), ["current", "daily", "timezone"]);
  assert.equal(r.body.data.current.temperature_2m, 21.4);
  assert.equal(r.body.data.timezone, "America/Chicago");
});

test("part: weather history aggregates a year of days into 12 months plus extremes", async () => {
  const r = await t.get(`/api/part/history?${P}`);
  const { months, extremes } = r.body.data;
  assert.equal(months.length, 12);
  assert.match(months[0].month, /^\d{4}-\d{2}$/);
  assert.ok(extremes.hottest.tempC > extremes.coldest.tempC);
  assert.ok(extremes.totalPrecipMm > 0);
});

test("part: people are merged per entity, unlabeled entities dropped, sorted by sitelinks", async () => {
  const r = await t.get(`/api/part/people?${P}`);
  const people = r.body.data;
  assert.deepEqual(people.map((p) => p.name), ["Ada Example", "Bob Sample"]);
  assert.deepEqual(people[0].occupations, ["writer", "poet"]);
  assert.equal(people[0].born, "1950-02-03");
  assert.equal(people[0].url, "https://www.wikidata.org/wiki/Q1");
});

test("part: landmarks use Wikidata across big circles and Wikipedia geosearch in small ones", async () => {
  const big = await t.get(`/api/part/landmarks?${P}`);
  assert.ok(big.body.data.every((m) => m.source === "wikidata"));
  assert.equal(big.body.data[0].url, "https://en.wikipedia.org/wiki/Lincoln_Home_National_Historic_Site");
  assert.equal(big.body.data[1].url, "https://www.wikidata.org/wiki/Q11", "no article -> Wikidata page");
  const small = await t.get(`/api/part/landmarks?lat=${LAT}&lon=${LON}&radius_mi=3`);
  assert.ok(small.body.data.every((m) => m.source === "wikipedia"));
  assert.equal(small.body.data[0].distanceKm, 0);
});

test("part: elevation, air quality, infrastructure, surveillance, earthquakes", async () => {
  assert.equal((await t.get(`/api/part/elevation?${P}`)).body.data, 181);
  assert.equal((await t.get(`/api/part/airquality?${P}`)).body.data.us_aqi, 42);

  const infra = (await t.get(`/api/part/infrastructure?${P}`)).body.data;
  assert.equal(infra.length, 12);
  assert.deepEqual(infra[0], { label: "Hospitals", count: 2 });
  assert.equal(infra.find((c) => c.label === "Places of worship").count, 80);

  const sv = (await t.get(`/api/part/surveillance?${P}`)).body.data;
  assert.deepEqual(sv.counts, { alpr: 1, camera: 1, speed: 1, gunshot: 1 });
  assert.equal(sv.total, 4);
  assert.equal(sv.points.find((p) => p.cat === "alpr").manufacturer, "Flock Safety");
  assert.equal(sv.truncated, false);

  const q = (await t.get(`/api/part/earthquakes?${P}`)).body.data;
  assert.equal(q.count, 2);
  assert.equal(q.largest.mag, 4.1);
  assert.equal(q.recent[0].date, "2024-08-15", "recent list is newest first");
});

test("part: news anchors every query to the verified place names and dedups titles", async () => {
  const r = await t.get(`/api/part/news?${P}&locality=Springfield&county=Sangamon%20County&state=Illinois&country=United%20States&extra=Rochester`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 6, "3 queries x 2 unique titles");
  assert.ok(r.body.data.every((n) => /^\d{4}-\d{2}-\d{2}T/.test(n.pubDate)), "full timestamps for the watch differ");
  const labels = new Set(r.body.data.map((n) => n.matched));
  assert.deepEqual([...labels].sort(), ["Rochester, Illinois", "Sangamon County, Illinois", "Springfield, Illinois"]);
  const queries = t.fake.calls.filter((c) => c.name === "news").map((c) => decodeURIComponent(new URL(c.url).searchParams.get("q")));
  assert.ok(queries.every((q) => q.includes('"Illinois"')), "each query carries the state as a quoted term");
});

test("part: news without a geocoded place is a 502 with a user-facing message", async () => {
  const r = await t.get(`/api/part/news?${P}`);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /No verified place names/);
});

test("part: upstream failures become 502 with the reason, and are not cached", async () => {
  t.fake.fail("usgs");
  const r = await t.get(`/api/part/earthquakes?lat=1&lon=1`);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /usgs unreachable/);
  t.fake.reset();
  const ok = await t.get(`/api/part/earthquakes?lat=1&lon=1`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("x-geoscope-cache"), "miss");
});

test("part: validation — unknown source 404, bad coordinates 400, radius clamped", async () => {
  assert.equal((await t.get(`/api/part/bogus?${P}`)).status, 404);
  assert.deepEqual((await t.get(`/api/part/weather?lat=999&lon=0`)).body, { error: "Valid lat and lon are required." });
  assert.equal((await t.get(`/api/part/weather?lon=0`)).status, 400);
  assert.equal((await t.get(`/api/part/weather?lat=1&lat=2&lon=0`)).status, 200, "repeated params take the first value");
  const r = await t.get(`/api/part/elevation?lat=${LAT}&lon=${LON}&radius_mi=9999`);
  assert.equal(r.status, 200);
});

/* ------------------------------------------------------------ /api/area */

test("area: the seven-source report, summarized, cached only when complete", async () => {
  const r = await t.get(`/api/area?${P}`);
  assert.equal(r.status, 200);
  const rep = r.body;
  assert.equal(rep.radiusMi, 10);
  assert.equal(rep.radiusKm, 16.1);
  assert.equal(rep.location.locality, "Springfield");
  assert.equal(rep.settlements.length, 3);
  assert.equal(rep.estimatedPopulation, 116250 + 3600);
  assert.equal(rep.elevationM, 181);
  assert.deepEqual(rep.sourceErrors, []);
  assert.match(rep.summary, /Springfield, Sangamon County, Illinois, United States/);
  assert.match(rep.summary, /largest being Springfield/);
  assert.equal((await t.get(`/api/area?${P}`)).headers.get("x-geoscope-cache"), "hit");
});

test("area: a failed source is listed, the report still answers, and nothing is cached", async () => {
  t.fake.fail("elevation");
  const r = await t.get(`/api/area?lat=45&lon=-100&radius_mi=5`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sourceErrors, ["elevation"]);
  assert.equal(r.body.elevationM, null);
  assert.equal((await t.get(`/api/area?lat=45&lon=-100&radius_mi=5`)).headers.get("x-geoscope-cache"), "miss");
});

test("area: open water", async () => {
  const r = await t.get(`/api/area?lat=0&lon=-140&radius_mi=50`);
  assert.equal(r.body.location.ocean, true);
  assert.match(r.body.summary, /open water/);
  assert.equal((await t.get(`/api/area?lat=abc`)).status, 400);
});

/* ----------------------------------------------- /api/geocode, /api/summary */

test("geocode: forward search returns ranked candidates, filters junk rows, caches", async () => {
  const r = await t.get(`/api/geocode?q=Springfield`);
  assert.equal(r.body.results.length, 2);
  assert.equal(r.body.results[0].displayName, "Springfield, Sangamon County, Illinois, United States");
  assert.equal(r.body.results[0].type, "city · place");
  assert.equal((await t.get(`/api/geocode?q=springfield`)).headers.get("x-geoscope-cache"), "hit", "case-insensitive key");
  assert.deepEqual((await t.get(`/api/geocode?q=nowhere`)).body, { results: [] });
  assert.deepEqual((await t.get(`/api/geocode?q=x`)).body, { error: "A search term is required." });
});

test("summary: composes the paragraph from a report payload", async () => {
  const area = (await t.get(`/api/area?${P}`)).body;
  const r = await t.post("/api/summary", { report: area });
  assert.equal(r.status, 200);
  assert.equal(r.body.summary, area.summary);
  assert.equal((await t.post("/api/summary", { report: { lat: "x" } })).status, 400);
});

/* ------------------------------------------------------- /api/infrapoints */

test("infrapoints: one category, all categories, validation", async () => {
  const one = await t.get(`/api/infrapoints?cat=Hospitals&${P}&lang=es`);
  assert.equal(one.body.data.length, 2);
  assert.equal(one.body.data[0].name, "Memorial Medical Center");
  assert.equal(one.body.truncated, false);

  const all = await t.get(`/api/infrapoints?cat=*&${P}`);
  assert.equal(all.body.data.length, 6);
  assert.ok(all.body.data.every((p) => p.cat));
  assert.equal(all.body.data.filter((p) => p.cat === "Hospitals").length, 2);

  assert.deepEqual((await t.get(`/api/infrapoints?cat=Bogus&${P}`)).body, { error: "Unknown infrastructure category." });
  assert.equal((await t.get(`/api/infrapoints?cat=Hospitals&lat=200&lon=0`)).status, 400);
});

/* -------------------------------------------------------- /api/wikipreview */

test("wikipreview: a Wikidata QID resolves to the requested language's edition", async () => {
  const es = (await t.get(`/api/wikipreview?name=Springfield&wikidata=Q28515&lang=es`)).body.data;
  assert.equal(es.title, "Springfield (Illinois)");
  assert.equal(es.lang, "es");
  assert.equal(es.langFallback, false);
  assert.equal(es.via, "Wikidata Q28515");
  const fr = (await t.get(`/api/wikipreview?name=Springfield&wikidata=Q28515&lang=fr`)).body.data;
  assert.equal(fr.lang, "en", "no French edition -> English");
  assert.equal(fr.langFallback, true);
});

test("wikipreview: an OSM wikipedia tag follows langlinks, else keeps the tagged edition", async () => {
  const es = (await t.get(`/api/wikipreview?name=Springfield&wikipedia=en:Springfield,%20Illinois&lang=es`)).body.data;
  assert.equal(es.title, "Springfield (Illinois)");
  assert.equal(es.via, "OSM wikipedia tag");
  const fr = (await t.get(`/api/wikipreview?name=Springfield&wikipedia=en:Springfield,%20Illinois&lang=fr`)).body.data;
  assert.equal(fr.title, "Springfield, Illinois");
  assert.equal(fr.langFallback, true);
});

test("wikipreview: satellites resolve by catalog number, with a SATCAT fallback for objects without an article", async () => {
  const iss = (await t.get(`/api/wikipreview?name=ISS&norad=25544&lang=en`)).body.data;
  assert.equal(iss.title, "International Space Station");
  assert.equal(iss.via, "satellite catalog number 25544");

  const hst = (await t.get(`/api/wikipreview?name=HST&norad=020580&lang=en`)).body.data; // zero-padded, as older clients send
  assert.equal(hst.factsOnly, true);
  assert.equal(hst.title, "Hubble Space Telescope");
  assert.equal(hst.via, "CelesTrak SATCAT 20580 + Wikidata Q2513");
  assert.ok(hst.facts.some((f) => f.label === "launch date" && f.value === "1990-04-24"));
  assert.ok(hst.facts.some((f) => f.kind === "owner" && f.iso === "US"));
  assert.match(hst.thumb, /Hubble\.jpg/);

  const none = await t.get(`/api/wikipreview?name=X&norad=99999&lang=en`);
  assert.equal(none.status, 404);
  assert.match(none.body.error, /satellite catalog/);
});

test("wikipreview: astronauts need an occupation-constrained match; places a coordinate match", async () => {
  const jane = (await t.get(`/api/wikipreview?name=Jane%20Orbit&astro=1&lang=en`)).body.data;
  assert.equal(jane.title, "Jane Orbit");
  assert.match(jane.via, /astronaut name \+ occupation match/);
  assert.equal((await t.get(`/api/wikipreview?name=Nobody&astro=1&lang=en`)).status, 404);

  const cap = (await t.get(`/api/wikipreview?name=Illinois%20State%20Capitol&lat=39.7983&lon=-89.6544&lang=en`)).body.data;
  assert.equal(cap.via, "coordinate + name match");
  const miss = await t.get(`/api/wikipreview?name=Unknown%20Place&lat=39.7983&lon=-89.6544&lang=en`);
  assert.equal(miss.status, 404);
  assert.equal(miss.body.error, "No verified Wikipedia article for this place.");
});

test("wikipreview: repeated query parameters don't crash the resolver", async () => {
  const r = await t.get(`/api/wikipreview?name=a&name=b&wikipedia=en:Springfield,%20Illinois&wikipedia=x&lang=en`);
  assert.equal(r.status, 200);
});

/* ------------------------------------------------------------ /api/space */

test("space: TLEs deduplicated across groups, crew list without non-humans", async () => {
  const r = await t.get("/api/space");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.satellites.map((s) => s.noradId), ["25544", "48274", "20580"]);
  assert.equal(r.body.satellites[0].group, "stations");
  assert.match(r.body.tleFetchedAt, /^\d{4}-/);
  assert.equal(r.body.astros.number, 2);
  assert.equal(r.body.astros.people[0].wiki, "https://en.wikipedia.org/wiki/Jane_Orbit");
});

/* ---------------------------------------------------------- /api/history */

test("history: save creates a place, a second save at the same spot appends, deletes cascade", async () => {
  const area = (await t.get(`/api/area?${P}`)).body;
  assert.deepEqual((await t.get("/api/history")).body, []);

  const s1 = await t.post("/api/history", { report: area });
  assert.equal(s1.status, 201);
  assert.equal(s1.body.created, true);
  assert.equal(s1.body.snapshots, 1);

  const s2 = await t.post("/api/history", { report: { ...area, queriedAt: new Date().toISOString() } });
  assert.equal(s2.body.created, false);
  assert.equal(s2.body.placeId, s1.body.placeId);
  assert.equal(s2.body.snapshots, 2);

  await t.post("/api/history", { report: { ...area, lat: 1, lon: 2, radiusMi: 5 } });
  assert.equal((await t.post("/api/history", { report: { lat: 1 } })).status, 400);

  const list = (await t.get("/api/history")).body;
  assert.equal(list.length, 2);
  assert.equal(list[0].label, "Springfield", "most recent activity first");
  assert.equal(list[1].label, "Springfield", "label derives from the report's geocode");
  assert.equal(list[0].snapshots.length, 2);

  const d1 = await t.del(`/api/history/${s1.body.placeId}/snapshots/${s2.body.snapshotId}`);
  assert.deepEqual(d1.body, { deleted: s2.body.snapshotId, placeDeleted: false });
  assert.equal((await t.del(`/api/history/${s1.body.placeId}/snapshots/nope`)).body.error, "Snapshot not found.");
  assert.equal((await t.del(`/api/history/nope/snapshots/nope`)).body.error, "Place not found.");
  const d2 = await t.del(`/api/history/${s1.body.placeId}/snapshots/${s1.body.snapshotId}`);
  assert.equal(d2.body.placeDeleted, true, "last snapshot gone -> place gone");

  const rest = (await t.get("/api/history")).body;
  assert.equal(rest.length, 1);
  assert.deepEqual((await t.del(`/api/history/${rest[0].id}`)).body, { deleted: rest[0].id });
  assert.equal((await t.del(`/api/history/nope`)).status, 404);
  assert.deepEqual((await t.get("/api/history")).body, []);
});

/* ---------------------------------------------------------- /api/watches */

test("watches: create, baseline, configure, check, feed, delete", async () => {
  assert.deepEqual((await t.get("/api/watches")).body, []);
  const add = await t.post("/api/watches", {
    lat: LAT, lon: LON, radiusMi: 10, label: "Springfield",
    place: { locality: "Springfield", state: "Illinois", country: "United States", junk: { nested: true } },
  });
  assert.equal(add.status, 201);
  const w = add.body;
  assert.deepEqual(w.place, { locality: "Springfield", state: "Illinois", country: "United States" }, "only known place fields are stored");
  assert.equal(w.baselined, false);
  assert.ok(!("snapshots" in w), "snapshots are internal");
  assert.equal((await t.post("/api/watches", { lat: "x" })).status, 400);

  // the create kicked off a forced baseline tick in the background; a manual
  // check waits for its own tick, after which every source has a snapshot
  let view;
  for (let i = 0; i < 50; i++) {
    const r = await t.post(`/api/watches/${w.id}/check`, {});
    if (r.status === 200) { view = r.body; break; }
    assert.equal(r.status, 409, "while a tick runs, check reports busy");
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.equal(view.baselined, true);
  assert.deepEqual(view.lastErrors, {});
  assert.deepEqual(view.changes, [], "the first check only sets baselines");
  assert.match(view.nextCheckAt, /^\d{4}-/);

  const m = await t.patch(`/api/watches/${w.id}`, { metrics: { news: false, bogus: true } });
  assert.equal(m.body.metrics.news, false);
  assert.ok(!("bogus" in m.body.metrics));

  assert.equal((await t.patch(`/api/watches/${w.id}`, { notify: { url: "ftp://x" } })).status, 400);
  const n = await t.patch(`/api/watches/${w.id}`, { notify: { url: "https://ntfy.sh/geoscope-test", format: "auto" } });
  assert.deepEqual(n.body.notify, { url: "https://ntfy.sh/geoscope-test", format: "auto" });

  t.fake.reset();
  const nt = await t.post(`/api/watches/${w.id}/notify-test`, {});
  assert.deepEqual(nt.body, { ok: true });
  const sent = t.fake.calls.find((c) => c.name === "notify");
  assert.equal(sent.headers.Title, "GeoScope: Springfield (10 mi / 16 km radius)");
  assert.match(sent.body, /Test notification/);
  assert.equal((await t.get("/api/watches")).body[0].notifyState.ok, true);

  const seen = await t.patch(`/api/watches/${w.id}`, { seen: true });
  assert.match(seen.body.lastSeenAt, /^\d{4}-/);

  const rss = await t.get(`/api/watches/${w.id}/rss`);
  assert.equal(rss.status, 200);
  assert.match(rss.headers.get("content-type"), /rss\+xml/);
  assert.match(rss.text, /<title>GeoScope watch — Springfield<\/title>/);

  const second = await t.post("/api/watches", { lat: 1, lon: 1 });
  assert.equal(second.status, 201);
  const third = await t.post("/api/watches", { lat: 2, lon: 2 });
  assert.equal(third.status, 409, "watch limit");
  assert.match(third.body.error, /Watch limit reached \(2\)/);

  for (const path of [`/api/watches/nope`, `/api/watches/nope/check`, `/api/watches/nope/rss`, `/api/watches/nope/notify-test`]) {
    const r = path.endsWith("rss") ? await t.get(path) : path.endsWith("nope") ? await t.patch(path, {}) : await t.post(path, {});
    assert.equal(r.status, 404, path);
    assert.equal(r.body.error, "Watch not found.");
  }
  assert.deepEqual((await t.del(`/api/watches/${w.id}`)).body, { deleted: w.id });
  assert.equal((await t.del(`/api/watches/${w.id}`)).status, 404);
  const noUrl = await t.post(`/api/watches/${second.body.id}/notify-test`, {});
  assert.equal(noUrl.status, 400);
  assert.match(noUrl.body.error, /No notification URL/);
});

/* ------------------------------------------------------------- plumbing */

test("errors are always JSON: unknown API route, malformed body", async () => {
  const nf = await t.get("/api/does-not-exist");
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.body, { error: "Not found." });
  const bad = await t.postRaw("/api/summary", "{not json");
  assert.equal(bad.status, 400);
  assert.equal(typeof bad.body.error, "string");
});

test("static: the app shell is served with no-cache so redeploys show up", async () => {
  const r = await t.get("/");
  assert.equal(r.status, 200);
  assert.match(r.text, /<script type="module" src="js\/main.js">/);
  assert.equal(r.headers.get("cache-control"), "no-cache");
  assert.equal((await t.get("/js/main.js")).status, 200);
});
