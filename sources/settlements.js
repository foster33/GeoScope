/**
 * Settlements + enclosing admin boundaries (Overpass / OpenStreetMap)
 * -------------------------------------------------------------------
 * Settlements are mapped as single center-point nodes, so a small circle can
 * sit inside a city without containing its node. Below a floor radius the report
 * anchors on boundary containment (enclosingPlaces) instead.
 */
import { overpass } from "../lib/net.js";
import { haversineKm } from "../lib/geo.js";
import { bestName } from "../lib/format.js";

export async function settlementsWithin(lat, lon, radiusM, lang = null) {
  const j = await overpass(`[out:json][timeout:40];
node["place"~"^(city|town|village|hamlet|suburb)$"](around:${Math.round(radiusM)},${lat},${lon});
out body 300;`, { timeoutMs: 45000 });
  const list = (j.elements || []).map((e) => ({
    name: bestName(e.tags, lang) || "(unnamed)",
    localName: lang ? e.tags?.[`name:${lang}`] || null : null, // OSM's own translation tag, not MT
    type: e.tags?.place,
    population: e.tags?.population ? parseInt(String(e.tags.population).replace(/[^\d]/g, ""), 10) || null : null,
    lat: e.lat,
    lon: e.lon,
    wikidata: e.tags?.wikidata || null,
    wikipedia: e.tags?.wikipedia || null,
    distanceKm: haversineKm(lat, lon, e.lat, e.lon),
  }));
  const rank = { city: 0, town: 1, suburb: 2, village: 3, hamlet: 4 };
  list.sort((a, b) => (rank[a.type] - rank[b.type]) || ((b.population || 0) - (a.population || 0)));
  return list;
}

/* Administrative boundaries containing the point (Overpass is_in). Used as the
   small-radius anchor since boundary containment doesn't have the center-node
   problem that settlement nodes do. */
export async function enclosingPlaces(lat, lon, lang = null) {
  const j = await overpass(`[out:json][timeout:15];
is_in(${lat},${lon});
area._["boundary"="administrative"]["name"]["admin_level"~"^(6|7|8|9|10)$"];
out tags 8;`);
  return (j.elements || [])
    .map((e) => ({
      name: e.tags?.name,
      localName: lang ? e.tags?.[`name:${lang}`] || null : null,
      adminLevel: parseInt(e.tags?.admin_level, 10) || null,
      population: e.tags?.population ? parseInt(String(e.tags.population).replace(/[^\d]/g, ""), 10) || null : null,
    }))
    .filter((p) => p.name)
    .sort((a, b) => (b.adminLevel || 0) - (a.adminLevel || 0))
    .slice(0, 4);
}
