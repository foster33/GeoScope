/**
 * Astronomy helpers for the flyover predictor
 * -------------------------------------------
 * Pure math, no satellite.js dependency, unit-tested in Node.
 *
 * "Visible" for a satellite pass means the object is sunlit while the
 * observer's sky is dark — the only time you can actually see one. That needs
 * the Sun's position (low-precision, good to ~0.01°, ample for shadow tests)
 * and an Earth-shadow test (a cylinder of Earth's radius pointing away from
 * the Sun).
 */
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const EARTH_R_KM = 6378.137;
export const AU_KM = 149597870.7;

/* Sun position in ECI km for a date (Astronomical Almanac low-precision formula) */
export function sunEciKm(date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const g = (357.529 + 0.98560028 * d) * D2R;                   // mean anomaly
  const q = (280.459 + 0.98564736 * d) * D2R;                   // mean longitude
  const L = q + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * D2R;                    // obliquity
  const r = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU_KM;
  return { x: r * Math.cos(L), y: r * Math.cos(e) * Math.sin(L), z: r * Math.sin(e) * Math.sin(L) };
}

/* is the satellite in sunlight (not inside Earth's umbra cylinder)? */
export function satSunlit(sat, sun) {
  const sm = Math.hypot(sun.x, sun.y, sun.z);
  const ux = sun.x / sm, uy = sun.y / sm, uz = sun.z / sm;
  const dot = sat.x * ux + sat.y * uy + sat.z * uz;
  if (dot > 0) return true; // sunward hemisphere is always lit
  const px = sat.x - dot * ux, py = sat.y - dot * uy, pz = sat.z - dot * uz;
  return Math.hypot(px, py, pz) > EARTH_R_KM; // outside the shadow cylinder
}

/* Scan one object's elevation over time and return its passes above `minEl`
   degrees. `sample(t)` -> { el, az, visible } or null when the object can't
   be propagated; `visible` may be a function so the (costlier) sun geometry
   is only evaluated inside passes, never on the thousands of samples between
   them. Separated from the propagator so the pass logic is testable with a
   synthetic elevation curve.

   Each pass carries rise, peak and set (time + bearing) and the naked-eye
   window inside it: a pass is "visible" if ANY sample is sunlit under a dark
   sky, and visStart/visEnd bound that stretch — a station that climbs sunlit
   and fades into Earth's shadow before culminating is still a sight worth
   stepping outside for. With `refineMs`, the rise, set and peak found at the
   coarse step are re-sampled at the finer step so times are exact to a second
   and the peak elevation isn't clipped by the sampling grid. */
export function scanPasses(sample, { t0, tEnd, stepMs, minEl, meta = {}, refineMs = 0 }) {
  const passes = [];
  let cur = null;
  const up = (s) => s && s.el >= minEl;

  const finish = (p) => {
    if (refineMs > 0 && refineMs < stepMs) {
      if (p.start > t0) { // rise lies in (start - step, start]
        for (let t = p.start - stepMs + refineMs; t < p.start; t += refineMs) {
          const s = sample(t);
          if (up(s)) { p.start = t; p.startAz = s.az; break; }
        }
      }
      for (let t = p.end + refineMs; t < p.end + stepMs; t += refineMs) { // set lies in [end, end + step)
        const s = sample(t);
        if (!up(s)) break;
        p.end = t; p.endAz = s.az;
      }
      for (let t = p.peakT - stepMs + refineMs; t < p.peakT + stepMs; t += refineMs) {
        const s = sample(t);
        if (s && s.el > p.peakEl) { p.peakEl = s.el; p.peakAz = s.az; p.peakT = t; }
      }
    }
    let visStart = null, visEnd = null, visPeakEl = null, visPeakAz = null;
    for (const { t, s } of p.samples) {
      if (!(typeof s.visible === "function" ? s.visible() : s.visible)) continue;
      if (visStart == null) visStart = t;
      visEnd = t;
      if (visPeakEl == null || s.el > visPeakEl) { visPeakEl = s.el; visPeakAz = s.az; }
    }
    delete p.samples;
    return { ...p, visible: visStart != null, visStart, visEnd, visPeakEl, visPeakAz };
  };
  const close = () => { if (cur) { passes.push(finish(cur)); cur = null; } };

  for (let t = t0; t <= tEnd; t += stepMs) {
    const s = sample(t);
    if (!up(s)) { close(); continue; }
    if (!cur) cur = { ...meta, start: t, startAz: s.az, end: t, endAz: s.az, peakEl: -90, peakAz: 0, peakT: t, samples: [] };
    cur.end = t; cur.endAz = s.az;
    cur.samples.push({ t, s });
    if (s.el > cur.peakEl) { cur.peakEl = s.el; cur.peakAz = s.az; cur.peakT = t; }
  }
  close();
  return passes;
}
