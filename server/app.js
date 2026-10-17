/**
 * Application factory
 * -------------------
 * Builds the Express app and the watch engine without starting anything: no
 * port is opened and no timer runs until the caller says so. That is what lets
 * the route tests boot a full app on an ephemeral port against a temp data
 * directory, and lets server.js stay a three-line entry point.
 *
 * Accuracy note: every upstream lookup is keyed by the exact lat/lon the user
 * clicked - never by place name - so results can't drift to a different town
 * that happens to share a name. The reverse-geocoded address hierarchy
 * (county / state / country) is returned so the user can verify the match.
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import { HistoryStore } from "./history.js";
import { createWatchEngine } from "../watch/engine.js";
import { reportRoutes } from "./routes/report.js";
import { historyRoutes } from "./routes/history.js";
import { watchRoutes } from "./routes/watches.js";
import { wikiRoutes } from "./routes/wiki.js";
import { spaceRoutes } from "./routes/space.js";
import { infraRoutes } from "./routes/infrapoints.js";
import { jsonErrorHandler, jsonNotFound } from "./http.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_AREA_CACHE_MS = 5 * 60 * 1000;

/**
 * @param {object} options
 * @param {string} options.dataDir        where history.json / watches.json live
 * @param {number} [options.areaCacheMs]  TTL of the report hot-path cache
 * @param {object} [options.engine]       overrides passed to createWatchEngine (tests)
 * @returns {{ app: import("express").Express, engine: object, history: HistoryStore }}
 */
export function createApp({ dataDir, areaCacheMs = DEFAULT_AREA_CACHE_MS, engine: engineOpts = {}, log = console }) {
  if (!dataDir) throw new Error("createApp: dataDir is required");

  const history = new HistoryStore(dataDir, { log });
  const engine = createWatchEngine({ dataDir, ...engineOpts });

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  // no-cache = revalidate every load (ETag 304s keep it cheap), so a redeploy
  // is never masked by a stale cached app.js
  app.use(express.static(path.join(ROOT, "public"), {
    etag: true,
    setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
  }));

  app.use("/api", reportRoutes({ areaCacheMs }));
  app.use("/api", historyRoutes({ history }));
  app.use("/api", watchRoutes({ engine }));
  app.use("/api", wikiRoutes());
  app.use("/api", spaceRoutes());
  app.use("/api", infraRoutes());
  app.use("/api", jsonNotFound);
  app.use(jsonErrorHandler);

  return { app, engine, history };
}
