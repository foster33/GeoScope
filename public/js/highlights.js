/**
 * Temporary highlights on the globe
 * ---------------------------------
 * Teal pins that pulse, then remove themselves (a single pinned place), and
 * category plots that stay until toggled off (facilities, surveillance
 * devices). A new highlight replaces the previous one. Clicking a plotted
 * point toggles its name label; the legend lets a category be hidden/shown.
 */
import { $ } from "./dom.js";
import { esc } from "./format.js";
import { viewer, resizeGlobeSoon, setSpinning, flyToCircle, radiusMi, NIGHT } from "./globe.js";
import { restoreStatus } from "./status.js";

export const TEAL = "#4fc4a8";
const PLOT_ALL_LABEL = "◎ Plot all on globe";

let tempPins = [];
let tempPinTimer = null;
let activePlot = null; // "all" | "cat:<label>" | "surv" | "surv:<cat>" | null — category plots toggle, they don't expire

export const isTempPin = (ent) => tempPins.includes(ent);
export const getActivePlot = () => activePlot;
export const setActivePlot = (key) => { activePlot = key; };
export const addTempPin = (ent) => { tempPins.push(ent); };
export const forEachPin = (fn) => tempPins.forEach(fn);

export function clearTempHighlights() {
  clearTimeout(tempPinTimer);
  tempPins.forEach((e) => viewer.entities.remove(e));
  tempPins = [];
  activePlot = null;
  $("infraLegend").hidden = true;
  document.querySelectorAll(".infra-all-btn").forEach((b) => { b.textContent = PLOT_ALL_LABEL; });
  restoreStatus(); // drop stale "N highlighted…" messages
}

/* clicking a plotted point toggles its name label */
export function toggleTempPinName(ent) {
  if (!ent._pinName || !ent.label) return;
  ent._nameOn = !ent._nameOn;
  ent.label.show = ent._nameOn;
}

/* Cesium's label renderer strips emoji to monochrome glyphs, so icons are
   pre-rendered on a 2D canvas (which does color emoji) and used as billboards */
const emojiImageCache = new Map();
export function emojiImage(emoji) {
  if (emojiImageCache.has(emoji)) return emojiImageCache.get(emoji);
  const c = document.createElement("canvas");
  c.width = 56; c.height = 56;
  const ctx = c.getContext("2d");
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(2, 2, 52, 52, 12);
  else ctx.rect(2, 2, 52, 52);
  ctx.fillStyle = "rgba(10, 19, 34, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(36, 57, 92, 0.95)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = "34px sans-serif"; // falls through to the platform color-emoji font
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 28, 31);
  const url = c.toDataURL();
  emojiImageCache.set(emoji, url);
  return url;
}

export function showPlotLegend(title, rowsHtml, note) {
  const legend = $("infraLegend");
  legend.innerHTML =
    `<div class="il-head"><h4>${esc(title)}</h4><button class="il-clear" title="Clear plotted points" aria-label="Clear plotted points">✕</button></div>` +
    rowsHtml +
    `<div class="il-note">click a point for its name · click a row to hide/show${note ? ` · ${esc(note)}` : ""}</div>`;
  legend.hidden = false;
  legend.querySelector(".il-clear").addEventListener("click", clearTempHighlights);
  legend.querySelectorAll(".il-toggle").forEach((row) => row.addEventListener("click", () => {
    const off = row.classList.toggle("il-off");
    tempPins.forEach((ent) => { if (ent._cat === row.dataset.cat) ent.show = !off; });
  }));
}

export const legendRow = (cat, icon, label, n) =>
  `<div class="il-row il-toggle" data-cat="${esc(cat)}" title="Click to hide/show" role="button"><span class="il-ico">${icon}</span><span class="il-cat">${esc(label)}</span><span class="il-n mono">${n}</span></div>`;

/* globe visible, idle spin off, previous highlight gone */
export function prepGlobeForHighlight() {
  setSpinning(false);
  document.body.classList.remove("panel-full"); // pins are pointless with the globe hidden
  resizeGlobeSoon();
  clearTempHighlights();
}

export function tealPoint(born, size) {
  return {
    pixelSize: new Cesium.CallbackProperty(() => size + 3 * Math.sin((Date.now() - born) / 280), false),
    color: Cesium.Color.fromCssColorString(TEAL),
    outlineColor: Cesium.Color.fromCssColorString(NIGHT),
    outlineWidth: 2,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

export function tealLabel(text) {
  return {
    text,
    font: "13px 'IBM Plex Mono', monospace",
    fillColor: Cesium.Color.fromCssColorString(TEAL),
    outlineColor: Cesium.Color.fromCssColorString(NIGHT),
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(0, -22),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

/* an emoji billboard with a hidden name label, used by the category plots */
export function addIconPin({ lat, lon, icon, name, cat }) {
  const ent = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    billboard: {
      image: emojiImage(icon),
      scale: 0.55,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: { ...tealLabel(name), show: false, pixelOffset: new Cesium.Cartesian2(0, -28) },
  });
  ent._pinName = name;
  ent._nameOn = false;
  ent._cat = cat;
  tempPins.push(ent);
  return ent;
}

/* one named place, pulsing for eight seconds, camera framing it */
export function pinpointOnGlobe(lat, lon, name) {
  prepGlobeForHighlight();
  const born = Date.now();
  const ent = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(lon, lat),
    point: tealPoint(born, 10),
    label: tealLabel(name),
  });
  ent._pinName = name;
  ent._nameOn = true;
  tempPins.push(ent);
  flyToCircle(lat, lon, radiusMi(), 2.2);
  tempPinTimer = setTimeout(clearTempHighlights, 8000);
}
