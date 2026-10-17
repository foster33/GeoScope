/**
 * Shareable permalink
 * -------------------
 * The current report's spot lives in the URL hash so a report is linkable and
 * bookmarkable. Format: #@<lat>,<lon>,<radius> — lat/lon to 5 decimals (~1 m,
 * plenty for a circle), radius an integer of miles. We remember the last hash
 * WE wrote so the hashchange listener can tell a user/back-button navigation
 * apart from our own write and not re-analyze in a loop.
 */

let lastWrittenHash = null;

export function permalinkFor(lat, lon, radiusMi) {
  return `#@${lat.toFixed(5)},${lon.toFixed(5)},${Math.round(radiusMi)}`;
}

/* "#@lat,lon,radius" -> {lat, lon, radius}; null for anything malformed */
export function parseLocationHash(hash) {
  const m = /^#@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+)$/.exec(hash || "");
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]), radius = parseInt(m[3], 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, radius };
}

/* point the URL at the spot a report was just run for, without spamming
   browser history; record it so our own hashchange is ignored below */
export function writeLocationHash(lat, lon, radiusMi) {
  const hash = permalinkFor(lat, lon, radiusMi);
  if (location.hash === hash) return;
  lastWrittenHash = hash;
  history.replaceState(null, "", location.pathname + location.search + hash);
}

/* drop the permalink so a reload doesn't resurrect a cleared report */
export function clearLocationHash() {
  if (!location.hash) return;
  lastWrittenHash = "";
  history.replaceState(null, "", location.pathname + location.search);
}

export const fullPermalink = (lat, lon, radiusMi) =>
  location.origin + location.pathname + permalinkFor(lat, lon, radiusMi);

/* a hashchange we didn't cause (manual edit, bookmark, back/forward) re-runs */
export function watchLocationHash(onNavigate) {
  window.addEventListener("hashchange", () => {
    if (location.hash === lastWrittenHash) return; // our own write — don't loop
    onNavigate(location.hash);
  });
}
