/**
 * Watch engine tests: the scheduler with an injected clock, instant sleeps,
 * a synthetic watcher registry and a stubbed notifier — so cadence, change
 * detection, retries and persistence are checked without any real time or
 * network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWatchEngine, MAX_CHANGES } from "../watch/engine.js";

function harness({ watchers, notify, ...opts } = {}) {
  let t = Date.UTC(2026, 0, 1);
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "geoscope-engine-"));
  const values = { a: 1 };
  const fetches = { a: 0 };
  const reg = watchers || {
    a: {
      intervalMs: 60_000,
      fetch: async () => { fetches.a++; if (values.a instanceof Error) throw values.a; return values.a; },
      diff: (prev, data) => (prev.v === data ? null : { summary: `a: ${prev.v} -> ${data}`, items: [{ text: String(data) }] }),
      next: (_prev, data) => ({ v: data }),
    },
  };
  const sent = [];
  const engine = createWatchEngine({
    dataDir, watchers: reg, now, sleep: async () => {}, uuid: (() => { let n = 0; return () => `id-${++n}`; })(),
    notify: notify || (async (cfg, w, change) => { sent.push({ cfg, change }); }),
    ...opts,
  });
  return { engine, now, values, fetches, sent, dataDir };
}

test("first tick baselines, a later change is recorded with id/time/summary", async () => {
  const h = harness();
  const w = h.engine.add({ lat: 1, lon: 2, radiusMi: 10, label: "X", place: {} });
  assert.equal(h.engine.view(w).baselined, false);

  assert.equal(await h.engine.tick(w.id), true);
  assert.equal(h.fetches.a, 1);
  assert.deepEqual(w.snapshots.a, { v: 1 });
  assert.deepEqual(w.changes, [], "baseline run records no change");
  assert.equal(h.engine.view(w).baselined, true);

  h.values.a = 2;
  await h.engine.tick(w.id);
  assert.equal(w.changes.length, 1);
  assert.deepEqual(w.changes[0], {
    id: "id-2", at: "2026-01-01T00:00:00.000Z", source: "a", summary: "a: 1 -> 2", items: [{ text: "2" }],
  });
  assert.deepEqual(w.snapshots.a, { v: 2 });
});

test("a scheduled tick respects each source's interval; a forced tick ignores it", async () => {
  const h = harness();
  const w = h.engine.add({ lat: 1, lon: 2 });
  await h.engine.tick(w.id);
  await h.engine.tick();
  assert.equal(h.fetches.a, 1, "not due yet");
  h.now.advance(59_000);
  await h.engine.tick();
  assert.equal(h.fetches.a, 1, "still inside the interval");
  h.now.advance(2_000);
  await h.engine.tick();
  assert.equal(h.fetches.a, 2, "due");
  await h.engine.tick(w.id);
  assert.equal(h.fetches.a, 3, "forced");
});

test("disabled metrics are skipped; the view reports the next due time", async () => {
  const h = harness();
  const w = h.engine.add({ lat: 1, lon: 2 });
  h.engine.setMetrics(w, { a: false, bogus: true });
  assert.deepEqual(w.metrics, { a: false });
  await h.engine.tick(w.id);
  assert.equal(h.fetches.a, 0);
  assert.equal(h.engine.view(w).nextCheckAt, null, "nothing enabled -> nothing scheduled");

  h.engine.setMetrics(w, { a: true });
  assert.equal(h.engine.view(w).nextCheckAt, "2026-01-01T00:00:00.000Z", "never checked -> due now, not in 1970");
  await h.engine.tick(w.id);
  assert.equal(h.engine.view(w).nextCheckAt, "2026-01-01T00:01:00.000Z");
});

test("a failing source is recorded per source and cleared on the next success", async () => {
  const h = harness();
  const w = h.engine.add({ lat: 1, lon: 2 });
  h.values.a = new Error("Overpass timed out");
  await h.engine.tick(w.id);
  assert.deepEqual(w.lastErrors, { a: "Overpass timed out" });
  assert.equal(h.engine.view(w).baselined, true, "an error counts as a completed attempt");
  h.values.a = 5;
  await h.engine.tick(w.id);
  assert.deepEqual(w.lastErrors, {});
  assert.deepEqual(w.snapshots.a, { v: 5 });
});

test("notifications: delivered once, retried once, failure recorded", async () => {
  let attempts = 0;
  const h = harness({ notify: async () => { attempts++; if (attempts <= 2) throw new Error(`boom ${attempts}`); } });
  const w = h.engine.add({ lat: 1, lon: 2 });
  h.engine.setNotify(w, { url: "https://ntfy.sh/t", format: "auto" });
  await h.engine.tick(w.id);
  h.values.a = 2;
  await h.engine.tick(w.id);
  await new Promise((r) => setImmediate(r)); // notifyChange runs detached from the tick
  assert.deepEqual(w.notifyState, { ok: false, at: "2026-01-01T00:00:00.000Z", error: "boom 2" });

  h.values.a = 3;
  await h.engine.tick(w.id);
  await new Promise((r) => setImmediate(r));
  assert.equal(w.notifyState.ok, true, "third change: first attempt succeeds");
  assert.equal(attempts, 3);

  h.engine.setNotify(w, null);
  assert.ok(!w.notify && !w.notifyState, "clearing the channel forgets the last outcome");
});

test("sendTest records the outcome and rethrows on failure", async () => {
  const h = harness({ notify: async () => { throw new Error("HTTP 500 from ntfy.sh"); } });
  const w = h.engine.add({ lat: 1, lon: 2, label: "Here" });
  h.engine.setNotify(w, { url: "https://ntfy.sh/t", format: "ntfy" });
  await assert.rejects(() => h.engine.sendTest(w), /HTTP 500/);
  assert.equal(w.notifyState.ok, false);
  assert.equal(w.notifyState.error, "HTTP 500 from ntfy.sh");
});

test("only one tick runs at a time", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ watchers: { a: { intervalMs: 1, fetch: () => gate, diff: () => null, next: (_p, d) => ({ v: d }) } } });
  const w = h.engine.add({ lat: 1, lon: 2 });
  const first = h.engine.tick(w.id);
  assert.equal(h.engine.running, true);
  assert.equal(await h.engine.tick(w.id), false, "busy");
  release(1);
  assert.equal(await first, true);
  assert.equal(h.engine.running, false);
});

test("the change log is capped and ack/seen bookkeeping works", async () => {
  const h = harness();
  const w = h.engine.add({ lat: 1, lon: 2 });
  await h.engine.tick(w.id);
  for (let i = 2; i < MAX_CHANGES + 10; i++) { h.values.a = i; await h.engine.tick(w.id); }
  assert.equal(w.changes.length, MAX_CHANGES);
  assert.equal(w.changes[0].summary, `a: ${MAX_CHANGES + 8} -> ${MAX_CHANGES + 9}`, "newest first");
  h.engine.ackChange(w, w.changes[0].id);
  assert.equal(w.changes[0].seen, true);
  h.now.advance(1000);
  h.engine.markSeen(w);
  assert.equal(w.lastSeenAt, "2026-01-01T00:00:01.000Z");
});

test("watches persist to disk and reload; removal mid-tick stops further checks", async () => {
  const h = harness();
  const w = h.engine.add({ lat: 1, lon: 2, radiusMi: "abc", label: "x".repeat(200) });
  assert.equal(w.radiusMi, 25, "unparseable radius -> default");
  assert.equal(w.label.length, 120);
  const onDisk = JSON.parse(fs.readFileSync(path.join(h.dataDir, "watches.json"), "utf8"));
  assert.equal(onDisk[0].id, w.id);

  const again = createWatchEngine({ dataDir: h.dataDir, watchers: {}, now: h.now, sleep: async () => {} });
  assert.equal(again.list().length, 1);

  assert.equal(h.engine.remove("nope"), false);
  assert.equal(h.engine.remove(w.id), true);
  assert.equal(h.engine.list().length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.dataDir, "watches.json"), "utf8")), []);
});

test("the watch limit is enforced at add time", () => {
  const h = harness({ maxWatches: 1 });
  h.engine.add({ lat: 1, lon: 2 });
  assert.throws(() => h.engine.add({ lat: 1, lon: 2 }), (e) => e.code === "LIMIT" && /Watch limit reached \(1\)/.test(e.message));
});

test("start/stop manage timers without ticking synchronously", () => {
  const h = harness({ tickEveryMs: 1e9, bootDelayMs: 1e9 });
  h.engine.start();
  h.engine.start(); // idempotent
  h.engine.stop();
  assert.equal(h.fetches.a, 0);
});
