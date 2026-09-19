/**
 * Space tab data (CelesTrak TLEs + Launch Library 2 crew)
 * ------------------------------------------------------
 * CelesTrak publishes TLE element sets (keyless); the browser propagates
 * positions locally with satellite.js, so one TLE fetch covers hours of motion.
 * Who is in space comes from Launch Library 2 (actively maintained, unlike the
 * frozen Open Notify feed). Both cached in memory: TLEs drift slowly (6 h) and
 * crew changes are rarer still (1 h, which also respects LL2's anon limit).
 *
 * `parseTle` is pure and exported for unit tests.
 */
import { fetchJson, fetchText } from "../lib/net.js";

const HOUR_MS = 3600000;
const TLE_GROUPS = ["stations", "visual"]; // space stations + the ~150 brightest objects
const spaceCache = { sats: null, satsAt: 0, astros: null, astrosAt: 0 };

export function parseTle(text, group) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) continue;
    // strip TLE zero-padding ("00733" -> "733"): SATCAT and Wikidata P377 use the bare number
    out.push({ name: name.trim(), noradId: String(parseInt(l1.slice(2, 7), 10)), line1: l1, line2: l2, group });
  }
  return out;
}

/* Returns { satellites, tleFetchedAt, astros }. Throws only when CelesTrak is
   unavailable AND there is no usable cached TLE set; a stale cache beats no
   data, and a missing crew card is tolerated silently. */
export async function loadSpace() {
  const now = Date.now();
  if (!spaceCache.sats || now - spaceCache.satsAt > 6 * HOUR_MS) {
    try {
      const texts = await Promise.all(TLE_GROUPS.map((g) =>
        fetchText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, 20000)));
      const seen = new Set();
      const sats = [];
      texts.forEach((t, i) => {
        for (const s of parseTle(t, TLE_GROUPS[i])) {
          if (seen.has(s.noradId)) continue; // ISS et al. appear in both groups
          seen.add(s.noradId);
          sats.push(s);
        }
      });
      if (sats.length) { spaceCache.sats = sats; spaceCache.satsAt = now; }
    } catch (e) {
      if (!spaceCache.sats) throw new Error(`CelesTrak unavailable — ${e.message}`);
      // stale cache beats no data: TLEs stay usably accurate for days
    }
  }
  if (!spaceCache.astros || now - spaceCache.astrosAt > HOUR_MS) {
    try {
      const j = await fetchJson("https://ll.thespacedevs.com/2.2.0/astronaut/?in_space=true&limit=100&format=json", {}, 25000);
      if (Array.isArray(j.results)) {
        const people = j.results
          .filter((p) => p.type?.name !== "Non-Human") // the catalog flags Starman, the Tesla mannequin, as in space
          .map((p) => ({
            name: p.name,
            agency: p.agency?.abbrev || p.agency?.name || null,
            nationality: p.nationality || null,
            wiki: p.wiki || null, // curated enwiki URL — stronger than any name match
          }));
        spaceCache.astros = { number: people.length, people };
        spaceCache.astrosAt = now;
      }
    } catch { /* stale cache (or no card) beats wrong data */ }
  }
  return {
    satellites: spaceCache.sats,
    tleFetchedAt: new Date(spaceCache.satsAt).toISOString(),
    astros: spaceCache.astros,
  };
}
