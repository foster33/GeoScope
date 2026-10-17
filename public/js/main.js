/**
 * GeoScope frontend entry point
 * -----------------------------
 * Wires the modules together: initializes each one, decides what a globe click
 * means, routes the Escape key, and runs any deep link in the URL.
 *
 * Module map (each owns one concern; arrows point at dependencies):
 *   main → analyze → render → {plots, highlights, wiki, flyovers, badges}
 *        → saved, watches, space, search, tabs, controls, settingsUi
 *   globe (the Cesium viewer + selection) and format/settings/api sit underneath.
 */
import { initGlobe, onGlobeClick, selectPoint } from "./globe.js";
import { initControls } from "./controls.js";
import { isTempPin, toggleTempPinName } from "./highlights.js";
import { initTabs, onTabClick } from "./tabs.js";
import { initSearch } from "./search.js";
import { initWiki, isWikiOpen, closeWikiPop, openWikiPop } from "./wiki.js";
import { initAnalyze, analyzeFromHash } from "./analyze.js";
import { loadSaved } from "./saved.js";
import { loadWatches } from "./watches.js";
import { initSpace, SPACE, trackSat, untrackSat } from "./space.js";
import { initSettingsUI } from "./settingsUi.js";
import { startClocks } from "./clocks.js";
import { refreshSavedCount, refreshWatchBadge, startBadgePolling } from "./badges.js";
import { watchLocationHash } from "./permalink.js";

initGlobe();
initControls();
initTabs();
initSearch();
initWiki();
initAnalyze();
initSpace();
initSettingsUI();
startClocks();
startBadgePolling();

onTabClick("saved", loadSaved);
onTabClick("watch", loadWatches);

/* a click on the globe: a plotted highlight toggles its name, a satellite dot
   locks the camera on and opens its preview, bare ground moves the selection */
onGlobeClick(({ hit, latLng }) => {
  if (hit?.id && isTempPin(hit.id)) {
    toggleTempPinName(hit.id);
    return;
  }
  if (hit?.id?._isSat) {
    const ent = hit.id;
    trackSat(ent._rec);
    openWikiPop({ name: ent._satName, norad: ent._norad });
    return;
  }
  if (latLng) selectPoint(latLng.lat, latLng.lng, { fly: false });
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (isWikiOpen()) return closeWikiPop(); // preview first, camera lock second
  if (SPACE.tracked) untrackSat();
});

refreshSavedCount();
refreshWatchBadge();

/* deep link: if the URL carries a valid #@lat,lon,radius, drop the circle
   there and run the analysis automatically — now and on later hash changes */
watchLocationHash(analyzeFromHash);
analyzeFromHash(location.hash);
