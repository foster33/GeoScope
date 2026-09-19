/**
 * Pure formatting + classification helpers
 * ----------------------------------------
 * No I/O, no module state — every function here maps inputs to outputs, which is
 * exactly why the watch differ leans on them. Unit-tested in test/format.test.js.
 */

// WMO weather-interpretation codes -> human text (Open-Meteo's `weather_code`)
export const WMO = {
  0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "icy fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "heavy freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers",
  85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm",
  96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

// codes that justify a severe-weather alert on their own
export const SEVERE_WX = new Set([65, 67, 75, 82, 86, 95, 96, 99]);

// US AQI -> EPA category band (watch alerts fire on band changes, not raw jitter)
export function aqiBand(aqi) {
  return aqi <= 50 ? "Good" : aqi <= 100 ? "Moderate" : aqi <= 150 ? "Unhealthy for sensitive groups"
    : aqi <= 200 ? "Unhealthy" : aqi <= 300 ? "Very unhealthy" : "Hazardous";
}

// stable identity for an earthquake event so re-fetches don't re-alert
export const quakeKey = (e) => `${e.date}|M${e.mag}|${e.place || ""}`;

/* Some OSM elements have no plain `name` but do carry localized tags
   (e.g. rural Thailand: only `name:en`). Fall through before giving up. */
export function bestName(t, lang) {
  if (!t) return null;
  if (t.name) return t.name;
  if (lang && t[`name:${lang}`]) return t[`name:${lang}`];
  if (t["name:en"]) return t["name:en"];
  if (t.int_name) return t.int_name;
  const k = Object.keys(t).find((x) => x.startsWith("name:"));
  return k ? t[k] : null;
}

// human label for a saved place, derived from its report's geocode
export function labelFor(report) {
  const l = report?.location || {};
  if (l.ocean) return "Open water";
  return l.locality || l.county || l.state || l.country || "Unnamed area";
}

export const xmlEsc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
