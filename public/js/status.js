/**
 * The instrument-strip readout
 * ----------------------------
 * The small status line in the top bar ("hover the globe", "target locked",
 * "gathering 7/12", "14 facilities plotted"). Modules write to it through
 * setStatus/flashStatus; `defaultStatus` is what it should say when nothing
 * transient is being shown.
 */
import { $ } from "./dom.js";
import { state } from "./state.js";
import { fmtLat, fmtLon } from "./format.js";

export const lockedStatus = (lat, lng) => `target locked · ${fmtLat(lat)} ${fmtLon(lng)}`;

/* null means the live analysis ticker owns the readout right now */
export function defaultStatus() {
  const rep = state.currentReport;
  if (rep) return rep.pending?.size ? null : "report complete";
  return state.picked ? lockedStatus(state.picked.lat, state.picked.lng) : "hover the globe";
}

export function setStatus(text) {
  $("readoutStatus").textContent = text;
}

/* back to the default unless the ticker owns it */
export function restoreStatus() {
  const d = defaultStatus();
  if (d) setStatus(d);
}

let revertTimer = null;
export function flashStatus(text, ms = 6000) {
  setStatus(text);
  clearTimeout(revertTimer);
  revertTimer = setTimeout(restoreStatus, ms);
}
