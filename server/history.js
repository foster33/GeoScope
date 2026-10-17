/**
 * Saved places ("history")
 * ------------------------
 * A saved place is an exact (lat, lon, radius) owning an append-only timeline
 * of immutable report snapshots. The model functions here are pure (places in,
 * places out) so the rules are unit-testable; HistoryStore wraps them with the
 * JSON file and the one-time migration from the pre-timeline format.
 *
 * Rules:
 *   - a snapshot saved at an identical spot+radius appends to that timeline
 *   - a timeline keeps at most MAX_SNAPSHOTS: the original is always kept and
 *     the newest fill the rest
 *   - at most MAX_PLACES places are kept, oldest dropped first
 *   - deleting a place's last snapshot deletes the place
 */
import path from "path";
import crypto from "crypto";
import { JsonFile } from "./store.js";
import { labelFor } from "../lib/format.js";

export const MAX_SNAPSHOTS = 50;
export const MAX_PLACES = 200;

const samePlace = (p, r) => p.lat === r.lat && p.lon === r.lon && p.radiusMi === r.radiusMi;

/* newest activity first, for the Saved tab */
export const latestTakenAt = (p) => p.snapshots[p.snapshots.length - 1]?.takenAt || p.createdAt;
export const sortByLatest = (places) => [...places].sort((a, b) => latestTakenAt(b).localeCompare(latestTakenAt(a)));

export function addSnapshot(places, report, { uuid = crypto.randomUUID, now = () => new Date().toISOString() } = {}) {
  const snap = { id: uuid(), takenAt: report.queriedAt || now(), report };
  let place = places.find((p) => samePlace(p, report));
  const created = !place;
  if (place) {
    place.snapshots.push(snap);
    if (place.snapshots.length > MAX_SNAPSHOTS) {
      place.snapshots = [place.snapshots[0], ...place.snapshots.slice(-(MAX_SNAPSHOTS - 1))];
    }
  } else {
    place = {
      id: uuid(), label: labelFor(report),
      lat: report.lat, lon: report.lon, radiusMi: report.radiusMi,
      createdAt: now(), snapshots: [snap],
    };
    places.push(place);
  }
  return {
    places: places.slice(-MAX_PLACES),
    result: { placeId: place.id, snapshotId: snap.id, created, snapshots: place.snapshots.length },
  };
}

/* -> { places, placeDeleted } | { error: "place" | "snapshot" } */
export function removeSnapshot(places, placeId, snapId) {
  const place = places.find((p) => p.id === placeId);
  if (!place) return { error: "place" };
  const next = place.snapshots.filter((s) => s.id !== snapId);
  if (next.length === place.snapshots.length) return { error: "snapshot" };
  place.snapshots = next;
  return { places: next.length ? places : places.filter((p) => p.id !== placeId), placeDeleted: !next.length };
}

/* -> places without the place, or null when it didn't exist */
export function removePlace(places, id) {
  const next = places.filter((p) => p.id !== id);
  return next.length === places.length ? null : next;
}

/* Pre-timeline files held flat entries ({id, savedAt, report}). Entries saved
   at the identical spot+radius merge into one timeline, oldest first. Returns
   null when the data is already in the current shape. */
export function migrateLegacy(entries, { uuid = crypto.randomUUID } = {}) {
  if (!Array.isArray(entries) || !entries.length || entries[0].snapshots) return null;
  const places = [];
  for (const e of [...entries].sort((a, b) => a.savedAt.localeCompare(b.savedAt))) {
    if (!e.report) continue;
    const snap = { id: uuid(), takenAt: e.report.queriedAt || e.savedAt, report: e.report };
    const place = places.find((p) => samePlace(p, e.report));
    if (place) place.snapshots.push(snap);
    else places.push({
      id: e.id, label: labelFor(e.report),
      lat: e.report.lat, lon: e.report.lon, radiusMi: e.report.radiusMi,
      createdAt: e.savedAt, snapshots: [snap],
    });
  }
  return places;
}

export class HistoryStore {
  constructor(dataDir, { log = console } = {}) {
    this.file = new JsonFile(path.join(dataDir, "history.json")).ensure([]);
    this.migrate(log);
  }

  migrate(log) {
    try {
      const entries = this.file.read();
      const places = migrateLegacy(entries);
      if (!places) return;
      this.file.write(places);
      log.log(`Migrated ${entries.length} saved lookup(s) into ${places.length} place timeline(s)`);
    } catch { /* unreadable file: leave untouched */ }
  }

  list() { return sortByLatest(this.file.read()); }

  save(report) {
    const { places, result } = addSnapshot(this.file.read(), report);
    this.file.write(places);
    return result;
  }

  deleteSnapshot(placeId, snapId) {
    const r = removeSnapshot(this.file.read(), placeId, snapId);
    if (!r.error) this.file.write(r.places);
    return r;
  }

  deletePlace(id) {
    const next = removePlace(this.file.read(), id);
    if (next) this.file.write(next);
    return !!next;
  }
}
