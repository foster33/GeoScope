/**
 * Earthquakes within the radius, last 10 years (USGS, global coverage)
 * -------------------------------------------------------------------
 */
import { fetchJson } from "../lib/net.js";
import { clamp } from "../lib/geo.js";

export async function earthquakes(lat, lon, radiusKm) {
  const start = new Date(Date.now() - 10 * 365.25 * 86400000).toISOString().slice(0, 10);
  const url =
    `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson` +
    `&latitude=${lat}&longitude=${lon}&maxradiuskm=${Math.round(clamp(radiusKm, 1, 500))}` +
    `&starttime=${start}&minmagnitude=2.5&orderby=magnitude&limit=200`;
  const j = await fetchJson(url, {}, 25000);
  const feats = j.features || [];
  const ev = (f) => ({
    mag: f.properties.mag,
    place: f.properties.place,
    date: new Date(f.properties.time).toISOString().slice(0, 10),
    depthKm: Math.round(f.geometry?.coordinates?.[2] ?? 0),
  });
  return {
    count: j.metadata?.count ?? feats.length,
    largest: feats.length ? ev(feats[0]) : null,
    recent: feats
      .slice()
      .sort((a, b) => b.properties.time - a.properties.time)
      .slice(0, 5)
      .map(ev),
    periodYears: 10,
    minMagnitude: 2.5,
  };
}
