/**
 * Recent news (Google News RSS)
 * -----------------------------
 * News APIs can't search by coordinates, so this is the one name-based source.
 * Disambiguation: place names come from the coordinate-verified geocode, and
 * each query REQUIRES the locality AND its state/country as quoted pairs, so a
 * same-named town elsewhere won't match.
 *
 * `parseRssItems` and `buildPlaceQueries` are pure and exported for unit tests.
 */
import { fetchText } from "../lib/net.js";

export function parseRssItems(xml) {
  const items = [];
  const strip = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
  const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag) => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return mm ? decode(strip(mm[1])) : null;
    };
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || null;
    items.push({ title: pick("title"), link, pubDate: pick("pubDate"), source: pick("source") });
  }
  return items.filter((i) => i.title && i.link);
}

// Google News ranks RSS results by relevance, not date, so without a window the
// feed is dominated by old "most relevant" stories. `when:` constrains the query
// server-side to a recent window; the cutoff below is a backstop in case a feed
// ignores it or returns an undated item.
const NEWS_WINDOW_DAYS = 365;

export async function news(placeQueries) {
  const all = [];
  const queries = placeQueries.slice(0, 3);
  let okFeeds = 0;
  for (const pq of queries) {
    const q = pq.terms.map((t) => `"${t}"`).join(" ") + ` when:${NEWS_WINDOW_DAYS}d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    let xml = null;
    for (let attempt = 0; attempt < 2 && xml === null; attempt++) { // Google News intermittently blocks
      try { xml = await fetchText(url); }
      catch { if (attempt === 0) await new Promise((r) => setTimeout(r, 800)); }
    }
    if (xml === null) continue;
    okFeeds++;
    for (const item of parseRssItems(xml).slice(0, 10)) {
      all.push({ ...item, matched: pq.label });
    }
  }
  // every feed fetch failed -> a transient block, not "no news here": surface it
  // as an error (with a Retry button) rather than a misleading empty result
  if (queries.length && okFeeds === 0) {
    throw new Error("Google News didn't respond (likely a temporary rate-limit) — retry in a moment.");
  }
  const cutoff = Date.now() - NEWS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const seen = new Set();
  return all
    .filter((i) => { const k = i.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .filter((i) => { const t = Date.parse(i.pubDate); return Number.isNaN(t) ? false : t >= cutoff; })
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
    .slice(0, 14)
    .map((i) => ({ ...i, pubDate: new Date(i.pubDate).toISOString() })); // full timestamp — watch diffing needs it
}

export function buildPlaceQueries(q) {
  const { locality, county, state, country } = q;
  const queries = [];
  if (locality && (state || country)) {
    queries.push({ terms: [locality, state || country], label: `${locality}, ${state || country}` });
  }
  if (county && state && county !== locality) {
    queries.push({ terms: [county, state], label: `${county}, ${state}` });
  }
  // extra settlement names from the circle, each anchored to the state/country
  for (const name of String(q.extra || "").split("|").filter(Boolean).slice(0, 2)) {
    if (name !== locality && (state || country)) {
      queries.push({ terms: [name, state || country], label: `${name}, ${state || country}` });
    }
  }
  if (!queries.length && state && country) queries.push({ terms: [state, country], label: `${state}, ${country}` });
  if (!queries.length && country) queries.push({ terms: [country], label: country });
  return queries;
}
