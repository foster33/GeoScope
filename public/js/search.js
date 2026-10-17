/**
 * Search to fly
 * -------------
 * Type a place name (Nominatim forward geocode) or paste "lat, lon"; pick a
 * result and the camera flies there and drops the circle — exactly the state a
 * globe click produces, so analysis stays coordinate-keyed. The full display
 * name lets the user disambiguate same-named places before analyzing.
 *
 * On the Space tab the same box searches the loaded objects by name and the
 * camera locks onto the one you pick — a place search up there is meaningless.
 */
import { $ } from "./dom.js";
import { api, qs } from "./api.js";
import { settings } from "./settings.js";
import { esc, COORD_RE, parseCoordInput } from "./format.js";
import { selectPoint } from "./globe.js";
import { showTab } from "./tabs.js";
import { SPACE, trackSat } from "./space.js";

function flyToResult(lat, lon, label) {
  showTab("explore");
  selectPoint(lat, lon);
  $("searchResults").hidden = true;
  if (label) $("searchInput").value = label;
}

function renderSearchResults(items) {
  const box = $("searchResults");
  if (!items) { box.hidden = true; box.innerHTML = ""; return; }
  if (!items.length) { box.hidden = false; box.innerHTML = `<p class="sr-msg">No matches.</p>`; return; }
  box.hidden = false;
  box.innerHTML = items.slice(0, 6).map((r, i) =>
    `<button type="button" data-i="${i}"><span>${esc(r.displayName)}</span>${r.type ? `<br><span class="sr-type">${esc(r.type)}</span>` : ""}</button>`
  ).join("");
  box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    const r = items[+b.dataset.i];
    flyToResult(r.lat, r.lon, r.displayName.split(",").slice(0, 2).join(",").trim());
  }));
}

function searchSatellites(q) {
  const box = $("searchResults");
  if (q.length < 1) { renderSearchResults(null); return; }
  if (!SPACE.sats.length) { box.hidden = false; box.innerHTML = `<p class="sr-msg">Loading orbital elements…</p>`; return; }
  const ql = q.toLowerCase();
  const matches = SPACE.sats.filter((s) => s.name.toLowerCase().includes(ql)).slice(0, 8);
  if (!matches.length) { box.hidden = false; box.innerHTML = `<p class="sr-msg">No tracked object matches “${esc(q)}”.</p>`; return; }
  box.hidden = false;
  box.innerHTML = matches.map((s, i) =>
    `<button type="button" data-i="${i}"><span>${esc(s.name)}</span><br><span class="sr-type">${s.group === "stations" ? "space station" : "satellite"} · NORAD ${esc(s.noradId)}</span></button>`
  ).join("");
  box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    trackSat(matches[+b.dataset.i]);
    box.hidden = true;
    $("searchInput").value = matches[+b.dataset.i].name;
  }));
}

let searchTimer = null, searchSeq = 0;
async function runSearch(q) {
  q = q.trim();
  if (SPACE.active) { searchSatellites(q); return; }
  if (q.length < 2) { renderSearchResults(null); return; }
  const coords = parseCoordInput(q); // raw coordinates short-circuit the API entirely
  if (coords) { flyToResult(coords.lat, coords.lon, `${coords.lat}, ${coords.lon}`); return; }
  const seq = ++searchSeq;
  const box = $("searchResults");
  box.hidden = false; box.innerHTML = `<p class="sr-msg">Searching…</p>`;
  try {
    const j = await api.get(`/api/geocode?${qs({ q, lang: settings.lang })}`);
    if (seq !== searchSeq) return; // a newer keystroke superseded this search
    renderSearchResults(j.results || []);
  } catch (e) {
    if (seq !== searchSeq) return;
    box.innerHTML = `<p class="sr-msg">${esc(e.status ? e.message : "Search failed — check your connection.")}</p>`;
  }
}

export function initSearch() {
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(searchTimer);
    const v = $("searchInput").value.trim();
    if (SPACE.active) { // Enter locks onto the best-matching object
      const top = SPACE.sats.find((s) => s.name.toLowerCase().includes(v.toLowerCase()));
      if (top) { trackSat(top); $("searchResults").hidden = true; $("searchInput").value = top.name; }
      return;
    }
    runSearch(v);
  });
  $("searchInput").addEventListener("input", () => {
    clearTimeout(searchTimer);
    const v = $("searchInput").value;
    if (SPACE.active) { searchSatellites(v.trim()); return; } // local filter — instant, no debounce
    if (COORD_RE.test(v)) return; // raw coords: wait for Enter rather than geocoding partial numbers
    searchTimer = setTimeout(() => runSearch(v), 350); // debounce, polite to Nominatim
  });
  $("searchInput").addEventListener("keydown", (e) => { if (e.key === "Escape") { $("searchResults").hidden = true; $("searchInput").blur(); } });
  document.addEventListener("click", (e) => { if (!e.target.closest(".geo-search")) $("searchResults").hidden = true; });
}
