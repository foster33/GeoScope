/**
 * The live analysis
 * -----------------
 * Owns the Explore report from "Analyze this area" to "report complete":
 * creates the report object, fans every source out in parallel through
 * /api/part/:src, renders each section as its source answers, chains the
 * sources that depend on another (news waits for the geocode), and asks the
 * server for the summary paragraph once everything is in.
 *
 * Every render and finalize path checks that the report is still the current
 * one, so in-flight fetches from a superseded analysis are orphaned safely.
 */
import { $ } from "./dom.js";
import { state } from "./state.js";
import { api, qs } from "./api.js";
import { settings } from "./settings.js";
import { radiusMi, clearSelection } from "./globe.js";
import { showTab } from "./tabs.js";
import { setStatus } from "./status.js";
import { writeLocationHash, clearLocationHash, parseLocationHash } from "./permalink.js";
import { goToPlace } from "./navigate.js";
import { clearTempHighlights } from "./highlights.js";
import { renderReport } from "./render.js";
import { on } from "./events.js";
import {
  SOURCES, SHORT, DEPENDS_ON, DEPENDENT_SOURCES, INITIAL_SOURCES, SOURCE_FIELD,
  newReport, serializableReport, sumPopulation,
} from "./report-model.js";

let statusTicker = null;

/* repaint the live report every half second while sources are in flight so
   the per-source timers tick */
function startTicker(rep) {
  clearInterval(statusTicker);
  statusTicker = setInterval(() => { if (rep.pending.size) renderLive(rep); }, 500);
}

export function startAnalysis() {
  if (!state.picked) return;
  showTab("explore");
  $("emptyState").hidden = true;

  const rep = newReport(state.picked.lat, state.picked.lng, radiusMi());
  state.currentReport = rep;

  // make this exact spot+radius linkable; reflects what's analyzed, not the
  // live slider, and is suppressed in the hashchange listener so it can't loop
  writeLocationHash(rep.lat, rep.lon, rep.radiusMi);

  startTicker(rep);
  Promise.allSettled(INITIAL_SOURCES.map((src) => fetchPart(rep, src)));
  renderLive(rep);
}

/* wipe the current Explore analysis: panel back to the empty state, circle
   and marker off the globe; in-flight fetches are orphaned safely because
   every render/finalize path checks the current report first */
export function clearExplore() {
  clearInterval(statusTicker);
  state.currentReport = null;
  $("report").hidden = true;
  $("report").innerHTML = "";
  $("emptyState").hidden = false;
  clearSelection();
  clearTempHighlights(); // plotted points belonged to this report; also resets the readout
  clearLocationHash();   // so a reload doesn't resurrect the report we just cleared
}

export function renderLive(rep) {
  if (state.currentReport !== rep) return; // superseded by a newer analysis
  renderReport(rep, $("report"), { saveable: true });
  $("report").hidden = false;
  const done = SOURCES.length - rep.pending.size;
  setStatus(rep.pending.size
    ? `gathering ${done}/${SOURCES.length} — waiting on ${[...rep.pending].map((s) => SHORT[s]).join(", ")}`
    : "report complete");
}

/* the query string for one source; news also carries the verified place names */
function partQuery(rep, src) {
  const q = { lat: rep.lat, lon: rep.lon, radius_mi: rep.radiusMi, lang: settings.lang };
  if (src === "news") {
    const l = rep.location || {};
    if (l.ocean || (!l.locality && !l.county && !l.state && !l.country)) {
      throw new Error("No verified place names here to search news for.");
    }
    Object.assign(q, {
      locality: l.locality || "", county: l.county || "", state: l.state || "", country: l.country || "",
      extra: (rep.settlements || []).map((s) => s.name).filter((n) => n && n !== l.locality).slice(0, 2).join("|"),
    });
  }
  return qs(q);
}

function storePart(rep, src, data) {
  if (src === "settlements") {
    // new shape is {list, enclosing}; saved reports from older versions are bare arrays
    rep.settlements = Array.isArray(data) ? data : data.list;
    rep.enclosing = Array.isArray(data) ? null : data.enclosing;
  } else {
    rep[SOURCE_FIELD[src]] = data;
  }
}

export async function fetchPart(rep, src) {
  const st = rep.sourceStatus[src];
  st.state = "fetching"; st.started = performance.now(); st.error = null; st.note = null;
  rep.pending.add(src);
  renderLive(rep);
  try {
    const j = await api.get(`/api/part/${src}?${partQuery(rep, src)}`);
    storePart(rep, src, j.data);
    st.state = "done";
  } catch (e) {
    st.state = "failed";
    st.error = e.message;
  } finally {
    st.ms = Math.round(performance.now() - st.started);
    rep.pending.delete(src);
    // chain: launch any dependent source now that the one it waits on finished
    for (const dep of DEPENDENT_SOURCES) {
      if (DEPENDS_ON[dep] !== src || rep.sourceStatus[dep]?.state !== "queued") continue;
      if (st.state === "done") fetchPart(rep, dep);
      else rep.sourceStatus[dep] = { state: "failed", error: `Skipped — ${SHORT[src]} failed.`, ms: 0 };
    }
    renderLive(rep);
    if (!rep.pending.size) finalize(rep);
  }
}

async function finalize(rep) {
  if (state.currentReport !== rep || rep.pending.size || rep.finalized) return;
  if (DEPENDENT_SOURCES.some((s) => rep.sourceStatus[s]?.state === "queued")) return; // a prerequisite still running
  rep.finalized = true;
  clearInterval(statusTicker);
  rep.sourceErrors = SOURCES.filter((s) => rep.sourceStatus[s].state === "failed").map((s) => SHORT[s]);
  rep.estimatedPopulation = sumPopulation(rep.settlements);
  try {
    const j = await api.post("/api/summary", { report: serializableReport(rep) });
    rep.summary = j.summary;
  } catch { /* summary box keeps fallback text */ }
  renderLive(rep);
}

/* a source retried from the status board: the report is open again until it answers */
async function retryPart({ rep, src }) {
  rep.finalized = false;
  if (state.currentReport === rep) startTicker(rep);
  await fetchPart(rep, src);
}

/* localized settlement names come from the server per language, so a language
   change refreshes that one section of the live report */
export function refetchSettlements() {
  const rep = state.currentReport;
  if (rep && !rep.pending?.size) fetchPart(rep, "settlements");
}

/* run the analysis described by a hash; shared by initial load and hashchange */
export function analyzeFromHash(hash) {
  const loc = parseLocationHash(hash);
  if (!loc) return; // malformed or absent — ignore silently
  goToPlace(loc.lat, loc.lon, loc.radius);
  startAnalysis();
}

export function initAnalyze() {
  $("analyzeBtn").addEventListener("click", startAnalysis);
  on("report:retry", retryPart);
  on("report:clear", clearExplore);
  on("report:rerender", renderLive);
}
