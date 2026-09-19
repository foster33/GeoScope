import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRssItems, buildPlaceQueries } from "../sources/news.js";
import { parseTle } from "../sources/space.js";
import { buildSummary } from "../lib/summary.js";

test("parseRssItems extracts title/link/pubDate and skips incomplete items", () => {
  const xml = `<rss><channel>
    <item>
      <title><![CDATA[Big <b>news</b> &amp; more]]></title>
      <link>https://example.com/a</link>
      <pubDate>Tue, 09 Jan 2024 12:00:00 GMT</pubDate>
      <source url="x">The Source</source>
    </item>
    <item>
      <title>No link here</title>
    </item>
  </channel></rss>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1, "the item without a link is dropped");
  assert.equal(items[0].title, "Big news & more"); // tags stripped, entities decoded
  assert.equal(items[0].link, "https://example.com/a");
  assert.equal(items[0].source, "The Source");
});

test("buildPlaceQueries anchors locality to its state/country (no name drift)", () => {
  const q = buildPlaceQueries({ locality: "Springfield", county: "Sangamon", state: "Illinois", country: "USA" });
  // locality query must include the state so a same-named town can't match
  assert.deepEqual(q[0].terms, ["Springfield", "Illinois"]);
  assert.equal(q[0].label, "Springfield, Illinois");
  // county query added (distinct from locality)
  assert.ok(q.some((x) => x.label === "Sangamon, Illinois"));
});

test("buildPlaceQueries falls back to state, then country", () => {
  assert.deepEqual(buildPlaceQueries({ state: "Bavaria", country: "Germany" })[0].terms, ["Bavaria", "Germany"]);
  assert.deepEqual(buildPlaceQueries({ country: "Iceland" })[0].terms, ["Iceland"]);
  assert.deepEqual(buildPlaceQueries({}), []);
});

test("buildPlaceQueries folds in extra settlement names", () => {
  const q = buildPlaceQueries({ locality: "A", state: "S", extra: "B|C|D" });
  const labels = q.map((x) => x.label);
  assert.ok(labels.includes("B, S"));
  assert.ok(labels.includes("C, S"));
  assert.ok(!labels.includes("D, S"), "only the first two extras are used");
});

test("parseTle parses 3-line sets and strips NORAD zero-padding", () => {
  const tle = [
    "ISS (ZARYA)",
    "1 25544U 98067A   24009.50000000  .00016717  00000-0  10270-3 0  9000",
    "2 25544  51.6400 200.0000 0006703  90.0000 270.0000 15.50000000000000",
    "VANGUARD 1",
    "1 00005U 58002B   24009.00000000  .00000100  00000-0  10000-3 0  9000",
    "2 00005  34.2400 100.0000 1846000  90.0000 270.0000 10.84000000000000",
  ].join("\n");
  const sats = parseTle(tle, "stations");
  assert.equal(sats.length, 2);
  assert.equal(sats[0].name, "ISS (ZARYA)");
  assert.equal(sats[0].noradId, "25544");
  assert.equal(sats[1].noradId, "5", "leading zeros stripped to match SATCAT/P377");
  assert.equal(sats[0].group, "stations");
});

test("parseTle ignores malformed blocks", () => {
  assert.deepEqual(parseTle("just a name\nnot a tle line\nanother", "visual"), []);
  assert.deepEqual(parseTle("", "visual"), []);
});

test("buildSummary composes a coherent paragraph from a report", () => {
  const summary = buildSummary({
    lat: 40.7128, lon: -74.006, radiusMi: 10,
    location: { locality: "New York", state: "New York", country: "USA" },
    settlements: [{ name: "New York", population: 8000000 }],
    weather: { current: { temperature_2m: 20, weather_code: 0, relative_humidity_2m: 50, wind_speed_10m: 10 } },
    quakes: { count: 0 },
  });
  assert.match(summary, /10-mile radius/);
  assert.match(summary, /New York, New York, USA/);
  assert.match(summary, /largest being New York/);
  assert.match(summary, /clear sky/);
  assert.match(summary, /no M2.5\+ earthquakes/);
});

test("buildSummary handles open water with no settlements", () => {
  const summary = buildSummary({ lat: 0, lon: -140, radiusMi: 50, location: { ocean: true } });
  assert.match(summary, /open water or unpopulated terrain/);
});
