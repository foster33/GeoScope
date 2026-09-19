/**
 * Watcher registry
 * ----------------
 * Each watcher: fetch a source, diff against the previous snapshot (null =
 * nothing changed), and produce the next snapshot. Cadence is proportionate to
 * how fast each source actually moves. The `diff`/`next` callbacks are pure
 * (snapshot in, change/snapshot out), which is what makes the change-detection
 * logic unit-testable in test/watchers.test.js without any network.
 *
 * Bounded lists (news, landmarks, people, quakes, surveillance) accumulate seen
 * keys so an item dropping out of a feed and returning later doesn't re-alert.
 */
import { MI_TO_KM } from "../lib/geo.js";
import { WMO, SEVERE_WX, aqiBand, quakeKey } from "../lib/format.js";
import { news, buildPlaceQueries } from "../sources/news.js";
import { earthquakes } from "../sources/earthquakes.js";
import { airQuality, currentWeather } from "../sources/weather.js";
import { settlementsWithin } from "../sources/settlements.js";
import { landmarks } from "../sources/landmarks.js";
import { notablePeople } from "../sources/people.js";
import { surveillance } from "../sources/surveillance.js";
import { infrastructure } from "../sources/infrastructure.js";

export const MIN_MS = 60000, HOUR_MS = 3600000;
export const SLOW_MS = 7 * 24 * HOUR_MS;
export const MAX_WATCHES = 20;

export const WATCHERS = {
  news: {
    intervalMs: 30 * MIN_MS,
    fetch: (w) => news(buildPlaceQueries(w.place || {})),
    /* "new" must clear two bars: title never seen before, AND published after
       the previous check. Google News ranks by relevance, so an old article
       can rotate into the feed at any time — the publication timestamp is
       what proves it's actually new, the title set just prevents duplicate
       alerts for late-indexed pieces inside the slack window. */
    diff: (prev, items) => {
      const seen = new Set(prev.titles || []);
      const prevCheck = Date.parse(prev.asOf || "") || Date.now();
      const since = prevCheck - 48 * 3600000; // slack: articles often hit the index hours-to-days late
      const fresh = items.filter((i) => {
        if (seen.has(i.title.toLowerCase())) return false;
        const t = Date.parse(i.pubDate || "");
        return !Number.isNaN(t) && t >= since;
      });
      return fresh.length ? {
        summary: `${fresh.length} new headline${fresh.length === 1 ? "" : "s"}`,
        items: fresh.map((i) => ({ text: i.title, link: i.link, detail: [i.source, (i.pubDate || "").slice(0, 10)].filter(Boolean).join(" · ") })),
      } : null;
    },
    next: (prev, items) => ({
      asOf: new Date().toISOString(),
      titles: [...new Set([...items.map((i) => i.title.toLowerCase()), ...(prev?.titles || [])])].slice(0, 400),
    }),
  },
  earthquakes: {
    intervalMs: HOUR_MS,
    fetch: (w) => earthquakes(w.lat, w.lon, w.radiusMi * MI_TO_KM),
    diff: (prev, q) => {
      const seen = new Set(prev.keys || []);
      const fresh = (q.recent || []).filter((e) => !seen.has(quakeKey(e)));
      return fresh.length ? {
        summary: `${fresh.length} new earthquake${fresh.length === 1 ? "" : "s"} recorded`,
        items: fresh.map((e) => ({ text: `M${e.mag} — ${e.place || "unnamed location"}`, detail: `${e.date} · ${e.depthKm} km deep` })),
      } : null;
    },
    next: (prev, q) => ({ keys: [...new Set([...(q.recent || []).map(quakeKey), ...(prev?.keys || [])])].slice(0, 120) }),
  },
  airquality: {
    intervalMs: 3 * HOUR_MS,
    fetch: (w) => airQuality(w.lat, w.lon),
    diff: (prev, a) => {
      if (prev.aqi == null || a?.us_aqi == null) return null;
      const from = aqiBand(prev.aqi), to = aqiBand(a.us_aqi);
      return from === to ? null : {
        summary: `Air quality ${a.us_aqi > prev.aqi ? "worsened" : "improved"}: ${from} → ${to}`,
        items: [{ text: `US AQI ${prev.aqi} → ${a.us_aqi}` }],
      };
    },
    next: (_prev, a) => ({ aqi: a?.us_aqi ?? null }),
  },
  weather: {
    intervalMs: HOUR_MS,
    fetch: async (w) => (await currentWeather(w.lat, w.lon)).current,
    diff: (prev, c) => {
      if (c?.weather_code == null || prev.code == null) return null;
      const was = SEVERE_WX.has(prev.code), is = SEVERE_WX.has(c.weather_code);
      if (!was && is) return {
        summary: `Severe weather: ${WMO[c.weather_code] || "extreme conditions"}`,
        items: [{ text: `${c.temperature_2m}°C · wind ${c.wind_speed_10m} km/h (gusts ${c.wind_gusts_10m ?? "—"}) · precip ${c.precipitation} mm` }],
      };
      if (was && !is) return { summary: `Severe weather cleared — now ${WMO[c.weather_code] || "settled"}`, items: [] };
      return null;
    },
    next: (_prev, c) => ({ code: c?.weather_code ?? null }),
  },
  settlements: {
    intervalMs: SLOW_MS,
    fetch: (w) => settlementsWithin(w.lat, w.lon, w.radiusMi * MI_TO_KM * 1000),
    diff: (prev, list) => {
      const before = prev.places || {};
      const after = Object.fromEntries(list.map((s) => [s.name, s.population ?? null]));
      const items = [];
      for (const name of Object.keys(after)) {
        if (!(name in before)) items.push({ text: `New settlement mapped: ${name}` });
        else if (before[name] != null && after[name] != null && before[name] !== after[name])
          items.push({ text: `${name} population tag: ${before[name].toLocaleString()} → ${after[name].toLocaleString()}` });
      }
      for (const name of Object.keys(before)) if (!(name in after)) items.push({ text: `No longer mapped as a settlement: ${name}` });
      return items.length ? { summary: `Settlement data changed (${items.length} difference${items.length === 1 ? "" : "s"})`, items } : null;
    },
    next: (_prev, list) => ({ places: Object.fromEntries(list.map((s) => [s.name, s.population ?? null])) }),
  },
  landmarks: {
    intervalMs: SLOW_MS,
    fetch: (w) => landmarks(w.lat, w.lon, w.radiusMi * MI_TO_KM * 1000),
    diff: (prev, list) => {
      const seen = new Set(prev.titles || []);
      const fresh = list.filter((m) => !seen.has(m.title));
      return fresh.length ? {
        summary: `${fresh.length} new landmark${fresh.length === 1 ? "" : "s"} on Wikipedia`,
        items: fresh.map((m) => ({ text: m.title, link: m.url, detail: `${m.distanceKm} km from center` })),
      } : null;
    },
    next: (prev, list) => ({ titles: [...new Set([...list.map((m) => m.title), ...(prev?.titles || [])])].slice(0, 150) }),
  },
  people: {
    intervalMs: SLOW_MS,
    fetch: (w) => notablePeople(w.lat, w.lon, w.radiusMi * MI_TO_KM),
    diff: (prev, list) => {
      const seen = new Set(prev.names || []);
      const fresh = list.filter((p) => !seen.has(p.name));
      return fresh.length ? {
        summary: `${fresh.length} newly recorded notable ${fresh.length === 1 ? "person" : "people"}`,
        items: fresh.map((p) => ({ text: p.name, link: p.url, detail: p.occupations?.join(", ") || null })),
      } : null;
    },
    next: (prev, list) => ({ names: [...new Set([...list.map((p) => p.name), ...(prev?.names || [])])].slice(0, 300) }),
  },
  surveillance: {
    intervalMs: SLOW_MS,
    fetch: (w) => surveillance(w.lat, w.lon, w.radiusMi * MI_TO_KM * 1000),
    diff: (prev, s) => {
      const key = (p) => `${p.cat}|${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
      const seen = new Set(prev.keys || []);
      const fresh = (s.points || []).filter((p) => !seen.has(key(p)));
      if (!fresh.length) return null;
      const names = { alpr: "license plate reader (ALPR)", camera: "surveillance camera", speed: "speed camera", gunshot: "gunshot detector" };
      return {
        summary: `${fresh.length} newly mapped surveillance device${fresh.length === 1 ? "" : "s"}`,
        items: fresh.slice(0, 12).map((p) => ({
          text: `${names[p.cat] || p.cat}${p.manufacturer ? ` — ${p.manufacturer}` : ""}${p.operator ? ` (${p.operator})` : ""}`,
          detail: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`,
        })),
      };
    },
    next: (prev, s) => {
      const key = (p) => `${p.cat}|${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
      return { keys: [...new Set([...(s.points || []).map(key), ...(prev?.keys || [])])].slice(0, 800) };
    },
  },
  infrastructure: {
    intervalMs: SLOW_MS,
    fetch: (w) => infrastructure(w.lat, w.lon, w.radiusMi * MI_TO_KM * 1000),
    diff: (prev, list) => {
      const before = prev.counts || {};
      const items = [];
      for (const c of list) {
        if (before[c.label] != null && c.count != null && before[c.label] !== c.count)
          items.push({ text: `${c.label}: ${before[c.label].toLocaleString()} → ${c.count.toLocaleString()}` });
      }
      return items.length ? { summary: "Infrastructure counts changed", items } : null;
    },
    next: (_prev, list) => ({ counts: Object.fromEntries(list.filter((c) => c.count != null).map((c) => [c.label, c.count])) }),
  },
};
