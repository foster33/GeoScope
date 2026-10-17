/**
 * Report rendering
 * ----------------
 * Turns a report object into the panel's HTML: header, summary, the live
 * source status board, action buttons, and one collapsible section per
 * topic. The same function renders the live analysis (saveable: true, with
 * the status board, actions and the client-computed flyovers) and a stored
 * snapshot (saveable: false).
 *
 * Sections are collapsed by default so the report reads as a scannable
 * index; the set the user opened survives live re-renders in rep._open.
 * Requests that need the analysis owner (retry a source, clear the report)
 * go out as events so this module stays free of that dependency.
 */
import { $ } from "./dom.js";
import { api } from "./api.js";
import { settings, tInfra, localized } from "./settings.js";
import {
  MI_TO_KM, esc, num, F, tempStr, distKm, distMi, distUnit, distCell, areaStr, windStr,
  fmtHM, fmtLat, fmtLon, wmo, aqiInfo, placeTitle, flagEmoji, dstInfo, utcOffStr,
} from "./format.js";
import { SOURCES, SOURCE_LABELS, SURV_CATS, serializableReport } from "./report-model.js";
import { emit } from "./events.js";
import { tickClocks } from "./clocks.js";
import { pinpointOnGlobe } from "./highlights.js";
import { bindPlotControls } from "./plots.js";
import { bindWikiPeeks } from "./wiki.js";
import { flyoversBody, flyCompute } from "./flyovers.js";
import { refreshSavedCount, refreshWatchBadge } from "./badges.js";
import { fullPermalink } from "./permalink.js";

const NOTE = `class="dim" style="font-size:11.5px;margin-top:10px"`;
const loadingRow = `<p class="dim sect-loading"><span class="dot"></span> loading…</p>`;

/* collapsible report section — collapsed by default so the report reads as a
   scannable index; open state survives live re-renders via rep._open */
function sec(rep, key, titleHtml, bodyHtml, loading = false) {
  const open = rep._open instanceof Set && rep._open.has(key) ? " open" : "";
  return `<details class="block" data-sec="${key}"${open}>
    <summary><h3>${titleHtml}${loading ? ' <span class="dot"></span>' : ""}</h3></summary>
    ${bodyHtml}
  </details>`;
}

/* ------------------------------------------------------------ sections */

function headerHtml(rep, saveable, pend) {
  const l = rep.location || {};
  const hierarchy = [l.locality, l.county, l.state, l.country].filter(Boolean).join(" · ");
  return `
    <div class="r-head">
      ${saveable ? `<button id="clearReportBtn" class="r-clear" title="Clear this report and the circle" aria-label="Clear this report and the circle">✕</button>` : ""}
      <div class="r-place">${pend("geocode") ? "Locating…" : esc(placeTitle(rep))}</div>
      <div class="r-context">${esc(hierarchy || l.displayName || "")}</div>
      <div class="r-coords mono">${fmtLat(rep.lat)} &nbsp; ${fmtLon(rep.lon)} &nbsp; · &nbsp; ${distMi(rep.radiusMi, 1)} radius</div>
    </div>`;
}

/* live source status board (only on the active analysis, not saved entries) */
function statusBoardHtml(rep) {
  const allDone = !rep.pending?.size;
  const failures = SOURCES.filter((s) => rep.sourceStatus[s].state === "failed");
  const doneCount = SOURCES.filter((s) => rep.sourceStatus[s].state === "done").length;
  const open = rep._open instanceof Set && rep._open.has("sources") ? " open" : "";
  let html = `<details class="status-board${allDone && !failures.length ? " all-good" : ""}${allDone ? "" : " working"}" data-sec="sources"${open}>
      <summary><h3>Data sources <span class="n${allDone && !failures.length ? " ok" : ""}">${doneCount}/${SOURCES.length}</span>
        ${allDone
          ? (failures.length ? `<span class="n">· ${failures.length} failed</span>` : `<span class="n ok">· all reported</span>`)
          : `<span class="working-note"><span class="dot"></span> gathering…</span>`}
      </h3></summary>`;
  for (const src of SOURCES) {
    const st = rep.sourceStatus[src];
    let stateHtml;
    if (st.state === "queued") {
      stateHtml = `<span class="st dim">queued${st.note ? ` — ${esc(st.note)}` : ""}</span>`;
    } else if (st.state === "fetching") {
      const secs = ((performance.now() - st.started) / 1000).toFixed(1);
      stateHtml = `<span class="st fetching"><span class="dot"></span> fetching… ${secs}s</span>`;
    } else if (st.state === "done") {
      stateHtml = `<span class="st ok">✓ ${(st.ms / 1000).toFixed(1)}s</span>`;
    } else {
      stateHtml = `<span class="st fail">✕ ${esc(st.error || "failed")}</span> <button class="mini retry-btn" data-src="${src}">Retry</button>`;
    }
    html += `<div class="status-row"><span class="src-name">${esc(SOURCE_LABELS[src])}</span>${stateHtml}</div>`;
  }
  return html + `</details>`;
}

function actionsHtml(rep) {
  const ready = !rep.pending?.size;
  return `<div class="actions">
      <button id="saveBtn" class="ghost" ${ready ? "" : "disabled"} title="Adds an immutable snapshot to this exact spot's timeline in Saved lookups">${ready ? "Save snapshot" : "Gathering data…"}</button>
      <button id="watchBtn" class="ghost" ${ready ? "" : "disabled"} title="Re-check this area on a schedule and log what changes">${ready ? "Watch this area" : "…"}</button>
      <button id="copyLinkBtn" class="ghost" title="Copy a shareable link to this exact spot and radius">🔗 Copy link</button>
    </div>`;
}

/* Languages row in Location & terrain — the country's official language(s),
   from the same dataset as the currency row. */
function languageRowHtml(l) {
  const langs = l.languages || null;
  if (!langs?.length) return "";
  return `<dt>Languages</dt><dd>${esc(langs.join(", "))} <span class="dim">(official · ${esc(l.country || "country")})</span></dd>`;
}

function locationHtml(rep, pend) {
  const l = rep.location || {};
  const w = rep.weather;
  const flag = flagEmoji(l.countryCode);
  return sec(rep, "location", "Location & terrain", `
      <dl class="kv">
        <dt>Full address match</dt><dd style="font-family:var(--font-body)">${esc(l.displayName || "—")}</dd>
        <dt>Country</dt><dd>${flag ? flag + " " : ""}${esc(l.country || "—")}${l.countryCode ? ` (${esc(l.countryCode)})` : ""}</dd>
        ${l.currency ? `<dt>Currency</dt><dd>${esc(l.currency.name || l.currency.code)} (${esc(l.currency.code)}${l.currency.symbol && l.currency.symbol !== l.currency.code ? ` · ${esc(l.currency.symbol)}` : ""})${l.currency.perUsd ? `<span class="dim"> · 1 USD ≈ ${l.currency.perUsd} ${esc(l.currency.code)}</span>` : ""}</dd>` : ""}
        ${languageRowHtml(l)}
        <dt>State / region</dt><dd>${esc(l.state || "—")}</dd>
        <dt>County / district</dt><dd>${esc(l.county || "—")}</dd>
        <dt>Latitude</dt><dd>${rep.lat.toFixed(6)}°</dd>
        <dt>Longitude</dt><dd>${rep.lon.toFixed(6)}°</dd>
        <dt>Elevation (center)</dt><dd>${rep.elevationM != null ? `${Math.round(rep.elevationM)} m / ${Math.round(rep.elevationM * 3.281)} ft` : "—"}</dd>
        <dt>Time zone</dt><dd>${esc(w?.timezone || "—")}</dd>
      </dl>`, pend("geocode"));
}

/* local-time block: live clocks driven by tickClocks(); DST derived from the
   IANA zone, so it stays correct as the report ages */
function timeBlock(tz, rep) {
  if (!tz) return "";
  let info;
  try { info = dstInfo(tz); } catch { return ""; }
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dst = !info.observed
    ? "Not observed in this zone"
    : info.active
      ? `In effect — clocks are forward (standard time is ${utcOffStr(info.stdMin)})`
      : `Not currently in effect (standard time ${utcOffStr(info.stdMin)})`;
  return sec(rep, "time", `Local time <span class="n" data-tz-clock="${esc(tz)}"></span>`, `
    <div class="clock-row">
      <span class="clock-big mono" data-tz-clock="${esc(tz)}"></span>
      <span class="clock-zone">${esc(tz)}${info.abbr ? ` (${esc(info.abbr)})` : ""}</span>
    </div>
    <dl class="kv">
      <dt>UTC offset</dt><dd>${utcOffStr(info.offsetMin)}</dd>
      <dt>Daylight saving</dt><dd style="font-family:var(--font-body)">${dst}</dd>
      <dt>GMT / UTC now</dt><dd data-tz-clock="UTC"></dd>
      <dt>Your local time</dt><dd data-tz-clock="${esc(userTz)}"></dd>
    </dl>`);
}

/* circle geometry & global position - computed, always instant */
function geometryHtml(rep) {
  const rMi = rep.radiusMi;
  const areaMi2 = Math.PI * rMi * rMi;
  const eqKm = Math.abs(rep.lat) * 111.32;
  const poleKm = (90 - Math.abs(rep.lat)) * 111.32;
  const antiLat = -rep.lat;
  const antiLon = rep.lon > 0 ? rep.lon - 180 : rep.lon + 180;
  const densityArea = settings.dist === "km" ? areaMi2 * MI_TO_KM * MI_TO_KM : areaMi2;
  const density = rep.estimatedPopulation ? Math.round(rep.estimatedPopulation / densityArea) : null;
  return sec(rep, "geometry", "Circle geometry & global position", `
      <dl class="kv">
        <dt>Circle area</dt><dd>${areaStr(areaMi2)}</dd>
        <dt>Circumference</dt><dd>${distMi(2 * Math.PI * rMi)}</dd>
        <dt>Pop. density (est.)</dt><dd>${density ? `~${density.toLocaleString()} / ${distUnit()}²` : "—"}</dd>
        <dt>Hemisphere</dt><dd>${rep.lat >= 0 ? "Northern" : "Southern"} · ${rep.lon >= 0 ? "Eastern" : "Western"}</dd>
        <dt>Distance to equator</dt><dd>${distKm(eqKm)}</dd>
        <dt>Distance to ${rep.lat >= 0 ? "North" : "South"} Pole</dt><dd>${distKm(poleKm)}</dd>
        <dt>Antipode</dt><dd>${fmtLat(antiLat)}, ${fmtLon(antiLon)}</dd>
      </dl>`);
}

const LEVEL_NAMES = { 6: "County / district", 7: "Municipality", 8: "City / municipality", 9: "District / borough", 10: "Neighborhood" };

function settlementsHtml(rep, pend) {
  const setts = rep.settlements || [];
  let encl = "";
  if (rep.enclosing?.length) {
    encl = `<dl class="kv" style="margin-bottom:14px">` + rep.enclosing.map((p) =>
      `<dt>${esc(LEVEL_NAMES[p.adminLevel] || "Inside")}</dt><dd>${esc(localized(p.name, p.localName))}${p.population ? ` · pop. ~${p.population.toLocaleString()}` : ""}</dd>`).join("") + `</dl>
      <p class="dim" style="font-size:11.5px;margin-bottom:14px">At this radius the circle can sit inside a town without containing its mapped center-point, so the places above are resolved by boundary containment — they hold the point itself, whatever the circle size.</p>`;
  }
  let body;
  if (pend("settlements")) {
    body = loadingRow;
  } else if (setts.length) {
    body = encl + `<dl class="kv" style="margin-bottom:14px">
        <dt>Est. population</dt><dd>${rep.estimatedPopulation ? "~" + num(rep.estimatedPopulation) : "no census tags found"}</dd>
      </dl>
      <table><thead><tr><th>Name</th><th>Type</th><th class="num">Population</th><th class="num">Dist (${distUnit()})</th></tr></thead><tbody>`;
    for (const s of setts.slice(0, 40)) {
      const disp = s.localName && s.localName !== s.name
        ? `${esc(s.localName)} <span class="dim">(${esc(s.name)})</span>`
        : esc(s.name);
      body += `<tr><td><button class="wiki-peek" title="Preview the Wikipedia article for ${esc(s.name)}"
          data-name="${esc(s.name)}" data-wikidata="${esc(s.wikidata || "")}" data-wikipedia="${esc(s.wikipedia || "")}"
          data-lat="${s.lat}" data-lon="${s.lon}">${disp}</button>
          <button class="pin-btn" title="Highlight ${esc(s.name)} on the globe" aria-label="Highlight ${esc(s.name)} on the globe"
          data-name="${esc(localized(s.name, s.localName))}" data-lat="${s.lat}" data-lon="${s.lon}">◎</button></td><td class="dim">${esc(s.type)}</td><td class="num">${num(s.population)}</td><td class="num">${distCell(s.distanceKm)}</td></tr>`;
    }
    body += `</tbody></table>`;
    if (setts.length > 40) body += `<p class="dim" style="font-size:12px;margin-top:8px">…and ${setts.length - 40} more.</p>`;
    body += `<p ${NOTE}>Population sums OpenStreetMap census tags for places inside the circle; settlements without a recorded figure are excluded, so treat it as a floor, not an exact count.</p>`;
  } else {
    body = encl + `<p class="dim">No settlement center-points inside this radius${rep.enclosing?.length ? " — but the place(s) above contain it" : ""}.</p>`;
  }
  return sec(rep, "settlements", `Settlements in the circle ${pend("settlements") ? "" : `<span class="n">${setts.length}</span>`}`, body, pend("settlements"));
}

function infrastructureHtml(rep, pend) {
  if (pend("infrastructure")) return sec(rep, "infrastructure", "Infrastructure in the circle", loadingRow, true);
  if (!rep.infrastructure?.length) return "";
  let chips = "";
  for (const c of rep.infrastructure) {
    const clickable = c.count != null && c.count > 0;
    chips += `<div class="chip${clickable ? " chip-click" : ""}"${clickable ? ` data-cat="${esc(c.label)}" title="Click to highlight all ${esc(c.label.toLowerCase())} on the globe" role="button" tabindex="0"` : ""}><span class="chip-n">${c.count == null ? "—" : c.count.toLocaleString()}</span><span class="chip-l">${esc(tInfra(c.label))}</span></div>`;
  }
  const infraMissing = rep.infrastructure.some((c) => c.count == null);
  return sec(rep, "infrastructure", "Infrastructure in the circle",
    `<div class="chip-grid">${chips}</div>
      <div style="margin-top:10px"><button class="mini infra-all-btn">◎ Plot all on globe</button></div>
      ${infraMissing ? `<p ${NOTE}>Categories showing “—” exceeded the map server's time budget — a big circle over a dense region is a huge scan. Retry the infrastructure source in Data sources to fill them, or use a smaller radius for a complete census.</p>` : ""}
      <p ${NOTE}>Counts of OpenStreetMap-mapped facilities inside the radius; coverage varies by region, so treat as minimums. Click a category to light up its points, or plot everything at once with per-category icons.</p>`);
}

function surveillanceHtml(rep, pend) {
  if (pend("surveillance")) return sec(rep, "surveillance", "Surveillance devices", loadingRow, true);
  const sv = rep.surveillance;
  if (!sv) return "";
  let sbody = `<div class="chip-grid">`;
  for (const [key, label] of SURV_CATS) {
    const clickable = sv.counts[key] > 0;
    sbody += `<div class="chip${clickable ? " chip-click" : ""}"${clickable ? ` data-survcat="${key}" title="Click to plot ${esc(label.toLowerCase())} on the globe" role="button" tabindex="0"` : ""}><span class="chip-n">${sv.counts[key].toLocaleString()}</span><span class="chip-l">${esc(label)}</span></div>`;
  }
  sbody += `</div>`;
  if (sv.total) {
    sbody += `<div style="margin-top:10px"><button class="mini surv-plot-btn">◎ Plot all positions on globe</button></div>`;
  }
  sbody += `<p ${NOTE}>Positions of publicly documented devices from OpenStreetMap — ALPR locations are largely crowdsourced by the <a href="https://deflock.me" target="_blank" rel="noopener">DeFlock</a> project. Coverage is volunteer-mapped and very uneven: an empty count means none <em>mapped</em>, not none present. Positions only — no feeds are accessed.</p>`;
  return sec(rep, "surveillance", `Surveillance devices <span class="n">${sv.total.toLocaleString()}${sv.counts.alpr ? ` · ${sv.counts.alpr} ALPR` : ""}</span>`, sbody);
}

function weatherHtml(rep, pend) {
  if (pend("weather")) return sec(rep, "weather", "Weather now", loadingRow, true);
  const w = rep.weather;
  const cw = w?.current;
  if (!cw) return "";
  const sun = w.daily?.sunrise?.[0]
    ? `sunrise ${fmtHM(w.daily.sunrise[0].slice(11))} · sunset ${fmtHM(w.daily.sunset[0].slice(11))} · ${(w.daily.daylight_duration[0] / 3600).toFixed(1)}h daylight · UV max ${w.daily.uv_index_max?.[0] ?? "—"}`
    : "";
  const bigTemp = settings.temp === "f" ? `${F(cw.temperature_2m)}°F` : `${cw.temperature_2m}°C`;
  const altTemp = settings.temp === "both" ? `${F(cw.temperature_2m)}°F · ` : "";
  let body = `<div class="wx-now">
        <span class="wx-temp">${bigTemp}</span>
        <span class="wx-desc">${esc(wmo(cw.weather_code))} · feels like ${tempStr(cw.apparent_temperature)}</span>
        <span class="wx-meta">${altTemp}humidity ${cw.relative_humidity_2m}% · wind ${windStr(cw.wind_speed_10m)} (gusts ${windStr(cw.wind_gusts_10m)}) · cloud ${cw.cloud_cover}% · pressure ${cw.pressure_msl ?? "—"} hPa · precip ${cw.precipitation} mm</span>
        ${sun ? `<span class="wx-meta">${esc(sun)}</span>` : ""}
      </div>`;
  if (w.daily?.time) {
    body += `<table><thead><tr><th>Next 7 days</th><th class="num">High</th><th class="num">Low</th><th class="num">Precip</th></tr></thead><tbody>`;
    w.daily.time.forEach((d, i) => {
      body += `<tr><td>${esc(d)} <span class="dim">${esc(wmo(w.daily.weather_code[i]))}</span></td>
          <td class="num">${tempStr(w.daily.temperature_2m_max[i])}</td>
          <td class="num">${tempStr(w.daily.temperature_2m_min[i])}</td>
          <td class="num">${w.daily.precipitation_sum[i]} mm</td></tr>`;
    });
    body += `</tbody></table>`;
  }
  return sec(rep, "weather", `Weather now <span class="n">${esc(`${bigTemp.replace("°C", "°").replace("°F", "°")} ${wmo(cw.weather_code)}`)}</span>`, body);
}

function airHtml(rep, pend) {
  if (pend("airquality")) return sec(rep, "air", "Air quality now", loadingRow, true);
  if (rep.air?.us_aqi == null) return "";
  const aqi = rep.air.us_aqi;
  const { band, color } = aqiInfo(aqi);
  return sec(rep, "air", `Air quality now <span class="n" style="color:${color}">${aqi} ${band}</span>`, `
      <div class="wx-now">
        <span class="wx-temp" style="color:${color}">${aqi}</span>
        <span class="wx-desc">${band} <span class="dim">(US AQI)</span>${rep.air.european_aqi != null ? ` · European AQI ${rep.air.european_aqi}` : ""}</span>
        <span class="wx-meta">PM2.5 ${rep.air.pm2_5 ?? "—"} · PM10 ${rep.air.pm10 ?? "—"} · O₃ ${rep.air.ozone ?? "—"} · NO₂ ${rep.air.nitrogen_dioxide ?? "—"} · SO₂ ${rep.air.sulphur_dioxide ?? "—"} · CO ${rep.air.carbon_monoxide ?? "—"} µg/m³</span>
      </div>`);
}

/* small SVG chart: temp lines + precip bars */
export function histChart(months) {
  const W = 480, H = 150, P = 26;
  const temps = months.flatMap((m) => [m.avgHighC, m.avgLowC]).filter((v) => v != null);
  if (!temps.length) return ""; // nothing to scale the axis by
  const tMin = Math.min(...temps) - 2, tMax = Math.max(...temps) + 2;
  const pMax = Math.max(...months.map((m) => m.precipMm), 1);
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(months.length - 1, 1);
  const yT = (t) => H - P - ((t - tMin) / (tMax - tMin)) * (H - 2 * P);
  const yP = (p) => ((p / pMax) * (H - 2 * P));

  const line = (key, color) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2" points="${months.map((m, i) => `${x(i)},${yT(m[key])}`).join(" ")}"/>`;
  const bars = months.map((m, i) =>
    `<rect x="${x(i) - 5}" y="${H - P - yP(m.precipMm)}" width="10" height="${yP(m.precipMm)}" fill="#4fc4a8" opacity="0.35"/>`).join("");
  const labels = months.map((m, i) =>
    i % 2 === 0 ? `<text x="${x(i)}" y="${H - 6}" font-size="8.5" fill="#8ca1c2" text-anchor="middle" font-family="IBM Plex Mono">${m.month.slice(2)}</text>` : "").join("");

  return `<svg class="hist-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly average temperatures and precipitation">
    ${bars}${line("avgHighC", "#d9a441")}${line("avgLowC", "#4a6fa5")}${labels}
  </svg>`;
}

function historyHtml(rep, pend) {
  if (pend("history")) return sec(rep, "history", "Weather history — last 12 months", loadingRow, true);
  const months = rep.history?.months || [];
  if (!months.length) return "";
  let hbody = `${histChart(months)}
      <div class="legend">
        <span><span class="sw" style="background:#d9a441"></span>avg high</span>
        <span><span class="sw" style="background:#4a6fa5"></span>avg low</span>
        <span><span class="sw" style="background:#4fc4a8"></span>precip mm</span>
      </div>
      <table><thead><tr><th>Month</th><th class="num">Avg high</th><th class="num">Avg low</th><th class="num">Precip</th></tr></thead><tbody>`;
  for (const m of months) {
    hbody += `<tr><td>${esc(m.month)}</td><td class="num">${tempStr(m.avgHighC)}</td><td class="num">${tempStr(m.avgLowC)}</td><td class="num">${m.precipMm} mm</td></tr>`;
  }
  hbody += `</tbody></table>`;
  const ex = rep.history?.extremes;
  if (ex) {
    hbody += `<dl class="kv" style="margin-top:14px">
        ${ex.hottest ? `<dt>Hottest day</dt><dd>${tempStr(ex.hottest.tempC)} on ${esc(ex.hottest.date)}</dd>` : ""}
        ${ex.coldest ? `<dt>Coldest day</dt><dd>${tempStr(ex.coldest.tempC)} on ${esc(ex.coldest.date)}</dd>` : ""}
        ${ex.wettest ? `<dt>Wettest day</dt><dd>${ex.wettest.precipMm} mm on ${esc(ex.wettest.date)}</dd>` : ""}
        <dt>Days ≥ ${tempStr(30)}</dt><dd>${ex.daysOver30}</dd>
        <dt>Days ≤ ${tempStr(0)}</dt><dd>${ex.daysBelow0}</dd>
        <dt>Total precipitation</dt><dd>${ex.totalPrecipMm.toLocaleString()} mm</dd>
      </dl>`;
  }
  return sec(rep, "history", "Weather history — last 12 months", hbody);
}

function quakesHtml(rep, pend) {
  if (pend("earthquakes")) return sec(rep, "quakes", "Seismic activity — past 10 years", loadingRow, true);
  const q = rep.quakes;
  if (!q) return "";
  let qbody = "";
  if (q.count) {
    qbody += `<dl class="kv" style="margin-bottom:12px">
        <dt>M2.5+ quakes</dt><dd>${q.count.toLocaleString()}</dd>
        ${q.largest ? `<dt>Largest</dt><dd>M${q.largest.mag} · ${esc(q.largest.place || "")} · ${esc(q.largest.date)} · ${q.largest.depthKm} km deep</dd>` : ""}
      </dl>`;
    if (q.recent?.length) {
      qbody += `<table><thead><tr><th>Most recent</th><th class="num">Mag</th><th class="num">Depth</th></tr></thead><tbody>`;
      for (const e of q.recent) {
        qbody += `<tr><td>${esc(e.date)} <span class="dim">${esc(e.place || "")}</span></td><td class="num">M${e.mag}</td><td class="num">${e.depthKm} km</td></tr>`;
      }
      qbody += `</tbody></table>`;
    }
  } else {
    qbody = `<p class="dim">No M2.5+ earthquakes recorded by USGS within this radius in the past decade — seismically quiet.</p>`;
  }
  return sec(rep, "quakes", `Seismic activity — past 10 years <span class="n">${q.count.toLocaleString()}</span>`, qbody);
}

function newsHtml(rep, pend) {
  if (pend("news") || rep.sourceStatus?.news?.state === "queued") return sec(rep, "news", "Recent news", loadingRow, true);
  if (!rep.news) return "";
  let nbody = "";
  if (rep.news.length) {
    for (const n of rep.news) {
      nbody += `<div class="person">
          <span class="who"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a></span>
          <div class="meta">${n.source ? esc(n.source) + " · " : ""}${n.pubDate ? esc(n.pubDate.slice(0, 10)) + " · " : ""}<span class="tag">matched: ${esc(n.matched)}</span></div>
        </div>`;
    }
    nbody += `<p ${NOTE}>News can't be searched by coordinates, so headlines are matched against the place names verified by this point's geocode — each query requires the locality and its state/country together, which screens out same-named places elsewhere. The “matched” tag shows which verified place pair found each story.</p>`;
  } else {
    nbody = `<p class="dim">No recent headlines found for the verified place names in this circle.</p>`;
  }
  return sec(rep, "news", `Recent news <span class="n">${rep.news.length}</span>`, nbody);
}

function peopleHtml(rep, pend) {
  const people = rep.people || [];
  let pbody;
  if (pend("people")) {
    pbody = loadingRow;
  } else if (people.length) {
    pbody = "";
    for (const p of people) {
      pbody += `<div class="person">
          <span class="who"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a></span>
          <div class="meta">${esc(p.occupations?.join(", ") || "")}${p.born ? ` · b. ${esc(p.born)}` : ""}${p.birthplace ? ` · ${esc(p.birthplace)}` : ""}</div>
        </div>`;
    }
    pbody += `<p ${NOTE}>From Wikidata: people whose recorded birthplace lies within the circle, ranked by worldwide Wikipedia coverage.${rep.radiusMi * MI_TO_KM < 10 ? " Birthplace coordinates resolve to town centers, so below ~6 mi the scan uses a 10 km floor — these people were born in or around the towns at this point." : ""}</p>`;
  } else {
    pbody = `<p class="dim">No notable births recorded inside this radius.</p>`;
  }
  return sec(rep, "people", `Notable people born in this circle ${pend("people") ? "" : `<span class="n">${people.length}</span>`}`, pbody, pend("people"));
}

function landmarksHtml(rep, pend) {
  if (pend("landmarks")) return sec(rep, "landmarks", "Landmarks & points of interest", loadingRow, true);
  const marks = rep.landmarks || [];
  if (!marks.length) return "";
  let mbody = `<table><thead><tr><th>Wikipedia entry</th><th class="num">Dist (${distUnit()})</th></tr></thead><tbody>`;
  for (const m of marks) {
    const pin = m.lat != null
      ? ` <button class="pin-btn" title="Highlight ${esc(m.title)} on the globe" aria-label="Highlight ${esc(m.title)} on the globe" data-name="${esc(m.title)}" data-lat="${m.lat}" data-lon="${m.lon}">◎</button>`
      : "";
    mbody += `<tr><td><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>${pin}</td><td class="num">${distCell(m.distanceKm)}</td></tr>`;
  }
  mbody += `</tbody></table>
      <p ${NOTE}>${rep.radiusKm > 10
        ? "Across the whole circle: the most globally notable places (Wikidata, ranked by Wikipedia coverage), with towns excluded since they're listed above."
        : "Wikipedia geosearch, every geotagged article within the circle."}</p>`;
  return sec(rep, "landmarks", `Landmarks & points of interest <span class="n">${marks.length}</span>`, mbody);
}

/* ------------------------------------------------------------- render */

export function renderReport(rep, mount, { saveable }) {
  const pend = (src) => !!rep.pending?.has(src);

  let html = headerHtml(rep, saveable, pend);
  if (rep.summary) {
    html += `<p class="summary">${esc(rep.summary)}</p>`;
  } else if (rep.pending?.size) {
    html += `<p class="summary dim">Summary will appear once all sources report in…</p>`;
  }
  if (saveable && rep.sourceStatus) html += statusBoardHtml(rep);
  if (saveable) html += actionsHtml(rep);
  html += `<div class="sec-tools">
    <button class="mini" data-secall="open">Expand all sections</button>
    <button class="mini" data-secall="close">Collapse all</button>
  </div>`;
  html += locationHtml(rep, pend);
  html += timeBlock(rep.weather?.timezone, rep);
  html += geometryHtml(rep);
  html += settlementsHtml(rep, pend);
  html += infrastructureHtml(rep, pend);
  html += surveillanceHtml(rep, pend);
  html += weatherHtml(rep, pend);
  html += airHtml(rep, pend);
  html += historyHtml(rep, pend);
  html += quakesHtml(rep, pend);
  html += newsHtml(rep, pend);
  html += peopleHtml(rep, pend);
  html += landmarksHtml(rep, pend);
  // satellite flyovers — client-computed, so only on the live report (it's about
  // the future, not a historical snapshot); lazily computed when expanded
  if (saveable) {
    const n = rep._fly?.state === "done" ? ` <span class="n">${rep._fly.shown.length}</span>` : "";
    html += sec(rep, "flyovers", `Satellite flyovers${n}`, flyoversBody(rep));
  }
  if (rep.sourceErrors?.length) {
    html += `<p class="errors">Some sources didn't respond this time: ${rep.sourceErrors.join(", ")}. Re-run the analysis to retry.</p>`;
  }

  mount.innerHTML = html;
  tickClocks();
  bindSections(rep, mount);
  bindWikiPeeks(mount);
  bindPlotControls(mount, rep);
  mount.querySelectorAll(".pin-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      pinpointOnGlobe(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon), btn.dataset.name);
    }));
  if (saveable) bindLiveActions(rep, mount);
}

/* remember which sections the user opened, across live re-renders */
function bindSections(rep, mount) {
  mount.querySelectorAll("details[data-sec]").forEach((d) => d.addEventListener("toggle", () => {
    if (!(rep._open instanceof Set)) rep._open = new Set();
    if (d.open) rep._open.add(d.dataset.sec); else rep._open.delete(d.dataset.sec);
    if (d.open && d.dataset.sec === "flyovers" && !rep._fly) flyCompute(rep); // compute on first expand
  }));
  mount.querySelectorAll("[data-secall]").forEach((b) => b.addEventListener("click", () => {
    const open = b.dataset.secall === "open";
    mount.querySelectorAll("details[data-sec]").forEach((d) => { d.open = open; });
  }));
}

/* buttons that exist only on the live report */
function bindLiveActions(rep, mount) {
  mount.querySelector("#clearReportBtn")?.addEventListener("click", () => emit("report:clear"));
  mount.querySelectorAll(".retry-btn").forEach((btn) =>
    btn.addEventListener("click", () => emit("report:retry", { rep, src: btn.dataset.src })));
  mount.querySelector("#flyComputeBtn")?.addEventListener("click", () => flyCompute(rep));

  // shareable permalink: copies the full URL for this report's exact spot and
  // radius (read from the report, not the live slider), matching the RSS copy UX
  const linkBtn = mount.querySelector("#copyLinkBtn");
  if (linkBtn) linkBtn.addEventListener("click", async () => {
    const url = fullPermalink(rep.lat, rep.lon, rep.radiusMi);
    try { await navigator.clipboard.writeText(url); linkBtn.textContent = "Copied ✓"; }
    catch { prompt("Shareable link:", url); }
    setTimeout(() => { linkBtn.textContent = "🔗 Copy link"; }, 2000);
  });

  const saveBtn = mount.querySelector("#saveBtn");
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const j = await api.post("/api/history", { report: serializableReport(rep) });
      saveBtn.textContent = j.created ? "Saved ✓" : `Snapshot ${j.snapshots ?? ""} added ✓`;
      saveBtn.classList.add("saved");
      refreshSavedCount();
    } catch {
      saveBtn.textContent = "Save failed — retry";
      saveBtn.disabled = false;
    }
  });

  const watchBtn = mount.querySelector("#watchBtn");
  if (watchBtn && !watchBtn.disabled) watchBtn.addEventListener("click", async () => {
    watchBtn.disabled = true;
    watchBtn.textContent = "Adding…";
    const loc = rep.location || {};
    const extra = (rep.settlements || []).map((s) => s.name)
      .filter((n) => n && n !== loc.locality).slice(0, 2).join("|");
    try {
      await api.post("/api/watches", {
        lat: rep.lat, lon: rep.lon, radiusMi: rep.radiusMi, label: placeTitle(rep),
        place: { locality: loc.locality, county: loc.county, state: loc.state, country: loc.country, extra, displayName: loc.displayName },
      });
      watchBtn.textContent = "Watching ✓";
      watchBtn.classList.add("saved");
      refreshWatchBadge();
    } catch (e) {
      watchBtn.textContent = "Watch failed — retry";
      watchBtn.title = e.message || "";
      watchBtn.disabled = false;
    }
  });
}
