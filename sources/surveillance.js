/**
 * Surveillance devices mapped inside the radius (OSM)
 * ---------------------------------------------------
 * ALPR positions are largely crowdsourced via the DeFlock project, which uploads
 * to OSM. This plots publicly documented device POSITIONS only — no feed access.
 */
import { overpass } from "../lib/net.js";

export async function surveillance(lat, lon, radiusM) {
  const r = Math.round(radiusM);
  const j = await overpass(`[out:json][timeout:20];(
nwr["man_made"="surveillance"](around:${r},${lat},${lon});
nwr["highway"="speed_camera"](around:${r},${lat},${lon});
);out center 400;`);
  const points = [];
  for (const e of j.elements || []) {
    const t = e.tags || {};
    const plat = e.lat ?? e.center?.lat, plon = e.lon ?? e.center?.lon;
    if (plat == null || plon == null) continue;
    const stype = String(t["surveillance:type"] || "").toLowerCase();
    const maker = t.manufacturer || t.brand || null;
    let cat;
    if (t.highway === "speed_camera") cat = "speed";
    else if (stype === "alpr" || /flock|vigilant|motorola/i.test(maker || "")) cat = "alpr";
    else if (stype === "gunshot_detector") cat = "gunshot";
    else cat = "camera";
    points.push({
      cat, lat: plat, lon: plon,
      operator: t.operator || null,
      manufacturer: maker,
      zone: t.surveillance || null,           // public / outdoor / traffic / indoor…
      cameraType: t["camera:type"] || null,   // fixed / dome / panning
      direction: t["camera:direction"] || t.direction || null,
    });
  }
  const count = (c) => points.filter((p) => p.cat === c).length;
  return {
    counts: { alpr: count("alpr"), camera: count("camera"), speed: count("speed"), gunshot: count("gunshot") },
    total: points.length,
    points,
    truncated: (j.elements || []).length >= 400,
  };
}
