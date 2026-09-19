/**
 * Notable people born inside the radius (Wikidata, coordinate-bounded)
 * -------------------------------------------------------------------
 * `wikibase:around` finds people whose recorded birthplace coordinates fall
 * inside the circle — never a same-named town elsewhere. Ranked by global
 * Wikipedia coverage (sitelinks).
 */
import { wdqs } from "../lib/net.js";
import { clamp } from "../lib/geo.js";

export async function notablePeople(lat, lon, radiusKm) {
  // WDQS handles the full circle fine (~1s even at 160 km) — the sitelinks
  // filter + LIMIT keep it bounded — so cover the real radius instead of just
  // the central 60 km, which previously made big circles centre-biased
  const km = clamp(radiusKm, 1, 500);
  const sparql = `
SELECT ?person ?personLabel ?birthPlaceLabel ?dob ?occLabel ?sitelinks WHERE {
  SERVICE wikibase:around {
    ?birthPlace wdt:P625 ?loc .
    bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${km}" .
  }
  ?person wdt:P19 ?birthPlace ;
          wdt:P31 wd:Q5 ;
          wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= 8)
  OPTIONAL { ?person wdt:P569 ?dob . }
  OPTIONAL { ?person wdt:P106 ?occ . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?sitelinks)
LIMIT 120`;
  const j = await wdqs(sparql, 30000);
  const seen = new Map();
  for (const r of j.results?.bindings || []) {
    const id = r.person?.value;
    if (!id) continue;
    if (!seen.has(id)) {
      seen.set(id, {
        name: r.personLabel?.value,
        birthplace: r.birthPlaceLabel?.value,
        born: r.dob?.value ? r.dob.value.slice(0, 10) : null,
        occupations: new Set(),
        sitelinks: parseInt(r.sitelinks?.value || "0", 10),
        url: id.replace("http://www.wikidata.org/entity/", "https://www.wikidata.org/wiki/"),
      });
    }
    if (r.occLabel?.value) seen.get(id).occupations.add(r.occLabel.value);
  }
  return [...seen.values()]
    .filter((p) => p.name && !/^Q\d+$/.test(p.name))
    .sort((a, b) => b.sitelinks - a.sitelinks)
    .slice(0, 18)
    .map((p) => ({ ...p, occupations: [...p.occupations].slice(0, 3) }));
}
