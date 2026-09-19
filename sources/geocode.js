/**
 * Reverse geocode + country reference data (Nominatim / OpenStreetMap)
 * -------------------------------------------------------------------
 * Coordinate-based, so there is zero name ambiguity. Currency + official
 * languages are attached from the keyless mledoze/countries dataset (the data
 * behind REST Countries, which now requires an account key).
 */
import { fetchJson } from "../lib/net.js";

/* Forward geocode (search a place name -> candidate coordinates). Used only by
   the "search to fly" box: the user picks a result, and from then on every
   report is keyed by those exact coordinates — so this is a navigation aid, not
   a data source. Returns a short, ranked candidate list with the full display
   name so the user disambiguates same-named places themselves. */
export async function forwardGeocode(q, lang = "en") {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=0` +
    `&accept-language=${encodeURIComponent(lang)}&q=${encodeURIComponent(q)}`;
  const list = await fetchJson(url);
  return (Array.isArray(list) ? list : [])
    .map((r) => ({
      displayName: r.display_name,
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      type: [r.type, r.class].filter(Boolean).join(" · ") || null,
      importance: r.importance ?? 0,
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

// 1. Reverse geocode - coordinate based, zero name ambiguity
export async function reverseGeocode(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1&accept-language=en`;
  const j = await fetchJson(url);
  if (j.error) return { ocean: true, displayName: "Open water / unpopulated area" };
  const a = j.address || {};
  return {
    ocean: false,
    displayName: j.display_name,
    locality: a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || null,
    county: a.county || a.state_district || null,
    state: a.state || a.region || a.province || null,
    country: a.country || null,
    countryCode: (a.country_code || "").toUpperCase(),
    postcode: a.postcode || null,
    osmType: j.type || null,
  };
}

/* 1b. Country reference data, reduced to tiny per-country maps from one fetch.
   Keyless; any failure simply omits the affected row. */
let currencyByCountry = null;   // cca2 -> { code, name, symbol }
let languagesByCountry = null;  // cca2 -> [ "English", "French", ... ]
let usdRates = null, usdRatesAt = 0;

async function ensureCountryData() {
  if (currencyByCountry && languagesByCountry) return;
  const list = await fetchJson("https://raw.githubusercontent.com/mledoze/countries/master/countries.json", {}, 30000);
  const cur = {}, langs = {};
  for (const c of list) {
    if (!c.cca2) continue;
    const [code, info] = Object.entries(c.currencies || {})[0] || [];
    if (code) cur[c.cca2] = { code, name: info?.name || null, symbol: info?.symbol || null };
    const names = Object.values(c.languages || {});
    if (names.length) langs[c.cca2] = names;
  }
  if (!Object.keys(cur).length) throw new Error("empty country dataset");
  currencyByCountry = cur;
  languagesByCountry = langs;
}

export async function countryCurrency(cc) {
  if (!cc) return null;
  await ensureCountryData();
  const cur = currencyByCountry[cc];
  if (!cur) return null;
  if (!usdRates || Date.now() - usdRatesAt > 12 * 3600000) {
    try {
      const j = await fetchJson("https://open.er-api.com/v6/latest/USD");
      if (j?.rates) { usdRates = j.rates; usdRatesAt = Date.now(); }
    } catch { /* rate part omitted, currency still shown */ }
  }
  const rate = usdRates?.[cur.code];
  return { ...cur, perUsd: rate ? Math.round(rate * 10000) / 10000 : null };
}

export async function countryLanguages(cc) {
  if (!cc) return null;
  await ensureCountryData();
  return languagesByCountry[cc] || null;
}
