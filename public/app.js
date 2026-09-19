/* GeoScope frontend */

const $ = (id) => document.getElementById(id);
const MI_TO_KM = 1.609344;

let picked = null;          // { lat, lng }
let currentReport = null;
let savedIds = new Set();

/* -------------------------------------------------------- user settings */

const SETTINGS_KEY = "geoscope-settings";
const settings = Object.assign(
  { dist: "both", temp: "both", clock: "12", lang: "en", infraLang: "off" },
  JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
);
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

/* infrastructure category labels per language (app-generated text, so it gets
   a real translation table; place/facility names come from OSM name:* tags) */
const INFRA_LABEL_ORDER = ["Hospitals", "Clinics", "Schools", "Universities", "Police stations", "Fire stations", "Supermarkets", "Places of worship", "Rail stations", "Airports & airfields", "Parks", "Museums"];
const INFRA_I18N = {
  es: ["Hospitales", "Clínicas", "Escuelas", "Universidades", "Comisarías", "Estaciones de bomberos", "Supermercados", "Lugares de culto", "Estaciones de tren", "Aeropuertos y aeródromos", "Parques", "Museos"],
  fr: ["Hôpitaux", "Cliniques", "Écoles", "Universités", "Commissariats", "Casernes de pompiers", "Supermarchés", "Lieux de culte", "Gares ferroviaires", "Aéroports et aérodromes", "Parcs", "Musées"],
  de: ["Krankenhäuser", "Kliniken", "Schulen", "Universitäten", "Polizeiwachen", "Feuerwachen", "Supermärkte", "Gotteshäuser", "Bahnhöfe", "Flughäfen und Flugplätze", "Parks", "Museen"],
  pt: ["Hospitais", "Clínicas", "Escolas", "Universidades", "Delegacias", "Quartéis de bombeiros", "Supermercados", "Locais de culto", "Estações ferroviárias", "Aeroportos e aeródromos", "Parques", "Museus"],
  it: ["Ospedali", "Cliniche", "Scuole", "Università", "Stazioni di polizia", "Caserme dei vigili del fuoco", "Supermercati", "Luoghi di culto", "Stazioni ferroviarie", "Aeroporti e aviosuperfici", "Parchi", "Musei"],
  nl: ["Ziekenhuizen", "Klinieken", "Scholen", "Universiteiten", "Politiebureaus", "Brandweerkazernes", "Supermarkten", "Gebedshuizen", "Treinstations", "Luchthavens en vliegvelden", "Parken", "Musea"],
  pl: ["Szpitale", "Kliniki", "Szkoły", "Uniwersytety", "Komisariaty", "Remizy strażackie", "Supermarkety", "Miejsca kultu", "Stacje kolejowe", "Lotniska", "Parki", "Muzea"],
  sv: ["Sjukhus", "Kliniker", "Skolor", "Universitet", "Polisstationer", "Brandstationer", "Stormarknader", "Gudstjänstlokaler", "Järnvägsstationer", "Flygplatser", "Parker", "Museer"],
  ru: ["Больницы", "Клиники", "Школы", "Университеты", "Полицейские участки", "Пожарные части", "Супермаркеты", "Места богослужения", "Ж/д станции", "Аэропорты и аэродромы", "Парки", "Музеи"],
  uk: ["Лікарні", "Клініки", "Школи", "Університети", "Поліцейські відділки", "Пожежні частини", "Супермаркети", "Місця богослужінь", "Залізничні станції", "Аеропорти та аеродроми", "Парки", "Музеї"],
  tr: ["Hastaneler", "Klinikler", "Okullar", "Üniversiteler", "Polis karakolları", "İtfaiye istasyonları", "Süpermarketler", "İbadet yerleri", "Tren istasyonları", "Havalimanları", "Parklar", "Müzeler"],
  ar: ["المستشفيات", "العيادات", "المدارس", "الجامعات", "مراكز الشرطة", "محطات الإطفاء", "محلات السوبر ماركت", "دور العبادة", "محطات القطار", "المطارات", "الحدائق", "المتاحف"],
  fa: ["بیمارستان‌ها", "درمانگاه‌ها", "مدارس", "دانشگاه‌ها", "کلانتری‌ها", "ایستگاه‌های آتش‌نشانی", "سوپرمارکت‌ها", "اماکن عبادی", "ایستگاه‌های قطار", "فرودگاه‌ها", "پارک‌ها", "موزه‌ها"],
  he: ["בתי חולים", "מרפאות", "בתי ספר", "אוניברסיטאות", "תחנות משטרה", "תחנות כיבוי אש", "סופרמרקטים", "מקומות פולחן", "תחנות רכבת", "שדות תעופה", "פארקים", "מוזיאונים"],
  hi: ["अस्पताल", "क्लिनिक", "स्कूल", "विश्वविद्यालय", "पुलिस थाने", "दमकल केंद्र", "सुपरमार्केट", "पूजा स्थल", "रेलवे स्टेशन", "हवाई अड्डे", "पार्क", "संग्रहालय"],
  zh: ["医院", "诊所", "学校", "大学", "警察局", "消防站", "超市", "宗教场所", "火车站", "机场", "公园", "博物馆"],
  ja: ["病院", "クリニック", "学校", "大学", "警察署", "消防署", "スーパーマーケット", "礼拝所", "鉄道駅", "空港", "公園", "博物館"],
  ko: ["병원", "의원", "학교", "대학교", "경찰서", "소방서", "슈퍼마켓", "예배 장소", "기차역", "공항", "공원", "박물관"],
  vi: ["Bệnh viện", "Phòng khám", "Trường học", "Đại học", "Đồn cảnh sát", "Trạm cứu hỏa", "Siêu thị", "Nơi thờ tự", "Ga đường sắt", "Sân bay", "Công viên", "Bảo tàng"],
  id: ["Rumah sakit", "Klinik", "Sekolah", "Universitas", "Kantor polisi", "Pos pemadam kebakaran", "Supermarket", "Tempat ibadah", "Stasiun kereta", "Bandara", "Taman", "Museum"],
};
function tInfra(label) {
  if (settings.infraLang !== "on" || settings.lang === "en") return label;
  const i = INFRA_LABEL_ORDER.indexOf(label);
  return (INFRA_I18N[settings.lang] && i >= 0 && INFRA_I18N[settings.lang][i]) || label;
}

/* display form for an OSM-named thing: translated (original) when they differ */
function localized(name, localName) {
  return localName && localName !== name ? `${localName} (${name})` : name;
}

const r1 = (v) => Math.round(v * 10) / 10;

function tempStr(c) {
  if (c == null) return "—";
  const f = Math.round((c * 9) / 5 + 32);
  if (settings.temp === "c") return `${r1(c)}°C`;
  if (settings.temp === "f") return `${f}°F`;
  return `${r1(c)}°C / ${f}°F`;
}

/* dual-unit distance: pass whichever unit the source value is in */
function distKm(km, digits = 0) {
  if (km == null) return "—";
  const fmt = (v) => v.toLocaleString(undefined, { maximumFractionDigits: digits });
  if (settings.dist === "mi") return `${fmt(km / MI_TO_KM)} mi`;
  if (settings.dist === "km") return `${fmt(km)} km`;
  return `${fmt(km / MI_TO_KM)} mi / ${fmt(km)} km`;
}
function distMi(mi, digits = 0) { return distKm(mi * MI_TO_KM, digits); }

/* tables show a single unit to stay compact; header names it */
const distUnit = () => (settings.dist === "km" ? "km" : "mi");
const distCell = (km) => (settings.dist === "km" ? km : r1(km / MI_TO_KM));

function areaStr(mi2) {
  const km2 = mi2 * MI_TO_KM * MI_TO_KM;
  const fmt = (v) => Math.round(v).toLocaleString();
  if (settings.dist === "mi") return `${fmt(mi2)} mi²`;
  if (settings.dist === "km") return `${fmt(km2)} km²`;
  return `${fmt(mi2)} mi² / ${fmt(km2)} km²`;
}
function windStr(kmh) {
  if (kmh == null) return "—";
  if (settings.dist === "km") return `${kmh} km/h`;
  const mph = Math.round(kmh / MI_TO_KM);
  return settings.dist === "mi" ? `${mph} mph` : `${kmh} km/h (${mph} mph)`;
}

/* time helpers — everything derives from the IANA zone via Intl */

function fmtHM(hhmm) {
  if (!hhmm || settings.clock === "24") return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function fmtWhen(iso) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric",
    hour: settings.clock === "12" ? "numeric" : "2-digit",
    minute: "2-digit", hour12: settings.clock === "12",
  }).format(new Date(iso));
}

function tzOffsetMin(tz, date) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(date).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
}
function tzAbbr(tz) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value || "";
  } catch { return ""; }
}
/* DST always moves clocks forward, so the standard offset is the smaller of
   the January / July offsets — works in both hemispheres */
function dstInfo(tz) {
  const now = new Date();
  const jan = tzOffsetMin(tz, new Date(Date.UTC(now.getUTCFullYear(), 0, 1)));
  const jul = tzOffsetMin(tz, new Date(Date.UTC(now.getUTCFullYear(), 6, 1)));
  const cur = tzOffsetMin(tz, now);
  const std = Math.min(jan, jul);
  return { observed: jan !== jul, active: cur > std, offsetMin: cur, stdMin: std, abbr: tzAbbr(tz) };
}
function utcOffStr(min) {
  const sign = min < 0 ? "−" : "+";
  return `UTC${sign}${String(Math.floor(Math.abs(min) / 60)).padStart(2, "0")}:${String(Math.abs(min) % 60).padStart(2, "0")}`;
}

/* one global ticker drives every [data-tz-clock] element */
function tickClocks() {
  const now = new Date();
  document.querySelectorAll("[data-tz-clock]").forEach((el) => {
    try {
      el.textContent = new Intl.DateTimeFormat("en-US", {
        timeZone: el.dataset.tzClock,
        weekday: "short", month: "short", day: "numeric",
        hour: settings.clock === "12" ? "numeric" : "2-digit",
        minute: "2-digit", second: "2-digit", hour12: settings.clock === "12",
      }).format(now);
    } catch { /* unknown zone string */ }
  });
}
setInterval(tickClocks, 1000);

/* ------------------------------------------------------------- globe
   CesiumJS streams map tiles, so resolution increases continuously as you
   zoom - down to individual streets - instead of blurring a fixed texture. */

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

const viewer = new Cesium.Viewer("globe", {
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
viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0a1322");
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 60; // ~street level
viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-40, 25, 22_000_000) });

let satOn = true; // satellite imagery is the default basemap
$("layerBtn").addEventListener("click", () => {
  satOn = !satOn;
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.add(new Cesium.ImageryLayer(satOn ? SAT_TILES : DARK_TILES));
  $("layerBtn").textContent = satOn ? "Map view" : "Satellite view";
});

/* pinch & zoom: stop the browser/Safari from hijacking gestures on the canvas */
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

/* explicit zoom buttons as a universal fallback */
function zoomStep(factor) {
  spinning = false;
  const h = viewer.camera.positionCartographic.height;
  if (factor < 1) viewer.camera.zoomIn(h * (1 - factor));
  else viewer.camera.zoomOut(h * (factor - 1));
}
$("zoomIn").addEventListener("click", () => zoomStep(0.45));
$("zoomOut").addEventListener("click", () => zoomStep(2.0));

/* panel fullscreen / hide toggles */
function resizeGlobeSoon() { setTimeout(() => viewer.resize && viewer.resize(), 80); }
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

/* gentle spin until first interaction */
let spinning = true;
viewer.clock.onTick.addEventListener(() => {
  if (spinning) viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.0008);
});
viewer.screenSpaceEventHandler.setInputAction(() => { spinning = false; },
  Cesium.ScreenSpaceEventType.LEFT_DOWN);
viewer.screenSpaceEventHandler.setInputAction(() => { spinning = false; },
  Cesium.ScreenSpaceEventType.WHEEL);

function pickLatLng(screenPos) {
  const cart = viewer.camera.pickEllipsoid(screenPos, viewer.scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return { lat: Cesium.Math.toDegrees(c.latitude), lng: Cesium.Math.toDegrees(c.longitude) };
}

viewer.screenSpaceEventHandler.setInputAction((e) => {
  // a click on a plotted highlight toggles its name instead of moving the selection
  const picked = viewer.scene.pick(e.position);
  if (picked?.id && tempPins.includes(picked.id)) {
    toggleTempPinName(picked.id);
    return;
  }
  if (picked?.id?._isSat) {
    const ent = picked.id;
    trackSat(ent._rec); // lock the camera onto it and follow
    openWikiPop({ name: ent._satName, norad: ent._norad });
    return;
  }
  const p = pickLatLng(e.position);
  if (p) selectPoint(p.lat, p.lng, { fly: false });
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// live coordinate readout under the cursor (the instrument strip)
viewer.screenSpaceEventHandler.setInputAction((e) => {
  const p = pickLatLng(e.endPosition);
  if (p) $("cursorCoords").textContent = `${fmtLat(p.lat)}, ${fmtLon(p.lng)}`;
}, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

function fmtLat(v) { return `${Math.abs(v).toFixed(4)}°${v >= 0 ? "N" : "S"}`; }
function fmtLon(v) { return `${Math.abs(v).toFixed(4)}°${v >= 0 ? "E" : "W"}`; }

function radiusMi() { return parseInt($("radiusRange").value, 10); }

let circleEntity = null;
let markerEntity = null;

function drawSelection() {
  if (!picked) return;
  const radiusM = radiusMi() * MI_TO_KM * 1000;
  const pos = Cesium.Cartesian3.fromDegrees(picked.lng, picked.lat);
  if (!circleEntity) {
    circleEntity = viewer.entities.add({
      position: pos,
      ellipse: {
        semiMajorAxis: radiusM,
        semiMinorAxis: radiusM,
        material: Cesium.Color.fromCssColorString("#d9a441").withAlpha(0.10),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#d9a441"),
        outlineWidth: 2,
        height: 0,
      },
    });
    markerEntity = viewer.entities.add({
      position: pos,
      point: {
        pixelSize: 9,
        color: Cesium.Color.fromCssColorString("#ff6b5e"),
        outlineColor: Cesium.Color.fromCssColorString("#0a1322"),
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

function selectPoint(lat, lng, { fly = true } = {}) {
  picked = { lat, lng };
  spinning = false;
  drawSelection();
  if (fly) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, radiusMi() * 1609 * 3.2),
      duration: 1.4,
    });
  }
  $("analyzeBtn").disabled = false;
  $("readoutStatus").textContent = `target locked · ${fmtLat(lat)} ${fmtLon(lng)}`;
}

function syncRadiusOut() { $("radiusOut").textContent = distMi(radiusMi(), 0); }
$("radiusRange").addEventListener("input", () => {
  syncRadiusOut();
  drawSelection();
});
syncRadiusOut();

/* temporary highlights: teal pins that pulse, then remove themselves.
   A new highlight (single pin or category group) replaces the previous one. */
const TEAL = "#4fc4a8";
let tempPins = [];
let tempPinTimer = null;
let activePlot = null; // "all" | "cat:<label>" | null — category plots toggle, they don't expire

/* what the readout strip should say when no highlight message is active */
function defaultStatus() {
  if (currentReport) return currentReport.pending?.size ? null : "report complete"; // null: live ticker owns it
  return picked ? `target locked · ${fmtLat(picked.lat)} ${fmtLon(picked.lng)}` : "hover the globe";
}
let statusRevertTimer = null;
function flashStatus(text, ms = 6000) {
  $("readoutStatus").textContent = text;
  clearTimeout(statusRevertTimer);
  statusRevertTimer = setTimeout(() => {
    const d = defaultStatus();
    if (d) $("readoutStatus").textContent = d;
  }, ms);
}

function clearTempHighlights() {
  clearTimeout(tempPinTimer);
  tempPins.forEach((e) => viewer.entities.remove(e));
  tempPins = [];
  activePlot = null;
  $("infraLegend").hidden = true;
  document.querySelectorAll(".infra-all-btn").forEach((b) => { b.textContent = "◎ Plot all on globe"; });
  const d = defaultStatus();
  if (d) $("readoutStatus").textContent = d; // drop stale "N highlighted…" messages
}

/* clicking a plotted point toggles its name label */
function toggleTempPinName(ent) {
  if (!ent._pinName || !ent.label) return;
  ent._nameOn = !ent._nameOn;
  ent.label.show = ent._nameOn;
}

/* Cesium's label renderer strips emoji to monochrome glyphs, so icons are
   pre-rendered on a 2D canvas (which does color emoji) and used as billboards */
const emojiImageCache = new Map();
function emojiImage(emoji) {
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

function showPlotLegend(title, rowsHtml, note) {
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

function prepGlobeForHighlight() {
  spinning = false;
  document.body.classList.remove("panel-full"); // pins are pointless with the globe hidden
  resizeGlobeSoon();
  clearTempHighlights();
}

function tealPoint(born, size) {
  return {
    pixelSize: new Cesium.CallbackProperty(() => size + 3 * Math.sin((Date.now() - born) / 280), false),
    color: Cesium.Color.fromCssColorString(TEAL),
    outlineColor: Cesium.Color.fromCssColorString("#0a1322"),
    outlineWidth: 2,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}
function tealLabel(text) {
  return {
    text,
    font: "13px 'IBM Plex Mono', monospace",
    fillColor: Cesium.Color.fromCssColorString(TEAL),
    outlineColor: Cesium.Color.fromCssColorString("#0a1322"),
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(0, -22),
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

function pinpointOnGlobe(lat, lon, name) {
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
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(15000, radiusMi() * 1609 * 2.2)),
    duration: 1.0,
  });
  tempPinTimer = setTimeout(clearTempHighlights, 8000);
}

/* category icons for the all-categories plot — each facility renders as its
   emoji so categories stay distinguishable in a mixed cloud */
const INFRA_ICONS = {
  "Hospitals": "🏥", "Clinics": "🩺", "Schools": "🏫", "Universities": "🎓",
  "Police stations": "🚓", "Fire stations": "🚒", "Supermarkets": "🛒",
  "Places of worship": "⛪", "Rail stations": "🚉", "Airports & airfields": "✈️",
  "Parks": "🌳", "Museums": "🏛️",
};

async function showAllInfra(rep, btn) {
  if (activePlot === "all") {
    clearTempHighlights();
    btn.textContent = "◎ Plot all on globe";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Plotting…";
  try {
    const r = await fetch(`/api/infrapoints?cat=*&lat=${rep.lat}&lon=${rep.lon}&radius_mi=${rep.radiusMi}&lang=${encodeURIComponent(settings.lang)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (!j.data.length) {
      flashStatus("no mapped facility coordinates returned");
      btn.textContent = "◎ Plot all on globe";
      return;
    }
    prepGlobeForHighlight();
    activePlot = "all";
    const counts = {};
    for (const p of j.data) {
      counts[p.cat] = (counts[p.cat] || 0) + 1;
      const icon = INFRA_ICONS[p.cat] || "•";
      // click-label always carries the (translated) category, so even facilities
      // without an OSM name:lang tag get a translated context line
      const pinName = `${p.name ? localized(p.name, p.localName) : "(unnamed)"} · ${tInfra(p.cat)}`;
      const ent = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
        billboard: {
          image: emojiImage(icon),
          scale: 0.55,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: { ...tealLabel(pinName), show: false, pixelOffset: new Cesium.Cartesian2(0, -28) },
      });
      ent._pinName = pinName;
      ent._nameOn = false;
      ent._cat = p.cat;
      tempPins.push(ent);
    }
    showPlotLegend("Facilities in the circle",
      Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([cat, n]) =>
        `<div class="il-row il-toggle" data-cat="${esc(cat)}" title="Click to hide/show" role="button"><span class="il-ico">${INFRA_ICONS[cat] || "•"}</span><span class="il-cat">${esc(tInfra(cat))}</span><span class="il-n mono">${n}</span></div>`).join(""),
      j.truncated ? "dense categories capped at 60" : null);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(rep.lon, rep.lat, Math.max(15000, rep.radiusMi * 1609 * 3.2)),
      duration: 1.0,
    });
    $("readoutStatus").textContent = `${j.data.length} facilities plotted across ${Object.keys(counts).length} categories`;
    btn.textContent = "✕ Clear plotted points";
  } catch (e) {
    flashStatus(`couldn't plot facilities — ${e.message}`);
    btn.textContent = "◎ Plot all on globe";
  } finally {
    btn.disabled = false;
  }
}

/* surveillance device plotting — data is already in the report payload */
const SURV_CATS = [
  ["alpr", "License plate readers (ALPR)"],
  ["camera", "Surveillance cameras"],
  ["speed", "Speed cameras"],
  ["gunshot", "Gunshot detectors"],
];
const SURV_ICONS = { alpr: "📸", camera: "📹", speed: "🚦", gunshot: "🔊" };
const SURV_NAMES = Object.fromEntries(SURV_CATS);

function showSurveillancePoints(rep, cat = null) {
  const plotKey = cat ? `surv:${cat}` : "surv";
  if (activePlot === plotKey) {
    clearTempHighlights();
    return;
  }
  const pts = (rep.surveillance?.points || []).filter((p) => !cat || p.cat === cat);
  if (!pts.length) return;
  prepGlobeForHighlight();
  activePlot = plotKey;
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
    const ent = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat),
      billboard: {
        image: emojiImage(SURV_ICONS[p.cat] || "📷"),
        scale: 0.55,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: { ...tealLabel(detail), show: false, pixelOffset: new Cesium.Cartesian2(0, -28) },
    });
    ent._pinName = detail;
    ent._nameOn = false;
    ent._cat = p.cat;
    tempPins.push(ent);
  }
  showPlotLegend("Surveillance devices",
    SURV_CATS.filter(([k]) => counts[k]).map(([k, label]) =>
      `<div class="il-row il-toggle" data-cat="${k}" title="Click to hide/show" role="button"><span class="il-ico">${SURV_ICONS[k]}</span><span class="il-cat">${esc(label)}</span><span class="il-n mono">${counts[k]}</span></div>`).join(""),
    rep.surveillance.truncated ? "capped at 400" : null);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(rep.lon, rep.lat, Math.max(15000, rep.radiusMi * 1609 * 3.2)),
    duration: 1.0,
  });
  $("readoutStatus").textContent = `${pts.length} ${cat ? (SURV_NAMES[cat] || cat).toLowerCase() : `surveillance device position${pts.length === 1 ? "" : "s"}`} plotted — click again or ✕ to clear`;
}

/* Languages row in Location & terrain — the country's official language(s),
   from the same dataset as the currency row. */
function languageRowHtml(rep) {
  const l = rep.location || {};
  const langs = l.languages || null;
  if (!langs?.length) return "";
  return `<dt>Languages</dt><dd>${esc(langs.join(", "))} <span class="dim">(official · ${esc(l.country || "country")})</span></dd>`;
}

/* highlight every point of one infrastructure category inside the circle;
   clicking the same chip again clears it (toggle) */
async function showInfraPoints(rep, label, chipEl) {
  if (activePlot === `cat:${label}`) { clearTempHighlights(); return; }
  if (chipEl.classList.contains("chip-busy")) return;
  chipEl.classList.add("chip-busy");
  try {
    const r = await fetch(`/api/infrapoints?cat=${encodeURIComponent(label)}&lat=${rep.lat}&lon=${rep.lon}&radius_mi=${rep.radiusMi}&lang=${encodeURIComponent(settings.lang)}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (!j.data.length) {
      flashStatus(`no mapped coordinates returned for ${label.toLowerCase()}`);
      return;
    }
    prepGlobeForHighlight();
    activePlot = `cat:${label}`;
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
      tempPins.push(ent);
    }
    showPlotLegend("Highlighted", `<div class="il-row il-toggle" data-cat="${esc(label)}" title="Click to hide/show" role="button"><span class="il-ico">◎</span><span class="il-cat">${esc(tInfra(label))}</span><span class="il-n mono">${j.data.length}</span></div>`,
      j.truncated ? "first 150 shown" : null);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(rep.lon, rep.lat, Math.max(15000, rep.radiusMi * 1609 * 3.2)),
      duration: 1.0,
    });
    $("readoutStatus").textContent = `${j.data.length} ${label.toLowerCase()} highlighted — click the chip again or ✕ to clear`;
  } catch (e) {
    flashStatus(`couldn't load ${label.toLowerCase()} — ${e.message}`);
  } finally {
    chipEl.classList.remove("chip-busy");
  }
}

/* radius fine-controls: ± steppers and click-to-type on the readout */

const RADIUS_MIN = parseInt($("radiusRange").min, 10);
const RADIUS_MAX = parseInt($("radiusRange").max, 10);

function setRadiusMi(mi) {
  if (!Number.isFinite(mi)) return;
  $("radiusRange").value = Math.round(Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, mi)));
  syncRadiusOut();
  drawSelection();
}
$("radMinus").addEventListener("click", () => setRadiusMi(radiusMi() - 1));
$("radPlus").addEventListener("click", () => setRadiusMi(radiusMi() + 1));

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

/* --------------------------------------------------- shareable permalink
   The current report's spot lives in the URL hash so a report is linkable and
   bookmarkable. Format: #@<lat>,<lon>,<radius> — lat/lon to 5 decimals (~1 m,
   plenty for a circle), radius an integer of miles. We remember the last hash
   WE wrote so the hashchange listener can tell a user/back-button navigation
   apart from our own write and not re-analyze in a loop. */

let lastWrittenHash = null;

function permalinkFor(lat, lon, radiusMi) {
  return `#@${lat.toFixed(5)},${lon.toFixed(5)},${Math.round(radiusMi)}`;
}

/* parse "#@lat,lon,radius" -> {lat, lon, radius}; null for anything malformed */
function parseLocationHash(hash) {
  const m = /^#@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+)$/.exec(hash || "");
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]), radius = parseInt(m[3], 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radius)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, radius };
}

/* point the URL at the spot a report was just run for, without spamming
   browser history; record it so our own hashchange is ignored below */
function writeLocationHash(lat, lon, radiusMi) {
  const hash = permalinkFor(lat, lon, radiusMi);
  if (location.hash === hash) return;
  lastWrittenHash = hash;
  history.replaceState(null, "", location.pathname + location.search + hash);
}

/* run the analysis described by a hash; shared by initial load and hashchange */
function analyzeFromHash(hash) {
  const loc = parseLocationHash(hash);
  if (!loc) return; // malformed or absent — ignore silently
  selectPoint(loc.lat, loc.lon);
  setRadiusMi(loc.radius);
  showTab("explore");
  $("analyzeBtn").click(); // same path the button uses; it will rewrite the hash
}

/* a hashchange we didn't cause (manual edit, bookmark, back/forward) re-runs */
window.addEventListener("hashchange", () => {
  if (location.hash === lastWrittenHash) return; // our own write — don't loop
  analyzeFromHash(location.hash);
});

/* --------------------------------------------------- search to fly
   Type a place name (Nominatim forward geocode) or paste "lat, lon"; pick a
   result and the camera flies there and drops the circle — exactly the state a
   globe click produces, so analysis stays coordinate-keyed. The full display
   name lets the user disambiguate same-named places before analyzing. */
const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

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

/* on the Space tab the same box searches the loaded objects by name and the
   camera locks onto the one you pick — a place search up there is meaningless */
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
  const m = COORD_RE.exec(q); // raw coordinates short-circuit the API entirely
  if (m) {
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { flyToResult(lat, lon, `${lat}, ${lon}`); return; }
  }
  const seq = ++searchSeq;
  const box = $("searchResults");
  box.hidden = false; box.innerHTML = `<p class="sr-msg">Searching…</p>`;
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(settings.lang)}`);
    const j = await r.json();
    if (seq !== searchSeq) return; // a newer keystroke superseded this search
    if (!r.ok) { box.innerHTML = `<p class="sr-msg">${esc(j.error || "Search failed.")}</p>`; return; }
    renderSearchResults(j.results || []);
  } catch {
    if (seq === searchSeq) box.innerHTML = `<p class="sr-msg">Search failed — check your connection.</p>`;
  }
}

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

/* ------------------------------------------------------------ analyze */

const SOURCES = ["geocode", "settlements", "weather", "history", "people", "landmarks", "elevation", "airquality", "infrastructure", "surveillance", "earthquakes", "news"];
const SOURCE_LABELS = {
  geocode: "Reverse geocode (Nominatim)",
  settlements: "Settlements in circle (Overpass)",
  weather: "Current weather (Open-Meteo)",
  history: "12-month weather history (Open-Meteo archive)",
  people: "Notable people (Wikidata)",
  landmarks: "Landmarks (Wikipedia)",
  elevation: "Elevation (Open-Meteo)",
  airquality: "Air quality (Open-Meteo AQ model)",
  infrastructure: "Infrastructure census (Overpass)",
  surveillance: "Surveillance devices (OSM / DeFlock-sourced)",
  earthquakes: "Seismic history (USGS)",
  news: "Recent news (Google News, place-verified)",
};
const SHORT = { geocode: "geocode", settlements: "settlements", weather: "weather", history: "weather history", people: "notable people", landmarks: "landmarks", elevation: "elevation", airquality: "air quality", infrastructure: "infrastructure", surveillance: "surveillance", earthquakes: "earthquakes", news: "news" };

/* sources that can't start until another has produced what they consume:
   news needs the geocoded place names */
const DEPENDS_ON = { news: "geocode" };
const DEPENDENT_SOURCES = Object.keys(DEPENDS_ON);
const INITIAL_SOURCES = SOURCES.filter((s) => !DEPENDENT_SOURCES.includes(s));

let statusTicker = null;

$("analyzeBtn").addEventListener("click", () => {
  if (!picked) return;
  showTab("explore");
  $("emptyState").hidden = true;

  const radius = radiusMi();
  const rep = {
    lat: picked.lat, lon: picked.lng, radiusMi: radius,
    radiusKm: Math.round(radius * MI_TO_KM * 10) / 10,
    queriedAt: new Date().toISOString(),
    location: null, settlements: null, weather: null, history: { months: [] },
    people: null, landmarks: null, elevationM: null,
    air: null, infrastructure: null, surveillance: null, quakes: null, news: null,
    estimatedPopulation: null, summary: null, sourceErrors: [],
    pending: new Set(),
    sourceStatus: Object.fromEntries(SOURCES.map((s) => [s, { state: "queued" }])),
  };
  currentReport = rep;

  // make this exact spot+radius linkable; reflects what's analyzed, not the
  // live slider, and is suppressed in the hashchange listener so it can't loop
  writeLocationHash(rep.lat, rep.lon, rep.radiusMi);

  for (const s of DEPENDENT_SOURCES) rep.sourceStatus[s] = { state: "queued", note: `waits for ${SHORT[DEPENDS_ON[s]]}` };

  clearInterval(statusTicker);
  statusTicker = setInterval(() => { if (rep.pending.size) renderLive(rep); }, 500);

  Promise.allSettled(INITIAL_SOURCES.map((src) => fetchPart(rep, src)));
  renderLive(rep);
});

/* wipe the current Explore analysis: panel back to the empty state, circle
   and marker off the globe; in-flight fetches are orphaned safely because
   every render/finalize path checks currentReport identity first */
function clearExplore() {
  clearInterval(statusTicker);
  currentReport = null;
  $("report").hidden = true;
  $("report").innerHTML = "";
  $("emptyState").hidden = false;
  if (circleEntity) { viewer.entities.remove(circleEntity); circleEntity = null; }
  if (markerEntity) { viewer.entities.remove(markerEntity); markerEntity = null; }
  picked = null;
  $("analyzeBtn").disabled = true;
  clearTempHighlights(); // plotted points belonged to this report; also resets the readout
  // drop the permalink so a reload doesn't resurrect the report we just cleared
  if (location.hash) {
    lastWrittenHash = "";
    history.replaceState(null, "", location.pathname + location.search);
  }
}

function renderLive(rep) {
  if (currentReport !== rep) return; // superseded by a newer analysis
  renderReport(rep, $("report"), { saveable: true });
  $("report").hidden = false;
  const done = SOURCES.length - rep.pending.size;
  $("readoutStatus").textContent = rep.pending.size
    ? `gathering ${done}/${SOURCES.length} — waiting on ${[...rep.pending].map((s) => SHORT[s]).join(", ")}`
    : "report complete";
}

async function fetchPart(rep, src) {
  const st = rep.sourceStatus[src];
  st.state = "fetching"; st.started = performance.now(); st.error = null; st.note = null;
  rep.pending.add(src);
  renderLive(rep);
  try {
    let qs = `lat=${rep.lat}&lon=${rep.lon}&radius_mi=${rep.radiusMi}&lang=${encodeURIComponent(settings.lang)}`;
    if (src === "news") {
      const l = rep.location || {};
      if (l.ocean || (!l.locality && !l.county && !l.state && !l.country)) {
        throw new Error("No verified place names here to search news for.");
      }
      const extra = (rep.settlements || []).map((s) => s.name).filter((n) => n && n !== l.locality).slice(0, 2).join("|");
      qs += "&" + new URLSearchParams({
        locality: l.locality || "", county: l.county || "",
        state: l.state || "", country: l.country || "", extra,
      }).toString();
    }
    const r = await fetch(`/api/part/${src}?${qs}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    if (src === "geocode") rep.location = j.data;
    else if (src === "settlements") {
      // new shape is {list, enclosing}; saved reports from older versions are bare arrays
      rep.settlements = Array.isArray(j.data) ? j.data : j.data.list;
      rep.enclosing = Array.isArray(j.data) ? null : j.data.enclosing;
    }
    else if (src === "weather") rep.weather = j.data;
    else if (src === "history") rep.history = j.data;
    else if (src === "people") rep.people = j.data;
    else if (src === "landmarks") rep.landmarks = j.data;
    else if (src === "elevation") rep.elevationM = j.data;
    else if (src === "airquality") rep.air = j.data;
    else if (src === "infrastructure") rep.infrastructure = j.data;
    else if (src === "surveillance") rep.surveillance = j.data;
    else if (src === "earthquakes") rep.quakes = j.data;
    else if (src === "news") rep.news = j.data;
    st.state = "done";
  } catch (e) {
    st.state = "failed";
    st.error = e.message;
  } finally {
    st.ms = Math.round(performance.now() - st.started);
    rep.pending.delete(src);
    // chain: launch any dependent source now that the one it waits on finished
    for (const dep of DEPENDENT_SOURCES) {
      if (DEPENDS_ON[dep] !== src || rep.sourceStatus[dep]?.state !== "queued") continue;
      if (st.state === "done") fetchPart(rep, dep);
      else rep.sourceStatus[dep] = { state: "failed", error: `Skipped — ${SHORT[src]} failed.`, ms: 0 };
    }
    renderLive(rep);
    if (!rep.pending.size) finalize(rep);
  }
}

async function finalize(rep) {
  if (currentReport !== rep || rep.pending.size || rep.finalized) return;
  if (DEPENDENT_SOURCES.some((s) => rep.sourceStatus[s]?.state === "queued")) return; // a prerequisite still running
  rep.finalized = true;
  clearInterval(statusTicker);
  rep.sourceErrors = SOURCES.filter((s) => rep.sourceStatus[s].state === "failed").map((s) => SHORT[s]);
  rep.estimatedPopulation = (rep.settlements || [])
    .filter((s) => s.population)
    .reduce((s, x) => s + x.population, 0) || null;
  try {
    const { pending, sourceStatus, ...payload } = rep;
    const r = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report: payload }),
    });
    if (r.ok) rep.summary = (await r.json()).summary;
  } catch { /* summary box keeps fallback text */ }
  renderLive(rep);
}

/* ------------------------------------------------------------- render */

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
const F = (c) => Math.round((c * 9) / 5 + 32);
const num = (n) => (n == null ? "—" : n.toLocaleString());

function placeTitle(rep) {
  const l = rep.location || {};
  if (l.ocean) return "Open water";
  return l.locality || l.county || l.state || l.country || "Unnamed area";
}

/* collapsible report section — collapsed by default so the report reads as a
   scannable index; open state survives live re-renders via rep._open */
function sec(rep, key, titleHtml, bodyHtml, loading = false) {
  const open = rep._open instanceof Set && rep._open.has(key) ? " open" : "";
  return `<details class="block" data-sec="${key}"${open}>
    <summary><h3>${titleHtml}${loading ? ' <span class="dot"></span>' : ""}</h3></summary>
    ${bodyHtml}
  </details>`;
}

function renderReport(rep, mount, { saveable }) {
  const pend = (src) => rep.pending?.has(src);
  const loadingRow = `<p class="dim sect-loading"><span class="dot"></span> loading…</p>`;
  const l = rep.location || {};
  const hierarchy = [l.locality, l.county, l.state, l.country].filter(Boolean).join(" · ");
  const w = rep.weather;
  const cw = w?.current;

  let html = `
    <div class="r-head">
      ${saveable ? `<button id="clearReportBtn" class="r-clear" title="Clear this report and the circle" aria-label="Clear this report and the circle">✕</button>` : ""}
      <div class="r-place">${pend("geocode") ? "Locating…" : esc(placeTitle(rep))}</div>
      <div class="r-context">${esc(hierarchy || l.displayName || "")}</div>
      <div class="r-coords mono">${fmtLat(rep.lat)} &nbsp; ${fmtLon(rep.lon)} &nbsp; · &nbsp; ${distMi(rep.radiusMi, 1)} radius</div>
    </div>`;

  if (rep.summary) {
    html += `<p class="summary">${esc(rep.summary)}</p>`;
  } else if (rep.pending?.size) {
    html += `<p class="summary dim">Summary will appear once all sources report in…</p>`;
  }

  /* live source status board (only on the active analysis, not saved entries) */
  if (saveable && rep.sourceStatus) {
    const allDone = !rep.pending?.size;
    const failures = SOURCES.filter((s) => rep.sourceStatus[s].state === "failed");
    const doneCount = SOURCES.filter((s) => rep.sourceStatus[s].state === "done").length;
    const open = rep._open instanceof Set && rep._open.has("sources") ? " open" : "";
    html += `<details class="status-board${allDone && !failures.length ? " all-good" : ""}${allDone ? "" : " working"}" data-sec="sources"${open}>
      <summary><h3>Data sources <span class="n${allDone && !failures.length ? " ok" : ""}">${doneCount}/${SOURCES.length}</span>
        ${allDone
          ? (failures.length ? `<span class="n">· ${failures.length} failed</span>` : `<span class="n ok">· all reported</span>`)
          : `<span class="working-note"><span class="dot"></span> gathering…</span>`}
      </h3></summary>`;
    for (const src of SOURCES) {
      const st = rep.sourceStatus[src];
      let stateHtml;
      if (st.state === "queued") {
        stateHtml = `<span class="st dim">queued${st.note ? ` — ${esc(st.note)}` : ""}</span>`;
      } else if (st.state === "fetching") {
        const secs = ((performance.now() - st.started) / 1000).toFixed(1);
        stateHtml = `<span class="st fetching"><span class="dot"></span> fetching… ${secs}s</span>`;
      } else if (st.state === "done") {
        stateHtml = `<span class="st ok">✓ ${(st.ms / 1000).toFixed(1)}s</span>`;
      } else {
        stateHtml = `<span class="st fail">✕ ${esc(st.error || "failed")}</span> <button class="mini retry-btn" data-src="${src}">Retry</button>`;
      }
      html += `<div class="status-row"><span class="src-name">${esc(SOURCE_LABELS[src])}</span>${stateHtml}</div>`;
    }
    html += `</details>`;
  }

  if (saveable) {
    const ready = !rep.pending?.size;
    html += `<div class="actions">
      <button id="saveBtn" class="ghost" ${ready ? "" : "disabled"} title="Adds an immutable snapshot to this exact spot's timeline in Saved lookups">${ready ? "Save snapshot" : "Gathering data…"}</button>
      <button id="watchBtn" class="ghost" ${ready ? "" : "disabled"} title="Re-check this area on a schedule and log what changes">${ready ? "Watch this area" : "…"}</button>
      <button id="copyLinkBtn" class="ghost" title="Copy a shareable link to this exact spot and radius">🔗 Copy link</button>
    </div>`;
  }

  /* location + terrain */
  const flag = l.countryCode && l.countryCode.length === 2
    ? String.fromCodePoint(...[...l.countryCode].map((c) => 127397 + c.charCodeAt(0))) + " "
    : "";
  html += `<div class="sec-tools">
    <button class="mini" data-secall="open">Expand all sections</button>
    <button class="mini" data-secall="close">Collapse all</button>
  </div>`;

  html += sec(rep, "location", "Location & terrain", `
      <dl class="kv">
        <dt>Full address match</dt><dd style="font-family:var(--font-body)">${esc(l.displayName || "—")}</dd>
        <dt>Country</dt><dd>${flag}${esc(l.country || "—")}${l.countryCode ? ` (${esc(l.countryCode)})` : ""}</dd>
        ${l.currency ? `<dt>Currency</dt><dd>${esc(l.currency.name || l.currency.code)} (${esc(l.currency.code)}${l.currency.symbol && l.currency.symbol !== l.currency.code ? ` · ${esc(l.currency.symbol)}` : ""})${l.currency.perUsd ? `<span class="dim"> · 1 USD ≈ ${l.currency.perUsd} ${esc(l.currency.code)}</span>` : ""}</dd>` : ""}
        ${languageRowHtml(rep)}
        <dt>State / region</dt><dd>${esc(l.state || "—")}</dd>
        <dt>County / district</dt><dd>${esc(l.county || "—")}</dd>
        <dt>Latitude</dt><dd>${rep.lat.toFixed(6)}°</dd>
        <dt>Longitude</dt><dd>${rep.lon.toFixed(6)}°</dd>
        <dt>Elevation (center)</dt><dd>${rep.elevationM != null ? `${Math.round(rep.elevationM)} m / ${Math.round(rep.elevationM * 3.281)} ft` : "—"}</dd>
        <dt>Time zone</dt><dd>${esc(w?.timezone || "—")}</dd>
      </dl>`, pend("geocode"));

  html += timeBlock(w?.timezone, rep);

  /* circle geometry & global position - computed, always instant */
  {
    const rMi = rep.radiusMi;
    const areaMi2 = Math.PI * rMi * rMi;
    const eqKm = Math.abs(rep.lat) * 111.32;
    const poleKm = (90 - Math.abs(rep.lat)) * 111.32;
    const antiLat = -rep.lat;
    const antiLon = rep.lon > 0 ? rep.lon - 180 : rep.lon + 180;
    const densityArea = settings.dist === "km" ? areaMi2 * MI_TO_KM * MI_TO_KM : areaMi2;
    const density = rep.estimatedPopulation ? Math.round(rep.estimatedPopulation / densityArea) : null;
    html += sec(rep, "geometry", "Circle geometry & global position", `
      <dl class="kv">
        <dt>Circle area</dt><dd>${areaStr(areaMi2)}</dd>
        <dt>Circumference</dt><dd>${distMi(2 * Math.PI * rMi)}</dd>
        <dt>Pop. density (est.)</dt><dd>${density ? `~${density.toLocaleString()} / ${distUnit()}²` : "—"}</dd>
        <dt>Hemisphere</dt><dd>${rep.lat >= 0 ? "Northern" : "Southern"} · ${rep.lon >= 0 ? "Eastern" : "Western"}</dd>
        <dt>Distance to equator</dt><dd>${distKm(eqKm)}</dd>
        <dt>Distance to ${rep.lat >= 0 ? "North" : "South"} Pole</dt><dd>${distKm(poleKm)}</dd>
        <dt>Antipode</dt><dd>${fmtLat(antiLat)}, ${fmtLon(antiLon)}</dd>
      </dl>`);
  }

  /* settlements & population */
  const setts = rep.settlements || [];
  {
    const LEVEL_NAMES = { 6: "County / district", 7: "Municipality", 8: "City / municipality", 9: "District / borough", 10: "Neighborhood" };
    let encl = "";
    if (rep.enclosing?.length) {
      encl = `<dl class="kv" style="margin-bottom:14px">` + rep.enclosing.map((p) =>
        `<dt>${esc(LEVEL_NAMES[p.adminLevel] || "Inside")}</dt><dd>${esc(localized(p.name, p.localName))}${p.population ? ` · pop. ~${p.population.toLocaleString()}` : ""}</dd>`).join("") + `</dl>
      <p class="dim" style="font-size:11.5px;margin-bottom:14px">At this radius the circle can sit inside a town without containing its mapped center-point, so the places above are resolved by boundary containment — they hold the point itself, whatever the circle size.</p>`;
    }
    let body;
    if (pend("settlements")) {
      body = loadingRow;
    } else if (setts.length) {
      body = encl + `<dl class="kv" style="margin-bottom:14px">
        <dt>Est. population</dt><dd>${rep.estimatedPopulation ? "~" + num(rep.estimatedPopulation) : "no census tags found"}</dd>
      </dl>
      <table><thead><tr><th>Name</th><th>Type</th><th class="num">Population</th><th class="num">Dist (${distUnit()})</th></tr></thead><tbody>`;
      for (const s of setts.slice(0, 40)) {
        const disp = s.localName && s.localName !== s.name
          ? `${esc(s.localName)} <span class="dim">(${esc(s.name)})</span>`
          : esc(s.name);
        body += `<tr><td><button class="wiki-peek" title="Preview the Wikipedia article for ${esc(s.name)}"
          data-name="${esc(s.name)}" data-wikidata="${esc(s.wikidata || "")}" data-wikipedia="${esc(s.wikipedia || "")}"
          data-lat="${s.lat}" data-lon="${s.lon}">${disp}</button>
          <button class="pin-btn" title="Highlight ${esc(s.name)} on the globe" aria-label="Highlight ${esc(s.name)} on the globe"
          data-name="${esc(localized(s.name, s.localName))}" data-lat="${s.lat}" data-lon="${s.lon}">◎</button></td><td class="dim">${esc(s.type)}</td><td class="num">${num(s.population)}</td><td class="num">${distCell(s.distanceKm)}</td></tr>`;
      }
      body += `</tbody></table>`;
      if (setts.length > 40) body += `<p class="dim" style="font-size:12px;margin-top:8px">…and ${setts.length - 40} more.</p>`;
      body += `<p class="dim" style="font-size:11.5px;margin-top:10px">Population sums OpenStreetMap census tags for places inside the circle; settlements without a recorded figure are excluded, so treat it as a floor, not an exact count.</p>`;
    } else {
      body = encl + `<p class="dim">No settlement center-points inside this radius${rep.enclosing?.length ? " — but the place(s) above contain it" : ""}.</p>`;
    }
    html += sec(rep, "settlements", `Settlements in the circle ${pend("settlements") ? "" : `<span class="n">${setts.length}</span>`}`, body, pend("settlements"));
  }

  /* infrastructure census */
  if (pend("infrastructure")) {
    html += sec(rep, "infrastructure", "Infrastructure in the circle", loadingRow, true);
  } else if (rep.infrastructure?.length) {
    let chips = "";
    for (const c of rep.infrastructure) {
      const clickable = c.count != null && c.count > 0;
      chips += `<div class="chip${clickable ? " chip-click" : ""}"${clickable ? ` data-cat="${esc(c.label)}" title="Click to highlight all ${esc(c.label.toLowerCase())} on the globe" role="button" tabindex="0"` : ""}><span class="chip-n">${c.count == null ? "—" : c.count.toLocaleString()}</span><span class="chip-l">${esc(tInfra(c.label))}</span></div>`;
    }
    const infraMissing = rep.infrastructure.some((c) => c.count == null);
    html += sec(rep, "infrastructure", "Infrastructure in the circle",
      `<div class="chip-grid">${chips}</div>
      <div style="margin-top:10px"><button class="mini infra-all-btn">◎ Plot all on globe</button></div>
      ${infraMissing ? `<p class="dim" style="font-size:11.5px;margin-top:10px">Categories showing “—” exceeded the map server's time budget — a big circle over a dense region is a huge scan. Retry the infrastructure source in Data sources to fill them, or use a smaller radius for a complete census.</p>` : ""}
      <p class="dim" style="font-size:11.5px;margin-top:10px">Counts of OpenStreetMap-mapped facilities inside the radius; coverage varies by region, so treat as minimums. Click a category to light up its points, or plot everything at once with per-category icons.</p>`);
  }

  /* surveillance devices */
  if (pend("surveillance")) {
    html += sec(rep, "surveillance", "Surveillance devices", loadingRow, true);
  } else if (rep.surveillance) {
    const sv = rep.surveillance;
    let sbody = `<div class="chip-grid">`;
    for (const [key, label] of SURV_CATS) {
      const clickable = sv.counts[key] > 0;
      sbody += `<div class="chip${clickable ? " chip-click" : ""}"${clickable ? ` data-survcat="${key}" title="Click to plot ${esc(label.toLowerCase())} on the globe" role="button" tabindex="0"` : ""}><span class="chip-n">${sv.counts[key].toLocaleString()}</span><span class="chip-l">${esc(label)}</span></div>`;
    }
    sbody += `</div>`;
    if (sv.total) {
      sbody += `<div style="margin-top:10px"><button class="mini surv-plot-btn">◎ Plot all positions on globe</button></div>`;
    }
    sbody += `<p class="dim" style="font-size:11.5px;margin-top:10px">Positions of publicly documented devices from OpenStreetMap — ALPR locations are largely crowdsourced by the <a href="https://deflock.me" target="_blank" rel="noopener">DeFlock</a> project. Coverage is volunteer-mapped and very uneven: an empty count means none <em>mapped</em>, not none present. Positions only — no feeds are accessed.</p>`;
    html += sec(rep, "surveillance", `Surveillance devices <span class="n">${sv.total.toLocaleString()}${sv.counts.alpr ? ` · ${sv.counts.alpr} ALPR` : ""}</span>`, sbody);
  }

  /* current weather */
  if (pend("weather")) {
    html += sec(rep, "weather", "Weather now", loadingRow, true);
  } else if (cw) {
    const sun = w.daily?.sunrise?.[0]
      ? `sunrise ${fmtHM(w.daily.sunrise[0].slice(11))} · sunset ${fmtHM(w.daily.sunset[0].slice(11))} · ${(w.daily.daylight_duration[0] / 3600).toFixed(1)}h daylight · UV max ${w.daily.uv_index_max?.[0] ?? "—"}`
      : "";
    const bigTemp = settings.temp === "f" ? `${F(cw.temperature_2m)}°F` : `${cw.temperature_2m}°C`;
    const altTemp = settings.temp === "both" ? `${F(cw.temperature_2m)}°F · ` : "";
    let body = `<div class="wx-now">
        <span class="wx-temp">${bigTemp}</span>
        <span class="wx-desc">${esc(wmo(cw.weather_code))} · feels like ${tempStr(cw.apparent_temperature)}</span>
        <span class="wx-meta">${altTemp}humidity ${cw.relative_humidity_2m}% · wind ${windStr(cw.wind_speed_10m)} (gusts ${windStr(cw.wind_gusts_10m)}) · cloud ${cw.cloud_cover}% · pressure ${cw.pressure_msl ?? "—"} hPa · precip ${cw.precipitation} mm</span>
        ${sun ? `<span class="wx-meta">${esc(sun)}</span>` : ""}
      </div>`;
    if (w.daily?.time) {
      body += `<table><thead><tr><th>Next 7 days</th><th class="num">High</th><th class="num">Low</th><th class="num">Precip</th></tr></thead><tbody>`;
      w.daily.time.forEach((d, i) => {
        body += `<tr><td>${esc(d)} <span class="dim">${esc(wmo(w.daily.weather_code[i]))}</span></td>
          <td class="num">${tempStr(w.daily.temperature_2m_max[i])}</td>
          <td class="num">${tempStr(w.daily.temperature_2m_min[i])}</td>
          <td class="num">${w.daily.precipitation_sum[i]} mm</td></tr>`;
      });
      body += `</tbody></table>`;
    }
    html += sec(rep, "weather", `Weather now <span class="n">${esc(`${bigTemp.replace("°C", "°").replace("°F", "°")} ${wmo(cw.weather_code)}`)}</span>`, body);
  }

  /* air quality */
  if (pend("airquality")) {
    html += sec(rep, "air", "Air quality now", loadingRow, true);
  } else if (rep.air?.us_aqi != null) {
    const aqi = rep.air.us_aqi;
    const [cat, col] = aqi <= 50 ? ["Good", "var(--teal)"] : aqi <= 100 ? ["Moderate", "var(--brass)"]
      : aqi <= 150 ? ["Unhealthy for sensitive groups", "var(--brass)"] : aqi <= 200 ? ["Unhealthy", "var(--coral)"]
      : aqi <= 300 ? ["Very unhealthy", "var(--coral)"] : ["Hazardous", "var(--coral)"];
    html += sec(rep, "air", `Air quality now <span class="n" style="color:${col}">${aqi} ${cat}</span>`, `
      <div class="wx-now">
        <span class="wx-temp" style="color:${col}">${aqi}</span>
        <span class="wx-desc">${cat} <span class="dim">(US AQI)</span>${rep.air.european_aqi != null ? ` · European AQI ${rep.air.european_aqi}` : ""}</span>
        <span class="wx-meta">PM2.5 ${rep.air.pm2_5 ?? "—"} · PM10 ${rep.air.pm10 ?? "—"} · O₃ ${rep.air.ozone ?? "—"} · NO₂ ${rep.air.nitrogen_dioxide ?? "—"} · SO₂ ${rep.air.sulphur_dioxide ?? "—"} · CO ${rep.air.carbon_monoxide ?? "—"} µg/m³</span>
      </div>`);
  }

  /* weather history */
  const months = rep.history?.months || [];
  if (pend("history")) {
    html += sec(rep, "history", "Weather history — last 12 months", loadingRow, true);
  } else if (months.length) {
    let hbody = `${histChart(months)}
      <div class="legend">
        <span><span class="sw" style="background:#d9a441"></span>avg high</span>
        <span><span class="sw" style="background:#4a6fa5"></span>avg low</span>
        <span><span class="sw" style="background:#4fc4a8"></span>precip mm</span>
      </div>
      <table><thead><tr><th>Month</th><th class="num">Avg high</th><th class="num">Avg low</th><th class="num">Precip</th></tr></thead><tbody>`;
    for (const m of months) {
      hbody += `<tr><td>${esc(m.month)}</td><td class="num">${tempStr(m.avgHighC)}</td><td class="num">${tempStr(m.avgLowC)}</td><td class="num">${m.precipMm} mm</td></tr>`;
    }
    hbody += `</tbody></table>`;
    const ex = rep.history?.extremes;
    if (ex) {
      hbody += `<dl class="kv" style="margin-top:14px">
        ${ex.hottest ? `<dt>Hottest day</dt><dd>${tempStr(ex.hottest.tempC)} on ${esc(ex.hottest.date)}</dd>` : ""}
        ${ex.coldest ? `<dt>Coldest day</dt><dd>${tempStr(ex.coldest.tempC)} on ${esc(ex.coldest.date)}</dd>` : ""}
        ${ex.wettest ? `<dt>Wettest day</dt><dd>${ex.wettest.precipMm} mm on ${esc(ex.wettest.date)}</dd>` : ""}
        <dt>Days ≥ ${tempStr(30)}</dt><dd>${ex.daysOver30}</dd>
        <dt>Days ≤ ${tempStr(0)}</dt><dd>${ex.daysBelow0}</dd>
        <dt>Total precipitation</dt><dd>${ex.totalPrecipMm.toLocaleString()} mm</dd>
      </dl>`;
    }
    html += sec(rep, "history", "Weather history — last 12 months", hbody);
  }

  /* seismic activity */
  if (pend("earthquakes")) {
    html += sec(rep, "quakes", "Seismic activity — past 10 years", loadingRow, true);
  } else if (rep.quakes) {
    let qbody = "";
    if (rep.quakes.count) {
      qbody += `<dl class="kv" style="margin-bottom:12px">
        <dt>M2.5+ quakes</dt><dd>${rep.quakes.count.toLocaleString()}</dd>
        ${rep.quakes.largest ? `<dt>Largest</dt><dd>M${rep.quakes.largest.mag} · ${esc(rep.quakes.largest.place || "")} · ${esc(rep.quakes.largest.date)} · ${rep.quakes.largest.depthKm} km deep</dd>` : ""}
      </dl>`;
      if (rep.quakes.recent?.length) {
        qbody += `<table><thead><tr><th>Most recent</th><th class="num">Mag</th><th class="num">Depth</th></tr></thead><tbody>`;
        for (const q of rep.quakes.recent) {
          qbody += `<tr><td>${esc(q.date)} <span class="dim">${esc(q.place || "")}</span></td><td class="num">M${q.mag}</td><td class="num">${q.depthKm} km</td></tr>`;
        }
        qbody += `</tbody></table>`;
      }
    } else {
      qbody = `<p class="dim">No M2.5+ earthquakes recorded by USGS within this radius in the past decade — seismically quiet.</p>`;
    }
    html += sec(rep, "quakes", `Seismic activity — past 10 years <span class="n">${rep.quakes.count.toLocaleString()}</span>`, qbody);
  }

  /* recent news */
  if (pend("news") || rep.sourceStatus?.news?.state === "queued") {
    html += sec(rep, "news", "Recent news", loadingRow, true);
  } else if (rep.news) {
    let nbody = "";
    if (rep.news.length) {
      for (const n of rep.news) {
        nbody += `<div class="person">
          <span class="who"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a></span>
          <div class="meta">${n.source ? esc(n.source) + " · " : ""}${n.pubDate ? esc(n.pubDate.slice(0, 10)) + " · " : ""}<span class="tag">matched: ${esc(n.matched)}</span></div>
        </div>`;
      }
      nbody += `<p class="dim" style="font-size:11.5px;margin-top:10px">News can't be searched by coordinates, so headlines are matched against the place names verified by this point's geocode — each query requires the locality and its state/country together, which screens out same-named places elsewhere. The “matched” tag shows which verified place pair found each story.</p>`;
    } else {
      nbody = `<p class="dim">No recent headlines found for the verified place names in this circle.</p>`;
    }
    html += sec(rep, "news", `Recent news <span class="n">${rep.news.length}</span>`, nbody);
  }

  /* notable people */
  const people = rep.people || [];
  {
    let pbody;
    if (pend("people")) {
      pbody = loadingRow;
    } else if (people.length) {
      pbody = "";
      for (const p of people) {
        pbody += `<div class="person">
          <span class="who"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a></span>
          <div class="meta">${esc(p.occupations?.join(", ") || "")}${p.born ? ` · b. ${esc(p.born)}` : ""}${p.birthplace ? ` · ${esc(p.birthplace)}` : ""}</div>
        </div>`;
      }
      pbody += `<p class="dim" style="font-size:11.5px;margin-top:10px">From Wikidata: people whose recorded birthplace lies within the circle, ranked by worldwide Wikipedia coverage.${rep.radiusMi * MI_TO_KM < 10 ? " Birthplace coordinates resolve to town centers, so below ~6 mi the scan uses a 10 km floor — these people were born in or around the towns at this point." : ""}</p>`;
    } else {
      pbody = `<p class="dim">No notable births recorded inside this radius.</p>`;
    }
    html += sec(rep, "people", `Notable people born in this circle ${pend("people") ? "" : `<span class="n">${people.length}</span>`}`, pbody, pend("people"));
  }

  /* landmarks */
  const marks = rep.landmarks || [];
  if (pend("landmarks")) {
    html += sec(rep, "landmarks", "Landmarks & points of interest", loadingRow, true);
  } else if (marks.length) {
    let mbody = `<table><thead><tr><th>Wikipedia entry</th><th class="num">Dist (${distUnit()})</th></tr></thead><tbody>`;
    for (const m of marks) {
      const pin = m.lat != null
        ? ` <button class="pin-btn" title="Highlight ${esc(m.title)} on the globe" aria-label="Highlight ${esc(m.title)} on the globe" data-name="${esc(m.title)}" data-lat="${m.lat}" data-lon="${m.lon}">◎</button>`
        : "";
      mbody += `<tr><td><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>${pin}</td><td class="num">${distCell(m.distanceKm)}</td></tr>`;
    }
    mbody += `</tbody></table>
      <p class="dim" style="font-size:11.5px;margin-top:10px">${rep.radiusKm > 10
        ? "Across the whole circle: the most globally notable places (Wikidata, ranked by Wikipedia coverage), with towns excluded since they're listed above."
        : "Wikipedia geosearch, every geotagged article within the circle."}</p>`;
    html += sec(rep, "landmarks", `Landmarks & points of interest <span class="n">${marks.length}</span>`, mbody);
  }

  /* satellite flyovers — client-computed, so only on the live report (it's about
     the future, not a historical snapshot); lazily computed when expanded */
  if (saveable) {
    const n = rep._fly?.state === "done" ? ` <span class="n">${rep._fly.shown.length}</span>` : "";
    html += sec(rep, "flyovers", `Satellite flyovers${n}`, flyoversBody(rep));
  }

  if (rep.sourceErrors?.length) {
    html += `<p class="errors">Some sources didn't respond this time: ${rep.sourceErrors.join(", ")}. Re-run the analysis to retry.</p>`;
  }

  mount.innerHTML = html;
  tickClocks();

  /* remember which sections the user opened, across live re-renders */
  mount.querySelectorAll("details[data-sec]").forEach((d) => d.addEventListener("toggle", () => {
    if (!(rep._open instanceof Set)) rep._open = new Set();
    if (d.open) rep._open.add(d.dataset.sec); else rep._open.delete(d.dataset.sec);
    if (d.open && d.dataset.sec === "flyovers" && !rep._fly) flyCompute(rep); // compute on first expand
  }));
  mount.querySelectorAll("[data-secall]").forEach((b) => b.addEventListener("click", () => {
    const open = b.dataset.secall === "open";
    mount.querySelectorAll("details[data-sec]").forEach((d) => { d.open = open; });
  }));

  mount.querySelector("#clearReportBtn")?.addEventListener("click", clearExplore);

  mount.querySelectorAll(".wiki-peek").forEach((btn) =>
    btn.addEventListener("click", (e) => { e.preventDefault(); openWikiPop(btn.dataset); }));

  mount.querySelectorAll(".pin-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      pinpointOnGlobe(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon), btn.dataset.name);
    }));

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

  mount.querySelectorAll(".infra-all-btn").forEach((btn) =>
    btn.addEventListener("click", () => showAllInfra(rep, btn)));

  mount.querySelectorAll(".surv-plot-btn").forEach((btn) =>
    btn.addEventListener("click", () => showSurveillancePoints(rep)));

  mount.querySelectorAll(".retry-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      rep.finalized = false;
      await fetchPart(rep, btn.dataset.src);
    });
  });

  if (saveable) {
    // shareable permalink: copies the full URL for this report's exact spot and
    // radius (read from the report, not the live slider), matching the RSS copy UX
    const linkBtn = mount.querySelector("#copyLinkBtn");
    if (linkBtn) linkBtn.addEventListener("click", async () => {
      const url = location.origin + location.pathname + permalinkFor(rep.lat, rep.lon, rep.radiusMi);
      try { await navigator.clipboard.writeText(url); linkBtn.textContent = "Copied ✓"; }
      catch { prompt("Shareable link:", url); }
      setTimeout(() => { linkBtn.textContent = "🔗 Copy link"; }, 2000);
    });

    // satellite flyovers: explicit compute/recompute (also auto-runs on expand)
    mount.querySelector("#flyComputeBtn")?.addEventListener("click", () => flyCompute(rep));

    const btn = mount.querySelector("#saveBtn");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Saving…";
      const { pending, ...payload } = rep;
      const r = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: payload }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        btn.textContent = j.created ? "Saved ✓" : `Snapshot ${j.snapshots ?? ""} added ✓`;
        btn.classList.add("saved");
        refreshSavedCount();
      } else {
        btn.textContent = "Save failed — retry";
        btn.disabled = false;
      }
    });

    const wbtn = mount.querySelector("#watchBtn");
    if (wbtn && !wbtn.disabled) wbtn.addEventListener("click", async () => {
      wbtn.disabled = true;
      wbtn.textContent = "Adding…";
      const loc = rep.location || {};
      const extra = (rep.settlements || []).map((s) => s.name)
        .filter((n) => n && n !== loc.locality).slice(0, 2).join("|");
      const r = await fetch("/api/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: rep.lat, lon: rep.lon, radiusMi: rep.radiusMi, label: placeTitle(rep),
          place: { locality: loc.locality, county: loc.county, state: loc.state, country: loc.country, extra, displayName: loc.displayName },
        }),
      });
      if (r.ok) {
        wbtn.textContent = "Watching ✓";
        wbtn.classList.add("saved");
        refreshWatchBadge();
      } else {
        const j = await r.json().catch(() => ({}));
        wbtn.textContent = "Watch failed — retry";
        wbtn.title = j.error || "";
        wbtn.disabled = false;
      }
    });
  }
}

/* local-time block: live clocks driven by tickClocks(); DST derived from the
   IANA zone, so it stays correct as the report ages */
function timeBlock(tz, rep) {
  if (!tz) return "";
  let info;
  try { info = dstInfo(tz); } catch { return ""; }
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dst = !info.observed
    ? "Not observed in this zone"
    : info.active
      ? `In effect — clocks are forward (standard time is ${utcOffStr(info.stdMin)})`
      : `Not currently in effect (standard time ${utcOffStr(info.stdMin)})`;
  return sec(rep, "time", `Local time <span class="n" data-tz-clock="${esc(tz)}"></span>`, `
    <div class="clock-row">
      <span class="clock-big mono" data-tz-clock="${esc(tz)}"></span>
      <span class="clock-zone">${esc(tz)}${info.abbr ? ` (${esc(info.abbr)})` : ""}</span>
    </div>
    <dl class="kv">
      <dt>UTC offset</dt><dd>${utcOffStr(info.offsetMin)}</dd>
      <dt>Daylight saving</dt><dd style="font-family:var(--font-body)">${dst}</dd>
      <dt>GMT / UTC now</dt><dd data-tz-clock="UTC"></dd>
      <dt>Your local time</dt><dd data-tz-clock="${esc(userTz)}"></dd>
    </dl>`);
}

/* ----------------------------------------------- Wikipedia preview popup */

const wikiCache = new Map();

/* the preview borrows the side panel instead of covering the page: the
   visible view is remembered, swapped out, and restored by ✕ / Escape */
let wikiReturnView = null;
const PANEL_VIEWS = ["exploreView", "savedView", "watchView", "spaceView"];

async function openWikiPop(d) {
  const pop = $("wikiView");
  const body = $("wikiBody");
  if (pop.hidden) {
    wikiReturnView = PANEL_VIEWS.find((id) => !$(id).hidden) || "exploreView";
    $(wikiReturnView).hidden = true;
    pop.hidden = false;
  }
  // a click on a globe dot must surface the panel even when it's hidden away
  document.body.classList.remove("panel-hidden");
  $("showPanelBtn").hidden = true;
  resizeGlobeSoon();
  $("panel").scrollTop = 0;
  body.innerHTML = `<div class="wiki-loading"><span class="dot"></span> Verifying the right article for <strong>${esc(d.name)}</strong>…</div>`;

  const key = `${settings.lang}|${d.norad ? `norad:${d.norad}` : d.astro ? `astro:${d.name}` : d.wikidata || d.wikipedia || `${d.name}@${d.lat},${d.lon}`}`;
  let result = wikiCache.get(key);
  if (!result) {
    try {
      const qs = new URLSearchParams({
        name: d.name || "", wikidata: d.wikidata || "", wikipedia: d.wikipedia || "",
        norad: d.norad || "", astro: d.astro || "", lat: d.lat || "", lon: d.lon || "", lang: settings.lang,
      });
      const r = await fetch(`/api/wikipreview?${qs}`);
      const j = await r.json();
      result = r.ok ? { ok: true, data: j.data } : { ok: false, error: j.error };
    } catch {
      result = { ok: false, error: "Server unreachable." };
    }
    wikiCache.set(key, result);
  }
  if (pop.hidden) return; // closed while loading

  if (!result.ok) {
    body.innerHTML = `
      <div class="wiki-head"><span class="wiki-title">${esc(d.name)}</span></div>
      <p class="dim" style="margin-top:10px">${esc(result.error || "No verified Wikipedia article for this place.")}</p>
      <p class="dim" style="font-size:11.5px;margin-top:8px">${d.norad
        ? "GeoScope matches space objects by their catalog number on Wikidata — it never guesses from the display name."
        : "GeoScope only links an article when the place's own map tags or its exact coordinates confirm the match — it never guesses from the name alone."}</p>`;
    return;
  }
  const w = result.data;
  const langName = (code) => $("setLang")?.querySelector(`option[value="${code}"]`)?.textContent || code;
  const langNote = !w.langFallback ? ""
    : w.factsOnly
      ? `<p class="dim" style="font-size:11.5px;margin-top:10px">No ${esc(langName(settings.lang))} description exists yet — showing the English one. Catalog facts below are language-neutral.</p>`
      : `<p class="dim" style="font-size:11.5px;margin-top:10px">No ${esc(langName(settings.lang))} edition of this article exists yet — showing the ${esc(langName(w.lang))} one.</p>`;
  body.innerHTML = `
    ${w.thumb ? `<img class="wiki-thumb" src="${esc(w.thumb)}" alt="">` : ""}
    <div class="wiki-head">
      <span class="wiki-title">${esc(w.title)}</span>
      ${w.description ? `<span class="wiki-desc">${esc(w.description)}</span>` : ""}
    </div>
    ${w.extract ? `<p class="wiki-extract">${esc(w.extract)}</p>` : ""}
    ${w.facts?.length ? `<dl class="kv" style="margin-top:14px">${w.facts.map((f) =>
      `<dt>${esc(f.label)}</dt><dd${f.mono ? ' class="mono"' : ""}>${esc(factVal(f))}</dd>`).join("")}</dl>` : ""}
    ${langNote}
    <div class="wiki-foot">
      <span class="tag" title="How this information was verified as the right match">verified via ${esc(w.via)}</span>
      <a class="ghost wiki-go" href="${esc(w.url)}" target="_blank" rel="noopener">${w.urlLabel ? `Open on ${esc(w.urlLabel)}` : "Read on Wikipedia"} ↗</a>
    </div>`;
}

/* catalog fact values localized in the browser — native Intl formatting for
   the settings language, never machine translation */
function factVal(f) {
  const lang = settings.lang;
  try {
    if (f.kind === "date") return new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(new Date(f.value + "T00:00:00Z"));
    if (f.kind === "owner") {
      if (f.iso) {
        const n = new Intl.DisplayNames([lang], { type: "region" }).of(f.iso);
        if (n && n !== f.iso) return `${n} (${f.value})`;
      }
      return f.value;
    }
    if (f.kind === "minutes") return `${Number(f.value).toLocaleString(lang)} min`;
    if (f.kind === "degrees") return `${Number(f.value).toLocaleString(lang)}°`;
    if (f.kind === "km") return distKm(Number(f.value));
  } catch { /* raw value still beats nothing */ }
  return String(f.value);
}

function closeWikiPop() {
  if ($("wikiView").hidden) return;
  $("wikiView").hidden = true;
  if (wikiReturnView) $(wikiReturnView).hidden = false;
}
$("wikiClose").addEventListener("click", closeWikiPop);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("wikiView").hidden) return closeWikiPop(); // preview first, camera lock second
  if (SPACE.tracked) untrackSat();
});

function wmo(code) {
  const map = { 0:"clear sky",1:"mostly clear",2:"partly cloudy",3:"overcast",45:"fog",48:"icy fog",51:"light drizzle",53:"drizzle",55:"heavy drizzle",61:"light rain",63:"rain",65:"heavy rain",66:"freezing rain",67:"heavy freezing rain",71:"light snow",73:"snow",75:"heavy snow",77:"snow grains",80:"light showers",81:"showers",82:"violent showers",85:"snow showers",86:"heavy snow showers",95:"thunderstorm",96:"thunderstorm w/ hail",99:"severe thunderstorm" };
  return map[code] || "mixed";
}

/* small SVG chart: temp lines + precip bars */
function histChart(months) {
  const W = 480, H = 150, P = 26;
  const temps = months.flatMap((m) => [m.avgHighC, m.avgLowC]).filter((v) => v != null);
  const tMin = Math.min(...temps) - 2, tMax = Math.max(...temps) + 2;
  const pMax = Math.max(...months.map((m) => m.precipMm), 1);
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(months.length - 1, 1);
  const yT = (t) => H - P - ((t - tMin) / (tMax - tMin)) * (H - 2 * P);
  const yP = (p) => ((p / pMax) * (H - 2 * P));

  const line = (key, color) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2" points="${months.map((m, i) => `${x(i)},${yT(m[key])}`).join(" ")}"/>`;
  const bars = months.map((m, i) =>
    `<rect x="${x(i) - 5}" y="${H - P - yP(m.precipMm)}" width="10" height="${yP(m.precipMm)}" fill="#4fc4a8" opacity="0.35"/>`).join("");
  const labels = months.map((m, i) =>
    i % 2 === 0 ? `<text x="${x(i)}" y="${H - 6}" font-size="8.5" fill="#8ca1c2" text-anchor="middle" font-family="IBM Plex Mono">${m.month.slice(2)}</text>` : "").join("");

  return `<svg class="hist-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly average temperatures and precipitation">
    ${bars}${line("avgHighC", "#d9a441")}${line("avgLowC", "#4a6fa5")}${labels}
  </svg>`;
}

/* ------------------------------------------------------------- tabs */

const TAB_BTNS = { explore: "tabExplore", saved: "tabSaved", watch: "tabWatch", space: "tabSpace" };
function showTab(which) {
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
$("tabExplore").addEventListener("click", () => showTab("explore"));
$("tabSaved").addEventListener("click", () => { showTab("saved"); loadSaved(); });
$("tabWatch").addEventListener("click", () => { showTab("watch"); loadWatches(); });
$("tabSpace").addEventListener("click", () => showTab("space"));

/* ------------------------------------------------------------ history */

async function refreshSavedCount() {
  try {
    const h = await (await fetch("/api/history")).json();
    $("savedCount").textContent = h.length ? `(${h.length})` : "";
  } catch { /* server offline */ }
}

/* compare selection: place id -> place object, for the side-by-side feature.
   Cleared on every (re)load so it never references stale/deleted places. */
const compareSel = new Map();

async function loadSaved() {
  const mount = $("savedList");
  mount.innerHTML = `<p class="dim">Loading…</p>`;
  const places = await (await fetch("/api/history")).json();
  $("savedCount").textContent = places.length ? `(${places.length})` : "";
  if (!places.length) {
    mount.innerHTML = `<p class="empty-saved">Nothing saved yet. Analyze an area and press “Save snapshot” — the place keeps an immutable timeline you can re-sample any time.</p>`;
    return;
  }
  compareSel.clear();
  mount.innerHTML = "";
  // compare bar: tick two places below, then this contrasts their latest snapshots
  const bar = document.createElement("div");
  bar.className = "compare-bar";
  bar.innerHTML = `
    <span class="compare-hint dim">Tick two places to compare them side by side.</span>
    <button class="mini compare-go" disabled>Compare 0/2</button>
    <div class="compare-out" hidden></div>`;
  mount.appendChild(bar);
  if (places.length < 2) bar.querySelector(".compare-hint").textContent = "Save a second place to unlock side-by-side compare.";
  bar.querySelector(".compare-go").addEventListener("click", () => runCompare(bar));
  for (const p of places) mount.appendChild(placeCard(p));
}

/* enable/relabel the Compare button as ticks come and go (max two) */
function syncCompareBar() {
  const bar = $("savedList").querySelector(".compare-bar");
  if (!bar) return;
  const btn = bar.querySelector(".compare-go");
  btn.textContent = `Compare ${compareSel.size}/2`;
  btn.disabled = compareSel.size !== 2;
}

/* render the side-by-side diff of the two ticked places' latest snapshots */
function runCompare(bar) {
  const [a, b] = [...compareSel.values()];
  if (!a || !b) return;
  const latest = (p) => p.snapshots[p.snapshots.length - 1];
  const out = bar.querySelector(".compare-out");
  out.hidden = false;
  out.innerHTML = renderCompareHtml(
    { label: a.label, lat: a.lat, lon: a.lon, radiusMi: a.radiusMi, report: latest(a).report },
    { label: b.label, lat: b.lat, lon: b.lon, radiusMi: b.radiusMi, report: latest(b).report },
  );
  out.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function placeCard(p) {
  const newestFirst = [...p.snapshots].reverse();
  const latest = newestFirst[0];
  const card = document.createElement("div");
  card.className = "card";

  const rows = newestFirst.map((s, i) => `
    <div class="snap-row" data-sid="${esc(s.id)}">
      <span class="snap-when mono">${esc(fmtWhen(s.takenAt))}</span>
      ${i === newestFirst.length - 1 ? `<span class="tag">original</span>` : ""}
      ${i === 0 && newestFirst.length > 1 ? `<span class="tag">latest</span>` : ""}
      <button class="mini view-snap">View</button>
      ${i < newestFirst.length - 1 ? `<button class="mini diff-snap" title="What changed since the previous snapshot">Δ Diff</button>` : ""}
      <button class="mini danger del-snap" aria-label="Delete this snapshot">✕</button>
    </div>
    <div class="snap-detail" hidden></div>`).join("");

  card.innerHTML = `
    <div class="card-top">
      <span class="card-place"><label class="compare-pick" title="Tick to compare with another place"><input type="checkbox" class="compare-check" /></label>${esc(p.label)}</span>
      <span class="card-when">${p.snapshots.length} snapshot${p.snapshots.length === 1 ? "" : "s"} · latest ${esc(fmtWhen(latest.takenAt))}</span>
    </div>
    <div class="card-when mono" style="margin-top:2px">${fmtLat(p.lat)} ${fmtLon(p.lon)} · ${distMi(p.radiusMi)}</div>
    <p class="card-sum">${esc(latest.report.summary || "")}</p>
    <div class="card-actions">
      <button class="mini snap-btn" title="Re-run the analysis for this exact spot and radius">＋ New snapshot</button>
      <button class="mini fly-btn">Show on globe</button>
      ${p.snapshots.length > 1 ? `<button class="mini diff-all-btn" title="Everything that changed across this place's whole timeline">Δ Original → latest</button>` : ""}
      <button class="mini danger del-btn" aria-label="Delete this place and all its snapshots">✕ Delete place</button>
    </div>
    <div class="diff-all" hidden></div>
    <div class="snap-list">${rows}</div>`;

  // compare tick: cap the selection at two, refusing a third with a quick bounce
  const cmpCheck = card.querySelector(".compare-check");
  cmpCheck.addEventListener("change", () => {
    if (cmpCheck.checked) {
      if (compareSel.size >= 2) { cmpCheck.checked = false; return; } // only two at a time
      compareSel.set(p.id, p);
    } else {
      compareSel.delete(p.id);
    }
    syncCompareBar();
  });

  card.querySelector(".snap-btn").addEventListener("click", () => {
    // exact same coordinates and radius -> saving the result appends to this timeline
    $("radiusRange").value = Math.min(p.radiusMi, parseInt($("radiusRange").max, 10));
    syncRadiusOut();
    selectPoint(p.lat, p.lon);
    showTab("explore");
    $("analyzeBtn").click();
  });
  card.querySelector(".fly-btn").addEventListener("click", () => {
    $("radiusRange").value = Math.min(p.radiusMi, parseInt($("radiusRange").max, 10));
    syncRadiusOut();
    selectPoint(p.lat, p.lon);
    showTab("explore");
  });
  card.querySelector(".del-btn").addEventListener("click", async () => {
    await fetch(`/api/history/${p.id}`, { method: "DELETE" });
    card.remove();
    refreshSavedCount();
    if (!$("savedList").children.length) loadSaved();
  });

  const diffAllBtn = card.querySelector(".diff-all-btn");
  if (diffAllBtn) diffAllBtn.addEventListener("click", () => {
    const box = card.querySelector(".diff-all");
    box.hidden = !box.hidden;
    diffAllBtn.textContent = box.hidden ? "Δ Original → latest" : "Hide Δ";
    if (!box.hidden) box.innerHTML = renderDiffHtml(p.snapshots[0], p.snapshots[p.snapshots.length - 1]);
  });

  card.querySelectorAll(".snap-row").forEach((row, i) => {
    const sid = row.dataset.sid;
    const snap = p.snapshots.find((s) => s.id === sid);
    const older = newestFirst[i + 1] || null; // rows render newest-first
    const detail = row.nextElementSibling;
    const viewBtn = row.querySelector(".view-snap");
    const diffBtn = row.querySelector(".diff-snap");
    const closeDetail = () => {
      detail.hidden = true;
      viewBtn.textContent = "View";
      if (diffBtn) diffBtn.textContent = "Δ Diff";
    };
    viewBtn.addEventListener("click", () => {
      if (!detail.hidden && detail.dataset.mode === "report") return closeDetail();
      closeDetail();
      detail.hidden = false;
      detail.dataset.mode = "report";
      viewBtn.textContent = "Hide";
      detail.innerHTML = `<p class="snap-banner">Snapshot from ${esc(fmtWhen(snap.takenAt))} (${esc(rel(snap.takenAt))}). Weather, air quality and news reflect that moment; terrain and map data drift slowly.</p><div class="snap-report"></div>`;
      renderReport(snap.report, detail.querySelector(".snap-report"), { saveable: false });
    });
    if (diffBtn) diffBtn.addEventListener("click", () => {
      if (!detail.hidden && detail.dataset.mode === "diff") return closeDetail();
      closeDetail();
      detail.hidden = false;
      detail.dataset.mode = "diff";
      diffBtn.textContent = "Hide Δ";
      detail.innerHTML = renderDiffHtml(older, snap);
    });
    row.querySelector(".del-snap").addEventListener("click", async () => {
      await fetch(`/api/history/${p.id}/snapshots/${sid}`, { method: "DELETE" });
      loadSaved();
    });
  });

  return card;
}

/* ------------------------------------------------------- snapshot diff
   Saved places keep immutable snapshot timelines; this makes the change
   visible. Pure client-side comparison of two stored reports: slow-moving
   data (settlements, infra, landmarks, people, devices, seismicity) is the
   signal; weather/AQI are shown separately since they always differ. */

function diffReports(a, b) {
  const out = [];
  const fmtN = (v) => (v == null ? "—" : v.toLocaleString());
  const delta = (x, y) => {
    const d = y - x;
    return `${fmtN(x)} → ${fmtN(y)} (${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString()})`;
  };
  const sec = (title, rows) => { if (rows.length) out.push({ title, rows }); };

  if ((a.estimatedPopulation || b.estimatedPopulation) && a.estimatedPopulation !== b.estimatedPopulation) {
    sec("Population estimate", [{ s: "Δ", t: delta(a.estimatedPopulation || 0, b.estimatedPopulation || 0) }]);
  }
  {
    const A = new Map((a.settlements || []).map((s) => [s.name, s]));
    const B = new Map((b.settlements || []).map((s) => [s.name, s]));
    const rows = [];
    for (const [name, s] of B) if (!A.has(name)) rows.push({ s: "+", t: `${name} (${s.type})` });
    for (const [name, s] of A) if (!B.has(name)) rows.push({ s: "−", t: `${name} (${s.type})` });
    for (const [name, sB] of B) {
      const sA = A.get(name);
      if (sA && sA.population != null && sB.population != null && sA.population !== sB.population) {
        rows.push({ s: "Δ", t: `${name}: population ${delta(sA.population, sB.population)}` });
      }
    }
    sec("Settlements", rows);
  }
  {
    const A = Object.fromEntries((a.infrastructure || []).map((c) => [c.label, c.count]));
    const rows = [];
    for (const c of b.infrastructure || []) {
      if (A[c.label] != null && c.count != null && A[c.label] !== c.count) {
        rows.push({ s: "Δ", t: `${tInfra(c.label)}: ${delta(A[c.label], c.count)}` });
      }
    }
    sec("Infrastructure", rows);
  }
  {
    const rows = [];
    const ca = a.surveillance?.counts, cb = b.surveillance?.counts;
    if (ca && cb) for (const [k, label] of SURV_CATS) {
      if (ca[k] !== cb[k]) rows.push({ s: "Δ", t: `${label}: ${delta(ca[k], cb[k])}` });
    }
    sec("Surveillance devices", rows);
  }
  {
    const A = new Set((a.landmarks || []).map((m) => m.title));
    const B = new Set((b.landmarks || []).map((m) => m.title));
    const rows = [];
    for (const t of B) if (!A.has(t)) rows.push({ s: "+", t });
    for (const t of A) if (!B.has(t)) rows.push({ s: "−", t });
    sec("Landmarks", rows);
  }
  {
    const A = new Set((a.people || []).map((p) => p.name));
    const B = new Set((b.people || []).map((p) => p.name));
    const rows = [];
    for (const t of B) if (!A.has(t)) rows.push({ s: "+", t });
    for (const t of A) if (!B.has(t)) rows.push({ s: "−", t });
    sec("Notable people", rows);
  }
  if (a.quakes && b.quakes) {
    const rows = [];
    if (a.quakes.count !== b.quakes.count) rows.push({ s: "Δ", t: `M2.5+ quakes in the 10-year window: ${delta(a.quakes.count, b.quakes.count)}` });
    if (a.quakes.largest && b.quakes.largest && quakeId(a.quakes.largest) !== quakeId(b.quakes.largest)) {
      rows.push({ s: "Δ", t: `Largest recorded: M${a.quakes.largest.mag} (${a.quakes.largest.date}) → M${b.quakes.largest.mag} (${b.quakes.largest.date})` });
    }
    sec("Seismicity", rows);
  }
  {
    const rows = [];
    const ta = a.weather?.current?.temperature_2m, tb = b.weather?.current?.temperature_2m;
    if (ta != null && tb != null) rows.push({ s: "Δ", t: `Temperature: ${tempStr(ta)} → ${tempStr(tb)}` });
    const qa = a.air?.us_aqi, qb = b.air?.us_aqi;
    if (qa != null && qb != null) rows.push({ s: "Δ", t: `US AQI: ${qa} → ${qb}` });
    if (rows.length) out.push({ title: "Moment-in-time readings (expected to differ)", rows, dim: true });
  }
  return out;
}
const quakeId = (q) => `${q.date}|${q.mag}`;

function renderDiffHtml(older, newer) {
  const secs = diffReports(older.report, newer.report);
  const days = Math.round(((new Date(newer.takenAt) - new Date(older.takenAt)) / 86400000) * 10) / 10;
  let html = `<p class="snap-banner">Δ comparing ${esc(fmtWhen(older.takenAt))} → ${esc(fmtWhen(newer.takenAt))} (${days} day${days === 1 ? "" : "s"} apart)</p>`;
  if (!secs.some((s) => !s.dim)) {
    html += `<p class="dim" style="margin:10px 0">No changes in the slow-moving data between these two snapshots.</p>`;
  }
  for (const s of secs) {
    html += `<div class="diff-sec${s.dim ? " diff-dim" : ""}"><h4>${esc(s.title)}</h4>` +
      s.rows.map((r) =>
        `<div class="diff-row"><span class="diff-sign ${r.s === "+" ? "add" : r.s === "−" ? "del" : "chg"}">${r.s}</span>${esc(r.t)}</div>`).join("") +
      `</div>`;
  }
  return html;
}

/* --------------------------------------------------- compare two areas
   The snapshot diff above contrasts one place at two moments; this reuses the
   exact same machinery to contrast TWO DIFFERENT places. The "moment-in-time"
   split diffReports already does still reads sensibly — it just means "these
   two areas happen to differ in weather/AQI" rather than "this area changed".
   `a`/`b` are {label, lat, lon, radiusMi, report}. */

function renderCompareHtml(a, b) {
  const secs = diffReports(a.report, b.report);
  const head = (x) => `${esc(x.label)} <span class="dim">(${fmtLat(x.lat)} ${fmtLon(x.lon)} · ${distMi(x.radiusMi)})</span>`;
  let html = `<p class="snap-banner">Comparing <strong>Area A</strong> ${head(a)} &nbsp;vs&nbsp; <strong>Area B</strong> ${head(b)}</p>`;
  if (!secs.some((s) => !s.dim)) {
    html += `<p class="dim" style="margin:10px 0">No differences in the slow-moving data between these two areas.</p>`;
  }
  for (const s of secs) {
    // signs read left→right: + present only in B, − present only in A, Δ A→B
    html += `<div class="diff-sec${s.dim ? " diff-dim" : ""}"><h4>${esc(s.title)}</h4>` +
      s.rows.map((r) =>
        `<div class="diff-row"><span class="diff-sign ${r.s === "+" ? "add" : r.s === "−" ? "del" : "chg"}">${r.s}</span>${esc(r.t)}</div>`).join("") +
      `</div>`;
  }
  html += `<p class="dim" style="font-size:11.5px;margin-top:12px">+ only in Area B · − only in Area A · Δ value differs (A → B). Because the two areas have different locations and radii, expect large differences — this is a side-by-side, not a change log.</p>`;
  return html;
}

/* ------------------------------------------------------------ watching */

const WATCH_METRICS = [
  ["news", "News"], ["earthquakes", "Quakes"], ["airquality", "Air quality"], ["weather", "Severe wx"],
  ["settlements", "Settlements"], ["landmarks", "Landmarks"], ["people", "People"], ["infrastructure", "Infra"],
  ["surveillance", "Cameras"],
];

function rel(iso) {
  if (!iso) return "—";
  const s = (new Date(iso) - Date.now()) / 1000;
  const abs = Math.abs(s);
  const span = abs < 90 ? "moments" : abs < 5400 ? `${Math.round(abs / 60)} min`
    : abs < 129600 ? `${Math.round(abs / 3600)}h` : `${Math.round(abs / 86400)}d`;
  return s > 0 ? `in ${span}` : `${span} ago`;
}

/* ----------------------------------------------- satellite flyovers
   "When will a satellite pass over THIS point, and where in the sky?" — answered
   entirely in the browser with the same TLEs + SGP4 propagator that drive the
   Space tab, so it costs zero extra API calls. A pass is a window where the
   object clears 10° elevation; "visible" means it's sunlit while the observer's
   sky is dark (the only time you can actually see one), using a cylindrical
   Earth-shadow model and a low-precision solar position. */
const D2R = Math.PI / 180, R2D = 180 / Math.PI, EARTH_R_KM = 6378.137;
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// low-precision Sun position in ECI km (good to ~0.01°, ample for shadow tests)
function sunEciKm(date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const g = (357.529 + 0.98560028 * d) * D2R;
  const q = (280.459 + 0.98564736 * d) * D2R;
  const L = q + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const e = (23.439 - 0.00000036 * d) * D2R;
  const r = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * 149597870.7;
  return { x: r * Math.cos(L), y: r * Math.cos(e) * Math.sin(L), z: r * Math.sin(e) * Math.sin(L) };
}

// is the satellite in sunlight (not inside Earth's umbra cylinder)?
function satSunlit(sat, sun) {
  const sm = Math.hypot(sun.x, sun.y, sun.z);
  const ux = sun.x / sm, uy = sun.y / sm, uz = sun.z / sm;
  const dot = sat.x * ux + sat.y * uy + sat.z * uz;
  if (dot > 0) return true; // sunward hemisphere is always lit
  const px = sat.x - dot * ux, py = sat.y - dot * uy, pz = sat.z - dot * uz;
  return Math.hypot(px, py, pz) > EARTH_R_KM; // outside the shadow cylinder
}

/* satrecs for the flyover scan: reuse the Space tab's if it's loaded (no globe
   side effects either way), otherwise fetch /api/space once and build them
   without adding any Cesium entities */
const FLY = { satrecs: null, tleAt: null, loading: null };
async function getFlySatrecs() {
  if (SPACE.loaded && SPACE.sats.length) {
    return { list: SPACE.sats.map((s) => ({ name: s.name, noradId: s.noradId, group: s.group, satrec: s.satrec })), tleAt: SPACE.tleFetchedAt };
  }
  if (FLY.satrecs) return { list: FLY.satrecs, tleAt: FLY.tleAt };
  if (!FLY.loading) FLY.loading = (async () => {
    if (typeof satellite === "undefined") throw new Error("the satellite.js library didn't load (CDN blocked?)");
    const r = await fetch("/api/space");
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const list = [];
    for (const s of j.satellites || []) {
      let satrec; try { satrec = satellite.twoline2satrec(s.line1, s.line2); } catch { continue; }
      list.push({ name: s.name, noradId: s.noradId, group: s.group, satrec });
    }
    if (!list.length) throw new Error("no usable orbital elements");
    FLY.satrecs = list; FLY.tleAt = j.tleFetchedAt;
    return { list, tleAt: j.tleFetchedAt };
  })();
  try { return await FLY.loading; } finally { FLY.loading = null; }
}

async function computeFlyovers(lat, lon, elevKm) {
  const { list, tleAt } = await getFlySatrecs();
  const obs = { latitude: lat * D2R, longitude: lon * D2R, height: elevKm || 0 };
  const MIN_EL = 10, STEP_MS = 30000, HORIZON_MS = 36 * 3600000;
  const t0 = Date.now(), tEnd = t0 + HORIZON_MS;
  const passes = [];
  let batch = 0;
  for (const sat of list) {
    let inPass = false, cur = null;
    for (let t = t0; t <= tEnd; t += STEP_MS) {
      const date = new Date(t);
      let pv; try { pv = satellite.propagate(sat.satrec, date); } catch { pv = null; }
      if (!pv?.position) { if (inPass) { passes.push(cur); inPass = false; cur = null; } continue; }
      const gmst = satellite.gstime(date);
      const look = satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, gmst));
      const elDeg = look.elevation * R2D;
      if (elDeg >= MIN_EL) {
        if (!inPass) { inPass = true; cur = { name: sat.name, noradId: sat.noradId, group: sat.group, start: t, end: t, peakEl: -90, peakAz: 0, peakT: t, visible: false }; }
        cur.end = t;
        if (elDeg > cur.peakEl) { // recompute visibility only at the (improving) peak
          cur.peakEl = elDeg; cur.peakAz = look.azimuth * R2D; cur.peakT = t;
          const sun = sunEciKm(date);
          const obsSunEl = satellite.ecfToLookAngles(obs, satellite.eciToEcf(sun, gmst)).elevation * R2D;
          cur.visible = obsSunEl < -6 && satSunlit(pv.position, sun); // dark sky + sunlit object
        }
      } else if (inPass) { passes.push(cur); inPass = false; cur = null; }
    }
    if (cur) passes.push(cur);
    if (++batch % 12 === 0) await new Promise((r) => setTimeout(r)); // yield so the spinner paints
  }
  // keep the meaningful ones (strong passes or anything naked-eye visible), time-ordered
  const shown = passes.filter((p) => p.visible || p.peakEl >= 15).sort((a, b) => a.start - b.start);
  return { tleAt, shown, total: passes.length };
}

function flyoversBody(rep) {
  const f = rep._fly;
  const computeBtn = (label) => `<div class="card-actions"><button class="mini" id="flyComputeBtn">${label}</button></div>`;
  if (!f) return `<p class="dim">Upcoming satellite passes over this exact point — space stations and the ~150 brightest objects, propagated locally from current orbital elements.</p>${computeBtn("Compute upcoming passes")}`;
  if (f.state === "loading") return `<p class="dim sect-loading"><span class="dot"></span> propagating orbits in your browser…</p>`;
  if (f.state === "error") return `<p class="dim">Couldn't compute passes — ${esc(f.error)}.</p>${computeBtn("Retry")}`;
  if (!f.shown.length) return `<p class="dim">No passes above 15° over this point in the next 36 hours for the tracked objects.</p>${computeBtn("Recompute")}`;
  const tz = rep.weather?.timezone;
  const fmt = new Intl.DateTimeFormat([], {
    timeZone: tz || undefined, weekday: "short",
    hour: settings.clock === "12" ? "numeric" : "2-digit", minute: "2-digit", hour12: settings.clock === "12",
  });
  const rows = f.shown.slice(0, 25).map((p) =>
    `<tr class="${p.visible ? "fly-vis" : ""}">
      <td><button class="wiki-peek" data-norad="${esc(p.noradId)}" data-name="${esc(p.name)}" title="Preview ${esc(p.name)} on Wikipedia">${esc(p.name)}</button></td>
      <td>${esc(fmt.format(new Date(p.peakT)))} <span class="fly-when">${esc(rel(new Date(p.start).toISOString()))}</span></td>
      <td class="num">${Math.round(p.peakEl)}° ${compass(p.peakAz)}</td>
      <td>${p.visible ? `<span class="fly-vis-badge">👁 visible</span>` : "—"}</td>
    </tr>`).join("");
  return `<table class="fly-table"><thead><tr><th>Object</th><th>Peak (${tz ? "local" : "your time"})</th><th class="num">Max elev</th><th>Naked eye</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="fly-note">${f.total} pass${f.total === 1 ? "" : "es"} above 10° in the next 36 h; showing the strongest ${Math.min(25, f.shown.length)} (≥15° or naked-eye visible). “Visible” = the object is sunlit while your sky is dark — go outside and look toward the listed compass bearing. Computed in your browser (SGP4) from elements fetched ${esc(rel(f.tleAt))}.</p>
    ${computeBtn("Recompute")}`;
}

async function flyCompute(rep) {
  if (rep._fly?.state === "loading") return;
  rep._fly = { state: "loading" };
  if (currentReport === rep) renderLive(rep);
  let result;
  try {
    const elevKm = Number.isFinite(rep.elevationM) ? rep.elevationM / 1000 : 0;
    result = { state: "done", at: Date.now(), ...(await computeFlyovers(rep.lat, rep.lon, elevKm)) };
  } catch (e) {
    result = { state: "error", error: e.message };
  }
  rep._fly = result;
  if (currentReport === rep) renderLive(rep);
}

const isUnseen = (w, c) => !c.seen && (!w.lastSeenAt || c.at > w.lastSeenAt);

function updateWatchBadge(ws) {
  const unseen = ws.reduce((n, w) => n + (w.changes || []).filter((c) => isUnseen(w, c)).length, 0);
  $("watchCount").textContent = unseen ? `(${unseen})` : "";
}
async function refreshWatchBadge() {
  try { updateWatchBadge(await (await fetch("/api/watches")).json()); } catch { /* server offline */ }
}
setInterval(refreshWatchBadge, 120000);

async function loadWatches() {
  const mount = $("watchList");
  mount.innerHTML = `<p class="dim">Loading…</p>`;
  let ws;
  try { ws = await (await fetch("/api/watches")).json(); }
  catch { mount.innerHTML = `<p class="empty-saved">Server unreachable.</p>`; return; }
  updateWatchBadge(ws);
  if (!ws.length) {
    mount.innerHTML = `<p class="empty-saved">Nothing watched yet. Analyze an area and press “Watch this area” — GeoScope will re-check it on a schedule and log every change here.</p>`;
    return;
  }
  mount.innerHTML = "";
  for (const w of ws) mount.appendChild(watchCard(w));
}

function watchCard(w) {
  const card = document.createElement("div");
  card.className = "card";
  const unseen = (w.changes || []).filter((c) => isUnseen(w, c));
  const errs = Object.entries(w.lastErrors || {});

  const toggles = WATCH_METRICS.map(([key, label]) =>
    `<button class="wm${w.metrics?.[key] === false ? "" : " on"}" data-metric="${key}" title="Toggle ${label} monitoring">${label}</button>`).join("");

  /* long feeds collapse twice over: entries past the first few hide behind
     "show older", and item lists inside one entry collapse past three */
  const ENTRY_CAP = 6, ITEM_CAP = 3;
  const itemHtml = (i) =>
    `<div class="feed-item">${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.text)}</a>` : esc(i.text)}${i.detail ? ` <span class="dim">· ${esc(i.detail)}</span>` : ""}</div>`;
  const entryHtml = (c) => {
    const fresh = isUnseen(w, c);
    const all = c.items || [];
    const rest = all.length > ITEM_CAP + 1 ? all.slice(ITEM_CAP) : [];
    const shown = rest.length ? all.slice(0, ITEM_CAP) : all;
    return `<div class="feed-entry${fresh ? " fresh" : ""}" data-cid="${esc(c.id)}">
      <div class="feed-head"><span class="feed-when mono">${esc(fmtWhen(c.at))}</span><span class="tag">${esc(SHORT[c.source] || c.source)}</span>${fresh ? `<button class="feed-ack" title="Mark this alert as read">✓ read</button>` : ""}</div>
      <div class="feed-sum">${esc(c.summary)}</div>${shown.map(itemHtml).join("")}
      ${rest.length ? `<div class="feed-extra" hidden>${rest.map(itemHtml).join("")}</div><button class="feed-more">▾ ${rest.length} more</button>` : ""}
    </div>`;
  };
  const changes = (w.changes || []).slice(0, 60);
  const older = changes.slice(ENTRY_CAP);
  const feed = changes.slice(0, ENTRY_CAP).map(entryHtml).join("") +
    (older.length
      ? `<div class="feed-rest" hidden>${older.map(entryHtml).join("")}</div>
         <button class="mini feed-toggle">▾ Show ${older.length} older change${older.length === 1 ? "" : "s"}</button>`
      : "");

  card.innerHTML = `
    <div class="card-top">
      <span class="card-place">${esc(w.label || "Unnamed area")}${unseen.length ? `<span class="unseen-pill">${unseen.length} new</span>` : ""}</span>
      <span class="card-when">since ${new Date(w.createdAt).toLocaleDateString()}</span>
    </div>
    <div class="card-when mono" style="margin-top:2px">${fmtLat(w.lat)} ${fmtLon(w.lon)} · ${distMi(w.radiusMi)}</div>
    <div class="watch-status dim">${w.baselined
      ? `last activity ${w.changes?.length ? rel(w.changes[0].at) : "none yet"} · next check ${rel(w.nextCheckAt)}`
      : "baselining — first snapshots are being gathered…"}${errs.length ? ` · <span class="errtxt" title="${esc(errs.map(([s, e]) => `${s}: ${e}`).join("\n"))}">${errs.length} source error${errs.length === 1 ? "" : "s"}</span>` : ""}</div>
    <div class="wm-row">${toggles}</div>
    <div class="card-actions">
      <button class="mini check-btn">Check now</button>
      <button class="mini fly-btn">Show on globe</button>
      <button class="mini notify-btn">${w.notify?.url ? "🔔 On" : "🔔 Notify"}</button>
      ${unseen.length ? `<button class="mini seen-btn">Mark seen</button>` : ""}
      <button class="mini danger del-btn">✕ Stop watching</button>
    </div>
    <div class="notify-cfg" hidden>
      <input class="notify-url" type="url" spellcheck="false" placeholder="https://ntfy.sh/your-topic — or a Discord webhook / JSON endpoint" value="${esc(w.notify?.url || "")}" />
      <div class="notify-row2">
        <select class="notify-format">${["auto", "ntfy", "discord", "json"].map((f) =>
          `<option value="${f}"${(w.notify?.format || "auto") === f ? " selected" : ""}>${{ auto: "Auto-detect", ntfy: "ntfy", discord: "Discord", json: "Generic JSON" }[f]}</option>`).join("")}
        </select>
        <button class="mini notify-save">Save</button>
        <button class="mini notify-test"${w.notify?.url ? "" : " disabled"}>Send test</button>
        <button class="mini notify-rss" title="Copy this watch's RSS feed URL — any feed reader works as a channel">RSS</button>
      </div>
      <p class="dim notify-hint">Phone push with zero setup: install the <a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy</a> app, subscribe to a topic of your choosing, paste its URL here — every change this watch records gets pushed.${w.notifyState ? ` · Last delivery: ${w.notifyState.ok ? "✓ delivered" : `✕ ${esc(w.notifyState.error || "failed")}`} (${esc(rel(w.notifyState.at))})` : ""}</p>
    </div>
    <div class="feed">${w.changes?.length ? feed : `<p class="dim feed-empty">No changes recorded yet. The baseline was captured when the watch was added; anything that differs on a later check will appear here.</p>`}</div>`;

  card.querySelectorAll(".feed-more").forEach((btn) => btn.addEventListener("click", () => {
    const extra = btn.previousElementSibling;
    extra.hidden = !extra.hidden;
    btn.textContent = extra.hidden ? `▾ ${extra.children.length} more` : "▴ fewer";
  }));
  const feedToggle = card.querySelector(".feed-toggle");
  if (feedToggle) feedToggle.addEventListener("click", () => {
    const restBox = card.querySelector(".feed-rest");
    restBox.hidden = !restBox.hidden;
    const n = restBox.querySelectorAll(".feed-entry").length;
    feedToggle.textContent = restBox.hidden ? `▾ Show ${n} older change${n === 1 ? "" : "s"}` : "▴ Show fewer";
  });
  card.querySelectorAll(".feed-ack").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const cid = btn.closest(".feed-entry").dataset.cid;
    btn.disabled = true;
    await fetch(`/api/watches/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ackChange: cid }),
    });
    const c = (w.changes || []).find((x) => x.id === cid);
    if (c) c.seen = true;
    card.replaceWith(watchCard(w)); // re-render this card; pill count updates
    refreshWatchBadge();
  }));

  card.querySelectorAll(".wm").forEach((btn) => btn.addEventListener("click", async () => {
    const on = !btn.classList.contains("on");
    btn.classList.toggle("on", on);
    await fetch(`/api/watches/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metrics: { [btn.dataset.metric]: on } }),
    });
  }));
  const cfg = card.querySelector(".notify-cfg");
  card.querySelector(".notify-btn").addEventListener("click", () => { cfg.hidden = !cfg.hidden; });
  card.querySelector(".notify-save").addEventListener("click", async (e) => {
    const url = card.querySelector(".notify-url").value.trim();
    const format = card.querySelector(".notify-format").value;
    e.target.disabled = true;
    e.target.textContent = "Saving…";
    const r = await fetch(`/api/watches/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notify: url ? { url, format } : null }),
    });
    if (r.ok) {
      w.notify = url ? { url, format } : undefined;
      delete w.notifyState;
      const next = watchCard(w);
      card.replaceWith(next);
      next.querySelector(".notify-cfg").hidden = false; // keep the config open after save
    } else {
      e.target.textContent = "Invalid URL";
      e.target.disabled = false;
      setTimeout(() => { e.target.textContent = "Save"; }, 2200);
    }
  });
  card.querySelector(".notify-test").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Sending…";
    const r = await fetch(`/api/watches/${w.id}/notify-test`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    e.target.textContent = r.ok ? "Delivered ✓" : "Failed ✕";
    e.target.title = j.error || "";
    setTimeout(() => { e.target.textContent = "Send test"; e.target.disabled = false; }, 2500);
  });
  card.querySelector(".notify-rss").addEventListener("click", async (e) => {
    const url = `${location.origin}/api/watches/${w.id}/rss`;
    try { await navigator.clipboard.writeText(url); e.target.textContent = "Copied ✓"; }
    catch { prompt("RSS feed URL:", url); }
    setTimeout(() => { e.target.textContent = "RSS"; }, 2000);
  });
  card.querySelector(".check-btn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Checking…";
    const r = await fetch(`/api/watches/${w.id}/check`, { method: "POST" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      e.target.textContent = j.error?.includes("already") ? "Busy — try again" : "Check failed";
      e.target.disabled = false;
      return;
    }
    loadWatches();
  });
  card.querySelector(".fly-btn").addEventListener("click", () => {
    $("radiusRange").value = Math.min(w.radiusMi, parseInt($("radiusRange").max, 10));
    syncRadiusOut();
    selectPoint(w.lat, w.lon);
    showTab("explore");
  });
  card.querySelector(".seen-btn")?.addEventListener("click", async () => {
    await fetch(`/api/watches/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seen: true }),
    });
    loadWatches();
  });
  card.querySelector(".del-btn").addEventListener("click", async () => {
    await fetch(`/api/watches/${w.id}`, { method: "DELETE" });
    card.remove();
    refreshWatchBadge();
    if (!$("watchList").children.length) loadWatches();
  });
  return card;
}

/* ------------------------------------------------------------- space
   Live orbital layer + panel. CelesTrak TLEs arrive once via /api/space;
   satellite.js (SGP4) propagates real positions in the browser every second,
   so the dots move because the physics says so — no animation, no polling.
   The layer exists only while the Space tab is active, and hides itself when
   the camera drops below ~1,000 km so it never clutters street-level work. */

const SPACE = {
  active: false, loaded: false, shown: null,
  sats: [],            // { name, group, noradId, satrec, ent, geo }
  iss: null, orbitEnt: null, orbitBuiltAt: 0, tracked: null, followTimer: null, recentering: false,
  astros: null, tleFetchedAt: null, ticker: null,
};
const SPACE_MIN_CAM_M = 1_000_000;
const STATION_COLOR = "#d9a441", SAT_COLOR = "#4fc4a8";

function satGeo(satrec, date) {
  let pv;
  try { pv = satellite.propagate(satrec, date); } catch { return null; }
  if (!pv?.position) return null;
  const g = satellite.eciToGeodetic(pv.position, satellite.gstime(date));
  return {
    lonRad: g.longitude, latRad: g.latitude, heightKm: g.height,
    speedKmS: pv.velocity ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) : null,
  };
}
const satCart = (g) => Cesium.Cartesian3.fromRadians(g.lonRad, g.latRad, g.heightKm * 1000);

/* no disableDepthTestDistance here on purpose: a satellite behind the Earth
   should be occluded by it — that's half the point of a real 3D layer */
function satLabelOpts(text, color) {
  return {
    text,
    font: "12px 'IBM Plex Mono', monospace",
    fillColor: Cesium.Color.fromCssColorString(color),
    outlineColor: Cesium.Color.fromCssColorString("#0a1322"),
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(0, -16),
  };
}

function setSpaceActive(on) {
  if (on === SPACE.active) return;
  SPACE.active = on;
  if (!on) {
    untrackSat();
    clearInterval(SPACE.ticker);
    SPACE.ticker = null;
    setSpaceShow(false);
    return;
  }
  spinning = false;
  const start = () => {
    if (!SPACE.active) return; // user already left the tab
    const c = viewer.camera.positionCartographic;
    if (c.height < 4_000_000) { // near the ground: pull back to where orbits are visible
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 20_000_000),
        duration: 1.6,
      });
    }
    SPACE.ticker = setInterval(spaceTick, 1000);
    spaceTick();
  };
  if (SPACE.loaded) start();
  else loadSpace().then(start);
}

async function loadSpace() {
  const mount = $("spaceBody");
  try {
    if (typeof satellite === "undefined") throw new Error("the satellite.js library didn't load (CDN blocked?)");
    const r = await fetch("/api/space");
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const now = new Date();
    for (const s of j.satellites || []) {
      let satrec;
      try { satrec = satellite.twoline2satrec(s.line1, s.line2); } catch { continue; }
      const geo = satGeo(satrec, now);
      if (!geo) continue; // decayed or unpropagatable element set
      const isStation = s.group === "stations";
      const color = isStation ? STATION_COLOR : SAT_COLOR;
      const ent = viewer.entities.add({
        show: false,
        position: satCart(geo),
        point: {
          pixelSize: isStation ? 9 : 5,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.fromCssColorString("#0a1322"),
          outlineWidth: 1,
        },
        label: { ...satLabelOpts(s.name, color), show: isStation },
      });
      ent._isSat = true;
      ent._satName = s.name;
      ent._norad = s.noradId;
      const rec = { name: s.name, group: s.group, noradId: s.noradId, satrec, ent, geo };
      ent._rec = rec;
      SPACE.sats.push(rec);
      if (s.noradId === "25544") SPACE.iss = rec;
    }
    if (!SPACE.sats.length) throw new Error("no propagatable satellites in the element sets");
    rebuildIssOrbit();
    SPACE.astros = j.astros;
    SPACE.tleFetchedAt = j.tleFetchedAt;
    SPACE.loaded = true;
    renderSpacePanel();
  } catch (e) {
    mount.innerHTML = `<p class="empty-saved">Couldn't load orbital data — ${esc(e.message)}. Switch to another tab and back to retry.</p>`;
  }
}

/* one full ISS revolution from now, sampled per minute; rebuilt every 10 min
   so the drawn ring tracks the real orbit as it precesses */
function rebuildIssOrbit() {
  if (!SPACE.iss) return;
  const periodMin = (2 * Math.PI) / SPACE.iss.satrec.no; // satrec.no is rad/min
  const t0 = Date.now();
  const pts = [];
  for (let m = 0; m <= Math.ceil(periodMin); m++) {
    const g = satGeo(SPACE.iss.satrec, new Date(t0 + m * 60000));
    if (g) pts.push(satCart(g));
  }
  if (pts.length < 2) return;
  if (!SPACE.orbitEnt) {
    SPACE.orbitEnt = viewer.entities.add({
      show: false,
      polyline: {
        positions: pts,
        width: 1.5,
        arcType: Cesium.ArcType.NONE,
        material: Cesium.Color.fromCssColorString(STATION_COLOR).withAlpha(0.45),
      },
    });
  } else {
    SPACE.orbitEnt.polyline.positions = pts;
  }
  SPACE.orbitBuiltAt = t0;
}

function setSpaceShow(on) {
  if (SPACE.shown === on) return;
  SPACE.shown = on;
  for (const s of SPACE.sats) s.ent.show = on;
  if (SPACE.orbitEnt) SPACE.orbitEnt.show = on;
}

function spaceTick() {
  const now = new Date();
  const visible = SPACE.active && (!!SPACE.tracked || viewer.camera.positionCartographic.height > SPACE_MIN_CAM_M);
  setSpaceShow(visible);
  if (!visible) return;
  for (const s of SPACE.sats) {
    const g = satGeo(s.satrec, now);
    if (!g) continue;
    s.geo = g;
    if (s !== SPACE.tracked) s.ent.position = satCart(g); // tracked one has a per-frame property
  }
  if (Date.now() - SPACE.orbitBuiltAt > 10 * 60000) rebuildIssOrbit();
  updateSpaceReadouts();
}

function updateSpaceReadouts() {
  if ($("spaceView").hidden) return;
  const g = SPACE.iss?.geo;
  if (g) {
    const set = (k, v) => { const el = document.querySelector(`[data-iss="${k}"]`); if (el) el.textContent = v; };
    set("pos", `${fmtLat(Cesium.Math.toDegrees(g.latRad))}, ${fmtLon(Cesium.Math.toDegrees(g.lonRad))}`);
    set("alt", distKm(g.heightKm));
    set("spd", g.speedKmS ? `${g.speedKmS.toFixed(2)} km/s (${Math.round((g.speedKmS * 3600) / MI_TO_KM).toLocaleString()} mph)` : "—");
  }
  document.querySelectorAll("[data-satalt]").forEach((el) => {
    const sg = SPACE.sats[+el.dataset.satalt]?.geo;
    if (sg) el.textContent = Math.round(distCell(sg.heightKm)).toLocaleString();
  });
}

function renderSpacePanel() {
  const mount = $("spaceBody");
  let html = "";

  if (SPACE.astros?.people?.length) {
    const byAgency = {};
    for (const p of SPACE.astros.people) {
      const k = p.agency || p.craft || "—"; // p.craft: tolerate the old Open Notify shape in a warm cache
      (byAgency[k] = byAgency[k] || []).push(p);
    }
    const astroBtn = (p) => {
      const t = p.wiki?.split("/wiki/")[1];
      const wikipedia = t ? `en:${decodeURIComponent(t).replace(/_/g, " ")}` : "";
      return `<button class="wiki-peek astro-wiki" data-name="${esc(p.name)}" data-wikipedia="${esc(wikipedia)}"
        title="Preview the Wikipedia article for ${esc(p.name)}">${esc(p.name)}</button>`;
    };
    html += `<div class="card">
      <div class="card-top"><span class="card-place">Humans in space right now</span><span class="card-when mono">${SPACE.astros.number}</span></div>
      ${Object.entries(byAgency).map(([agency, people]) =>
        `<div class="astro-craft"><span class="tag">${esc(agency)}</span> ${people.map(astroBtn).join(", ")}</div>`).join("")}
      <p class="dim" style="font-size:11.5px;margin-top:8px">Everyone currently in space, per Launch Library 2 (The Space Devs) — click a name for their article.</p>
    </div>`;
  }

  if (SPACE.iss) {
    const periodMin = (2 * Math.PI) / SPACE.iss.satrec.no;
    html += `<div class="card">
      <div class="card-top"><span class="card-place">ISS — live</span><span class="card-when">one orbit ≈ ${periodMin.toFixed(0)} min</span></div>
      <dl class="kv">
        <dt>Above</dt><dd class="mono" data-iss="pos">—</dd>
        <dt>Altitude</dt><dd data-iss="alt">—</dd>
        <dt>Speed</dt><dd data-iss="spd">—</dd>
      </dl>
      <div class="card-actions"><button class="mini" id="issFlyBtn">◉ Follow on globe</button></div>
      <p class="dim" style="font-size:11.5px">The brass ring on the globe is the station's next full revolution.</p>
    </div>`;
  }

  const row = (s) => {
    const i = SPACE.sats.indexOf(s);
    return `<tr><td><button class="wiki-peek sat-wiki" data-norad="${esc(s.noradId)}" data-name="${esc(s.name)}" title="Preview the Wikipedia article for ${esc(s.name)}">${esc(s.name)}</button>
      <button class="pin-btn sat-fly" data-si="${i}" title="Follow ${esc(s.name)} on the globe" aria-label="Follow ${esc(s.name)} on the globe">◎</button></td><td class="num" data-satalt="${i}">—</td></tr>`;
  };
  const stations = SPACE.sats.filter((s) => s.group === "stations");
  const visual = SPACE.sats.filter((s) => s.group !== "stations");
  html += `<details class="block" open><summary><h3>Space stations &amp; modules <span class="n">${stations.length}</span></h3></summary>
    <table><thead><tr><th>Name</th><th class="num">Alt (${distUnit()})</th></tr></thead><tbody>${stations.map(row).join("")}</tbody></table>
  </details>`;
  html += `<details class="block"><summary><h3>Brightest tracked satellites <span class="n">${visual.length}</span></h3></summary>
    <table><thead><tr><th>Name</th><th class="num">Alt (${distUnit()})</th></tr></thead><tbody>${visual.map(row).join("")}</tbody></table>
    <p class="dim" style="font-size:11.5px;margin-top:8px">CelesTrak's “visual” group — objects big and low enough to spot by eye at twilight. Click a name for its Wikipedia preview (matched by catalog number, never the name), ◎ to lock the camera on and follow it in orbit — clicking a dot up there does both. Esc or ✕ releases the lock.</p>
  </details>`;
  html += `<p class="dim" style="font-size:11.5px;margin-top:14px">Positions are propagated locally (SGP4) from CelesTrak orbital elements fetched ${esc(rel(SPACE.tleFetchedAt))} — typically accurate to a few km. Stations are brass, satellites teal; a dot behind the Earth is hidden, exactly as it should be.</p>`;

  mount.innerHTML = html;
  $("issFlyBtn")?.addEventListener("click", () => trackSat(SPACE.iss));
  mount.querySelectorAll(".sat-wiki").forEach((btn) =>
    btn.addEventListener("click", () => openWikiPop({ name: btn.dataset.name, norad: btn.dataset.norad })));
  mount.querySelectorAll(".sat-fly").forEach((btn) =>
    btn.addEventListener("click", () => trackSat(SPACE.sats[+btn.dataset.si])));
  mount.querySelectorAll(".astro-wiki").forEach((btn) =>
    btn.addEventListener("click", () =>
      openWikiPop({ name: btn.dataset.name, astro: "1", wikipedia: btn.dataset.wikipedia || "" })));
}

/* follow mode, tripod style: the camera holds still relative to Earth so the
   SATELLITE is what visibly moves — sweeping across the view along its orbit
   ring — and the view glides ahead to re-center it whenever it nears the
   edge. (A strict chase-cam pins the target to one pixel forever and makes
   everything else move instead.) The camera is never put in a special mode,
   so drag/zoom/tilt work normally the whole time, and re-centering keeps
   whatever zoom and angle the user has chosen. */
function trackSat(s) {
  if (!s) return;
  spinning = false;
  viewer.camera.cancelFlight();
  untrackSat(false); // release any previous follow first
  SPACE.tracked = s;
  // wall-clock, not the sim time param: the viewer's clock doesn't animate
  // (no timeline widget), so simulation time stays frozen at page load
  s.ent.position = new Cesium.CallbackProperty(() => {
    const g = satGeo(s.satrec, new Date());
    return g ? satCart(g) : undefined;
  }, false);
  if (s.ent.label) s.ent.label.show = true;
  const g0 = satGeo(s.satrec, new Date());
  if (!g0) { SPACE.tracked = null; return; }
  // vantage above its ground point, close enough that orbital motion is plain
  // to see; recentering=true holds the nudge watchdog off until this flight
  // lands (a nudge mid-flight would cancel it and strand the camera high up)
  SPACE.recentering = true;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(g0.lonRad, g0.latRad, Math.max(g0.heightKm * 2000, 1_000_000)),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.4,
    complete: () => { SPACE.recentering = false; },
    cancel: () => { SPACE.recentering = false; },
  });
  SPACE.followTimer = setInterval(followNudge, 500);
  $("trackStop").hidden = false;
  $("trackStop").textContent = `✕ Stop following ${s.name}`;
  $("readoutStatus").textContent = `following ${s.name} — watch it sweep past; the view re-centers as it nears the edge`;
}

/* glide the camera ahead of the satellite once it leaves the central 60% of
   the screen — aimed ~25 s down-orbit so it sweeps through center, keeping
   the user's current zoom and heading */
function followNudge() {
  const s = SPACE.tracked;
  if (!s || SPACE.recentering) return;
  const g = satGeo(s.satrec, new Date());
  if (!g) return;
  const st = Cesium.SceneTransforms.wgs84ToWindowCoordinates || Cesium.SceneTransforms.worldToWindowCoordinates;
  const win = st(viewer.scene, satCart(g));
  const w = viewer.canvas.clientWidth, h = viewer.canvas.clientHeight;
  const inBox = win && win.x > w * 0.2 && win.x < w * 0.8 && win.y > h * 0.2 && win.y < h * 0.8;
  if (inBox) return;
  const lead = satGeo(s.satrec, new Date(Date.now() + 25_000));
  if (!lead) return;
  SPACE.recentering = true;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(lead.lonRad, lead.latRad, viewer.camera.positionCartographic.height),
    orientation: { heading: viewer.camera.heading, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.6,
    complete: () => { SPACE.recentering = false; },
    cancel: () => { SPACE.recentering = false; },
  });
}

function untrackSat(updateUi = true) {
  const s = SPACE.tracked;
  if (!s) return;
  SPACE.tracked = null;
  clearInterval(SPACE.followTimer);
  SPACE.followTimer = null;
  SPACE.recentering = false;
  const g = satGeo(s.satrec, new Date());
  if (g) s.ent.position = satCart(g); // back to tick-driven updates
  if (updateUi) {
    $("trackStop").hidden = true;
    const d = defaultStatus();
    if (d) $("readoutStatus").textContent = d;
  }
}
$("trackStop").addEventListener("click", () => untrackSat());

/* ------------------------------------------------------------ settings UI */

function initSettingsUI() {
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
    // localized names come from the server per-language, so refresh the live report's settlements
    if (currentReport && !currentReport.pending?.size) fetchPart(currentReport, "settlements");
    applySettings();
  });
}

function applySettings() {
  syncRadiusOut();
  tickClocks();
  if (currentReport) renderLive(currentReport);
  if (!$("savedView").hidden) loadSaved();
  if (!$("watchView").hidden) loadWatches();
  if (!$("spaceView").hidden && SPACE.loaded) renderSpacePanel(); // unit headers
}

initSettingsUI();
refreshSavedCount();
refreshWatchBadge();

/* deep link on first load: if the URL carries a valid #@lat,lon,radius, drop
   the circle there and run the analysis automatically */
analyzeFromHash(location.hash);
