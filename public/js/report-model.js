/**
 * Report model
 * ------------
 * The sources a report is assembled from, how the UI names them, which ones
 * wait on another, and the shape of a report object as it moves through the
 * live analysis and into saved snapshots. Pure data; shared by analyze.js,
 * render.js, diff.js and the Watching tab.
 */
import { MI_TO_KM } from "./format.js";

export const SOURCES = ["geocode", "settlements", "weather", "history", "people", "landmarks", "elevation", "airquality", "infrastructure", "surveillance", "earthquakes", "news"];

export const SOURCE_LABELS = {
  geocode: "Reverse geocode (Nominatim)",
  settlements: "Settlements in circle (Overpass)",
  weather: "Current weather (Open-Meteo)",
  history: "12-month weather history (Open-Meteo archive)",
  people: "Notable people (Wikidata)",
  landmarks: "Landmarks (Wikipedia)",
  elevation: "Elevation (Open-Meteo)",
  airquality: "Air quality (Open-Meteo AQ model)",
  infrastructure: "Infrastructure census (Overpass)",
  surveillance: "Surveillance devices (OSM / DeFlock-sourced)",
  earthquakes: "Seismic history (USGS)",
  news: "Recent news (Google News, place-verified)",
};

export const SHORT = {
  geocode: "geocode", settlements: "settlements", weather: "weather", history: "weather history",
  people: "notable people", landmarks: "landmarks", elevation: "elevation", airquality: "air quality",
  infrastructure: "infrastructure", surveillance: "surveillance", earthquakes: "earthquakes", news: "news",
};

/* sources that can't start until another has produced what they consume:
   news needs the geocoded place names */
export const DEPENDS_ON = { news: "geocode" };
export const DEPENDENT_SOURCES = Object.keys(DEPENDS_ON);
export const INITIAL_SOURCES = SOURCES.filter((s) => !DEPENDENT_SOURCES.includes(s));

/* where each source's payload lands on the report object */
export const SOURCE_FIELD = {
  geocode: "location", weather: "weather", history: "history", people: "people", landmarks: "landmarks",
  elevation: "elevationM", airquality: "air", infrastructure: "infrastructure", surveillance: "surveillance",
  earthquakes: "quakes", news: "news",
  // settlements is special-cased: its payload is { list, enclosing }
};

export const SURV_CATS = [
  ["alpr", "License plate readers (ALPR)"],
  ["camera", "Surveillance cameras"],
  ["speed", "Speed cameras"],
  ["gunshot", "Gunshot detectors"],
];
export const SURV_NAMES = Object.fromEntries(SURV_CATS);

/* a fresh live report for a point: every section empty, every source queued */
export function newReport(lat, lon, radiusMi, now = new Date()) {
  const rep = {
    lat, lon, radiusMi,
    radiusKm: Math.round(radiusMi * MI_TO_KM * 10) / 10,
    queriedAt: now.toISOString(),
    location: null, settlements: null, enclosing: null, weather: null, history: { months: [] },
    people: null, landmarks: null, elevationM: null,
    air: null, infrastructure: null, surveillance: null, quakes: null, news: null,
    estimatedPopulation: null, summary: null, sourceErrors: [],
    pending: new Set(),
    sourceStatus: Object.fromEntries(SOURCES.map((s) => [s, { state: "queued" }])),
  };
  for (const s of DEPENDENT_SOURCES) rep.sourceStatus[s] = { state: "queued", note: `waits for ${SHORT[DEPENDS_ON[s]]}` };
  return rep;
}

/* the report as sent to the server (summary, save): no transient UI state */
export function serializableReport(rep) {
  const out = {};
  for (const [k, v] of Object.entries(rep)) {
    if (k === "pending" || k === "sourceStatus" || k === "finalized" || k.startsWith("_")) continue;
    out[k] = v;
  }
  return out;
}

export const sumPopulation = (settlements) =>
  (settlements || []).filter((s) => s.population).reduce((s, x) => s + x.population, 0) || null;
