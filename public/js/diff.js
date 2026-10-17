/**
 * Snapshot diff
 * -------------
 * Saved places keep immutable snapshot timelines; this makes the change
 * visible. Pure client-side comparison of two stored reports: slow-moving
 * data (settlements, infra, landmarks, people, devices, seismicity) is the
 * signal; weather/AQI are shown separately since they always differ.
 *
 * The same engine contrasts two DIFFERENT places (the Saved tab's Compare):
 * the "moment-in-time" split still reads sensibly — it just means "these two
 * areas happen to differ in weather/AQI" rather than "this area changed".
 *
 * diffReports is pure and unit-tested; the two render functions wrap it.
 */
import { esc, tempStr, fmtWhen, fmtLat, fmtLon, distMi } from "./format.js";
import { tInfra } from "./settings.js";
import { SURV_CATS } from "./report-model.js";

const fmtN = (v) => (v == null ? "—" : v.toLocaleString());
const delta = (x, y) => {
  const d = y - x;
  return `${fmtN(x)} → ${fmtN(y)} (${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString()})`;
};
const quakeId = (q) => `${q.date}|${q.mag}`;

/* -> [{ title, rows: [{ s: "+"|"−"|"Δ", t }], dim? }] */
export function diffReports(a, b) {
  const out = [];
  const section = (title, rows, dim = false) => { if (rows.length) out.push(dim ? { title, rows, dim } : { title, rows }); };

  if ((a.estimatedPopulation || b.estimatedPopulation) && a.estimatedPopulation !== b.estimatedPopulation) {
    section("Population estimate", [{ s: "Δ", t: delta(a.estimatedPopulation || 0, b.estimatedPopulation || 0) }]);
  }
  {
    const A = new Map((a.settlements || []).map((s) => [s.name, s]));
    const B = new Map((b.settlements || []).map((s) => [s.name, s]));
    const rows = [];
    for (const [name, s] of B) if (!A.has(name)) rows.push({ s: "+", t: `${name} (${s.type})` });
    for (const [name, s] of A) if (!B.has(name)) rows.push({ s: "−", t: `${name} (${s.type})` });
    for (const [name, sB] of B) {
      const sA = A.get(name);
      if (sA && sA.population != null && sB.population != null && sA.population !== sB.population) {
        rows.push({ s: "Δ", t: `${name}: population ${delta(sA.population, sB.population)}` });
      }
    }
    section("Settlements", rows);
  }
  {
    const A = Object.fromEntries((a.infrastructure || []).map((c) => [c.label, c.count]));
    const rows = [];
    for (const c of b.infrastructure || []) {
      if (A[c.label] != null && c.count != null && A[c.label] !== c.count) {
        rows.push({ s: "Δ", t: `${tInfra(c.label)}: ${delta(A[c.label], c.count)}` });
      }
    }
    section("Infrastructure", rows);
  }
  {
    const rows = [];
    const ca = a.surveillance?.counts, cb = b.surveillance?.counts;
    if (ca && cb) for (const [k, label] of SURV_CATS) {
      if (ca[k] !== cb[k]) rows.push({ s: "Δ", t: `${label}: ${delta(ca[k], cb[k])}` });
    }
    section("Surveillance devices", rows);
  }
  {
    const A = new Set((a.landmarks || []).map((m) => m.title));
    const B = new Set((b.landmarks || []).map((m) => m.title));
    const rows = [];
    for (const t of B) if (!A.has(t)) rows.push({ s: "+", t });
    for (const t of A) if (!B.has(t)) rows.push({ s: "−", t });
    section("Landmarks", rows);
  }
  {
    const A = new Set((a.people || []).map((p) => p.name));
    const B = new Set((b.people || []).map((p) => p.name));
    const rows = [];
    for (const t of B) if (!A.has(t)) rows.push({ s: "+", t });
    for (const t of A) if (!B.has(t)) rows.push({ s: "−", t });
    section("Notable people", rows);
  }
  if (a.quakes && b.quakes) {
    const rows = [];
    if (a.quakes.count !== b.quakes.count) rows.push({ s: "Δ", t: `M2.5+ quakes in the 10-year window: ${delta(a.quakes.count, b.quakes.count)}` });
    if (a.quakes.largest && b.quakes.largest && quakeId(a.quakes.largest) !== quakeId(b.quakes.largest)) {
      rows.push({ s: "Δ", t: `Largest recorded: M${a.quakes.largest.mag} (${a.quakes.largest.date}) → M${b.quakes.largest.mag} (${b.quakes.largest.date})` });
    }
    section("Seismicity", rows);
  }
  {
    const rows = [];
    const ta = a.weather?.current?.temperature_2m, tb = b.weather?.current?.temperature_2m;
    if (ta != null && tb != null) rows.push({ s: "Δ", t: `Temperature: ${tempStr(ta)} → ${tempStr(tb)}` });
    const qa = a.air?.us_aqi, qb = b.air?.us_aqi;
    if (qa != null && qb != null) rows.push({ s: "Δ", t: `US AQI: ${qa} → ${qb}` });
    section("Moment-in-time readings (expected to differ)", rows, true);
  }
  return out;
}

function sectionsHtml(secs) {
  return secs.map((s) =>
    `<div class="diff-sec${s.dim ? " diff-dim" : ""}"><h4>${esc(s.title)}</h4>` +
    s.rows.map((r) =>
      `<div class="diff-row"><span class="diff-sign ${r.s === "+" ? "add" : r.s === "−" ? "del" : "chg"}">${r.s}</span>${esc(r.t)}</div>`).join("") +
    `</div>`).join("");
}

/* one place at two moments */
export function renderDiffHtml(older, newer) {
  const secs = diffReports(older.report, newer.report);
  const days = Math.round(((new Date(newer.takenAt) - new Date(older.takenAt)) / 86400000) * 10) / 10;
  let html = `<p class="snap-banner">Δ comparing ${esc(fmtWhen(older.takenAt))} → ${esc(fmtWhen(newer.takenAt))} (${days} day${days === 1 ? "" : "s"} apart)</p>`;
  if (!secs.some((s) => !s.dim)) {
    html += `<p class="dim" style="margin:10px 0">No changes in the slow-moving data between these two snapshots.</p>`;
  }
  return html + sectionsHtml(secs);
}

/* two different places; `a`/`b` are {label, lat, lon, radiusMi, report} */
export function renderCompareHtml(a, b) {
  const secs = diffReports(a.report, b.report);
  const head = (x) => `${esc(x.label)} <span class="dim">(${fmtLat(x.lat)} ${fmtLon(x.lon)} · ${distMi(x.radiusMi)})</span>`;
  let html = `<p class="snap-banner">Comparing <strong>Area A</strong> ${head(a)} &nbsp;vs&nbsp; <strong>Area B</strong> ${head(b)}</p>`;
  if (!secs.some((s) => !s.dim)) {
    html += `<p class="dim" style="margin:10px 0">No differences in the slow-moving data between these two areas.</p>`;
  }
  // signs read left→right: + present only in B, − present only in A, Δ A→B
  html += sectionsHtml(secs);
  html += `<p class="dim" style="font-size:11.5px;margin-top:12px">+ only in Area B · − only in Area A · Δ value differs (A → B). Because the two areas have different locations and radii, expect large differences — this is a side-by-side, not a change log.</p>`;
  return html;
}
