/**
 * Tiny TTL + LRU cache
 * --------------------
 * One small primitive behind every server-side cache (country dataset, infra
 * counts, satellite catalog lookups, and the hot-path /api/area cache). Entries
 * expire after `ttlMs`; when the map exceeds `max`, the oldest key is evicted.
 *
 * `now` is injectable so expiry is unit-testable without real clocks.
 */
export function createCache({ ttlMs, max = 500, now = Date.now } = {}) {
  if (!(ttlMs > 0)) throw new Error("createCache: ttlMs must be a positive number");
  const m = new Map();

  return {
    get(key) {
      const hit = m.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) { m.delete(key); return undefined; }
      // re-insert so recently read keys are the last to be evicted (LRU)
      m.delete(key);
      m.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      m.set(key, { at: now(), value });
      if (m.size > max) m.delete(m.keys().next().value); // evict oldest
      return value;
    },
    has(key) {
      return this.get(key) !== undefined;
    },
    delete(key) { return m.delete(key); },
    clear() { m.clear(); },
    get size() { return m.size; },
  };
}

/* Memoize an async function behind a TTL cache. `keyFn` maps the call args to a
   cache key; only successful resolutions are cached, so a transient failure is
   always retried rather than remembered. */
export function memoizeAsync(fn, { ttlMs, max = 500, now = Date.now, keyFn = (...a) => JSON.stringify(a) } = {}) {
  const cache = createCache({ ttlMs, max, now });
  const wrapped = async (...args) => {
    const key = keyFn(...args);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = await fn(...args);
    cache.set(key, value);
    return value;
  };
  wrapped.cache = cache;
  return wrapped;
}
