/**
 * Category plots
 * --------------
 * Light up every point of a category inside the circle: one infrastructure
 * category, all twelve at once (each facility as its emoji), or the
 * surveillance devices already in the report payload. Each plot toggles:
 * invoking it again with the same key clears it.
 */
import { api, qs } from "./api.js";
import { settings, tInfra, localized } from "./settings.js";
import { esc } from "./format.js";
import { viewer, flyToCircle } from "./globe.js";
import { setStatus, flashStatus } from "./status.js";
import { SURV_CATS, SURV_NAMES } from "./report-model.js";
import {
  getActivePlot, setActivePlot, clearTempHighlights, prepGlobeForHighlight,
  showPlotLegend, legendRow, addIconPin, addTempPin, tealPoint, tealLabel,
} from "./highlights.js";

/* category icons for the all-categories plot — each facility renders as its
   emoji so categories stay distinguishable in a mixed cloud */
export const INFRA_ICONS = {
  "Hospitals": "🏥", "Clinics": "🩺", "Schools": "🏫", "Universities": "🎓",
  "Police stations": "🚓", "Fire stations": "🚒", "Supermarkets": "🛒",
  "Places of worship": "⛪", "Rail stations": "🚉", "Airports & airfields": "✈️",
  "Parks": "🌳", "Museums": "🏛️",
};
export const SURV_ICONS = { alpr: "📸", camera: "📹", speed: "🚦", gunshot: "🔊" };

const PLOT_ALL_LABEL = "◎ Plot all on globe";

const pointsUrl = (rep, cat) =>
  `/api/infrapoints?${qs({ cat, lat: rep.lat, lon: rep.lon, radius_mi: rep.radiusMi, lang: settings.lang })}`;

export async function showAllInfra(rep, btn) {
  if (getActivePlot() === "all") {
    clearTempHighlights();
    btn.textContent = PLOT_ALL_LABEL;
    return;
  }
  btn.disabled = true;
  btn.textContent = "Plotting…";
  try {
    const j = await api.get(pointsUrl(rep, "*"));
    if (!j.data.length) {
      flashStatus("no mapped facility coordinates returned");
      btn.textContent = PLOT_ALL_LABEL;
      return;
    }
    prepGlobeForHighlight();
    setActivePlot("all");
    const counts = {};
    for (const p of j.data) {
      counts[p.cat] = (counts[p.cat] || 0) + 1;
      // click-label always carries the (translated) category, so even facilities
      // without an OSM name:lang tag get a translated context line
      const name = `${p.name ? localized(p.name, p.localName) : "(unnamed)"} · ${tInfra(p.cat)}`;
      addIconPin({ lat: p.lat, lon: p.lon, icon: INFRA_ICONS[p.cat] || "•", name, cat: p.cat });
    }
    showPlotLegend("Facilities in the circle",
      Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([cat, n]) => legendRow(cat, INFRA_ICONS[cat] || "•", tInfra(cat), n)).join(""),
      j.truncated ? "dense categories capped at 60" : null);
    flyToCircle(rep.lat, rep.lon, rep.radiusMi);
    setStatus(`${j.data.length} facilities plotted across ${Object.keys(counts).length} categories`);
    btn.textContent = "✕ Clear plotted points";
  } catch (e) {
    flashStatus(`couldn't plot facilities — ${e.message}`);
    btn.textContent = PLOT_ALL_LABEL;
  } finally {
    btn.disabled = false;
  }
}

/* surveillance device plotting — data is already in the report payload */
export function showSurveillancePoints(rep, cat = null) {
  const plotKey = cat ? `surv:${cat}` : "surv";
  if (getActivePlot() === plotKey) {
    clearTempHighlights();
    return;
  }
  const pts = (rep.surveillance?.points || []).filter((p) => !cat || p.cat === cat);
  if (!pts.length) return;
  prepGlobeForHighlight();
  setActivePlot(plotKey);
  const counts = {};
  for (const p of pts) {
    counts[p.cat] = (counts[p.cat] || 0) + 1;
    const detail = [
      SURV_NAMES[p.cat] || p.cat,
      p.manufacturer, p.operator,
      p.cameraType ? `${p.cameraType} camera` : null,
      p.zone ? `zone: ${p.zone}` : null,
      p.direction != null ? `faces ${p.direction}°` : null,
    ].filter(Boolean).join(" · ");
    addIconPin({ lat: p.lat, lon: p.lon, icon: SURV_ICONS[p.cat] || "📷", name: detail, cat: p.cat });
  }
  showPlotLegend("Surveillance devices",
    SURV_CATS.filter(([k]) => counts[k]).map(([k, label]) => legendRow(k, SURV_ICONS[k], label, counts[k])).join(""),
    rep.surveillance.truncated ? "capped at 400" : null);
  flyToCircle(rep.lat, rep.lon, rep.radiusMi);
  setStatus(`${pts.length} ${cat ? (SURV_NAMES[cat] || cat).toLowerCase() : `surveillance device position${pts.length === 1 ? "" : "s"}`} plotted — click again or ✕ to clear`);
}

/* highlight every point of one infrastructure category inside the circle;
   clicking the same chip again clears it (toggle) */
export async function showInfraPoints(rep, label, chipEl) {
  if (getActivePlot() === `cat:${label}`) { clearTempHighlights(); return; }
  if (chipEl.classList.contains("chip-busy")) return;
  chipEl.classList.add("chip-busy");
  try {
    const j = await api.get(pointsUrl(rep, label));
    if (!j.data.length) {
      flashStatus(`no mapped coordinates returned for ${label.toLowerCase()}`);
      return;
    }
    prepGlobeForHighlight();
    setActivePlot(`cat:${label}`);
    const born = Date.now();
    const namesOn = j.data.length <= 25;
    for (const p of j.data) {
      const disp = p.name ? localized(p.name, p.localName) : null;
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        point: tealPoint(born, 7),
        label: { ...tealLabel(disp || ""), show: namesOn && !!disp },
      });
      ent._pinName = disp;
      ent._nameOn = namesOn && !!disp;
      ent._cat = label;
      addTempPin(ent);
    }
    showPlotLegend("Highlighted", legendRow(label, "◎", tInfra(label), j.data.length),
      j.truncated ? "first 150 shown" : null);
    flyToCircle(rep.lat, rep.lon, rep.radiusMi);
    setStatus(`${j.data.length} ${label.toLowerCase()} highlighted — click the chip again or ✕ to clear`);
  } catch (e) {
    flashStatus(`couldn't load ${label.toLowerCase()} — ${e.message}`);
  } finally {
    chipEl.classList.remove("chip-busy");
  }
}

/* the chips and buttons a rendered report uses to trigger plots */
export function bindPlotControls(mount, rep) {
  mount.querySelectorAll(".chip-click[data-cat]").forEach((chip) => {
    const go = () => showInfraPoints(rep, chip.dataset.cat, chip);
    chip.addEventListener("click", go);
    chip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  mount.querySelectorAll(".chip-click[data-survcat]").forEach((chip) => {
    const go = () => showSurveillancePoints(rep, chip.dataset.survcat);
    chip.addEventListener("click", go);
    chip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  mount.querySelectorAll(".infra-all-btn").forEach((btn) => btn.addEventListener("click", () => showAllInfra(rep, btn)));
  mount.querySelectorAll(".surv-plot-btn").forEach((btn) => btn.addEventListener("click", () => showSurveillancePoints(rep)));
}
