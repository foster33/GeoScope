/**
 * Infrastructure point route
 * --------------------------
 *   GET /api/infrapoints?cat=<label>|*&lat&lon&radius_mi[&lang]
 *
 * The report's infrastructure census is count-only to stay cheap; this fetches
 * the actual coordinates when the user asks to see a category (or all of them)
 * on the globe.
 */
import express from "express";
import { overpass } from "../../lib/net.js";
import { sanitizeLang } from "../../lib/geo.js";
import { bestName } from "../../lib/format.js";
import { INFRA_CATS, INFRA_SELECTORS } from "../../sources/infrastructure.js";
import { HttpError, wrap, str, parsePoint } from "../http.js";

const CAP_PER_CAT = 60;   // Overpass itself caps each `out` statement
const CAP_SINGLE = 150;

/* the full census as one request, with a separate out-statement per category
   so dense categories (churches, schools) can't crowd out sparse ones
   (hospitals, airports) */
async function allCategories({ lat, lon, radiusM }, lang) {
  const r = Math.round(radiusM);
  const q = `[out:json][timeout:25];\n` +
    INFRA_CATS.map(([, sel]) => `nwr${sel}(around:${r},${lat},${lon});out center ${CAP_PER_CAT};`).join("\n");
  const j = await overpass(q, { timeoutMs: 30000 });
  const perCat = {};
  const seen = new Set();
  const pts = [];
  for (const e of j.elements || []) {
    const id = `${e.type}/${e.id}`;
    if (seen.has(id)) continue; // an element can match two categories' statements
    seen.add(id);
    const t = e.tags || {};
    const c = INFRA_SELECTORS.find((s) => t[s.key] === s.val);
    const plat = e.lat ?? e.center?.lat, plon = e.lon ?? e.center?.lon;
    if (!c || plat == null || plon == null) continue;
    perCat[c.label] = (perCat[c.label] || 0) + 1;
    pts.push({ name: bestName(t, lang), localName: lang ? t[`name:${lang}`] || null : null, lat: plat, lon: plon, cat: c.label });
  }
  return { data: pts, truncated: Object.values(perCat).some((n) => n >= CAP_PER_CAT) };
}

async function oneCategory({ lat, lon, radiusM }, selector, lang) {
  const r = Math.round(radiusM);
  const j = await overpass(`[out:json][timeout:20];\nnwr${selector}(around:${r},${lat},${lon});\nout center ${CAP_SINGLE};`);
  const pts = (j.elements || [])
    .map((e) => ({
      name: bestName(e.tags, lang),
      localName: lang ? e.tags?.[`name:${lang}`] || null : null,
      lat: e.lat ?? e.center?.lat ?? null,
      lon: e.lon ?? e.center?.lon ?? null,
    }))
    .filter((p) => p.lat != null && p.lon != null);
  return { data: pts, truncated: (j.elements || []).length >= CAP_SINGLE };
}

export function infraRoutes() {
  const r = express.Router();

  r.get("/infrapoints", wrap(async (req, res) => {
    const catParam = str(req.query.cat);
    const all = catParam === "*";
    const cat = all ? null : INFRA_CATS.find(([label]) => label === catParam);
    if (!all && !cat) throw new HttpError(400, "Unknown infrastructure category.");
    const pt = parsePoint(req.query);
    const lang = req.query.lang ? sanitizeLang(str(req.query.lang)) : null;
    try {
      res.json(all ? await allCategories(pt, lang) : await oneCategory(pt, cat[1], lang));
    } catch (e) {
      throw new HttpError(502, e.message);
    }
  }));

  return r;
}
