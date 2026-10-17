/**
 * Formatting helpers
 * ------------------
 * Pure functions from values to display strings. Units and clock style come
 * from `settings`; nothing here touches the DOM or Cesium, so the whole module
 * is unit-tested in Node (test/client-format.test.js).
 */
import { settings } from "./settings.js";

export const MI_TO_KM = 1.609344;

export const r1 = (v) => Math.round(v * 10) / 10;
export const F = (c) => Math.round((c * 9) / 5 + 32);
export const num = (n) => (n == null ? "—" : n.toLocaleString());

/* HTML-escape anything interpolated into a template */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ------------------------------------------------------------- units */

export function tempStr(c) {
  if (c == null) return "—";
  const f = F(c);
  if (settings.temp === "c") return `${r1(c)}°C`;
  if (settings.temp === "f") return `${f}°F`;
  return `${r1(c)}°C / ${f}°F`;
}

/* dual-unit distance: pass whichever unit the source value is in */
export function distKm(km, digits = 0) {
  if (km == null) return "—";
  const fmt = (v) => v.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (settings.dist === "mi") return `${fmt(km / MI_TO_KM)} mi`;
  if (settings.dist === "km") return `${fmt(km)} km`;
  return `${fmt(km / MI_TO_KM)} mi / ${fmt(km)} km`;
}
export const distMi = (mi, digits = 0) => distKm(mi * MI_TO_KM, digits);

/* tables show a single unit to stay compact; the header names it */
export const distUnit = () => (settings.dist === "km" ? "km" : "mi");
export const distCell = (km) => (settings.dist === "km" ? km : r1(km / MI_TO_KM));

export function areaStr(mi2) {
  const km2 = mi2 * MI_TO_KM * MI_TO_KM;
  const fmt = (v) => Math.round(v).toLocaleString();
  if (settings.dist === "mi") return `${fmt(mi2)} mi²`;
  if (settings.dist === "km") return `${fmt(km2)} km²`;
  return `${fmt(mi2)} mi² / ${fmt(km2)} km²`;
}

export function windStr(kmh) {
  if (kmh == null) return "—";
  if (settings.dist === "km") return `${kmh} km/h`;
  const mph = Math.round(kmh / MI_TO_KM);
  return settings.dist === "mi" ? `${mph} mph` : `${kmh} km/h (${mph} mph)`;
}

/* ----------------------------------------------------------- coordinates */

export const fmtLat = (v) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? "N" : "S"}`;
export const fmtLon = (v) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? "E" : "W"}`;

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/* "40.7, -74" or "40.7 -74" typed into the search box */
export const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
export function parseCoordInput(text) {
  const m = COORD_RE.exec(text);
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/* -------------------------------------------------------------- time */

/* "HH:MM" -> clock-style string */
export function fmtHM(hhmm) {
  if (!hhmm || settings.clock === "24") return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export function fmtWhen(iso) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric",
    hour: settings.clock === "12" ? "numeric" : "2-digit",
    minute: "2-digit", hour12: settings.clock === "12",
  }).format(new Date(iso));
}

/* relative time, coarse on purpose ("3h ago", "in 2d") */
export function rel(iso, now = Date.now()) {
  if (!iso) return "—";
  const s = (new Date(iso) - now) / 1000;
  const abs = Math.abs(s);
  const span = abs < 90 ? "moments" : abs < 5400 ? `${Math.round(abs / 60)} min`
    : abs < 129600 ? `${Math.round(abs / 3600)}h` : `${Math.round(abs / 86400)}d`;
  return s > 0 ? `in ${span}` : `${span} ago`;
}

/* everything about a zone derives from its IANA name via Intl */
export function tzOffsetMin(tz, date) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(date).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
}

export function tzAbbr(tz, date = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(date).find((p) => p.type === "timeZoneName")?.value || "";
  } catch { return ""; }
}

/* DST always moves clocks forward, so the standard offset is the smaller of
   the January / July offsets — works in both hemispheres */
export function dstInfo(tz, now = new Date()) {
  const jan = tzOffsetMin(tz, new Date(Date.UTC(now.getUTCFullYear(), 0, 1)));
  const jul = tzOffsetMin(tz, new Date(Date.UTC(now.getUTCFullYear(), 6, 1)));
  const cur = tzOffsetMin(tz, now);
  const std = Math.min(jan, jul);
  return { observed: jan !== jul, active: cur > std, offsetMin: cur, stdMin: std, abbr: tzAbbr(tz, now) };
}

export function utcOffStr(min) {
  const sign = min < 0 ? "−" : "+";
  return `UTC${sign}${String(Math.floor(Math.abs(min) / 60)).padStart(2, "0")}:${String(Math.abs(min) % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------- classifiers */

/* WMO weather-interpretation codes (Open-Meteo `weather_code`); the server
   keeps the same table in lib/format.js and a test keeps them identical */
export const WMO = {
  0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "icy fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "heavy freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers",
  85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm",
  96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};
export const wmo = (code) => WMO[code] || "mixed";

/* US AQI -> EPA band plus the theme color the report paints it in */
export function aqiInfo(aqi) {
  if (aqi <= 50) return { band: "Good", color: "var(--teal)" };
  if (aqi <= 100) return { band: "Moderate", color: "var(--brass)" };
  if (aqi <= 150) return { band: "Unhealthy for sensitive groups", color: "var(--brass)" };
  if (aqi <= 200) return { band: "Unhealthy", color: "var(--coral)" };
  if (aqi <= 300) return { band: "Very unhealthy", color: "var(--coral)" };
  return { band: "Hazardous", color: "var(--coral)" };
}

/* the most specific place name a report's geocode offers */
export function placeTitle(rep) {
  const l = rep.location || {};
  if (l.ocean) return "Open water";
  return l.locality || l.county || l.state || l.country || "Unnamed area";
}

/* regional-indicator flag emoji from an ISO 3166 alpha-2 code */
export function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return "";
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}
