/**
 * Server API client
 * -----------------
 * Every call to /api/* goes through here, so the "fetch, parse JSON, turn a
 * non-2xx into an Error carrying the server's message" dance exists once.
 *
 *   api.get("/api/history")
 *   api.post("/api/history", { report })
 *   api.patch("/api/watches/" + id, { seen: true })
 *   api.del("/api/watches/" + id)
 *
 * Failures throw ApiError (status + the server's `error` text) for HTTP
 * errors, or the underlying TypeError when the server is unreachable.
 */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const r = await fetch(path, init);
  let json = null;
  try { json = await r.json(); } catch { /* non-JSON body */ }
  if (!r.ok) throw new ApiError(r.status, json?.error || `HTTP ${r.status}`);
  return json;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  patch: (path, body) => request("PATCH", path, body),
  del: (path) => request("DELETE", path),
};

/* build "?a=1&b=2" from an object, skipping null/undefined */
export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) p.set(k, String(v));
  return p.toString();
}
