/**
 * Globe controls
 * --------------
 * The buttons around the globe: basemap toggle, zoom, the radius ± steppers
 * with click-to-type on the readout, and the report-panel show/hide/fullscreen
 * toggles.
 */
import { $ } from "./dom.js";
import { settings } from "./settings.js";
import { MI_TO_KM } from "./format.js";
import {
  toggleBasemap, zoomStep, resizeGlobeSoon, radiusMi, setRadiusMi, syncRadiusOut, RADIUS_MIN, RADIUS_MAX,
} from "./globe.js";

function initRadiusTyping() {
  $("radiusOut").addEventListener("click", () => {
    if (document.getElementById("radiusTyped")) return; // already editing
    const out = $("radiusOut");
    const inKm = settings.dist === "km"; // type in the unit you see
    const inp = document.createElement("input");
    inp.type = "number";
    inp.id = "radiusTyped";
    inp.className = "radius-typed mono";
    inp.min = inKm ? Math.ceil(RADIUS_MIN * MI_TO_KM) : RADIUS_MIN;
    inp.max = inKm ? Math.floor(RADIUS_MAX * MI_TO_KM) : RADIUS_MAX;
    inp.step = 1;
    inp.value = inKm ? Math.round(radiusMi() * MI_TO_KM) : radiusMi();
    inp.setAttribute("aria-label", `Radius in ${inKm ? "kilometers" : "miles"}`);
    const unit = document.createElement("span");
    unit.className = "radius-typed-unit dim mono";
    unit.textContent = inKm ? "km" : "mi";
    out.hidden = true;
    out.after(unit);
    out.after(inp);
    inp.focus();
    inp.select();
    let finished = false;
    const close = (commit) => {
      if (finished) return;
      finished = true;
      if (commit) {
        const raw = parseFloat(inp.value); // type=number blocks junk; parse+clamp covers the rest
        if (Number.isFinite(raw) && raw > 0) setRadiusMi(inKm ? raw / MI_TO_KM : raw);
      }
      inp.remove();
      unit.remove();
      out.hidden = false;
      syncRadiusOut();
    };
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(true);
      else if (e.key === "Escape") close(false);
    });
    inp.addEventListener("blur", () => close(true));
  });
}

function initPanelToggles() {
  $("panelFullBtn").addEventListener("click", () => {
    document.body.classList.toggle("panel-full");
    document.body.classList.remove("panel-hidden");
    $("showPanelBtn").hidden = true;
    resizeGlobeSoon();
  });
  $("panelHideBtn").addEventListener("click", () => {
    document.body.classList.add("panel-hidden");
    document.body.classList.remove("panel-full");
    $("showPanelBtn").hidden = false;
    resizeGlobeSoon();
  });
  $("showPanelBtn").addEventListener("click", () => {
    document.body.classList.remove("panel-hidden");
    $("showPanelBtn").hidden = true;
    resizeGlobeSoon();
  });
}

/* bring the panel back when something (a globe click) needs it on screen */
export function revealPanel() {
  document.body.classList.remove("panel-hidden");
  $("showPanelBtn").hidden = true;
  resizeGlobeSoon();
}

export function initControls() {
  $("layerBtn").addEventListener("click", () => {
    $("layerBtn").textContent = toggleBasemap() ? "Map view" : "Satellite view";
  });
  $("zoomIn").addEventListener("click", () => zoomStep(0.45));
  $("zoomOut").addEventListener("click", () => zoomStep(2.0));
  $("radMinus").addEventListener("click", () => setRadiusMi(radiusMi() - 1));
  $("radPlus").addEventListener("click", () => setRadiusMi(radiusMi() + 1));
  initRadiusTyping();
  initPanelToggles();
}
