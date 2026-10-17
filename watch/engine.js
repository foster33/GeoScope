/**
 * Watch engine
 * ------------
 * A watch re-checks a saved point on a schedule and records what changed. The
 * per-source cadence and diff logic live in the registry (watchers.js); this is
 * the stateful scheduler, the watch list, and its file persistence.
 *
 * Scheduling: a tick walks every watch and every enabled source, and checks a
 * source only when its interval has elapsed since the last check (a forced
 * tick, for "check now" or a brand-new watch, ignores the interval for that one
 * watch). Checks run one at a time with a gap between upstream calls, so a full
 * set of watches stays well inside the public APIs' politeness limits. Only
 * one tick runs at a time.
 *
 * Change log: the first check of a source only records a baseline snapshot;
 * from then on each check diffs against the previous snapshot and, when the
 * registry reports a difference, prepends a change entry and pushes it through
 * the watch's notification channel (one retry).
 *
 * Every clock, timer, id generator and sleep is injectable so the scheduler is
 * unit-testable without waiting on real time.
 */
import crypto from "crypto";
import path from "path";
import { JsonFile } from "../server/store.js";
import { clamp } from "../lib/geo.js";
import { WATCHERS, MAX_WATCHES } from "./watchers.js";
import { sendNotification } from "./notify.js";

export const MAX_CHANGES = 200;      // change-log entries kept per watch
export const TICK_EVERY_MS = 5 * 60 * 1000;
export const BOOT_DELAY_MS = 10 * 1000;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createWatchEngine({
  dataDir,
  watchers = WATCHERS,
  notify = sendNotification,
  now = Date.now,
  sleep = defaultSleep,
  uuid = () => crypto.randomUUID(),
  tickEveryMs = TICK_EVERY_MS,
  bootDelayMs = BOOT_DELAY_MS,
  gapMs = 2000,          // pause between upstream calls in a scheduled tick
  forcedGapMs = 400,     // shorter pause when the user asked for a check now
  maxWatches = MAX_WATCHES,
} = {}) {
  const file = new JsonFile(path.join(dataDir, "watches.json")).ensure([]);
  const watches = file.readOr([]);
  const save = () => file.write(watches);
  const iso = () => new Date(now()).toISOString();
  const sources = () => Object.keys(watchers);

  let tickRunning = false;
  let intervalTimer = null, bootTimer = null;

  /* ------------------------------------------------------------ checks */

  async function notifyChange(w, change) {
    if (!w.notify?.url) return;
    const attempt = async () => {
      await notify(w.notify, w, change);
      w.notifyState = { ok: true, at: iso() };
    };
    try {
      await attempt();
    } catch {
      await sleep(2000);
      try { await attempt(); } catch (e) { w.notifyState = { ok: false, at: iso(), error: e.message }; }
    }
    save();
  }

  async function checkSource(w, src) {
    const def = watchers[src];
    w.lastChecked = w.lastChecked || {};
    w.lastErrors = w.lastErrors || {};
    try {
      const data = await def.fetch(w);
      const prev = (w.snapshots || {})[src];
      if (prev) { // first run only sets the baseline — no change entry
        const d = def.diff(prev, data, w);
        if (d) {
          w.changes = w.changes || [];
          const change = { id: uuid(), at: iso(), source: src, summary: d.summary, items: d.items };
          w.changes.unshift(change);
          w.changes = w.changes.slice(0, MAX_CHANGES);
          notifyChange(w, change).catch(() => {});
        }
      }
      w.snapshots = w.snapshots || {};
      w.snapshots[src] = def.next(prev, data);
      delete w.lastErrors[src];
    } catch (e) {
      w.lastErrors[src] = e.message;
    }
    w.lastChecked[src] = iso();
  }

  /* run every due check (or every check of `forceId`); false if a tick was
     already running, so callers can report "busy" instead of waiting */
  async function tick(forceId = null) {
    if (tickRunning) return false;
    tickRunning = true;
    try {
      for (const w of [...watches]) {
        for (const src of sources()) {
          if (w.metrics?.[src] === false) continue;
          const last = Date.parse(w.lastChecked?.[src] || "") || 0;
          if (w.id !== forceId && now() - last < watchers[src].intervalMs) continue;
          if (!watches.includes(w)) break; // deleted mid-run
          await checkSource(w, src);
          save();
          await sleep(forceId === w.id ? forcedGapMs : gapMs);
        }
      }
    } finally {
      tickRunning = false;
    }
    return true;
  }

  /* ------------------------------------------------------------- views */

  /* public shape: snapshots are internal state; add readiness + next due time */
  function view(w) {
    const { snapshots, ...rest } = w;
    const enabled = sources().filter((s) => w.metrics?.[s] !== false);
    // a source never checked is due at the next tick, not in 1970
    const nexts = enabled.map((s) => {
      const last = Date.parse(w.lastChecked?.[s] || "");
      return Number.isNaN(last) ? now() : last + watchers[s].intervalMs;
    });
    return {
      ...rest,
      baselined: enabled.every((s) => snapshots?.[s] != null || w.lastErrors?.[s] != null),
      nextCheckAt: nexts.length ? new Date(Math.min(...nexts)).toISOString() : null,
    };
  }

  /* ---------------------------------------------------------- mutations */

  function add({ lat, lon, radiusMi, label, place }) {
    if (watches.length >= maxWatches) {
      const err = new Error(`Watch limit reached (${maxWatches}) — remove one first to stay polite to the public APIs.`);
      err.code = "LIMIT";
      throw err;
    }
    const w = {
      id: uuid(),
      createdAt: iso(),
      lat, lon,
      radiusMi: clamp(parseFloat(radiusMi) || 25, 1, 300),
      label: String(label || "").slice(0, 120) || null,
      place: place && typeof place === "object" ? place : {},
      metrics: Object.fromEntries(sources().map((s) => [s, true])),
      snapshots: {}, lastChecked: {}, lastErrors: {}, changes: [],
      lastSeenAt: iso(),
    };
    watches.push(w);
    save();
    return w;
  }

  function remove(id) {
    const i = watches.findIndex((x) => x.id === id);
    if (i < 0) return false;
    watches.splice(i, 1);
    save();
    return true;
  }

  function setMetrics(w, metrics) {
    w.metrics = w.metrics || {};
    for (const [k, v] of Object.entries(metrics)) if (k in watchers) w.metrics[k] = !!v;
    save();
  }

  /* notify: { url, format } to set, null to clear; the previous delivery
     outcome is dropped either way since it described the old URL */
  function setNotify(w, notify) {
    if (notify) w.notify = notify;
    else delete w.notify;
    delete w.notifyState;
    save();
  }

  function markSeen(w) {
    w.lastSeenAt = iso();
    save();
  }

  function ackChange(w, changeId) {
    const c = (w.changes || []).find((x) => x.id === changeId);
    if (c) c.seen = true;
    save();
  }

  /* fire a synthetic change through the configured channel so the user can
     confirm delivery without waiting for a real one; throws on failure after
     recording the outcome */
  async function sendTest(w) {
    const change = {
      id: "test", at: iso(), source: "news",
      summary: "Test notification — your watch is wired up",
      items: [{ text: `Future changes inside ${w.label || "this area"} will arrive here.` }],
    };
    try {
      await notify(w.notify, w, change);
      w.notifyState = { ok: true, at: change.at };
      save();
    } catch (e) {
      w.notifyState = { ok: false, at: change.at, error: e.message };
      save();
      throw e;
    }
  }

  /* ---------------------------------------------------------- scheduler */

  function start() {
    if (intervalTimer) return;
    intervalTimer = setInterval(() => { tick().catch(() => {}); }, tickEveryMs);
    bootTimer = setTimeout(() => { tick().catch(() => {}); }, bootDelayMs); // catch up shortly after boot
    intervalTimer.unref?.();
    bootTimer.unref?.();
  }

  function stop() {
    clearInterval(intervalTimer);
    clearTimeout(bootTimer);
    intervalTimer = bootTimer = null;
  }

  return {
    list: () => watches,
    get: (id) => watches.find((x) => x.id === id),
    add, remove, setMetrics, setNotify, markSeen, ackChange, sendTest,
    view, tick, checkSource, start, stop,
    get running() { return tickRunning; },
  };
}
