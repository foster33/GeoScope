/**
 * Watching tab
 * ------------
 * One card per watched area: which sources it monitors, its change log
 * (collapsed past the first few entries), and the notification channel
 * configuration (ntfy / Discord / JSON, plus the RSS feed URL).
 */
import { $ } from "./dom.js";
import { api } from "./api.js";
import { esc, fmtWhen, fmtLat, fmtLon, distMi, rel } from "./format.js";
import { SHORT } from "./report-model.js";
import { goToPlace } from "./navigate.js";
import { isUnseen, updateWatchBadge, refreshWatchBadge } from "./badges.js";

const WATCH_METRICS = [
  ["news", "News"], ["earthquakes", "Quakes"], ["airquality", "Air quality"], ["weather", "Severe wx"],
  ["settlements", "Settlements"], ["landmarks", "Landmarks"], ["people", "People"], ["infrastructure", "Infra"],
  ["surveillance", "Cameras"],
];
const NOTIFY_FORMAT_LABELS = { auto: "Auto-detect", ntfy: "ntfy", discord: "Discord", json: "Generic JSON" };

export async function loadWatches() {
  const mount = $("watchList");
  mount.innerHTML = `<p class="dim">Loading…</p>`;
  let ws;
  try { ws = await api.get("/api/watches"); }
  catch { mount.innerHTML = `<p class="empty-saved">Server unreachable.</p>`; return; }
  updateWatchBadge(ws);
  if (!ws.length) {
    mount.innerHTML = `<p class="empty-saved">Nothing watched yet. Analyze an area and press “Watch this area” — GeoScope will re-check it on a schedule and log every change here.</p>`;
    return;
  }
  mount.innerHTML = "";
  for (const w of ws) mount.appendChild(watchCard(w));
}

/* the change log: entries past the first few hide behind "show older", and
   item lists inside one entry collapse past three */
function feedHtml(w) {
  const ENTRY_CAP = 6, ITEM_CAP = 3;
  const itemHtml = (i) =>
    `<div class="feed-item">${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.text)}</a>` : esc(i.text)}${i.detail ? ` <span class="dim">· ${esc(i.detail)}</span>` : ""}</div>`;
  const entryHtml = (c) => {
    const fresh = isUnseen(w, c);
    const all = c.items || [];
    const rest = all.length > ITEM_CAP + 1 ? all.slice(ITEM_CAP) : [];
    const shown = rest.length ? all.slice(0, ITEM_CAP) : all;
    return `<div class="feed-entry${fresh ? " fresh" : ""}" data-cid="${esc(c.id)}">
      <div class="feed-head"><span class="feed-when mono">${esc(fmtWhen(c.at))}</span><span class="tag">${esc(SHORT[c.source] || c.source)}</span>${fresh ? `<button class="feed-ack" title="Mark this alert as read">✓ read</button>` : ""}</div>
      <div class="feed-sum">${esc(c.summary)}</div>${shown.map(itemHtml).join("")}
      ${rest.length ? `<div class="feed-extra" hidden>${rest.map(itemHtml).join("")}</div><button class="feed-more">▾ ${rest.length} more</button>` : ""}
    </div>`;
  };
  const changes = (w.changes || []).slice(0, 60);
  const older = changes.slice(ENTRY_CAP);
  return changes.slice(0, ENTRY_CAP).map(entryHtml).join("") +
    (older.length
      ? `<div class="feed-rest" hidden>${older.map(entryHtml).join("")}</div>
         <button class="mini feed-toggle">▾ Show ${older.length} older change${older.length === 1 ? "" : "s"}</button>`
      : "");
}

function watchCard(w) {
  const card = document.createElement("div");
  card.className = "card";
  const unseen = (w.changes || []).filter((c) => isUnseen(w, c));
  const errs = Object.entries(w.lastErrors || {});

  const toggles = WATCH_METRICS.map(([key, label]) =>
    `<button class="wm${w.metrics?.[key] === false ? "" : " on"}" data-metric="${key}" title="Toggle ${label} monitoring">${label}</button>`).join("");

  card.innerHTML = `
    <div class="card-top">
      <span class="card-place">${esc(w.label || "Unnamed area")}${unseen.length ? `<span class="unseen-pill">${unseen.length} new</span>` : ""}</span>
      <span class="card-when">since ${new Date(w.createdAt).toLocaleDateString()}</span>
    </div>
    <div class="card-when mono" style="margin-top:2px">${fmtLat(w.lat)} ${fmtLon(w.lon)} · ${distMi(w.radiusMi)}</div>
    <div class="watch-status dim">${w.baselined
      ? `last activity ${w.changes?.length ? rel(w.changes[0].at) : "none yet"} · next check ${rel(w.nextCheckAt)}`
      : "baselining — first snapshots are being gathered…"}${errs.length ? ` · <span class="errtxt" title="${esc(errs.map(([s, e]) => `${s}: ${e}`).join("\n"))}">${errs.length} source error${errs.length === 1 ? "" : "s"}</span>` : ""}</div>
    <div class="wm-row">${toggles}</div>
    <div class="card-actions">
      <button class="mini check-btn">Check now</button>
      <button class="mini fly-btn">Show on globe</button>
      <button class="mini notify-btn">${w.notify?.url ? "🔔 On" : "🔔 Notify"}</button>
      ${unseen.length ? `<button class="mini seen-btn">Mark seen</button>` : ""}
      <button class="mini danger del-btn">✕ Stop watching</button>
    </div>
    <div class="notify-cfg" hidden>
      <input class="notify-url" type="url" spellcheck="false" placeholder="https://ntfy.sh/your-topic — or a Discord webhook / JSON endpoint" value="${esc(w.notify?.url || "")}" />
      <div class="notify-row2">
        <select class="notify-format">${Object.entries(NOTIFY_FORMAT_LABELS).map(([f, label]) =>
          `<option value="${f}"${(w.notify?.format || "auto") === f ? " selected" : ""}>${label}</option>`).join("")}
        </select>
        <button class="mini notify-save">Save</button>
        <button class="mini notify-test"${w.notify?.url ? "" : " disabled"}>Send test</button>
        <button class="mini notify-rss" title="Copy this watch's RSS feed URL — any feed reader works as a channel">RSS</button>
      </div>
      <p class="dim notify-hint">Phone push with zero setup: install the <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a> app, subscribe to a topic of your choosing, paste its URL here — every change this watch records gets pushed.${w.notifyState ? ` · Last delivery: ${w.notifyState.ok ? "✓ delivered" : `✕ ${esc(w.notifyState.error || "failed")}`} (${esc(rel(w.notifyState.at))})` : ""}</p>
    </div>
    <div class="feed">${w.changes?.length ? feedHtml(w) : `<p class="dim feed-empty">No changes recorded yet. The baseline was captured when the watch was added; anything that differs on a later check will appear here.</p>`}</div>`;

  bindFeed(card, w);
  bindMetrics(card, w);
  bindNotify(card, w);

  card.querySelector(".check-btn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Checking…";
    try {
      await api.post(`/api/watches/${w.id}/check`);
    } catch (err) {
      e.target.textContent = err.message?.includes("already") ? "Busy — try again" : "Check failed";
      e.target.disabled = false;
      return;
    }
    loadWatches();
  });
  card.querySelector(".fly-btn").addEventListener("click", () => goToPlace(w.lat, w.lon, w.radiusMi));
  card.querySelector(".seen-btn")?.addEventListener("click", async () => {
    try { await api.patch(`/api/watches/${w.id}`, { seen: true }); } catch { /* reload shows the real state */ }
    loadWatches();
  });
  card.querySelector(".del-btn").addEventListener("click", async () => {
    try { await api.del(`/api/watches/${w.id}`); } catch { /* already gone or offline */ }
    card.remove();
    refreshWatchBadge();
    if (!$("watchList").querySelector(".card")) loadWatches();
  });
  return card;
}

function bindFeed(card, w) {
  card.querySelectorAll(".feed-more").forEach((btn) => btn.addEventListener("click", () => {
    const extra = btn.previousElementSibling;
    extra.hidden = !extra.hidden;
    btn.textContent = extra.hidden ? `▾ ${extra.children.length} more` : "▴ fewer";
  }));
  const feedToggle = card.querySelector(".feed-toggle");
  if (feedToggle) feedToggle.addEventListener("click", () => {
    const restBox = card.querySelector(".feed-rest");
    restBox.hidden = !restBox.hidden;
    const n = restBox.querySelectorAll(".feed-entry").length;
    feedToggle.textContent = restBox.hidden ? `▾ Show ${n} older change${n === 1 ? "" : "s"}` : "▴ Show fewer";
  });
  card.querySelectorAll(".feed-ack").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const cid = btn.closest(".feed-entry").dataset.cid;
    btn.disabled = true;
    try { await api.patch(`/api/watches/${w.id}`, { ackChange: cid }); } catch { /* re-render anyway */ }
    const c = (w.changes || []).find((x) => x.id === cid);
    if (c) c.seen = true;
    card.replaceWith(watchCard(w)); // re-render this card; pill count updates
    refreshWatchBadge();
  }));
}

function bindMetrics(card, w) {
  card.querySelectorAll(".wm").forEach((btn) => btn.addEventListener("click", async () => {
    const on = !btn.classList.contains("on");
    btn.classList.toggle("on", on);
    try { await api.patch(`/api/watches/${w.id}`, { metrics: { [btn.dataset.metric]: on } }); }
    catch { btn.classList.toggle("on", !on); } // didn't stick: show the real state
  }));
}

function bindNotify(card, w) {
  const cfg = card.querySelector(".notify-cfg");
  card.querySelector(".notify-btn").addEventListener("click", () => { cfg.hidden = !cfg.hidden; });
  card.querySelector(".notify-save").addEventListener("click", async (e) => {
    const url = card.querySelector(".notify-url").value.trim();
    const format = card.querySelector(".notify-format").value;
    e.target.disabled = true;
    e.target.textContent = "Saving…";
    try {
      await api.patch(`/api/watches/${w.id}`, { notify: url ? { url, format } : null });
      w.notify = url ? { url, format } : undefined;
      delete w.notifyState;
      const next = watchCard(w);
      card.replaceWith(next);
      next.querySelector(".notify-cfg").hidden = false; // keep the config open after save
    } catch {
      e.target.textContent = "Invalid URL";
      e.target.disabled = false;
      setTimeout(() => { e.target.textContent = "Save"; }, 2200);
    }
  });
  card.querySelector(".notify-test").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Sending…";
    try {
      await api.post(`/api/watches/${w.id}/notify-test`);
      e.target.textContent = "Delivered ✓";
      e.target.title = "";
    } catch (err) {
      e.target.textContent = "Failed ✕";
      e.target.title = err.message || "";
    }
    setTimeout(() => { e.target.textContent = "Send test"; e.target.disabled = false; }, 2500);
  });
  card.querySelector(".notify-rss").addEventListener("click", async (e) => {
    const url = `${location.origin}/api/watches/${w.id}/rss`;
    try { await navigator.clipboard.writeText(url); e.target.textContent = "Copied ✓"; }
    catch { prompt("RSS feed URL:", url); }
    setTimeout(() => { e.target.textContent = "RSS"; }, 2000);
  });
}
