import { test } from "node:test";
import assert from "node:assert/strict";
import { createCache, memoizeAsync } from "../lib/cache.js";

// a controllable clock so expiry is deterministic
function fakeClock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test("createCache stores and returns values", () => {
  const c = createCache({ ttlMs: 1000 });
  c.set("a", 42);
  assert.equal(c.get("a"), 42);
  assert.equal(c.get("missing"), undefined);
});

test("createCache expires entries after ttl", () => {
  const now = fakeClock();
  const c = createCache({ ttlMs: 1000, now });
  c.set("a", "x");
  now.advance(999);
  assert.equal(c.get("a"), "x"); // still fresh
  now.advance(2);
  assert.equal(c.get("a"), undefined); // expired
});

test("createCache evicts the oldest key past max", () => {
  const c = createCache({ ttlMs: 10_000, max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  c.set("c", 3); // pushes "a" out
  assert.equal(c.get("a"), undefined);
  assert.equal(c.get("b"), 2);
  assert.equal(c.get("c"), 3);
});

test("createCache get refreshes LRU recency", () => {
  const c = createCache({ ttlMs: 10_000, max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  c.get("a");      // "a" becomes most-recently-used
  c.set("c", 3);   // so "b" is evicted, not "a"
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("b"), undefined);
});

test("createCache rejects a non-positive ttl", () => {
  assert.throws(() => createCache({ ttlMs: 0 }));
  assert.throws(() => createCache({}));
});

test("memoizeAsync caches successful calls but retries failures", async () => {
  let calls = 0;
  const flaky = memoizeAsync(async (x) => {
    calls++;
    if (calls === 1) throw new Error("transient");
    return x * 2;
  }, { ttlMs: 1000 });

  await assert.rejects(() => flaky(5)); // first call throws, nothing cached
  assert.equal(await flaky(5), 10);     // retried, succeeds
  assert.equal(await flaky(5), 10);     // served from cache
  assert.equal(calls, 2);               // not called a third time
});

test("memoizeAsync keys distinct args separately", async () => {
  let calls = 0;
  const fn = memoizeAsync(async (a, b) => { calls++; return a + b; }, { ttlMs: 1000 });
  assert.equal(await fn(1, 2), 3);
  assert.equal(await fn(2, 2), 4);
  assert.equal(await fn(1, 2), 3); // cached
  assert.equal(calls, 2);
});
