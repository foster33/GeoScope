/**
 * Space route
 * -----------
 *   GET /api/space -> { satellites, tleFetchedAt, astros }
 * Orbital element sets plus who is in space right now; see sources/space.js
 * for the caching rules. The browser does the propagation.
 */
import express from "express";
import { loadSpace } from "../../sources/space.js";
import { HttpError, wrap } from "../http.js";

export function spaceRoutes() {
  const r = express.Router();
  r.get("/space", wrap(async (_req, res) => {
    try {
      res.json(await loadSpace());
    } catch (e) {
      throw new HttpError(502, e.message);
    }
  }));
  return r;
}
