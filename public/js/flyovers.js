/**
 * Satellite flyovers
 * ------------------
 * "When will a satellite pass over THIS point, and where in the sky?" —
 * answered entirely in the browser with the same TLEs + SGP4 propagator that
 * drive the Space tab, so it costs zero extra API calls. A pass is a window
 * where the object clears 10° elevation; "visible" means it's sunlit while
 * the observer's sky is dark (see astro.js), and the table gives the exact
 * stretch of the pass for which that holds, since a station can fade into
 * Earth's shadow mid-pass.
 *
 * Accuracy budget: SGP4 on a fresh element set places the ISS within a
 * kilometre of independent trackers. The scan steps 30 s to find passes,
 * then re-samples rise, peak and set at 1 s, so times are good to a second
 * or two and peak elevation isn't clipped by the grid. Element sets older
 * than TLE_MAX_AGE are refetched before a scan (the server refreshes its
 * copy every 6 h; a browser tab left open would otherwise keep its first
 * set forever).
 */
import { api } from "./api.js";
import { settings } from "./settings.js";
import { esc, rel, compass } from "./format.js";
import { emit } from "./events.js";
import { SPACE } from "./space.js";
import { D2R, R2D, sunEciKm, satSunlit, scanPasses } from "./astro.js";

const MIN_EL = 10, SHOW_EL = 15, STEP_MS = 30000, REFINE_MS = 1000, HORIZON_MS = 36 * 3600000, MAX_ROWS = 25;
export const TLE_MAX_AGE_MS = 12 * 3600000;

const freshEnough = (fetchedAt) => !!fetchedAt && Date.now() - Date.parse(fetchedAt) < TLE_MAX_AGE_MS;

/* satrecs for the flyover scan: reuse the Space tab's if it's loaded and its
   elements are still fresh (no globe side effects either way), otherwise fetch
   /api/space and build them without adding any Cesium entities */
const FLY = { satrecs: null, tleAt: null, loading: null };
async function getFlySatrecs() {
  if (SPACE.loaded && SPACE.sats.length && freshEnough(SPACE.tleFetchedAt)) {
    return { list: SPACE.sats.map((s) => ({ name: s.name, noradId: s.noradId, group: s.group, satrec: s.satrec })), tleAt: SPACE.tleFetchedAt };
  }
  if (FLY.satrecs && freshEnough(FLY.tleAt)) return { list: FLY.satrecs, tleAt: FLY.tleAt };
  if (!FLY.loading) FLY.loading = (async () => {
    if (typeof satellite === "undefined") throw new Error("the satellite.js library didn't load (CDN blocked?)");
    const j = await api.get("/api/space");
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

export async function computeFlyovers(lat, lon, elevKm) {
  const { list, tleAt } = await getFlySatrecs();
  const obs = { latitude: lat * D2R, longitude: lon * D2R, height: elevKm || 0 };
  const t0 = Date.now(), tEnd = t0 + HORIZON_MS;
  const passes = [];
  let batch = 0;
  for (const sat of list) {
    const sample = (t) => {
      const date = new Date(t);
      let pv; try { pv = satellite.propagate(sat.satrec, date); } catch { return null; }
      if (!pv?.position) return null;
      const gmst = satellite.gstime(date);
      const look = satellite.ecfToLookAngles(obs, satellite.eciToEcf(pv.position, gmst));
      return {
        el: look.elevation * R2D,
        az: look.azimuth * R2D,
        visible: () => { // dark sky + sunlit object; evaluated only inside passes
          const sun = sunEciKm(date);
          const obsSunEl = satellite.ecfToLookAngles(obs, satellite.eciToEcf(sun, gmst)).elevation * R2D;
          return obsSunEl < -6 && satSunlit(pv.position, sun);
        },
      };
    };
    passes.push(...scanPasses(sample, {
      t0, tEnd, stepMs: STEP_MS, minEl: MIN_EL, refineMs: REFINE_MS,
      meta: { name: sat.name, noradId: sat.noradId, group: sat.group },
    }));
    if (++batch % 12 === 0) await new Promise((r) => setTimeout(r)); // yield so the spinner paints
  }
  // keep the meaningful ones (strong passes or anything naked-eye visible), time-ordered
  const shown = passes.filter((p) => p.visible || p.peakEl >= SHOW_EL).sort((a, b) => a.start - b.start);
  return { tleAt, shown, total: passes.length };
}

/* Element sets carry no brightness, so expectations come from what the
   object is: the stations are the size of a football field and outshine
   every star; the rest of the "visual" group are the brightest ordinary
   satellites, which still need a reasonably dark sky. */
const brightness = (p) => (p.group === "stations"
  ? { label: "bright", title: "A space station: easily seen even from a city" }
  : { label: "needs dark sky", title: "Bright for a satellite, but faint next to a station — look from somewhere without streetlights" });

export function flyoversBody(rep) {
  const f = rep._fly;
  const computeBtn = (label) => `<div class="card-actions"><button class="mini" id="flyComputeBtn">${label}</button></div>`;
  if (!f) return `<p class="dim">Upcoming satellite passes over this exact point — space stations and the ~150 brightest objects, propagated locally from current orbital elements.</p>${computeBtn("Compute upcoming passes")}`;
  if (f.state === "loading") return `<p class="dim sect-loading"><span class="dot"></span> propagating orbits in your browser…</p>`;
  if (f.state === "error") return `<p class="dim">Couldn't compute passes — ${esc(f.error)}.</p>${computeBtn("Retry")}`;
  if (!f.shown.length) return `<p class="dim">No passes above 15° over this point in the next 36 hours for the tracked objects.</p>${computeBtn("Recompute")}`;
  const tz = rep.weather?.timezone;
  const h12 = settings.clock === "12";
  const fmtDay = new Intl.DateTimeFormat([], { timeZone: tz || undefined, weekday: "short", hour: h12 ? "numeric" : "2-digit", minute: "2-digit", hour12: h12 });
  const fmtClock = new Intl.DateTimeFormat([], { timeZone: tz || undefined, hour: h12 ? "numeric" : "2-digit", minute: "2-digit", second: "2-digit", hour12: h12 });
  const mins = (a, b) => `${Math.max(1, Math.round((b - a) / 60000))} min`;
  const rows = f.shown.slice(0, MAX_ROWS).map((p) => {
    const b = brightness(p);
    const vis = p.visible
      ? `<span class="fly-vis-badge" title="${esc(b.title)}">👁 ${esc(fmtClock.format(new Date(p.visStart)))}–${esc(fmtClock.format(new Date(p.visEnd)))} · ${esc(b.label)}</span>`
      : "—";
    return `<tr class="${p.visible ? "fly-vis" : ""}">
      <td><button class="wiki-peek" data-norad="${esc(p.noradId)}" data-name="${esc(p.name)}" title="Preview ${esc(p.name)} on Wikipedia">${esc(p.name)}</button></td>
      <td>${esc(fmtDay.format(new Date(p.start)))} <span class="dim">${compass(p.startAz)}</span> <span class="fly-when">${esc(rel(new Date(p.start).toISOString()))}</span></td>
      <td class="num">${esc(fmtClock.format(new Date(p.peakT)))} · ${Math.round(p.peakEl)}° ${compass(p.peakAz)}</td>
      <td>${esc(fmtClock.format(new Date(p.end)))} <span class="dim">${compass(p.endAz)} · ${mins(p.start, p.end)}</span></td>
      <td>${vis}</td>
    </tr>`;
  }).join("");
  return `<table class="fly-table"><thead><tr><th>Object</th><th>Rises (${tz ? "local" : "your time"})</th><th class="num">Peak</th><th>Sets</th><th>Naked eye</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="fly-note">${f.total} pass${f.total === 1 ? "" : "es"} above 10° in the next 36 h; showing the strongest ${Math.min(MAX_ROWS, f.shown.length)} (≥15° or naked-eye visible). Rise and set are the times the object clears 10° above the horizon, with the compass bearing to look toward. “Naked eye” is the stretch of the pass during which the object is sunlit while your sky is dark — outside that window it is up there but invisible, so a pass can fade out mid-sky as it enters Earth's shadow. Computed in your browser (SGP4) from elements fetched ${esc(rel(f.tleAt))}.</p>
    ${computeBtn("Recompute")}`;
}

export async function flyCompute(rep) {
  if (rep._fly?.state === "loading") return;
  rep._fly = { state: "loading" };
  emit("report:rerender", rep);
  let result;
  try {
    const elevKm = Number.isFinite(rep.elevationM) ? rep.elevationM / 1000 : 0;
    result = { state: "done", at: Date.now(), ...(await computeFlyovers(rep.lat, rep.lon, elevKm)) };
  } catch (e) {
    result = { state: "error", error: e.message };
  }
  rep._fly = result;
  emit("report:rerender", rep);
}
