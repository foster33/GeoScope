/**
 * GeoScope server
 * ----------------
 * Serves the globe UI and exposes:
 *   GET    /api/area?lat=&lon=&radius_mi=   -> aggregated report for the circle
 *   GET    /api/part/:src                    -> one report section (parallel fan-out)
 *   GET    /api/history                      -> saved lookups (place timelines)
 *   POST   /api/history                      -> save a snapshot
 *   DELETE /api/history/:id                  -> delete a place / snapshot
 *   /api/watches*, /api/space, /api/wikipreview, /api/infrapoints …
 *
 * Accuracy note: every upstream lookup is keyed by the exact lat/lon the user
 * clicked - never by place name - so results can't drift to a different town
 * that happens to share a name. The reverse-geocoded address hierarchy
 * (county / state / country) is returned so the user can verify the match.
 *
 * Data sources live in sources/*.js, shared helpers in lib/*.js, and the watch
 * engine's registry/notifications in watch/*.js. This file is the Express wiring
 * plus the stateful watch scheduler.
 */

import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

import { MI_TO_KM, clamp, sanitizeLang } from "./lib/geo.js";
import { createCache } from "./lib/cache.js";
import { fetchJson, overpass } from "./lib/net.js";
import { bestName, labelFor, xmlEsc } from "./lib/format.js";
import { buildSummary } from "./lib/summary.js";

import { reverseGeocode, forwardGeocode, countryCurrency, countryLanguages } from "./sources/geocode.js";
import { settlementsWithin, enclosingPlaces } from "./sources/settlements.js";
import { currentWeather, weatherHistory, airQuality, elevation } from "./sources/weather.js";
import { infrastructure, INFRA_CATS, INFRA_SELECTORS } from "./sources/infrastructure.js";
import { surveillance } from "./sources/surveillance.js";
import { earthquakes } from "./sources/earthquakes.js";
import { notablePeople } from "./sources/people.js";
import { landmarks } from "./sources/landmarks.js";
import { news, buildPlaceQueries } from "./sources/news.js";
import { loadSpace } from "./sources/space.js";
import {
  noradToQid, astronautQid, satFallback, wikiSummary, wikiSummaryInLang,
} from "./sources/wiki.js";

import { WATCHERS, MAX_WATCHES } from "./watch/watchers.js";
import { NOTIFY_FORMATS, sendNotification } from "./watch/notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));
// no-cache = revalidate every load (ETag 304s keep it cheap), so a redeploy
// is never masked by a stale cached app.js
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
}));

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, "[]");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------- hot-path cache
   Re-clicking the same spot (or a watch + an explore on the same point) used
   to re-fan-out every upstream call. A short-TTL, coordinate-rounded cache in
   front of the report endpoints collapses those into one set of requests —
   faster for the user and far politer to the public APIs. TTL is configurable;
   the default is deliberately short so the report still reflects "now". */
const AREA_CACHE_MS = parseInt(process.env.AREA_CACHE_MS || "", 10) || 5 * 60 * 1000;
const areaCache = createCache({ ttlMs: AREA_CACHE_MS, max: 300 });
const partCache = createCache({ ttlMs: AREA_CACHE_MS, max: 1500 });

// round to ~11 m so two near-identical clicks share a cache entry
const coordKey = (lat, lon, radiusMi) => `${lat.toFixed(4)},${lon.toFixed(4)},${radiusMi}`;

/* ------------------------------------------------------------- summarizer */

/* forward geocode for the "search to fly" box — short-TTL cached so repeat
   searches don't re-hit Nominatim */
const geoSearchCache = createCache({ ttlMs: AREA_CACHE_MS, max: 500 });
app.get("/api/geocode", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "A search term is required." });
  const lang = sanitizeLang(req.query.lang);
  const key = `${lang}|${q.toLowerCase()}`;
  const cached = geoSearchCache.get(key);
  if (cached !== undefined) { res.set("X-GeoScope-Cache", "hit"); return res.json({ results: cached }); }
  try {
    const results = await forwardGeocode(q, lang);
    geoSearchCache.set(key, results);
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post("/api/summary", (req, res) => {
  const r = req.body?.report;
  if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) {
    return res.status(400).json({ error: "A report payload is required." });
  }
  res.json({ summary: buildSummary(r) });
});

/* ---------------------------------------------------------------- watches
   A watch re-checks a saved point on a schedule and records what changed. The
   registry (cadence + diff logic per source) lives in watch/watchers.js; this
   is the stateful scheduler + file persistence around it. Checks run one at a
   time with a gap between upstream calls, so a full set of watches stays well
   inside the public APIs' politeness limits. */

const WATCH_FILE = path.join(DATA_DIR, "watches.json");
if (!fs.existsSync(WATCH_FILE)) fs.writeFileSync(WATCH_FILE, "[]");
let WATCHES = [];
try { WATCHES = JSON.parse(fs.readFileSync(WATCH_FILE, "utf8")); } catch { WATCHES = []; }
const saveWatches = () => fs.writeFileSync(WATCH_FILE, JSON.stringify(WATCHES, null, 2));

async function notifyChange(w, change) {
  if (!w.notify?.url) return;
  for (let attempt = 0; ; attempt++) {
    try {
      await sendNotification(w.notify, w, change);
      w.notifyState = { ok: true, at: new Date().toISOString() };
      break;
    } catch (e) {
      if (attempt === 0) { await sleep(2000); continue; }
      w.notifyState = { ok: false, at: new Date().toISOString(), error: e.message };
      break;
    }
  }
  saveWatches();
}

let watchTickRunning = false;

async function checkWatchSource(w, src) {
  const def = WATCHERS[src];
  w.lastChecked = w.lastChecked || {};
  w.lastErrors = w.lastErrors || {};
  try {
    const data = await def.fetch(w);
    const prev = (w.snapshots || {})[src];
    if (prev) { // first run only sets the baseline — no change entry
      const d = def.diff(prev, data, w);
      if (d) {
        w.changes = w.changes || [];
        const change = { id: crypto.randomUUID(), at: new Date().toISOString(), source: src, summary: d.summary, items: d.items };
        w.changes.unshift(change);
        w.changes = w.changes.slice(0, 200);
        notifyChange(w, change).catch(() => {});
      }
    }
    w.snapshots = w.snapshots || {};
    w.snapshots[src] = def.next(prev, data);
    delete w.lastErrors[src];
  } catch (e) {
    w.lastErrors[src] = e.message;
  }
  w.lastChecked[src] = new Date().toISOString();
}

async function watchTick(forceId = null) {
  if (watchTickRunning) return false;
  watchTickRunning = true;
  try {
    for (const w of [...WATCHES]) {
      for (const src of Object.keys(WATCHERS)) {
        if (w.metrics?.[src] === false) continue;
        const last = Date.parse(w.lastChecked?.[src] || "") || 0;
        if (w.id !== forceId && Date.now() - last < WATCHERS[src].intervalMs) continue;
        if (!WATCHES.includes(w)) break; // deleted mid-run
        await checkWatchSource(w, src);
        saveWatches();
        await sleep(forceId === w.id ? 400 : 2000); // gap between upstream calls
      }
    }
  } finally {
    watchTickRunning = false;
  }
  return true;
}

setInterval(() => { watchTick().catch(() => {}); }, 5 * 60 * 1000);
setTimeout(() => { watchTick().catch(() => {}); }, 10 * 1000); // catch up shortly after boot

function watchView(w) {
  const { snapshots, ...rest } = w;
  const enabled = Object.keys(WATCHERS).filter((s) => w.metrics?.[s] !== false);
  const nexts = enabled.map((s) => (Date.parse(w.lastChecked?.[s] || "") || 0) + WATCHERS[s].intervalMs);
  return {
    ...rest,
    baselined: enabled.every((s) => snapshots?.[s] != null || w.lastErrors?.[s] != null),
    nextCheckAt: nexts.length ? new Date(Math.min(...nexts)).toISOString() : null,
  };
}

/* ---------------------------------------------------------------- routes */

/* Per-source endpoints: the frontend calls these in parallel and renders
   each report section the moment its source responds, so one slow source
   (usually Overpass) never blocks the whole report. */
/* Source-specific minimums: at or above them every source behaves exactly as
   at large radii; only below do the handlers compensate (enclosing-boundary
   anchor for settlements, 10 km scan floor for birthplaces). */
const SETTLEMENT_NODE_FLOOR_KM = 8;   // ~5 mi: below this a circle can miss town-center nodes
const PEOPLE_FLOOR_KM = 10;           // birthplace coordinates resolve to town centers

const PARTS = {
  geocode:        async (lat, lon)     => {
    const loc = await reverseGeocode(lat, lon);
    if (loc.countryCode) {
      [loc.currency, loc.languages] = await Promise.all([
        countryCurrency(loc.countryCode).catch(() => null),
        countryLanguages(loc.countryCode).catch(() => null),
      ]);
    }
    return loc;
  },
  settlements:    async (lat, lon, rM, rKm, q) => {
    const lang = q?.lang ? sanitizeLang(q.lang) : null;
    const list = await settlementsWithin(lat, lon, rM, lang);
    if (rKm >= SETTLEMENT_NODE_FLOOR_KM) return { list, enclosing: null };
    return { list, enclosing: await enclosingPlaces(lat, lon, lang).catch(() => []) };
  },
  weather:        (lat, lon)           => currentWeather(lat, lon).then((w) =>
                                            ({ current: w.current, daily: w.daily, timezone: w.timezone })),
  history:        (lat, lon)           => weatherHistory(lat, lon),
  people:         (lat, lon, rM, rKm)  => notablePeople(lat, lon, Math.max(rKm, PEOPLE_FLOOR_KM)),
  landmarks:      (lat, lon, rM, rKm)  => landmarks(lat, lon, rM, rKm),
  elevation:      (lat, lon)           => elevation(lat, lon),
  airquality:     (lat, lon)           => airQuality(lat, lon),
  infrastructure: (lat, lon, rM)       => infrastructure(lat, lon, rM),
  earthquakes:    (lat, lon, rM, rKm)  => earthquakes(lat, lon, rKm),
  surveillance:   (lat, lon, rM)       => surveillance(lat, lon, rM),
  news:           (lat, lon, rM, rKm, q) => {
    const queries = buildPlaceQueries(q || {});
    if (!queries.length) throw new Error("No verified place names to search news for (geocode the point first).");
    return news(queries);
  },
};

/* the news handler keys on resolved place names, not just coordinates, so its
   cache key must include them; every other source is purely coordinate-keyed */
function partCacheKey(src, lat, lon, radiusMi, q) {
  const base = `${src}|${coordKey(lat, lon, radiusMi)}|${sanitizeLang(q.lang || "")}`;
  if (src !== "news") return base;
  return base + `|${q.locality || ""}|${q.county || ""}|${q.state || ""}|${q.country || ""}|${q.extra || ""}`;
}

app.get("/api/part/:src", async (req, res) => {
  const src = req.params.src;
  const handler = PARTS[src];
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const radiusMi = clamp(parseFloat(req.query.radius_mi) || 10, 1, 300);
  if (!handler) return res.status(404).json({ error: "Unknown source." });
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: "Valid lat and lon are required." });
  }
  const key = partCacheKey(src, lat, lon, radiusMi, req.query);
  const cached = partCache.get(key);
  if (cached !== undefined) {
    res.set("X-GeoScope-Cache", "hit");
    return res.json({ data: cached });
  }
  const radiusKm = radiusMi * MI_TO_KM;
  try {
    const data = await handler(lat, lon, radiusKm * 1000, radiusKm, req.query);
    partCache.set(key, data);
    res.set("X-GeoScope-Cache", "miss");
    res.json({ data });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/area", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const radiusMi = clamp(parseFloat(req.query.radius_mi) || 10, 1, 300);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: "Valid lat and lon are required." });
  }
  const key = coordKey(lat, lon, radiusMi);
  const cached = areaCache.get(key);
  if (cached !== undefined) {
    res.set("X-GeoScope-Cache", "hit");
    return res.json(cached);
  }
  const radiusKm = radiusMi * MI_TO_KM;
  const radiusM = radiusKm * 1000;

  const [loc, setts, wx, hist, people, marks, elev] = await Promise.allSettled([
    reverseGeocode(lat, lon),
    settlementsWithin(lat, lon, radiusM),
    currentWeather(lat, lon),
    weatherHistory(lat, lon),
    notablePeople(lat, lon, radiusKm),
    landmarks(lat, lon, radiusM, radiusKm),
    elevation(lat, lon),
  ]);

  const val = (p, fb) => (p.status === "fulfilled" ? p.value : fb);
  const report = {
    lat, lon, radiusMi,
    radiusKm: Math.round(radiusKm * 10) / 10,
    queriedAt: new Date().toISOString(),
    location: val(loc, { ocean: false, displayName: "Location lookup unavailable" }),
    settlements: val(setts, []),
    weather: (() => {
      const w = val(wx, null);
      return w ? { current: w.current, daily: w.daily, timezone: w.timezone, units: w.current_units } : null;
    })(),
    history: val(hist, { months: [] }),
    people: val(people, []),
    landmarks: val(marks, []),
    elevationM: val(elev, null),
    sourceErrors: [loc, setts, wx, hist, people, marks, elev]
      .map((p, i) => (p.status === "rejected" ? ["geocode", "settlements", "weather", "weather history", "notable people", "landmarks", "elevation"][i] : null))
      .filter(Boolean),
  };
  report.estimatedPopulation = report.settlements
    .filter((s) => s.population)
    .reduce((s, x) => s + x.population, 0) || null;
  report.summary = buildSummary(report);
  if (!report.sourceErrors.length) areaCache.set(key, report); // don't cache partial failures
  res.set("X-GeoScope-Cache", "miss");
  res.json(report);
});

/* saved places: each is an exact (lat, lon, radius) plus an append-only
   timeline of immutable report snapshots, file-backed via the /data volume */

const readHistory = () => JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
const writeHistory = (h) => fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));

/* migrate pre-timeline entries ({id, savedAt, report}) into places; entries
   saved at the identical spot+radius merge into one timeline, oldest first */
(function migrateHistory() {
  try {
    const h = readHistory();
    if (!Array.isArray(h) || !h.length || h[0].snapshots) return;
    const places = [];
    for (const e of [...h].sort((a, b) => a.savedAt.localeCompare(b.savedAt))) {
      if (!e.report) continue;
      const snap = { id: crypto.randomUUID(), takenAt: e.report.queriedAt || e.savedAt, report: e.report };
      const place = places.find((p) => p.lat === e.report.lat && p.lon === e.report.lon && p.radiusMi === e.report.radiusMi);
      if (place) place.snapshots.push(snap);
      else places.push({
        id: e.id, label: labelFor(e.report),
        lat: e.report.lat, lon: e.report.lon, radiusMi: e.report.radiusMi,
        createdAt: e.savedAt, snapshots: [snap],
      });
    }
    writeHistory(places);
    console.log(`Migrated ${h.length} saved lookup(s) into ${places.length} place timeline(s)`);
  } catch { /* unreadable file: leave untouched */ }
})();

const MAX_SNAPSHOTS = 50;

app.get("/api/history", (_req, res) => {
  const latest = (p) => p.snapshots[p.snapshots.length - 1]?.takenAt || p.createdAt;
  res.json(readHistory().sort((a, b) => latest(b).localeCompare(latest(a))));
});

app.post("/api/history", (req, res) => {
  const report = req.body?.report;
  if (!report?.summary || !Number.isFinite(report.lat) || !Number.isFinite(report.lon)) {
    return res.status(400).json({ error: "A report payload is required." });
  }
  const h = readHistory();
  const snap = { id: crypto.randomUUID(), takenAt: report.queriedAt || new Date().toISOString(), report };
  let place = h.find((p) => p.lat === report.lat && p.lon === report.lon && p.radiusMi === report.radiusMi);
  const created = !place;
  if (place) {
    place.snapshots.push(snap);
    if (place.snapshots.length > MAX_SNAPSHOTS) {
      place.snapshots = [place.snapshots[0], ...place.snapshots.slice(-(MAX_SNAPSHOTS - 1))]; // keep the original
    }
  } else {
    place = {
      id: crypto.randomUUID(), label: labelFor(report),
      lat: report.lat, lon: report.lon, radiusMi: report.radiusMi,
      createdAt: new Date().toISOString(), snapshots: [snap],
    };
    h.push(place);
  }
  writeHistory(h.slice(-200)); // cap places
  res.status(201).json({ placeId: place.id, snapshotId: snap.id, created, snapshots: place.snapshots.length });
});

app.delete("/api/history/:placeId/snapshots/:snapId", (req, res) => {
  const h = readHistory();
  const place = h.find((p) => p.id === req.params.placeId);
  if (!place) return res.status(404).json({ error: "Place not found." });
  const next = place.snapshots.filter((s) => s.id !== req.params.snapId);
  if (next.length === place.snapshots.length) return res.status(404).json({ error: "Snapshot not found." });
  place.snapshots = next;
  const out = next.length ? h : h.filter((p) => p.id !== place.id); // last snapshot gone -> place gone
  writeHistory(out);
  res.json({ deleted: req.params.snapId, placeDeleted: !next.length });
});

app.delete("/api/history/:id", (req, res) => {
  const h = readHistory();
  const next = h.filter((e) => e.id !== req.params.id);
  if (next.length === h.length) return res.status(404).json({ error: "Place not found." });
  writeHistory(next);
  res.json({ deleted: req.params.id });
});

/* On-demand coordinates for one infrastructure category. The report's census
   is count-only to stay cheap; this fetches the actual points when the user
   asks to see a category on the globe. */
app.get("/api/infrapoints", async (req, res) => {
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  const radiusMi = clamp(parseFloat(req.query.radius_mi) || 10, 1, 300);
  const all = req.query.cat === "*";
  const cat = all ? null : INFRA_CATS.find(([label]) => label === req.query.cat);
  if (!all && !cat) return res.status(400).json({ error: "Unknown infrastructure category." });
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: "Valid lat and lon are required." });
  }
  const r = Math.round(radiusMi * MI_TO_KM * 1000);
  try {
    if (all) {
      // one request, but a separate out-statement per category: Overpass itself
      // caps each at 60, so dense categories (churches, schools) can't crowd
      // out sparse ones (hospitals, airports)
      const CAP_PER_CAT = 60;
      const q = `[out:json][timeout:25];\n` +
        INFRA_CATS.map(([, sel]) => `nwr${sel}(around:${r},${lat},${lon});out center ${CAP_PER_CAT};`).join("\n");
      const j = await overpass(q, { timeoutMs: 30000 });
      const perCat = {};
      const seen = new Set();
      const pts = [];
      const lang = req.query.lang ? sanitizeLang(req.query.lang) : null;
      for (const e of j.elements || []) {
        const id = `${e.type}/${e.id}`;
        if (seen.has(id)) continue; // an element can match two categories' statements
        seen.add(id);
        const t = e.tags || {};
        const c = INFRA_SELECTORS.find((s) => t[s.key] === s.val);
        const plat = e.lat ?? e.center?.lat, plon = e.lon ?? e.center?.lon;
        if (!c || plat == null || plon == null) continue;
        perCat[c.label] = (perCat[c.label] || 0) + 1;
        pts.push({ name: bestName(t, lang), localName: lang ? t[`name:${lang}`] || null : null, lat: plat, lon: plon, cat: c.label });
      }
      return res.json({ data: pts, truncated: Object.values(perCat).some((n) => n >= CAP_PER_CAT) });
    }
    const CAP = 150;
    const lang = req.query.lang ? sanitizeLang(req.query.lang) : null;
    const j = await overpass(`[out:json][timeout:20];\nnwr${cat[1]}(around:${r},${lat},${lon});\nout center ${CAP};`);
    const pts = (j.elements || [])
      .map((e) => ({
        name: bestName(e.tags, lang),
        localName: lang ? e.tags?.[`name:${lang}`] || null : null,
        lat: e.lat ?? e.center?.lat ?? null,
        lon: e.lon ?? e.center?.lon ?? null,
      }))
      .filter((p) => p.lat != null && p.lon != null);
    res.json({ data: pts, truncated: (j.elements || []).length >= CAP });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* Wikipedia preview. Resolution never trusts the bare name (OSM wikipedia tag,
   then wikidata QID -> sitelink, then coordinate+name geosearch); satellites
   resolve through the NORAD catalog number (P377) and astronauts through an
   occupation-constrained name match. See sources/wiki.js for the resolvers. */
app.get("/api/wikipreview", async (req, res) => {
  const { name, wikipedia } = req.query;
  // tolerate zero-padded catalog numbers from older cached clients
  const norad = /^\d{1,9}$/.test(req.query.norad || "") ? String(parseInt(req.query.norad, 10)) : null;
  const lat = parseFloat(req.query.lat), lon = parseFloat(req.query.lon);
  const target = sanitizeLang(req.query.lang);
  try {
    if (wikipedia && wikipedia.includes(":")) {
      const idx = wikipedia.indexOf(":");
      const data = await wikiSummaryInLang(sanitizeLang(wikipedia.slice(0, idx)), wikipedia.slice(idx + 1), target);
      return res.json({ data: { ...data, via: req.query.astro === "1" ? "Launch Library curated link" : "OSM wikipedia tag" } });
    }
    let wikidata = req.query.wikidata;
    let wdVia = wikidata ? `Wikidata ${wikidata}` : null;
    if (!wikidata && norad) {
      wikidata = await noradToQid(norad).catch(() => null);
      wdVia = `satellite catalog number ${norad}`;
    }
    if (!wikidata && req.query.astro === "1" && name) {
      wikidata = await astronautQid(name).catch(() => null);
      wdVia = `astronaut name + occupation match → ${wikidata}`;
    }
    if (wikidata && /^Q\d+$/.test(wikidata)) {
      const j = await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidata}&props=sitelinks&format=json`);
      const sl = j.entities?.[wikidata]?.sitelinks || {};
      // prefer the requested language's edition outright, else en, else anything
      const key = sl[`${target}wiki`] ? `${target}wiki`
        : sl.enwiki ? "enwiki"
        : Object.keys(sl).find((k) => /^[a-z]{2,3}wiki$/.test(k));
      if (key) {
        const data = await wikiSummary(key.replace(/wiki$/, ""), sl[key].title);
        return res.json({ data: { ...data, langFallback: key !== `${target}wiki`, via: wdVia } });
      }
    }
    if (Number.isFinite(lat) && Number.isFinite(lon) && name) {
      const g = await fetchJson(
        `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=2000&gslimit=10&format=json`
      );
      const nm = String(name).toLowerCase();
      const cand = (g.query?.geosearch || []).find((x) => {
        const t = x.title.toLowerCase();
        return t === nm || t.startsWith(nm + ",") || t.startsWith(nm + " (");
      });
      if (cand) {
        const data = await wikiSummaryInLang("en", cand.title, target);
        return res.json({ data: { ...data, via: "coordinate + name match" } });
      }
    }
    if (norad) {
      const data = await satFallback(norad, name, wikidata && /^Q\d+$/.test(wikidata) ? wikidata : null, target)
        .catch(() => null);
      if (data) return res.json({ data });
    }
    res.status(404).json({ error: norad
      ? "Neither Wikipedia nor the satellite catalog has details for this object."
      : req.query.astro === "1"
        ? "No Wikipedia article could be verified for this astronaut's name."
        : "No verified Wikipedia article for this place." });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* Space tab: orbital element sets + who is in space now. See sources/space.js. */
app.get("/api/space", async (_req, res) => {
  try {
    res.json(await loadSpace());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* watch routes */

app.get("/api/watches", (_req, res) => {
  res.json([...WATCHES].reverse().map(watchView));
});

app.post("/api/watches", (req, res) => {
  const { lat, lon, radiusMi, label, place } = req.body || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: "Valid lat and lon are required." });
  }
  if (WATCHES.length >= MAX_WATCHES) {
    return res.status(409).json({ error: `Watch limit reached (${MAX_WATCHES}) — remove one first to stay polite to the public APIs.` });
  }
  const w = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    lat, lon,
    radiusMi: clamp(parseFloat(radiusMi) || 25, 1, 300),
    label: String(label || "").slice(0, 120) || null,
    place: place && typeof place === "object" ? place : {},
    metrics: Object.fromEntries(Object.keys(WATCHERS).map((s) => [s, true])),
    snapshots: {}, lastChecked: {}, lastErrors: {}, changes: [],
    lastSeenAt: new Date().toISOString(),
  };
  WATCHES.push(w);
  saveWatches();
  watchTick(w.id).catch(() => {}); // capture the baseline in the background
  res.status(201).json(watchView(w));
});

app.patch("/api/watches/:id", (req, res) => {
  const w = WATCHES.find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: "Watch not found." });
  if (req.body?.metrics && typeof req.body.metrics === "object") {
    for (const [k, v] of Object.entries(req.body.metrics)) if (k in WATCHERS) w.metrics[k] = !!v;
  }
  if (req.body?.notify !== undefined) {
    const n = req.body.notify;
    if (!n || !n.url) {
      delete w.notify;
      delete w.notifyState;
    } else {
      try {
        const u = new URL(String(n.url));
        if (!/^https?:$/.test(u.protocol)) throw new Error();
      } catch {
        return res.status(400).json({ error: "Notification URL must be a valid http(s) URL." });
      }
      w.notify = {
        url: String(n.url).slice(0, 500),
        format: NOTIFY_FORMATS.includes(n.format) ? n.format : "auto",
      };
      delete w.notifyState; // stale outcome from the previous URL
    }
  }
  if (req.body?.seen) w.lastSeenAt = new Date().toISOString();
  if (req.body?.ackChange) {
    const c = (w.changes || []).find((x) => x.id === req.body.ackChange);
    if (c) c.seen = true;
  }
  saveWatches();
  res.json(watchView(w));
});

app.post("/api/watches/:id/check", async (req, res) => {
  const w = WATCHES.find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: "Watch not found." });
  const ran = await watchTick(w.id);
  if (!ran) return res.status(409).json({ error: "A check is already running — try again in a moment." });
  res.json(watchView(w));
});

app.delete("/api/watches/:id", (req, res) => {
  const i = WATCHES.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "Watch not found." });
  WATCHES.splice(i, 1);
  saveWatches();
  res.json({ deleted: req.params.id });
});

/* fires a synthetic change through the configured channel so the user can
   confirm delivery without waiting for a real change */
app.post("/api/watches/:id/notify-test", async (req, res) => {
  const w = WATCHES.find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: "Watch not found." });
  if (!w.notify?.url) return res.status(400).json({ error: "No notification URL is set for this watch." });
  const change = {
    id: "test", at: new Date().toISOString(), source: "news",
    summary: "Test notification — your watch is wired up",
    items: [{ text: `Future changes inside ${w.label || "this area"} will arrive here.` }],
  };
  try {
    await sendNotification(w.notify, w, change);
    w.notifyState = { ok: true, at: change.at };
    saveWatches();
    res.json({ ok: true });
  } catch (e) {
    w.notifyState = { ok: false, at: change.at, error: e.message };
    saveWatches();
    res.status(502).json({ error: e.message });
  }
});

/* per-watch RSS feed of the change log — any feed reader becomes a
   notification channel, no configuration needed */
app.get("/api/watches/:id/rss", (req, res) => {
  const w = WATCHES.find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: "Watch not found." });
  const title = `GeoScope watch — ${w.label || "watched area"}`;
  const items = (w.changes || []).slice(0, 50).map((c) => `
  <item>
    <title>${xmlEsc(c.summary)}</title>
    <description>${xmlEsc((c.items || []).map((i) => `${i.text}${i.detail ? ` — ${i.detail}` : ""}`).join("\n"))}</description>
    ${c.items?.find((i) => i.link) ? `<link>${xmlEsc(c.items.find((i) => i.link).link)}</link>` : ""}
    <guid isPermaLink="false">${xmlEsc(c.id)}</guid>
    <pubDate>${new Date(c.at).toUTCString()}</pubDate>
    <category>${xmlEsc(c.source)}</category>
  </item>`).join("");
  res.type("application/rss+xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${xmlEsc(title)}</title>
  <description>${xmlEsc(`Changes detected in the ${w.radiusMi}-mile circle at ${w.lat.toFixed(4)}, ${w.lon.toFixed(4)}`)}</description>
  <link>${xmlEsc(`${req.protocol}://${req.get("host")}/`)}</link>${items}
</channel></rss>`);
});

app.listen(PORT, () => console.log(`GeoScope running on http://localhost:${PORT}`));
