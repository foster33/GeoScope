/**
 * The ⚙ settings popover
 * ----------------------
 * Segmented controls for units and clock style, a language select for
 * previews and place names, and the category-translation toggle. Changing
 * anything saves it and re-renders whatever is on screen in the new units.
 */
import { $ } from "./dom.js";
import { settings, saveSettings } from "./settings.js";
import { state } from "./state.js";
import { tickClocks } from "./clocks.js";
import { syncRadiusOut } from "./globe.js";
import { renderLive, refetchSettlements } from "./analyze.js";
import { loadSaved } from "./saved.js";
import { loadWatches } from "./watches.js";
import { SPACE, renderSpacePanel } from "./space.js";

export function applySettings() {
  syncRadiusOut();
  tickClocks();
  if (state.currentReport) renderLive(state.currentReport);
  if (!$("savedView").hidden) loadSaved();
  if (!$("watchView").hidden) loadWatches();
  if (!$("spaceView").hidden && SPACE.loaded) renderSpacePanel(); // unit headers
}

export function initSettingsUI() {
  const panel = $("settingsPanel");
  $("settingsBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== $("settingsBtn")) panel.hidden = true;
  });
  panel.querySelectorAll(".seg").forEach((seg) => {
    const key = seg.dataset.setting;
    const sync = () => seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.val === settings[key]));
    sync();
    seg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      settings[key] = b.dataset.val;
      saveSettings();
      sync();
      applySettings();
    }));
  });
  const langSel = $("setLang");
  langSel.value = settings.lang;
  if (!langSel.value) { langSel.value = "en"; } // stored code not in the list
  langSel.addEventListener("change", () => {
    settings.lang = langSel.value;
    saveSettings();
    refetchSettlements(); // localized names come from the server per language
    applySettings();
  });
}
