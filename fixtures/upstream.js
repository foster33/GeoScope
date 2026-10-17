/**
 * Fake upstream APIs
 * ------------------
 * Every outbound call GeoScope makes goes through the global `fetch`. This
 * helper replaces it with a deterministic router over small fixtures for each
 * public service (Nominatim, Overpass, Open-Meteo, Wikidata, Wikipedia, USGS,
 * Google News, CelesTrak, Launch Library 2, the countries dataset, exchange
 * rates, and notification endpoints), so route tests and the browser E2E suite
 * exercise the real server code without touching the network.
 *
 * Requests to localhost pass through to the real fetch (that is how the tests
 * reach the Express app itself). Anything unmatched returns 404 and is logged
 * in `calls`, so an unexpected upstream call shows up as a test failure rather
 * than silently hitting the internet.
 *
 * Usage:
 *   const fake = installFakeUpstream();
 *   fake.fail("overpass");            // make a service error until reset
 *   fake.respond("nominatim-reverse", () => ({ error: "Unable to geocode" }));
 *   fake.calls                        // [{ name, url, method, body }]
 *   fake.reset(); fake.restore();
 */

export const FIX = {
  center: { lat: 39.7817, lon: -89.6501 }, // Springfield, Illinois
};

/* ------------------------------------------------------------ TLE builder
   SGP4 refuses to propagate a stale element set (it reports the object as
   decayed), so the fixture TLEs carry an epoch of "now". Column positions are
   what the parser reads, so the epoch is spliced in at columns 19-32. */
export function tleEpoch(date = new Date()) {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, "0");
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = (date.getTime() - start) / 86400000 + 1;
  return `${yy}${doy.toFixed(8).padStart(12, "0")}`;
}

export function tleSet(now = new Date()) {
  const epoch = tleEpoch(now);
  const l1 = (sat, intl) => `1 ${sat}U ${intl}   ${epoch}  .00001000  00000-0  10000-4 0  9990`;
  return {
    stations: [
      "ISS (ZARYA)",
      l1("25544", "98067A"),
      "2 25544  51.6400 200.0000 0006703  90.0000 270.0000 15.50000000000000",
      "TIANGONG",
      l1("48274", "21035A"),
      "2 48274  41.4700 120.0000 0004000  60.0000 300.0000 15.60000000000000",
    ].join("\n"),
    visual: [
      "ISS (ZARYA)",                     // appears in both groups, like CelesTrak's real feeds
      l1("25544", "98067A"),
      "2 25544  51.6400 200.0000 0006703  90.0000 270.0000 15.50000000000000",
      "HST",
      l1("20580", "90037B"),
      "2 20580  28.4700 100.0000 0002500  50.0000 310.0000 15.09000000000000",
    ].join("\n"),
  };
}

/* ------------------------------------------------------------- fixtures */

const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

export function forecastFixture() {
  const days = Array.from({ length: 7 }, (_, i) => isoDay(i));
  return {
    timezone: "America/Chicago",
    current_units: { temperature_2m: "°C", wind_speed_10m: "km/h" },
    current: {
      temperature_2m: 21.4, relative_humidity_2m: 55, apparent_temperature: 20.1, precipitation: 0,
      weather_code: 1, wind_speed_10m: 12, wind_gusts_10m: 20, wind_direction_10m: 200,
      cloud_cover: 25, pressure_msl: 1016,
    },
    daily: {
      time: days,
      temperature_2m_max: days.map((_, i) => 22 + i),
      temperature_2m_min: days.map((_, i) => 10 + i),
      precipitation_sum: days.map((_, i) => (i % 3 ? 0 : 2.5)),
      weather_code: days.map((_, i) => (i === 3 ? 61 : 1)),
      sunrise: days.map((d) => `${d}T07:05`),
      sunset: days.map((d) => `${d}T18:20`),
      daylight_duration: days.map(() => 40500),
      uv_index_max: days.map(() => 4.5),
    },
  };
}

export function archiveFixture() {
  const n = 366;
  const time = [], hi = [], lo = [], pr = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(Date.now() - (i + 5) * 86400000);
    time.push(d.toISOString().slice(0, 10));
    const season = Math.cos(((d.getUTCMonth() + 0.5) / 12) * 2 * Math.PI); // cold in Jan, hot in Jul
    hi.push(Math.round((22 - 14 * season) * 10) / 10);
    lo.push(Math.round((10 - 12 * season) * 10) / 10);
    pr.push(i % 4 === 0 ? 3.2 : 0);
  }
  return { daily: { time, temperature_2m_max: hi, temperature_2m_min: lo, precipitation_sum: pr } };
}

const SETTLEMENTS = [
  { id: 1, lat: 39.7817, lon: -89.6501, tags: { place: "city", name: "Springfield", population: "116250", wikidata: "Q28515", wikipedia: "en:Springfield, Illinois" } },
  { id: 2, lat: 39.73, lon: -89.6, tags: { place: "village", name: "Rochester", population: "3600" } },
  { id: 3, lat: 39.85, lon: -89.7, tags: { place: "hamlet", "name:en": "Nameless Corner" } },
];

const INFRA_POINTS = [
  { amenity: "hospital", name: "Memorial Medical Center", lat: 39.80, lon: -89.66 },
  { amenity: "hospital", name: "St. John's Hospital", lat: 39.81, lon: -89.64 },
  { amenity: "school", name: "Lincoln School", lat: 39.79, lon: -89.65 },
  { amenity: "police", name: "Police HQ", lat: 39.78, lon: -89.65 },
  { aeroway: "aerodrome", name: "Abraham Lincoln Capital Airport", lat: 39.84, lon: -89.68 },
  { tourism: "museum", name: "Lincoln Museum", lat: 39.80, lon: -89.65 },
];

const SELECTOR_TO_COUNT = {
  '"amenity"="hospital"': 2, '"amenity"="clinic"': 5, '"amenity"="school"': 31, '"amenity"="university"': 1,
  '"amenity"="police"': 3, '"amenity"="fire_station"': 6, '"shop"="supermarket"': 9, '"amenity"="place_of_worship"': 80,
  '"railway"="station"': 2, '"aeroway"="aerodrome"': 1, '"leisure"="park"': 40, '"tourism"="museum"': 4,
};

function overpassResponse(query) {
  if (query.includes("is_in(")) {
    return { elements: [
      { type: "area", id: 100, tags: { boundary: "administrative", admin_level: "6", name: "Sangamon County", population: "196000" } },
      { type: "area", id: 101, tags: { boundary: "administrative", admin_level: "8", name: "Springfield", "name:es": "Springfield", population: "116250" } },
    ] };
  }
  if (query.includes('"place"~')) {
    return { elements: SETTLEMENTS.map((s) => ({ type: "node", ...s })) };
  }
  if (query.includes("out count")) {
    const sels = [...query.matchAll(/nwr\[([^\]]+)\]/g)].map((m) => m[1]);
    return { elements: sels.map((sel) => ({ type: "count", id: 0, tags: { total: String(SELECTOR_TO_COUNT[sel] ?? 0), nodes: "0" } })) };
  }
  if (query.includes("man_made")) {
    return { elements: [
      { type: "node", id: 201, lat: 39.79, lon: -89.64, tags: { man_made: "surveillance", "surveillance:type": "ALPR", manufacturer: "Flock Safety", operator: "City" } },
      { type: "node", id: 202, lat: 39.78, lon: -89.66, tags: { man_made: "surveillance", surveillance: "public", "camera:type": "dome" } },
      { type: "node", id: 203, lat: 39.77, lon: -89.63, tags: { highway: "speed_camera" } },
      { type: "way", id: 204, center: { lat: 39.76, lon: -89.62 }, tags: { man_made: "surveillance", "surveillance:type": "gunshot_detector" } },
    ] };
  }
  if (query.includes("out center")) {
    const sels = [...query.matchAll(/nwr\["([^"]+)"="([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
    const pts = INFRA_POINTS.filter((p) => sels.some(([k, v]) => p[k] === v));
    return { elements: pts.map((p, i) => ({ type: "node", id: 300 + i, lat: p.lat, lon: p.lon, tags: { ...p, lat: undefined, lon: undefined } })) };
  }
  return { elements: [] };
}

function sparqlResponse(q) {
  const b = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: String(v) }]));
  if (q.includes("wdt:P377")) {
    const m = /wdt:P377 "(\d+)"/.exec(q);
    const qid = { 25544: "Q25271", 20580: "Q2513" }[m?.[1]];
    return { results: { bindings: qid ? [b({ item: `http://www.wikidata.org/entity/${qid}` })] : [] } };
  }
  if (q.includes("wd:Q11631")) {
    const m = /"([^"]+)"@en/.exec(q);
    const qid = m?.[1] === "Jane Orbit" ? "Q900" : null;
    return { results: { bindings: qid ? [b({ item: `http://www.wikidata.org/entity/${qid}` })] : [] } };
  }
  if (q.includes("wdt:P19")) {
    return { results: { bindings: [
      b({ person: "http://www.wikidata.org/entity/Q1", personLabel: "Ada Example", birthPlaceLabel: "Springfield", dob: "1950-02-03T00:00:00Z", occLabel: "writer", sitelinks: 40 }),
      b({ person: "http://www.wikidata.org/entity/Q1", personLabel: "Ada Example", birthPlaceLabel: "Springfield", dob: "1950-02-03T00:00:00Z", occLabel: "poet", sitelinks: 40 }),
      b({ person: "http://www.wikidata.org/entity/Q2", personLabel: "Bob Sample", birthPlaceLabel: "Rochester", occLabel: "engineer", sitelinks: 12 }),
      b({ person: "http://www.wikidata.org/entity/Q3", personLabel: "Q3", sitelinks: 9 }), // unlabeled entity: must be dropped
    ] } };
  }
  if (q.includes("P1082")) {
    return { results: { bindings: [
      b({ item: "http://www.wikidata.org/entity/Q10", itemLabel: "Lincoln Home", coord: "Point(-89.6447 39.7975)", dist: 1.9, sitelinks: 25, article: "https://en.wikipedia.org/wiki/Lincoln_Home_National_Historic_Site" }),
      b({ item: "http://www.wikidata.org/entity/Q11", itemLabel: "Illinois State Capitol", coord: "Point(-89.6544 39.7983)", dist: 1.2, sitelinks: 30 }),
    ] } };
  }
  return { results: { bindings: [] } };
}

const RSS = (items) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `
<item><title>${i.title}</title><link>${i.link}</link><guid>${i.link}</guid><pubDate>${i.pubDate}</pubDate><source url="https://example.com">${i.source}</source></item>`).join("")}
</channel></rss>`;

function newsFixture(query) {
  const recent = new Date(Date.now() - 2 * 86400000).toUTCString();
  const older = new Date(Date.now() - 30 * 86400000).toUTCString();
  const label = decodeURIComponent(query).replace(/"/g, "").split(" when:")[0];
  return RSS([
    { title: `Council approves budget in ${label}`, link: `https://news.example.com/${encodeURIComponent(label)}/1`, pubDate: recent, source: "Example Times" },
    { title: `Festival returns to ${label}`, link: `https://news.example.com/${encodeURIComponent(label)}/2`, pubDate: older, source: "Example Herald" },
    { title: `Council approves budget in ${label}`, link: `https://news.example.com/${encodeURIComponent(label)}/dup`, pubDate: recent, source: "Dup" }, // duplicate title
  ]);
}

const WIKI_SUMMARIES = {
  "Springfield, Illinois": { title: "Springfield, Illinois", description: "capital city of Illinois, United States", extract: "Springfield is the capital of the U.S. state of Illinois.", thumbnail: { source: "https://upload.example/springfield.jpg" } },
  "Springfield (Illinois)": { title: "Springfield (Illinois)", description: "capital del estado de Illinois", extract: "Springfield es la capital del estado de Illinois.", lang: "es" },
  "International Space Station": { title: "International Space Station", description: "space station in low Earth orbit", extract: "The ISS is a modular space station in low Earth orbit." },
  "Jane Orbit": { title: "Jane Orbit", description: "fictional astronaut", extract: "Jane Orbit is an astronaut." },
  "Lincoln Home National Historic Site": { title: "Lincoln Home National Historic Site", extract: "Home of Abraham Lincoln." },
  "Illinois State Capitol": { title: "Illinois State Capitol", description: "state capitol building", extract: "The Illinois State Capitol houses the state legislature." },
};

/* ------------------------------------------------------------- the router */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain" } });

/* Each route: a name (for overrides/assertions), a matcher, and a responder.
   Responders return a plain object (JSON), a string (text), or a Response. */
const ROUTES = [
  { name: "nominatim-search", match: (u) => u.host === "nominatim.openstreetmap.org" && u.pathname === "/search",
    respond: (u) => {
      const q = u.searchParams.get("q") || "";
      if (/nowhere/i.test(q)) return [];
      return [
        { display_name: "Springfield, Sangamon County, Illinois, United States", lat: "39.7817", lon: "-89.6501", type: "city", class: "place", importance: 0.7 },
        { display_name: "Springfield, Greene County, Missouri, United States", lat: "37.2090", lon: "-93.2923", type: "city", class: "place", importance: 0.6 },
        { display_name: "bad row", lat: "x", lon: "y" },
      ];
    } },
  { name: "nominatim-reverse", match: (u) => u.host === "nominatim.openstreetmap.org" && u.pathname === "/reverse",
    respond: (u) => {
      const lat = parseFloat(u.searchParams.get("lat"));
      if (Math.abs(lat) < 1) return { error: "Unable to geocode" }; // the equator fixture is "open water"
      return {
        display_name: "Springfield, Sangamon County, Illinois, 62701, United States",
        type: "city",
        address: { city: "Springfield", county: "Sangamon County", state: "Illinois", country: "United States", country_code: "us", postcode: "62701" },
      };
    } },
  { name: "countries", match: (u) => u.host === "raw.githubusercontent.com",
    respond: () => [
      { cca2: "US", currencies: { USD: { name: "United States dollar", symbol: "$" } }, languages: { eng: "English" } },
      { cca2: "FR", currencies: { EUR: { name: "Euro", symbol: "€" } }, languages: { fra: "French" } },
      { cca2: "XX" },
    ] },
  { name: "rates", match: (u) => u.host === "open.er-api.com", respond: () => ({ rates: { USD: 1, EUR: 0.92 } }) },
  { name: "overpass", match: (u) => /overpass/.test(u.host),
    respond: (u, opts) => overpassResponse(decodeURIComponent(String(opts?.body || "").replace(/^data=/, ""))) },
  { name: "forecast", match: (u) => u.host === "api.open-meteo.com" && u.pathname === "/v1/forecast", respond: forecastFixture },
  { name: "elevation", match: (u) => u.host === "api.open-meteo.com" && u.pathname === "/v1/elevation", respond: () => ({ elevation: [181.0] }) },
  { name: "archive", match: (u) => u.host === "archive-api.open-meteo.com", respond: archiveFixture },
  { name: "airquality", match: (u) => u.host === "air-quality-api.open-meteo.com",
    respond: () => ({ current: { us_aqi: 42, european_aqi: 31, pm2_5: 8.1, pm10: 12.4, ozone: 61, nitrogen_dioxide: 9.5, sulphur_dioxide: 1.2, carbon_monoxide: 210 } }) },
  { name: "usgs", match: (u) => u.host === "earthquake.usgs.gov",
    respond: () => ({ metadata: { count: 2 }, features: [
      { properties: { mag: 4.1, place: "5 km N of Springfield, Illinois", time: Date.UTC(2021, 3, 2) }, geometry: { coordinates: [-89.65, 39.83, 11.2] } },
      { properties: { mag: 2.7, place: "8 km S of Springfield, Illinois", time: Date.UTC(2024, 7, 15) }, geometry: { coordinates: [-89.65, 39.71, 5.6] } },
    ] }) },
  { name: "wdqs", match: (u) => u.host === "query.wikidata.org", respond: (u) => sparqlResponse(u.searchParams.get("query") || "") },
  { name: "wiki-geosearch", match: (u) => /wikipedia\.org$/.test(u.host) && u.pathname === "/w/api.php" && u.searchParams.get("list") === "geosearch",
    respond: (u) => {
      const r = parseInt(u.searchParams.get("gsradius") || "0", 10);
      const near = [{ pageid: 1, title: "Springfield, Illinois", lat: 39.7817, lon: -89.6501, dist: 20 }, { pageid: 2, title: "Illinois State Capitol", lat: 39.7983, lon: -89.6544, dist: 1900 }];
      return { query: { geosearch: r >= 5000 ? near.concat([{ pageid: 3, title: "Lincoln Home National Historic Site", lat: 39.7975, lon: -89.6447, dist: 1850 }]) : near } };
    } },
  { name: "wiki-langlinks", match: (u) => /wikipedia\.org$/.test(u.host) && u.pathname === "/w/api.php" && u.searchParams.get("prop") === "langlinks",
    respond: (u) => {
      const title = u.searchParams.get("titles"), target = u.searchParams.get("lllang");
      const ll = title === "Springfield, Illinois" && target === "es" ? [{ lang: "es", "*": "Springfield (Illinois)" }] : [];
      return { query: { pages: { 1: { title, langlinks: ll } } } };
    } },
  { name: "wiki-summary", match: (u) => /wikipedia\.org$/.test(u.host) && u.pathname.startsWith("/api/rest_v1/page/summary/"),
    respond: (u) => {
      const title = decodeURIComponent(u.pathname.split("/").pop()).replace(/_/g, " ");
      const s = WIKI_SUMMARIES[title];
      if (!s) return json({ type: "https://mediawiki.org/wiki/HyperSwitch/errors/not_found", title: "Not found." }, 404);
      const lang = u.host.split(".")[0];
      return { ...s, content_urls: { desktop: { page: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` } } };
    } },
  { name: "wikidata-entities", match: (u) => u.host === "www.wikidata.org" && u.searchParams.get("action") === "wbgetentities",
    respond: (u) => {
      const ids = (u.searchParams.get("ids") || "").split("|");
      const props = u.searchParams.get("props") || "";
      const entities = {};
      for (const id of ids) {
        const e = {};
        if (props.includes("sitelinks")) {
          if (id === "Q28515") e.sitelinks = { enwiki: { title: "Springfield, Illinois" }, eswiki: { title: "Springfield (Illinois)" } };
          if (id === "Q25271") e.sitelinks = { enwiki: { title: "International Space Station" } };
          if (id === "Q900") e.sitelinks = { enwiki: { title: "Jane Orbit" } };
          if (id === "Q2513") e.sitelinks = {}; // HST entity with no articles -> catalog fallback
        }
        if (props.includes("labels")) e.labels = { en: { value: { P31: "instance of", P247: "COSPAR ID", P619: "launch date", P17: "country", P2146: "orbital period", P2045: "orbital inclination", P2243: "apoapsis", P2244: "periapsis", Q26540: "artificial satellite", Q4809: "rocket stage", Q275450: "space debris", Q2513: "Hubble Space Telescope" }[id] || id } };
        if (props.includes("descriptions")) e.descriptions = { en: { value: id === "Q2513" ? "NASA space telescope" : "thing" } };
        if (props.includes("claims") && id === "Q2513") e.claims = { P18: [{ mainsnak: { datavalue: { value: "Hubble.jpg" } } }] };
        entities[id] = e;
      }
      return { entities };
    } },
  { name: "news", match: (u) => u.host === "news.google.com", respond: (u) => text(newsFixture(u.searchParams.get("q") || "")) },
  { name: "celestrak-tle", match: (u) => u.host === "celestrak.org" && u.pathname.startsWith("/NORAD/elements/"),
    respond: (u) => text(tleSet()[u.searchParams.get("GROUP")] || "") },
  { name: "celestrak-satcat", match: (u) => u.host === "celestrak.org" && u.pathname.startsWith("/satcat/"),
    respond: (u) => {
      const n = u.searchParams.get("CATNR");
      if (n === "20580") return [{ OBJECT_TYPE: "PAY", OBJECT_ID: "1990-037B", LAUNCH_DATE: "1990-04-24", OWNER: "US", PERIOD: 95.4, INCLINATION: 28.47, APOGEE: 540, PERIGEE: 535 }];
      if (n === "25544") return [{ OBJECT_TYPE: "PAY", OBJECT_ID: "1998-067A", LAUNCH_DATE: "1998-11-20", OWNER: "ISS", PERIOD: 92.9, INCLINATION: 51.64, APOGEE: 420, PERIGEE: 415 }];
      return [];
    } },
  { name: "ll2", match: (u) => u.host === "ll.thespacedevs.com",
    respond: () => ({ results: [
      { name: "Jane Orbit", agency: { abbrev: "NASA", name: "National Aeronautics and Space Administration" }, nationality: "American", wiki: "https://en.wikipedia.org/wiki/Jane_Orbit", type: { name: "Government" } },
      { name: "Yuri Example", agency: { abbrev: "RFSA" }, nationality: "Russian", wiki: null, type: { name: "Government" } },
      { name: "Starman", agency: null, type: { name: "Non-Human" } },
    ] }) },
  { name: "notify", match: (u) => ["ntfy.sh", "discord.com", "hooks.example.com"].includes(u.host), respond: () => json({ ok: true }) },
];

export function installFakeUpstream({ log = false } = {}) {
  const realFetch = globalThis.fetch;
  const overrides = new Map();
  const calls = [];

  const toResponse = (r) => {
    if (r instanceof Response) return r;
    if (typeof r === "string") return text(r);
    return json(r);
  };

  /* honor AbortSignal like the real fetch does, so timeout paths are testable */
  const abortable = (promise, signal) => {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  };

  globalThis.fetch = async (input, opts = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return realFetch(input, opts);
    const route = ROUTES.find((r) => r.match(url));
    const name = route?.name || "unmatched";
    calls.push({ name, url: url.href, method: opts.method || "GET", body: opts.body ?? null, headers: opts.headers || {} });
    if (log) console.log(`[fake upstream] ${name} ${opts.method || "GET"} ${url.href}`);
    if (!route) return json({ error: `no fixture for ${url.href}` }, 404);
    const ov = overrides.get(name);
    const produce = async () => {
      if (ov instanceof Error) throw ov;
      if (typeof ov === "number") return json({ error: `fixture forced HTTP ${ov}` }, ov);
      if (typeof ov === "function") return toResponse(await ov(url, opts));
      return toResponse(await route.respond(url, opts));
    };
    return abortable(produce(), opts.signal);
  };

  return {
    calls,
    /* make one service fail: with a network error (default), an HTTP status, or a custom responder */
    fail(name, how = new Error(`fetch failed: ${name} unreachable`)) { overrides.set(name, how); },
    respond(name, fn) { overrides.set(name, fn); },
    /* answer after a delay (to exercise timeouts); the default fixture body */
    delay(name, ms) {
      const route = ROUTES.find((r) => r.name === name);
      overrides.set(name, (url, opts) => new Promise((res) => setTimeout(() => res(route.respond(url, opts)), ms)));
    },
    reset() { overrides.clear(); calls.length = 0; },
    restore() { globalThis.fetch = realFetch; },
    names: ROUTES.map((r) => r.name),
  };
}
