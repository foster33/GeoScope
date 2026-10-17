/**
 * Report parts
 * ------------
 * One handler per report section. The frontend requests every part in parallel
 * (/api/part/:src) and renders each the moment it arrives, so one slow source
 * never blocks the whole report. Each handler receives the validated point and
 * the raw query (for per-source options such as language).
 *
 * Accuracy rule: everything is keyed by the exact coordinates, never a place
 * name. The one exception, news, takes the place names the geocode verified
 * for this point, and anchors each to its state/country (see sources/news.js).
 */
import { sanitizeLang } from "../lib/geo.js";
import { buildSummary } from "../lib/summary.js";
import { reverseGeocode, countryCurrency, countryLanguages } from "../sources/geocode.js";
import { settlementsWithin, enclosingPlaces } from "../sources/settlements.js";
import { currentWeather, weatherHistory, airQuality, elevation } from "../sources/weather.js";
import { infrastructure } from "../sources/infrastructure.js";
import { surveillance } from "../sources/surveillance.js";
import { earthquakes } from "../sources/earthquakes.js";
import { notablePeople } from "../sources/people.js";
import { landmarks } from "../sources/landmarks.js";
import { news, buildPlaceQueries } from "../sources/news.js";
import { str } from "./http.js";

/* Source-specific minimums: at or above them every source behaves exactly as
   at large radii; only below do the handlers compensate (enclosing-boundary
   anchor for settlements, 10 km scan floor for birthplaces). */
export const SETTLEMENT_NODE_FLOOR_KM = 8;   // ~5 mi: below this a circle can miss town-center nodes
export const PEOPLE_FLOOR_KM = 10;           // birthplace coordinates resolve to town centers

const langOf = (q) => (q?.lang ? sanitizeLang(str(q.lang)) : null);

export const PARTS = {
  geocode: async ({ lat, lon }) => {
    const loc = await reverseGeocode(lat, lon);
    if (loc.countryCode) {
      [loc.currency, loc.languages] = await Promise.all([
        countryCurrency(loc.countryCode).catch(() => null),
        countryLanguages(loc.countryCode).catch(() => null),
      ]);
    }
    return loc;
  },
  settlements: async ({ lat, lon, radiusM, radiusKm }, q) => {
    const lang = langOf(q);
    const list = await settlementsWithin(lat, lon, radiusM, lang);
    if (radiusKm >= SETTLEMENT_NODE_FLOOR_KM) return { list, enclosing: null };
    return { list, enclosing: await enclosingPlaces(lat, lon, lang).catch(() => []) };
  },
  weather: ({ lat, lon }) => currentWeather(lat, lon).then((w) => ({ current: w.current, daily: w.daily, timezone: w.timezone })),
  history: ({ lat, lon }) => weatherHistory(lat, lon),
  people: ({ lat, lon, radiusKm }) => notablePeople(lat, lon, Math.max(radiusKm, PEOPLE_FLOOR_KM)),
  landmarks: ({ lat, lon, radiusM, radiusKm }) => landmarks(lat, lon, radiusM, radiusKm),
  elevation: ({ lat, lon }) => elevation(lat, lon),
  airquality: ({ lat, lon }) => airQuality(lat, lon),
  infrastructure: ({ lat, lon, radiusM }) => infrastructure(lat, lon, radiusM),
  earthquakes: ({ lat, lon, radiusKm }) => earthquakes(lat, lon, radiusKm),
  surveillance: ({ lat, lon, radiusM }) => surveillance(lat, lon, radiusM),
  news: (_pt, q) => {
    const queries = buildPlaceQueries(placeFields(q));
    if (!queries.length) throw new Error("No verified place names to search news for (geocode the point first).");
    return news(queries);
  },
};

export const placeFields = (q = {}) => ({
  locality: str(q.locality), county: str(q.county), state: str(q.state), country: str(q.country), extra: str(q.extra),
});

/* round to ~11 m so two near-identical clicks share a cache entry */
export const coordKey = (lat, lon, radiusMi) => `${lat.toFixed(4)},${lon.toFixed(4)},${radiusMi}`;

/* the news handler keys on resolved place names, not just coordinates, so its
   cache key must include them; every other source is purely coordinate-keyed */
export function partCacheKey(src, { lat, lon, radiusMi }, q = {}) {
  const base = `${src}|${coordKey(lat, lon, radiusMi)}|${sanitizeLang(str(q.lang))}`;
  if (src !== "news") return base;
  const p = placeFields(q);
  return `${base}|${p.locality}|${p.county}|${p.state}|${p.country}|${p.extra}`;
}

/* The one-shot report behind /api/area: the seven core sources fanned out in
   parallel with Promise.allSettled, so a failed source is listed in
   `sourceErrors` instead of sinking the response. */
const AREA_SOURCES = [
  ["geocode", ({ lat, lon }) => reverseGeocode(lat, lon)],
  ["settlements", ({ lat, lon, radiusM }) => settlementsWithin(lat, lon, radiusM)],
  ["weather", ({ lat, lon }) => currentWeather(lat, lon)],
  ["weather history", ({ lat, lon }) => weatherHistory(lat, lon)],
  ["notable people", ({ lat, lon, radiusKm }) => notablePeople(lat, lon, radiusKm)],
  ["landmarks", ({ lat, lon, radiusM, radiusKm }) => landmarks(lat, lon, radiusM, radiusKm)],
  ["elevation", ({ lat, lon }) => elevation(lat, lon)],
];

export async function buildAreaReport(pt) {
  const { lat, lon, radiusMi, radiusKm } = pt;
  const settled = await Promise.allSettled(AREA_SOURCES.map(([, fn]) => fn(pt)));
  const val = (i, fallback) => (settled[i].status === "fulfilled" ? settled[i].value : fallback);
  const wx = val(2, null);
  const report = {
    lat, lon, radiusMi,
    radiusKm: Math.round(radiusKm * 10) / 10,
    queriedAt: new Date().toISOString(),
    location: val(0, { ocean: false, displayName: "Location lookup unavailable" }),
    settlements: val(1, []),
    weather: wx ? { current: wx.current, daily: wx.daily, timezone: wx.timezone, units: wx.current_units } : null,
    history: val(3, { months: [] }),
    people: val(4, []),
    landmarks: val(5, []),
    elevationM: val(6, null),
    sourceErrors: AREA_SOURCES.map(([name], i) => (settled[i].status === "rejected" ? name : null)).filter(Boolean),
  };
  report.estimatedPopulation = report.settlements
    .filter((s) => s.population)
    .reduce((s, x) => s + x.population, 0) || null;
  report.summary = buildSummary(report);
  return report;
}
