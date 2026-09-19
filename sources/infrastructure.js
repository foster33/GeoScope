/**
 * Infrastructure census (Overpass / OpenStreetMap)
 * ------------------------------------------------
 * Count-only in the report (cheap); /api/infrapoints fetches actual positions
 * on demand. The full 12-category census times out on dense metros at large
 * radii, so it is split into two half-size queries on different mirrors.
 */
import { overpass, OVERPASS_MIRRORS } from "../lib/net.js";
import { createCache } from "../lib/cache.js";

export const INFRA_CATS = [
  ["Hospitals", '["amenity"="hospital"]'],
  ["Clinics", '["amenity"="clinic"]'],
  ["Schools", '["amenity"="school"]'],
  ["Universities", '["amenity"="university"]'],
  ["Police stations", '["amenity"="police"]'],
  ["Fire stations", '["amenity"="fire_station"]'],
  ["Supermarkets", '["shop"="supermarket"]'],
  ["Places of worship", '["amenity"="place_of_worship"]'],
  ["Rail stations", '["railway"="station"]'],
  ["Airports & airfields", '["aeroway"="aerodrome"]'],
  ["Parks", '["leisure"="park"]'],
  ["Museums", '["tourism"="museum"]'],
];

// parsed selectors for /api/infrapoints (key/val per category)
export const INFRA_SELECTORS = INFRA_CATS.map(([label, sel]) => {
  const m = sel.match(/\["(.+?)"="(.+?)"\]/);
  return { label, key: m[1], val: m[2] };
});

const infraCache = createCache({ ttlMs: 6 * 3600000, max: 500 }); // counts move slowly

export async function infrastructure(lat, lon, radiusM) {
  const r = Math.round(radiusM);
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${Math.round(r / 1000)}`;
  const hit = infraCache.get(cacheKey);
  if (hit) return hit;
  const halves = [INFRA_CATS.slice(0, 6), INFRA_CATS.slice(6)];
  const q = (cats) => `[out:json][timeout:30];\n` +
    cats.map(([, sel]) => `nwr${sel}(around:${r},${lat},${lon});out count;`).join("\n");
  // each half walks the full mirror list, but starting on a different server so
  // the two concurrent queries spread load rather than both hitting the first
  // mirror. Rotating (instead of indexing fixed positions) means the list can be
  // any length without a slot coming up undefined.
  const rotate = (n) => OVERPASS_MIRRORS.map((_, i, m) => m[(i + n) % m.length]);
  const [a, b] = await Promise.allSettled([
    overpass(q(halves[0]), { timeoutMs: 35000, mirrors: rotate(0) }),
    overpass(q(halves[1]), { timeoutMs: 35000, mirrors: rotate(1) }),
  ]);
  if (a.status === "rejected" && b.status === "rejected") throw a.reason;
  const parse = (res, cats) => {
    // a server-side timeout truncates the response to a prefix of the count
    // statements (in order), so positional mapping leaves nulls on the tail
    const counts = res.status === "fulfilled" ? (res.value.elements || []).filter((e) => e.type === "count") : [];
    return cats.map(([label], i) => ({
      label,
      count: counts[i] ? parseInt(counts[i].tags?.total ?? counts[i].tags?.nodes ?? "0", 10) : null,
    }));
  };
  const data = [...parse(a, halves[0]), ...parse(b, halves[1])];
  if (data.every((c) => c.count != null)) infraCache.set(cacheKey, data); // only complete results are worth caching
  return data;
}
