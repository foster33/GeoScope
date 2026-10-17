/**
 * Nearby landmarks / points of interest
 * -------------------------------------
 * Wikipedia GeoSearch is hard-capped at a 10 km radius, so on its own it only
 * covers the centre of a large circle. Below that cap we use it (richer); above
 * it we switch to a Wikidata coordinate query that covers the WHOLE radius,
 * ranked by global notability with settlements filtered out.
 */
import { fetchJson, wdqs } from "../lib/net.js";
import { clamp } from "../lib/geo.js";

const WIKI_GEOSEARCH_MAX_KM = 10;

export async function landmarksWiki(lat, lon, radiusM) {
  const r = clamp(Math.round(radiusM), 10, 10000);
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=geosearch` +
    `&gscoord=${lat}%7C${lon}&gsradius=${r}&gslimit=20&format=json&origin=*`;
  const j = await fetchJson(url);
  return (j.query?.geosearch || []).map((g) => ({
    title: g.title,
    lat: g.lat,
    lon: g.lon,
    distanceKm: Math.round(g.dist / 100) / 10,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(g.title.replace(/ /g, "_"))}`,
    source: "wikipedia",
  }));
}

export async function landmarksWikidata(lat, lon, radiusKm) {
  const km = clamp(radiusKm, 1, 500);
  const sparql = `
SELECT ?item ?itemLabel ?coord ?dist ?sitelinks ?article WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${km}" .
    bd:serviceParam wikibase:distance ?dist .
  }
  ?item wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= 8)
  FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 }            # not a person
  FILTER NOT EXISTS { ?item wdt:P1082 ?pop }           # not a populated place
  FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* wd:Q486972 } # not a human settlement
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?sitelinks) LIMIT 30`;
  const j = await wdqs(sparql, 30000);
  const out = [];
  for (const b of j.results?.bindings || []) {
    const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value || "");
    const title = b.itemLabel?.value;
    if (!m || !title || /^Q\d+$/.test(title)) continue;
    out.push({
      title,
      lat: parseFloat(m[2]),
      lon: parseFloat(m[1]),
      distanceKm: Math.round(parseFloat(b.dist?.value ?? "0") * 10) / 10,
      url: b.article?.value || b.item.value.replace("http://www.wikidata.org/entity/", "https://www.wikidata.org/wiki/"),
      sitelinks: parseInt(b.sitelinks?.value || "0", 10),
      source: "wikidata",
    });
  }
  return out;
}

export async function landmarks(lat, lon, radiusM, radiusKm) {
  return radiusKm > WIKI_GEOSEARCH_MAX_KM
    ? landmarksWikidata(lat, lon, radiusKm)
    : landmarksWiki(lat, lon, radiusM);
}
