/**
 * Report routes
 * -------------
 *   GET  /api/part/:src?lat&lon&radius_mi[&lang…]  one report section
 *   GET  /api/area?lat&lon&radius_mi               the one-shot seven-source report
 *   GET  /api/geocode?q[&lang]                     forward geocode for the search box
 *   POST /api/summary { report }                   the overview paragraph for a report
 *
 * Hot-path cache: re-clicking the same spot (or a watch and an explore on the
 * same point) used to re-fan-out every upstream call. A short-TTL,
 * coordinate-rounded cache in front of the report endpoints collapses those
 * into one set of requests — faster for the user and far politer to the public
 * APIs. Responses say which happened in `X-GeoScope-Cache: hit|miss`.
 */
import express from "express";
import { createCache } from "../../lib/cache.js";
import { sanitizeLang } from "../../lib/geo.js";
import { buildSummary } from "../../lib/summary.js";
import { forwardGeocode } from "../../sources/geocode.js";
import { PARTS, partCacheKey, coordKey, buildAreaReport } from "../parts.js";
import { HttpError, wrap, str, parsePoint } from "../http.js";

export function reportRoutes({ areaCacheMs }) {
  const r = express.Router();
  const areaCache = createCache({ ttlMs: areaCacheMs, max: 300 });
  const partCache = createCache({ ttlMs: areaCacheMs, max: 1500 });
  const geoSearchCache = createCache({ ttlMs: areaCacheMs, max: 500 });

  r.get("/geocode", wrap(async (req, res) => {
    const q = str(req.query.q).trim();
    if (q.length < 2) throw new HttpError(400, "A search term is required.");
    const lang = sanitizeLang(str(req.query.lang));
    const key = `${lang}|${q.toLowerCase()}`;
    const cached = geoSearchCache.get(key);
    if (cached !== undefined) {
      res.set("X-GeoScope-Cache", "hit");
      return res.json({ results: cached });
    }
    try {
      const results = await forwardGeocode(q, lang);
      geoSearchCache.set(key, results);
      res.json({ results });
    } catch (e) {
      throw new HttpError(502, e.message);
    }
  }));

  r.post("/summary", (req, res) => {
    const report = req.body?.report;
    if (!report || !Number.isFinite(report.lat) || !Number.isFinite(report.lon)) {
      throw new HttpError(400, "A report payload is required.");
    }
    res.json({ summary: buildSummary(report) });
  });

  r.get("/part/:src", wrap(async (req, res) => {
    const handler = PARTS[req.params.src];
    if (!handler) throw new HttpError(404, "Unknown source.");
    const pt = parsePoint(req.query);
    const key = partCacheKey(req.params.src, pt, req.query);
    const cached = partCache.get(key);
    if (cached !== undefined) {
      res.set("X-GeoScope-Cache", "hit");
      return res.json({ data: cached });
    }
    try {
      const data = await handler(pt, req.query);
      partCache.set(key, data);
      res.set("X-GeoScope-Cache", "miss");
      res.json({ data });
    } catch (e) {
      throw new HttpError(502, e.message);
    }
  }));

  r.get("/area", wrap(async (req, res) => {
    const pt = parsePoint(req.query);
    const key = coordKey(pt.lat, pt.lon, pt.radiusMi);
    const cached = areaCache.get(key);
    if (cached !== undefined) {
      res.set("X-GeoScope-Cache", "hit");
      return res.json(cached);
    }
    const report = await buildAreaReport(pt);
    if (!report.sourceErrors.length) areaCache.set(key, report); // don't cache partial failures
    res.set("X-GeoScope-Cache", "miss");
    res.json(report);
  }));

  return r;
}
