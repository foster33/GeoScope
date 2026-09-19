/**
 * Wikipedia / Wikidata preview resolution (+ satellite catalog fallback)
 * ---------------------------------------------------------------------
 * Resolution never trusts a bare name: it goes through OSM wikipedia/wikidata
 * tags, NORAD catalog number (P377), or astronaut occupation match — the
 * "coordinates, never the name" principle applied to entities. Language follows
 * the request natively via sitelinks/langlinks, never machine translation.
 */
import { fetchJson, wdqs } from "../lib/net.js";

/* Satellite -> Wikidata entity via the catalog number (P377). A catalog number
   can be shared (ISS and its Zarya module are both 25544), so the entity with
   the widest Wikipedia coverage wins. Misses (rocket bodies) are cacheable too. */
const noradQidCache = new Map();
export async function noradToQid(norad) {
  if (noradQidCache.has(norad)) return noradQidCache.get(norad);
  const sparql = `SELECT ?item WHERE { ?item wdt:P377 "${norad}" ; wikibase:sitelinks ?n . } ORDER BY DESC(?n) LIMIT 1`;
  const j = await wdqs(sparql);
  const qid = j.results?.bindings?.[0]?.item?.value?.replace(/^.*\//, "") || null;
  noradQidCache.set(norad, qid);
  return qid;
}

/* Astronaut -> Wikidata entity: exact label/alias match constrained to humans
   with the astronaut occupation (Q11631), widest coverage first. */
const astroQidCache = new Map();
export async function astronautQid(name) {
  const clean = String(name).replace(/["\\\n]/g, "").trim();
  if (!clean) return null;
  if (astroQidCache.has(clean)) return astroQidCache.get(clean);
  const sparql = `SELECT ?item WHERE {
  ?item wdt:P31 wd:Q5 ; wdt:P106 wd:Q11631 ; rdfs:label|skos:altLabel "${clean}"@en ; wikibase:sitelinks ?n .
} ORDER BY DESC(?n) LIMIT 1`;
  const j = await wdqs(sparql);
  const qid = j.results?.bindings?.[0]?.item?.value?.replace(/^.*\//, "") || null;
  astroQidCache.set(clean, qid);
  return qid;
}

/* When no Wikipedia article exists (most rocket bodies, minor satellites), the
   preview falls back to real catalog data: CelesTrak's SATCAT record plus the
   Wikidata label/description/image when an entity exists. */
const satcatCache = new Map();
async function satcatRecord(norad) {
  if (satcatCache.has(norad)) return satcatCache.get(norad);
  const j = await fetchJson(`https://celestrak.org/satcat/records.php?CATNR=${norad}&FORMAT=JSON`);
  const rec = Array.isArray(j) && j[0] ? j[0] : null;
  satcatCache.set(norad, rec);
  return rec;
}

const SAT_LABEL_IDS = ["P31", "P247", "P619", "P17", "P2146", "P2045", "P2243", "P2244", "Q26540", "Q4809", "Q275450"];
const satLabelCache = new Map(); // lang -> { id: label }
async function satFieldLabels(lang) {
  if (satLabelCache.has(lang)) return satLabelCache.get(lang);
  const j = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${SAT_LABEL_IDS.join("|")}` +
    `&props=labels&languages=${lang}|en&format=json`
  );
  const out = {};
  for (const [id, e] of Object.entries(j.entities || {})) {
    out[id] = e.labels?.[lang]?.value || e.labels?.en?.value || id;
  }
  satLabelCache.set(lang, out);
  return out;
}

/* SATCAT owner codes for the catalogs we surface -> ISO 3166 alpha-2, so the
   client can localize the country name with Intl.DisplayNames; org codes stay. */
const SATCAT_OWNER_ISO = {
  US: "US", CIS: "RU", PRC: "CN", JPN: "JP", FR: "FR", GER: "DE", UK: "GB", IND: "IN",
  IT: "IT", CA: "CA", SKOR: "KR", SPN: "ES", SWED: "SE", NOR: "NO", NETH: "NL", LUXE: "LU",
  ARGN: "AR", BRAZ: "BR", AUS: "AU", ISRA: "IL", TURK: "TR", UAE: "AE", SAFR: "ZA",
  SAUD: "SA", INDO: "ID", THAI: "TH", MEX: "MX", EGYP: "EG", KAZ: "KZ", UKR: "UA", POL: "PL",
};

export async function satFallback(norad, name, qid, lang) {
  const [rec, labels] = await Promise.all([
    satcatRecord(norad).catch(() => null),
    satFieldLabels(lang).catch(() => ({})),
  ]);
  let title = name || `NORAD ${norad}`, description = null, thumb = null, langFallback = false;
  if (qid) {
    try {
      const j = await fetchJson(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}` +
        `&props=labels|descriptions|claims&languages=${lang}|en&format=json`
      );
      const e = j.entities?.[qid];
      title = e?.labels?.[lang]?.value || e?.labels?.en?.value || title;
      description = e?.descriptions?.[lang]?.value || e?.descriptions?.en?.value || null;
      langFallback = !!description && !e?.descriptions?.[lang]?.value;
      const img = e?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (img) thumb = "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(img) + "?width=640";
    } catch { /* catalog facts still stand on their own */ }
  }
  if (!rec && !description) return null;
  const L = (id, fb) => labels[id] || fb;
  const facts = [];
  if (rec) {
    const typeQ = { PAY: "Q26540", "R/B": "Q4809", DEB: "Q275450" }[rec.OBJECT_TYPE];
    if (typeQ) facts.push({ label: L("P31", "Type"), value: L(typeQ, rec.OBJECT_TYPE) });
    if (rec.OBJECT_ID) facts.push({ label: L("P247", "COSPAR ID"), value: rec.OBJECT_ID, mono: true });
    if (rec.LAUNCH_DATE) facts.push({ label: L("P619", "Launch date"), value: rec.LAUNCH_DATE, kind: "date" });
    if (rec.OWNER) facts.push({ label: L("P17", "Country"), value: rec.OWNER, iso: SATCAT_OWNER_ISO[rec.OWNER] || null, kind: "owner" });
    if (rec.PERIOD) facts.push({ label: L("P2146", "Orbital period"), value: rec.PERIOD, kind: "minutes" });
    if (rec.INCLINATION != null) facts.push({ label: L("P2045", "Inclination"), value: rec.INCLINATION, kind: "degrees" });
    if (rec.APOGEE != null) facts.push({ label: L("P2243", "Apogee"), value: rec.APOGEE, kind: "km" });
    if (rec.PERIGEE != null) facts.push({ label: L("P2244", "Perigee"), value: rec.PERIGEE, kind: "km" });
  }
  return {
    title, description, thumb, facts, lang, langFallback,
    url: qid ? `https://www.wikidata.org/wiki/${qid}` : `https://celestrak.org/satcat/table-satcat.php?CATNR=${norad}`,
    urlLabel: qid ? "Wikidata" : "CelesTrak SATCAT",
    factsOnly: true,
    via: rec ? `CelesTrak SATCAT ${norad}${qid ? ` + Wikidata ${qid}` : ""}` : `Wikidata ${qid}`,
  };
}

async function langlinkTitle(srcLang, title, target) {
  try {
    const j = await fetchJson(
      `https://${srcLang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}` +
      `&prop=langlinks&lllang=${target}&lllimit=1&redirects=1&format=json`
    );
    for (const p of Object.values(j.query?.pages || {})) {
      const ll = p.langlinks?.[0];
      if (ll?.["*"]) return ll["*"];
    }
  } catch { /* fall through to source language */ }
  return null;
}

export async function wikiSummaryInLang(srcLang, title, target) {
  if (target && target !== srcLang) {
    const t = await langlinkTitle(srcLang, title, target);
    if (t) return { ...(await wikiSummary(target, t)), langFallback: false };
    return { ...(await wikiSummary(srcLang, title)), langFallback: true };
  }
  return { ...(await wikiSummary(srcLang, title)), langFallback: false };
}

export async function wikiSummary(lang, title) {
  const safeLang = /^[a-z]{2,12}(-[a-z0-9-]+)?$/i.test(lang) ? lang.toLowerCase() : "en";
  const j = await fetchJson(
    `https://${safeLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`
  );
  if (!j?.title || j.type === "https://mediawiki.org/wiki/HyperSwitch/errors/not_found") {
    throw new Error("Article not found");
  }
  return {
    title: j.title,
    description: j.description || null,
    extract: j.extract || null,
    thumb: j.thumbnail?.source || null,
    url: j.content_urls?.desktop?.page || `https://${safeLang}.wikipedia.org/wiki/${encodeURIComponent(j.title.replace(/ /g, "_"))}`,
    lang: safeLang,
  };
}
