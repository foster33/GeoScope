/**
 * HTTP plumbing shared by every router
 * ------------------------------------
 * - HttpError: throw it from a handler to answer with a specific status and a
 *   JSON `{ error }` body (the error middleware below does the rest).
 * - wrap: adapts an async handler so a rejected promise reaches the error
 *   middleware instead of hanging the request (Express 4 doesn't do this).
 * - parsePoint: the one place the lat/lon/radius query triple is validated,
 *   so every coordinate-keyed route rejects the same inputs with the same
 *   message.
 */
import { MI_TO_KM, clamp } from "../lib/geo.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* query-string values can arrive as arrays (`?lat=1&lat=2`); routes want one string */
export const str = (v) => (Array.isArray(v) ? String(v[0] ?? "") : v == null ? "" : String(v));

export const RADIUS_MIN_MI = 1;
export const RADIUS_MAX_MI = 300; // the UI stops at 250; the API tolerates a little more

/* {lat, lon, radius_mi} -> validated numbers plus the derived radii every
   source wants. Throws 400 when the point is missing or off the globe. */
export function parsePoint(query, { defaultRadiusMi = 10 } = {}) {
  const lat = parseFloat(str(query.lat));
  const lon = parseFloat(str(query.lon));
  const radiusMi = clamp(parseFloat(str(query.radius_mi)) || defaultRadiusMi, RADIUS_MIN_MI, RADIUS_MAX_MI);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new HttpError(400, "Valid lat and lon are required.");
  }
  const radiusKm = radiusMi * MI_TO_KM;
  return { lat, lon, radiusMi, radiusKm, radiusM: radiusKm * 1000 };
}

export const isValidLatLon = (lat, lon) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/* Every error, thrown or passed to next(), becomes a JSON body — never
   Express's default HTML page, which the frontend can't parse. An HttpError
   carries a message meant for the user (a 502 says which upstream failed and
   why); anything else is a bug, so it is logged and its message hidden. */
export function jsonErrorHandler(err, _req, res, _next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  const status = err.status || err.statusCode || 500; // body-parser errors carry their own status
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Internal server error." : err.message });
}

export function jsonNotFound(_req, res) {
  res.status(404).json({ error: "Not found." });
}
