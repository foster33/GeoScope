/**
 * Wikipedia preview
 * -----------------
 * The preview borrows the side panel instead of covering the page: the
 * visible view is remembered, swapped out, and restored by ✕ / Escape.
 * Resolution happens server-side (never from the bare name); this module
 * only asks and renders, caching successful and definitive-404 answers for
 * the session so re-opening the same thing is instant.
 */
import { $ } from "./dom.js";
import { api, qs, ApiError } from "./api.js";
import { settings } from "./settings.js";
import { esc, distKm } from "./format.js";
import { revealPanel } from "./controls.js";

const wikiCache = new Map();
let wikiReturnView = null;
const PANEL_VIEWS = ["exploreView", "savedView", "watchView", "spaceView"];

/* d: { name, wikidata?, wikipedia?, norad?, astro?, lat?, lon? } */
export async function openWikiPop(d) {
  const pop = $("wikiView");
  const body = $("wikiBody");
  if (pop.hidden) {
    wikiReturnView = PANEL_VIEWS.find((id) => !$(id).hidden) || "exploreView";
    $(wikiReturnView).hidden = true;
    pop.hidden = false;
  }
  revealPanel(); // a click on a globe dot must surface the panel even when it's hidden away
  $("panel").scrollTop = 0;
  body.innerHTML = `<div class="wiki-loading"><span class="dot"></span> Verifying the right article for <strong>${esc(d.name)}</strong>…</div>`;

  const key = `${settings.lang}|${d.norad ? `norad:${d.norad}` : d.astro ? `astro:${d.name}` : d.wikidata || d.wikipedia || `${d.name}@${d.lat},${d.lon}`}`;
  let result = wikiCache.get(key);
  if (!result) {
    let cacheable = true;
    try {
      const j = await api.get(`/api/wikipreview?${qs({
        name: d.name || "", wikidata: d.wikidata || "", wikipedia: d.wikipedia || "",
        norad: d.norad || "", astro: d.astro || "", lat: d.lat || "", lon: d.lon || "", lang: settings.lang,
      })}`);
      result = { ok: true, data: j.data };
    } catch (e) {
      const known = e instanceof ApiError;
      result = { ok: false, error: known ? e.message : "Server unreachable." };
      cacheable = known && e.status === 404; // a transient failure must be retried next time
    }
    if (cacheable) wikiCache.set(key, result);
  }
  if (pop.hidden) return; // closed while loading

  if (!result.ok) {
    body.innerHTML = `
      <div class="wiki-head"><span class="wiki-title">${esc(d.name)}</span></div>
      <p class="dim" style="margin-top:10px">${esc(result.error || "No verified Wikipedia article for this place.")}</p>
      <p class="dim" style="font-size:11.5px;margin-top:8px">${d.norad
        ? "GeoScope matches space objects by their catalog number on Wikidata — it never guesses from the display name."
        : "GeoScope only links an article when the place's own map tags or its exact coordinates confirm the match — it never guesses from the name alone."}</p>`;
    return;
  }
  const w = result.data;
  const langName = (code) => $("setLang")?.querySelector(`option[value="${code}"]`)?.textContent || code;
  const langNote = !w.langFallback ? ""
    : w.factsOnly
      ? `<p class="dim" style="font-size:11.5px;margin-top:10px">No ${esc(langName(settings.lang))} description exists yet — showing the English one. Catalog facts below are language-neutral.</p>`
      : `<p class="dim" style="font-size:11.5px;margin-top:10px">No ${esc(langName(settings.lang))} edition of this article exists yet — showing the ${esc(langName(w.lang))} one.</p>`;
  body.innerHTML = `
    ${w.thumb ? `<img class="wiki-thumb" src="${esc(w.thumb)}" alt="">` : ""}
    <div class="wiki-head">
      <span class="wiki-title">${esc(w.title)}</span>
      ${w.description ? `<span class="wiki-desc">${esc(w.description)}</span>` : ""}
    </div>
    ${w.extract ? `<p class="wiki-extract">${esc(w.extract)}</p>` : ""}
    ${w.facts?.length ? `<dl class="kv" style="margin-top:14px">${w.facts.map((f) =>
      `<dt>${esc(f.label)}</dt><dd${f.mono ? ' class="mono"' : ""}>${esc(factVal(f))}</dd>`).join("")}</dl>` : ""}
    ${langNote}
    <div class="wiki-foot">
      <span class="tag" title="How this information was verified as the right match">verified via ${esc(w.via)}</span>
      <a class="ghost wiki-go" href="${esc(w.url)}" target="_blank" rel="noopener">${w.urlLabel ? `Open on ${esc(w.urlLabel)}` : "Read on Wikipedia"} ↗</a>
    </div>`;
}

/* catalog fact values localized in the browser — native Intl formatting for
   the settings language, never machine translation */
export function factVal(f) {
  const lang = settings.lang;
  try {
    if (f.kind === "date") return new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(new Date(f.value + "T00:00:00Z"));
    if (f.kind === "owner") {
      if (f.iso) {
        const n = new Intl.DisplayNames([lang], { type: "region" }).of(f.iso);
        if (n && n !== f.iso) return `${n} (${f.value})`;
      }
      return f.value;
    }
    if (f.kind === "minutes") return `${Number(f.value).toLocaleString(lang)} min`;
    if (f.kind === "degrees") return `${Number(f.value).toLocaleString(lang)}°`;
    if (f.kind === "km") return distKm(Number(f.value));
  } catch { /* raw value still beats nothing */ }
  return String(f.value);
}

export function isWikiOpen() { return !$("wikiView").hidden; }

export function closeWikiPop() {
  if ($("wikiView").hidden) return;
  $("wikiView").hidden = true;
  if (wikiReturnView) $(wikiReturnView).hidden = false;
}

/* the ".wiki-peek" buttons a rendered fragment contains */
export function bindWikiPeeks(mount) {
  mount.querySelectorAll(".wiki-peek").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.preventDefault(); openWikiPop(btn.dataset); }));
}

export function initWiki() {
  $("wikiClose").addEventListener("click", closeWikiPop);
}
