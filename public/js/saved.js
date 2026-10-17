/**
 * Saved lookups tab
 * -----------------
 * Each saved place is an exact spot+radius with an immutable timeline of
 * snapshots. A card lists the timeline newest-first with View / Δ Diff per
 * snapshot, a whole-timeline diff, re-sampling (＋ New snapshot), and the
 * compare picker that contrasts two places side by side.
 */
import { $ } from "./dom.js";
import { api } from "./api.js";
import { esc, fmtWhen, fmtLat, fmtLon, distMi, rel } from "./format.js";
import { renderReport } from "./render.js";
import { renderDiffHtml, renderCompareHtml } from "./diff.js";
import { goToPlace } from "./navigate.js";
import { startAnalysis } from "./analyze.js";
import { setSavedCount, refreshSavedCount } from "./badges.js";

/* compare selection: place id -> place object, for the side-by-side feature.
   Cleared on every (re)load so it never references stale/deleted places. */
const compareSel = new Map();

export async function loadSaved() {
  const mount = $("savedList");
  mount.innerHTML = `<p class="dim">Loading…</p>`;
  let places;
  try { places = await api.get("/api/history"); }
  catch { mount.innerHTML = `<p class="empty-saved">Server unreachable.</p>`; return; }
  setSavedCount(places.length);
  if (!places.length) {
    mount.innerHTML = `<p class="empty-saved">Nothing saved yet. Analyze an area and press “Save snapshot” — the place keeps an immutable timeline you can re-sample any time.</p>`;
    return;
  }
  compareSel.clear();
  mount.innerHTML = "";
  // compare bar: tick two places below, then this contrasts their latest snapshots
  const bar = document.createElement("div");
  bar.className = "compare-bar";
  bar.innerHTML = `
    <span class="compare-hint dim">Tick two places to compare them side by side.</span>
    <button class="mini compare-go" disabled>Compare 0/2</button>
    <div class="compare-out" hidden></div>`;
  mount.appendChild(bar);
  if (places.length < 2) bar.querySelector(".compare-hint").textContent = "Save a second place to unlock side-by-side compare.";
  bar.querySelector(".compare-go").addEventListener("click", () => runCompare(bar));
  for (const p of places) mount.appendChild(placeCard(p));
}

/* enable/relabel the Compare button as ticks come and go (max two) */
function syncCompareBar() {
  const bar = $("savedList").querySelector(".compare-bar");
  if (!bar) return;
  const btn = bar.querySelector(".compare-go");
  btn.textContent = `Compare ${compareSel.size}/2`;
  btn.disabled = compareSel.size !== 2;
}

/* render the side-by-side diff of the two ticked places' latest snapshots */
function runCompare(bar) {
  const [a, b] = [...compareSel.values()];
  if (!a || !b) return;
  const latest = (p) => p.snapshots[p.snapshots.length - 1];
  const out = bar.querySelector(".compare-out");
  out.hidden = false;
  out.innerHTML = renderCompareHtml(
    { label: a.label, lat: a.lat, lon: a.lon, radiusMi: a.radiusMi, report: latest(a).report },
    { label: b.label, lat: b.lat, lon: b.lon, radiusMi: b.radiusMi, report: latest(b).report },
  );
  out.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function placeCard(p) {
  const newestFirst = [...p.snapshots].reverse();
  const latest = newestFirst[0];
  const card = document.createElement("div");
  card.className = "card";

  const rows = newestFirst.map((s, i) => `
    <div class="snap-row" data-sid="${esc(s.id)}">
      <span class="snap-when mono">${esc(fmtWhen(s.takenAt))}</span>
      ${i === newestFirst.length - 1 ? `<span class="tag">original</span>` : ""}
      ${i === 0 && newestFirst.length > 1 ? `<span class="tag">latest</span>` : ""}
      <button class="mini view-snap">View</button>
      ${i < newestFirst.length - 1 ? `<button class="mini diff-snap" title="What changed since the previous snapshot">Δ Diff</button>` : ""}
      <button class="mini danger del-snap" aria-label="Delete this snapshot">✕</button>
    </div>
    <div class="snap-detail" hidden></div>`).join("");

  card.innerHTML = `
    <div class="card-top">
      <span class="card-place"><label class="compare-pick" title="Tick to compare with another place"><input type="checkbox" class="compare-check" /></label>${esc(p.label)}</span>
      <span class="card-when">${p.snapshots.length} snapshot${p.snapshots.length === 1 ? "" : "s"} · latest ${esc(fmtWhen(latest.takenAt))}</span>
    </div>
    <div class="card-when mono" style="margin-top:2px">${fmtLat(p.lat)} ${fmtLon(p.lon)} · ${distMi(p.radiusMi)}</div>
    <p class="card-sum">${esc(latest.report.summary || "")}</p>
    <div class="card-actions">
      <button class="mini snap-btn" title="Re-run the analysis for this exact spot and radius">＋ New snapshot</button>
      <button class="mini fly-btn">Show on globe</button>
      ${p.snapshots.length > 1 ? `<button class="mini diff-all-btn" title="Everything that changed across this place's whole timeline">Δ Original → latest</button>` : ""}
      <button class="mini danger del-btn" aria-label="Delete this place and all its snapshots">✕ Delete place</button>
    </div>
    <div class="diff-all" hidden></div>
    <div class="snap-list">${rows}</div>`;

  // compare tick: cap the selection at two, refusing a third
  const cmpCheck = card.querySelector(".compare-check");
  cmpCheck.addEventListener("change", () => {
    if (cmpCheck.checked) {
      if (compareSel.size >= 2) { cmpCheck.checked = false; return; } // only two at a time
      compareSel.set(p.id, p);
    } else {
      compareSel.delete(p.id);
    }
    syncCompareBar();
  });

  card.querySelector(".snap-btn").addEventListener("click", () => {
    // exact same coordinates and radius -> saving the result appends to this timeline
    goToPlace(p.lat, p.lon, p.radiusMi);
    startAnalysis();
  });
  card.querySelector(".fly-btn").addEventListener("click", () => goToPlace(p.lat, p.lon, p.radiusMi));
  card.querySelector(".del-btn").addEventListener("click", async () => {
    try { await api.del(`/api/history/${p.id}`); } catch { /* already gone or offline: the reload below tells the truth */ }
    card.remove();
    refreshSavedCount();
    if (!$("savedList").querySelector(".card")) loadSaved();
  });

  const diffAllBtn = card.querySelector(".diff-all-btn");
  if (diffAllBtn) diffAllBtn.addEventListener("click", () => {
    const box = card.querySelector(".diff-all");
    box.hidden = !box.hidden;
    diffAllBtn.textContent = box.hidden ? "Δ Original → latest" : "Hide Δ";
    if (!box.hidden) box.innerHTML = renderDiffHtml(p.snapshots[0], p.snapshots[p.snapshots.length - 1]);
  });

  card.querySelectorAll(".snap-row").forEach((row, i) => {
    const sid = row.dataset.sid;
    const snap = p.snapshots.find((s) => s.id === sid);
    const older = newestFirst[i + 1] || null; // rows render newest-first
    const detail = row.nextElementSibling;
    const viewBtn = row.querySelector(".view-snap");
    const diffBtn = row.querySelector(".diff-snap");
    const closeDetail = () => {
      detail.hidden = true;
      viewBtn.textContent = "View";
      if (diffBtn) diffBtn.textContent = "Δ Diff";
    };
    viewBtn.addEventListener("click", () => {
      if (!detail.hidden && detail.dataset.mode === "report") return closeDetail();
      closeDetail();
      detail.hidden = false;
      detail.dataset.mode = "report";
      viewBtn.textContent = "Hide";
      detail.innerHTML = `<p class="snap-banner">Snapshot from ${esc(fmtWhen(snap.takenAt))} (${esc(rel(snap.takenAt))}). Weather, air quality and news reflect that moment; terrain and map data drift slowly.</p><div class="snap-report"></div>`;
      renderReport(snap.report, detail.querySelector(".snap-report"), { saveable: false });
    });
    if (diffBtn) diffBtn.addEventListener("click", () => {
      if (!detail.hidden && detail.dataset.mode === "diff") return closeDetail();
      closeDetail();
      detail.hidden = false;
      detail.dataset.mode = "diff";
      diffBtn.textContent = "Hide Δ";
      detail.innerHTML = renderDiffHtml(older, snap);
    });
    row.querySelector(".del-snap").addEventListener("click", async () => {
      try { await api.del(`/api/history/${p.id}/snapshots/${sid}`); } catch { /* reload shows the real state */ }
      loadSaved();
    });
  });

  return card;
}
