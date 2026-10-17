/**
 * Space tab
 * ---------
 * Live orbital layer + panel. CelesTrak TLEs arrive once via /api/space;
 * satellite.js (SGP4) propagates real positions in the browser every second,
 * so the dots move because the physics says so — no animation, no polling.
 * The layer exists only while the Space tab is active, and hides itself when
 * the camera drops below ~1,000 km so it never clutters street-level work.
 */
import { $ } from "./dom.js";
import { api } from "./api.js";
import { MI_TO_KM, esc, rel, fmtLat, fmtLon, distKm, distCell, distUnit } from "./format.js";
import { viewer, setSpinning, NIGHT } from "./globe.js";
import { setStatus, restoreStatus } from "./status.js";
import { openWikiPop } from "./wiki.js";

export const SPACE = {
  active: false, loaded: false, shown: null,
  sats: [],            // { name, group, noradId, satrec, ent, geo }
  iss: null, orbitEnt: null, orbitBuiltAt: 0, tracked: null, followTimer: null, recentering: false,
  astros: null, tleFetchedAt: null, ticker: null,
};
const SPACE_MIN_CAM_M = 1_000_000;
const STATION_COLOR = "#d9a441", SAT_COLOR = "#4fc4a8";
const ISS_NORAD = "25544";

export function satGeo(satrec, date) {
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
    outlineColor: Cesium.Color.fromCssColorString(NIGHT),
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(0, -16),
  };
}

export function setSpaceActive(on) {
  if (on === SPACE.active) return;
  SPACE.active = on;
  if (!on) {
    untrackSat();
    clearInterval(SPACE.ticker);
    SPACE.ticker = null;
    setSpaceShow(false);
    return;
  }
  setSpinning(false);
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
    const j = await api.get("/api/space");
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
          outlineColor: Cesium.Color.fromCssColorString(NIGHT),
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
      if (s.noradId === ISS_NORAD) SPACE.iss = rec;
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

/* A tab left open for days would otherwise fly every dot on the element set
   it first loaded; SGP4 drifts by kilometres a day on a stale set. Once the
   loaded elements are older than TLE_MAX_AGE_MS, swap in the server's current
   set object by object (the server itself refetches every 6 h). */
export const TLE_MAX_AGE_MS = 12 * 3600000;
let refreshing = false;
async function refreshElementsIfStale() {
  if (!SPACE.loaded || refreshing || Date.now() - Date.parse(SPACE.tleFetchedAt || 0) < TLE_MAX_AGE_MS) return;
  refreshing = true;
  try {
    const j = await api.get("/api/space");
    const fresh = new Map((j.satellites || []).map((s) => [s.noradId, s]));
    for (const rec of SPACE.sats) {
      const s = fresh.get(rec.noradId);
      if (!s) continue;
      try { rec.satrec = satellite.twoline2satrec(s.line1, s.line2); } catch { /* keep the old set for this one */ }
    }
    SPACE.tleFetchedAt = j.tleFetchedAt;
    SPACE.orbitBuiltAt = 0; // redraw the ISS ring from the new elements
    if (!$("spaceView").hidden) renderSpacePanel(); // the "elements fetched … ago" note
  } catch { /* next tick tries again */ }
  finally { refreshing = false; }
}

function spaceTick() {
  const now = new Date();
  refreshElementsIfStale();
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

export function renderSpacePanel() {
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
export function trackSat(s) {
  if (!s) return;
  setSpinning(false);
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
  setStatus(`following ${s.name} — watch it sweep past; the view re-centers as it nears the edge`);
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

export function untrackSat(updateUi = true) {
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
    restoreStatus();
  }
}

export function initSpace() {
  $("trackStop").addEventListener("click", () => untrackSat());
}
