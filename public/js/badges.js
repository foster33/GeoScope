/**
 * Tab badges
 * ----------
 * The "(n)" counters on the Saved and Watching tabs: how many places are
 * saved, and how many watch changes haven't been seen yet.
 */
import { $ } from "./dom.js";
import { api } from "./api.js";

export async function refreshSavedCount() {
  try {
    const h = await api.get("/api/history");
    setSavedCount(h.length);
  } catch { /* server offline */ }
}

export function setSavedCount(n) {
  $("savedCount").textContent = n ? `(${n})` : "";
}

/* a change is unseen until acknowledged individually or by "Mark seen" */
export const isUnseen = (w, c) => !c.seen && (!w.lastSeenAt || c.at > w.lastSeenAt);

export function updateWatchBadge(ws) {
  const unseen = ws.reduce((n, w) => n + (w.changes || []).filter((c) => isUnseen(w, c)).length, 0);
  $("watchCount").textContent = unseen ? `(${unseen})` : "";
}

export async function refreshWatchBadge() {
  try { updateWatchBadge(await api.get("/api/watches")); } catch { /* server offline */ }
}

export function startBadgePolling() {
  setInterval(refreshWatchBadge, 120000);
}
