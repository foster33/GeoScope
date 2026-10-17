/**
 * The globe
 * ---------
 * CesiumJS streams map tiles, so resolution increases continuously as you
 * zoom - down to individual streets - instead of blurring a fixed texture.
 *
 * This module owns the viewer, the basemaps, the idle spin, the selected
 * point (circle + marker) and the radius slider that sizes it. Other modules
 * add their own entities (highlights, satellites) through `viewer` but never
 * touch the selection.
 */
import { $ } from "./dom.js";
import { state } from "./state.js";
import { MI_TO_KM, fmtLat, fmtLon, distMi } from "./format.js";
import { setStatus, lockedStatus } from "./status.js";

export const NIGHT = "#0a1322";   // the globe's base color; also outlines every marker
export const BRASS = "#d9a441";
export const CORAL = "#ff6b5e";

/* the original code sized camera flights with 1609 m/mi; kept so views land
   exactly where they always did */
const M_PER_MI_FLIGHT = 1609;

const DARK_TILES = new Cesium.UrlTemplateImageryProvider({
  url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  credit: "© OpenStreetMap contributors © CARTO",
  maximumLevel: 19,
});
const SAT_TILES = new Cesium.UrlTemplateImageryProvider({
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  credit: "Imagery © Esri, Maxar, Earthstar Geographics",
  maximumLevel: 19,
});

export const viewer = new Cesium.Viewer("globe", {
  baseLayer: new Cesium.ImageryLayer(SAT_TILES),
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  requestRenderMode: false,
});
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(NIGHT);
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 60; // ~street level
viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-40, 25, 22_000_000) });

/* --------------------------------------------------------------- basemap */

let satOn = true; // satellite imagery is the default basemap
export function toggleBasemap() {
  satOn = !satOn;
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.add(new Cesium.ImageryLayer(satOn ? SAT_TILES : DARK_TILES));
  return satOn;
}

/* ----------------------------------------------------------- idle spin */

let spinning = true; // gentle rotation until the first interaction
export function setSpinning(on) { spinning = on; }

/* ------------------------------------------------------------ camera */

export function resizeGlobeSoon() { setTimeout(() => viewer.resize && viewer.resize(), 80); }

export function zoomStep(factor) {
  spinning = false;
  const h = viewer.camera.positionCartographic.height;
  if (factor < 1) viewer.camera.zoomIn(h * (1 - factor));
  else viewer.camera.zoomOut(h * (factor - 1));
}

/* frame a circle: high enough to see all of it, never lower than 15 km */
export function flyToCircle(lat, lon, radiusMi, factor = 3.2, duration = 1.0) {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(15000, radiusMi * M_PER_MI_FLIGHT * factor)),
    duration,
  });
}

export function pickLatLng(screenPos) {
  const cart = viewer.camera.pickEllipsoid(screenPos, viewer.scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return { lat: Cesium.Math.toDegrees(c.latitude), lng: Cesium.Math.toDegrees(c.longitude) };
}

/* a left click: `hit` is whatever entity sits under the cursor (or null),
   `latLng` the ground point. main.js decides what the click means. */
export function onGlobeClick(handler) {
  viewer.screenSpaceEventHandler.setInputAction((e) => {
    handler({ hit: viewer.scene.pick(e.position), latLng: pickLatLng(e.position) });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/* ------------------------------------------------------------ radius */

export const RADIUS_MIN = parseInt($("radiusRange").min, 10);
export const RADIUS_MAX = parseInt($("radiusRange").max, 10);

export function radiusMi() { return parseInt($("radiusRange").value, 10); }

export function syncRadiusOut() { $("radiusOut").textContent = distMi(radiusMi(), 0); }

export function setRadiusMi(mi) {
  if (!Number.isFinite(mi)) return;
  $("radiusRange").value = Math.round(Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, mi)));
  syncRadiusOut();
  drawSelection();
}

/* --------------------------------------------------------- selection */

let circleEntity = null;
let markerEntity = null;

export function drawSelection() {
  const picked = state.picked;
  if (!picked) return;
  const radiusM = radiusMi() * MI_TO_KM * 1000;
  const pos = Cesium.Cartesian3.fromDegrees(picked.lng, picked.lat);
  if (!circleEntity) {
    circleEntity = viewer.entities.add({
      position: pos,
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM,
        material: Cesium.Color.fromCssColorString(BRASS).withAlpha(0.10),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString(BRASS),
        outlineWidth: 2,
        height: 0,
      },
    });
    markerEntity = viewer.entities.add({
      position: pos,
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString(CORAL),
        outlineColor: Cesium.Color.fromCssColorString(NIGHT),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  } else {
    circleEntity.position = pos;
    circleEntity.ellipse.semiMajorAxis = radiusM;
    circleEntity.ellipse.semiMinorAxis = radiusM;
    markerEntity.position = pos;
  }
}

/* drop the circle at a point; `fly` moves the camera to frame it */
export function selectPoint(lat, lng, { fly = true } = {}) {
  state.picked = { lat, lng };
  spinning = false;
  drawSelection();
  if (fly) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, radiusMi() * M_PER_MI_FLIGHT * 3.2),
      duration: 1.4,
    });
  }
  $("analyzeBtn").disabled = false;
  setStatus(lockedStatus(lat, lng));
}

/* circle and marker off the globe, nothing selected */
export function clearSelection() {
  if (circleEntity) { viewer.entities.remove(circleEntity); circleEntity = null; }
  if (markerEntity) { viewer.entities.remove(markerEntity); markerEntity = null; }
  state.picked = null;
  $("analyzeBtn").disabled = true;
}

/* ------------------------------------------------------------- init */

export function initGlobe() {
  viewer.clock.onTick.addEventListener(() => {
    if (spinning) viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.0008);
  });
  viewer.screenSpaceEventHandler.setInputAction(() => { spinning = false; }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
  viewer.screenSpaceEventHandler.setInputAction(() => { spinning = false; }, Cesium.ScreenSpaceEventType.WHEEL);

  // live coordinate readout under the cursor (the instrument strip)
  viewer.screenSpaceEventHandler.setInputAction((e) => {
    const p = pickLatLng(e.endPosition);
    if (p) $("cursorCoords").textContent = `${fmtLat(p.lat)}, ${fmtLon(p.lng)}`;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  // pinch & zoom: stop the browser/Safari from hijacking gestures on the canvas
  ["gesturestart", "gesturechange", "gestureend"].forEach((ev) =>
    $("globe").addEventListener(ev, (e) => e.preventDefault(), { passive: false })
  );
  const ctl = viewer.scene.screenSpaceCameraController;
  ctl.enableZoom = true;
  ctl.zoomEventTypes = [
    Cesium.CameraEventType.WHEEL,
    Cesium.CameraEventType.PINCH,
    Cesium.CameraEventType.RIGHT_DRAG,
  ];

  $("radiusRange").addEventListener("input", () => {
    syncRadiusOut();
    drawSelection();
  });
  syncRadiusOut();
}
