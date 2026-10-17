/**
 * Saved-place model tests: the pure timeline rules, the legacy migration,
 * and the file-backed store round trip.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_SNAPSHOTS, MAX_PLACES, addSnapshot, removeSnapshot, removePlace, migrateLegacy, sortByLatest, HistoryStore,
} from "../server/history.js";

const ids = () => { let n = 0; return () => `id-${++n}`; };
const report = (over = {}) => ({
  lat: 1, lon: 2, radiusMi: 10, queriedAt: "2026-01-01T00:00:00.000Z", summary: "s",
  location: { locality: "Town", state: "State" }, ...over,
});

test("addSnapshot creates a place, then appends at the identical spot+radius", () => {
  const opts = { uuid: ids(), now: () => "2026-02-02T00:00:00.000Z" };
  let { places, result } = addSnapshot([], report(), opts);
  assert.deepEqual(result, { placeId: "id-2", snapshotId: "id-1", created: true, snapshots: 1 });
  assert.equal(places[0].label, "Town");
  assert.equal(places[0].snapshots[0].takenAt, "2026-01-01T00:00:00.000Z", "takenAt is the report's own time");

  ({ places, result } = addSnapshot(places, report({ queriedAt: undefined }), opts));
  assert.equal(result.created, false);
  assert.equal(result.snapshots, 2);
  assert.equal(places.length, 1);
  assert.equal(places[0].snapshots[1].takenAt, "2026-02-02T00:00:00.000Z", "no queriedAt -> now");

  ({ places, result } = addSnapshot(places, report({ radiusMi: 11 }), opts));
  assert.equal(result.created, true, "a different radius is a different place");
  assert.equal(places.length, 2);
});

test("a timeline keeps its original and the newest snapshots up to the cap", () => {
  const opts = { uuid: ids() };
  let places = [];
  for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
    ({ places } = addSnapshot(places, report({ queriedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` }), opts));
  }
  const snaps = places[0].snapshots;
  assert.equal(snaps.length, MAX_SNAPSHOTS);
  assert.equal(snaps[0].takenAt, "2026-01-01T00:00:00.000Z", "the original survives");
  assert.equal(snaps.at(-1).takenAt, `2026-01-01T00:00:${MAX_SNAPSHOTS + 4}.000Z`, "the newest survives");
});

test("the place list is capped, oldest first to go", () => {
  const opts = { uuid: ids() };
  let places = [];
  for (let i = 0; i < MAX_PLACES + 2; i++) ({ places } = addSnapshot(places, report({ lat: i }), opts));
  assert.equal(places.length, MAX_PLACES);
  assert.equal(places[0].lat, 2);
});

test("removeSnapshot / removePlace report what happened", () => {
  const opts = { uuid: ids() };
  let { places } = addSnapshot([], report(), opts);
  ({ places } = addSnapshot(places, report(), opts));
  const [p] = places;
  assert.deepEqual(removeSnapshot(places, "nope", "x"), { error: "place" });
  assert.deepEqual(removeSnapshot(places, p.id, "nope"), { error: "snapshot" });
  let r = removeSnapshot(places, p.id, p.snapshots[0].id);
  assert.equal(r.placeDeleted, false);
  r = removeSnapshot(r.places, p.id, p.snapshots[0].id);
  assert.equal(r.placeDeleted, true);
  assert.deepEqual(r.places, []);
  assert.equal(removePlace([p], "nope"), null);
  assert.deepEqual(removePlace([p], p.id), []);
});

test("sortByLatest orders by newest snapshot, falling back to creation time", () => {
  const places = [
    { id: "a", createdAt: "2026-01-05T00:00:00Z", snapshots: [] },
    { id: "b", createdAt: "2026-01-01T00:00:00Z", snapshots: [{ takenAt: "2026-01-09T00:00:00Z" }] },
    { id: "c", createdAt: "2026-01-07T00:00:00Z", snapshots: [{ takenAt: "2026-01-02T00:00:00Z" }] },
  ];
  assert.deepEqual(sortByLatest(places).map((p) => p.id), ["b", "a", "c"]);
  assert.equal(places[0].id, "a", "input untouched");
});

test("migrateLegacy merges flat entries into timelines, oldest first, and ignores modern data", () => {
  const legacy = [
    { id: "e2", savedAt: "2026-01-02T00:00:00Z", report: report({ queriedAt: "2026-01-02T00:00:00Z" }) },
    { id: "e1", savedAt: "2026-01-01T00:00:00Z", report: report({ queriedAt: "2026-01-01T00:00:00Z" }) },
    { id: "e3", savedAt: "2026-01-03T00:00:00Z", report: report({ lat: 9, queriedAt: "2026-01-03T00:00:00Z" }) },
    { id: "junk", savedAt: "2026-01-04T00:00:00Z" },
  ];
  const places = migrateLegacy(legacy, { uuid: ids() });
  assert.equal(places.length, 2);
  assert.equal(places[0].id, "e1", "the place keeps the id of its oldest entry");
  assert.deepEqual(places[0].snapshots.map((s) => s.takenAt), ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]);
  assert.equal(places[1].lat, 9);
  assert.equal(migrateLegacy(places), null, "already migrated");
  assert.equal(migrateLegacy([]), null);
  assert.equal(migrateLegacy("garbage"), null);
});

test("HistoryStore round-trips through the file and migrates a legacy file on boot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geoscope-history-"));
  const file = path.join(dir, "history.json");
  fs.writeFileSync(file, JSON.stringify([{ id: "old", savedAt: "2026-01-01T00:00:00Z", report: report() }]));
  const logged = [];
  const store = new HistoryStore(dir, { log: { log: (m) => logged.push(m) } });
  assert.match(logged[0], /Migrated 1 saved lookup\(s\) into 1 place timeline\(s\)/);
  assert.equal(store.list()[0].id, "old");

  const r = store.save(report({ queriedAt: "2026-03-01T00:00:00Z" }));
  assert.equal(r.created, false);
  assert.equal(store.list()[0].snapshots.length, 2);
  assert.ok(!fs.existsSync(`${file}.${process.pid}.tmp`), "atomic write leaves no temp file");

  assert.equal(store.deletePlace("nope"), false);
  assert.equal(store.deletePlace("old"), true);
  assert.deepEqual(store.list(), []);

  fs.writeFileSync(file, "{corrupt");
  const again = new HistoryStore(dir, { log: { log() {} } });
  assert.equal(fs.readFileSync(file, "utf8"), "{corrupt", "an unreadable file is left untouched");
  assert.throws(() => again.list());
  fs.rmSync(dir, { recursive: true, force: true });
});
