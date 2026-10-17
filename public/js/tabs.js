/**
 * Panel tabs
 * ----------
 * Explore / Saved / Watching / Space. Switching tabs also retargets the search
 * box (places on the ground, objects in orbit) and starts or stops the orbital
 * layer, which lives and dies with its tab.
 */
import { $ } from "./dom.js";
import { setSpaceActive } from "./space.js";

const TAB_BTNS = { explore: "tabExplore", saved: "tabSaved", watch: "tabWatch", space: "tabSpace" };
const onClick = {};

/* something to run when the user clicks a tab (e.g. reload the saved list);
   programmatic showTab() calls don't trigger it */
export function onTabClick(name, fn) { onClick[name] = fn; }

export function showTab(which) {
  $("wikiView").hidden = true; // an open preview yields to explicit navigation
  for (const [name, btnId] of Object.entries(TAB_BTNS)) {
    const on = name === which;
    $(name + "View").hidden = !on;
    $(btnId).classList.toggle("active", on);
    $(btnId).setAttribute("aria-selected", on);
  }
  setSpaceActive(which === "space"); // orbital layer lives and dies with its tab
  document.body.classList.toggle("space-mode", which === "space"); // circle radius controls are meaningless up there
  // the search box switches roles with the tab: places on the ground, objects in orbit
  const sp = which === "space";
  $("searchInput").placeholder = sp ? "Search a satellite to track" : "Search a place or paste lat, lon";
  $("searchInput").value = "";
  $("searchResults").hidden = true;
}

export function initTabs() {
  for (const [name, btnId] of Object.entries(TAB_BTNS)) {
    $(btnId).addEventListener("click", () => { showTab(name); onClick[name]?.(); });
  }
}
