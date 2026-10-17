/**
 * Network helpers
 * ---------------
 * Every outbound call shares one User-Agent, one timeout discipline, and a
 * couple of resilience wrappers (WDQS retry, Overpass mirror fallback). Kept in
 * one place so politeness is uniform — see README "Polite API usage".
 */

/* Nominatim and the Overpass operators ask every client to identify itself
   with a way to reach its operator. Set GEOSCOPE_CONTACT (an email or URL) when
   you self-host; the default only makes sense on a private LAN. */
export const UA = `GeoScope/1.0 (self-hosted area explorer; contact: ${process.env.GEOSCOPE_CONTACT || "localhost"})`;

export async function fetchJson(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json", ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError" || ctrl.signal.aborted) {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s — ${new URL(url).host}`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/* plain-text fetch with the same UA/timeout discipline as fetchJson —
   used for RSS news feeds and CelesTrak TLE files */
export async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

/* Wikidata Query Service, with retry. WDQS frequently returns transient
   502/503/429 or times out under load; a single failure shouldn't sink the
   source, so retry a couple of times with backoff before giving up. */
export async function wdqs(sparql, timeoutMs = 30000) {
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchJson(url, { headers: { Accept: "application/sparql-results+json" } }, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (!/HTTP (429|500|502|503|504)|Timed out/i.test(e.message)) break; // only retry transient errors
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/* Overpass (OpenStreetMap query API) with mirror fallback.

   Every entry here must be a FULL-PLANET instance, verified by querying a few
   cities on different continents and checking the results are non-empty — not
   just that the request returned 200. A regional extract (overpass.osm.ch, for
   example, only holds Switzerland) answers a Paris query with HTTP 200, an
   empty element list and no `remark`, which is indistinguishable from a
   genuine "nothing here" and so never triggers failover. The report silently
   shows zeros. Checking availability alone is not enough.

   Ordered fastest-first (measured): openstreetmap.fr is an independent operator
   and consistently ~0.5s; z. and lz4. are the two physical servers behind the
   overpass-api.de round-robin, named directly so consecutive fallbacks land on
   different machines. A dead mirror is worse than a missing one — the chain
   waits the full timeoutMs before moving on — so anything that stops answering
   should be removed rather than kept as a "fallback". */
export const OVERPASS_MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

export async function overpass(q, { timeoutMs = 25000, mirrors = OVERPASS_MIRRORS } = {}) {
  let lastErr;
  for (const mirror of mirrors) {
    try {
      const j = await fetchJson(mirror, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
      }, timeoutMs);
      // a server-side timeout / runtime error comes back as HTTP 200 with an
      // empty element set and a `remark` — without this it would silently read
      // as "zero results" instead of failing over to the next mirror
      if (j.remark && /timed out|runtime error|out of memory/i.test(j.remark) && !(j.elements || []).length) {
        throw new Error(`Overpass remark: ${j.remark.trim()}`);
      }
      return j;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All Overpass mirrors failed");
}

/* fire-and-forget POST for notifications; short timeout, no body read */
export async function postNotify(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  } finally { clearTimeout(t); }
}
