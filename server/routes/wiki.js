/**
 * Wikipedia preview route
 * -----------------------
 *   GET /api/wikipreview?name&wikidata&wikipedia&norad&astro&lat&lon&lang
 *
 * Resolution never trusts the bare name. In order of strength:
 *   1. an explicit "lang:Title" wikipedia tag (OSM) or curated link (Launch Library)
 *   2. a Wikidata QID — given directly, resolved from a NORAD catalog number
 *      (P377), or from an occupation-constrained astronaut name match — and
 *      then its sitelink in the requested language (else English, else any)
 *   3. a Wikipedia geosearch at the exact coordinates whose title matches the name
 *   4. for satellites with no article, the CelesTrak SATCAT + Wikidata facts
 * Anything else is a 404 with a reason, never a guess. Language follows the
 * request natively via sitelinks/langlinks; see sources/wiki.js.
 */
import express from "express";
import { fetchJson } from "../../lib/net.js";
import { sanitizeLang } from "../../lib/geo.js";
import { noradToQid, astronautQid, satFallback, wikiSummary, wikiSummaryInLang } from "../../sources/wiki.js";
import { HttpError, wrap, str } from "../http.js";

const QID = /^Q\d+$/;

export function wikiRoutes() {
  const r = express.Router();

  r.get("/wikipreview", wrap(async (req, res) => {
    const name = str(req.query.name);
    const wikipedia = str(req.query.wikipedia);
    const isAstro = str(req.query.astro) === "1";
    // tolerate zero-padded catalog numbers from older cached clients
    const noradRaw = str(req.query.norad);
    const norad = /^\d{1,9}$/.test(noradRaw) ? String(parseInt(noradRaw, 10)) : null;
    const lat = parseFloat(str(req.query.lat)), lon = parseFloat(str(req.query.lon));
    const target = sanitizeLang(str(req.query.lang));

    try {
      if (wikipedia.includes(":")) {
        const idx = wikipedia.indexOf(":");
        const data = await wikiSummaryInLang(sanitizeLang(wikipedia.slice(0, idx)), wikipedia.slice(idx + 1), target);
        return res.json({ data: { ...data, via: isAstro ? "Launch Library curated link" : "OSM wikipedia tag" } });
      }

      let wikidata = str(req.query.wikidata) || null;
      let wdVia = wikidata ? `Wikidata ${wikidata}` : null;
      if (!wikidata && norad) {
        wikidata = await noradToQid(norad).catch(() => null);
        wdVia = `satellite catalog number ${norad}`;
      }
      if (!wikidata && isAstro && name) {
        wikidata = await astronautQid(name).catch(() => null);
        wdVia = `astronaut name + occupation match → ${wikidata}`;
      }
      if (wikidata && QID.test(wikidata)) {
        const j = await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidata}&props=sitelinks&format=json`);
        const sl = j.entities?.[wikidata]?.sitelinks || {};
        // prefer the requested language's edition outright, else en, else anything
        const key = sl[`${target}wiki`] ? `${target}wiki`
          : sl.enwiki ? "enwiki"
          : Object.keys(sl).find((k) => /^[a-z]{2,3}wiki$/.test(k));
        if (key) {
          const data = await wikiSummary(key.replace(/wiki$/, ""), sl[key].title);
          return res.json({ data: { ...data, langFallback: key !== `${target}wiki`, via: wdVia } });
        }
      }

      if (Number.isFinite(lat) && Number.isFinite(lon) && name) {
        const g = await fetchJson(
          `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=2000&gslimit=10&format=json`
        );
        const nm = name.toLowerCase();
        const cand = (g.query?.geosearch || []).find((x) => {
          const t = x.title.toLowerCase();
          return t === nm || t.startsWith(nm + ",") || t.startsWith(nm + " (");
        });
        if (cand) {
          const data = await wikiSummaryInLang("en", cand.title, target);
          return res.json({ data: { ...data, via: "coordinate + name match" } });
        }
      }

      if (norad) {
        const data = await satFallback(norad, name, wikidata && QID.test(wikidata) ? wikidata : null, target).catch(() => null);
        if (data) return res.json({ data });
      }
    } catch (e) {
      throw new HttpError(502, e.message);
    }

    throw new HttpError(404, norad
      ? "Neither Wikipedia nor the satellite catalog has details for this object."
      : isAstro
        ? "No Wikipedia article could be verified for this astronaut's name."
        : "No verified Wikipedia article for this place.");
  }));

  return r;
}
