/**
 * Saved-place routes
 * ------------------
 *   GET    /api/history                                   places, most recent activity first
 *   POST   /api/history { report }                        append a snapshot (creates the place if new)
 *   DELETE /api/history/:placeId/snapshots/:snapId        drop one snapshot (the last one drops the place)
 *   DELETE /api/history/:id                               drop a place and its whole timeline
 */
import express from "express";
import { HttpError } from "../http.js";

export function historyRoutes({ history }) {
  const r = express.Router();

  r.get("/history", (_req, res) => {
    res.json(history.list());
  });

  r.post("/history", (req, res) => {
    const report = req.body?.report;
    if (!report?.summary || !Number.isFinite(report.lat) || !Number.isFinite(report.lon)) {
      throw new HttpError(400, "A report payload is required.");
    }
    res.status(201).json(history.save(report));
  });

  r.delete("/history/:placeId/snapshots/:snapId", (req, res) => {
    const out = history.deleteSnapshot(req.params.placeId, req.params.snapId);
    if (out.error === "place") throw new HttpError(404, "Place not found.");
    if (out.error === "snapshot") throw new HttpError(404, "Snapshot not found.");
    res.json({ deleted: req.params.snapId, placeDeleted: out.placeDeleted });
  });

  r.delete("/history/:id", (req, res) => {
    if (!history.deletePlace(req.params.id)) throw new HttpError(404, "Place not found.");
    res.json({ deleted: req.params.id });
  });

  return r;
}
