/**
 * Watch routes
 * ------------
 *   GET    /api/watches                       all watches, newest first
 *   POST   /api/watches { lat, lon, radiusMi, label, place }
 *   PATCH  /api/watches/:id { metrics | notify | seen | ackChange }
 *   POST   /api/watches/:id/check             run every source for this watch now
 *   POST   /api/watches/:id/notify-test       push a synthetic change through its channel
 *   DELETE /api/watches/:id
 *   GET    /api/watches/:id/rss               the change log as an RSS feed
 *
 * The HTTP layer validates and shapes input; every state change goes through
 * the engine so the scheduler and the routes can never disagree about a watch.
 */
import express from "express";
import { xmlEsc } from "../../lib/format.js";
import { NOTIFY_FORMATS } from "../../watch/notify.js";
import { HttpError, wrap, isValidLatLon } from "../http.js";

/* the place names a watch searches news for: only the fields the news query
   builder reads, each bounded, so a client can't park arbitrary data here */
const PLACE_FIELDS = ["locality", "county", "state", "country", "extra", "displayName"];
export function sanitizePlace(place) {
  if (!place || typeof place !== "object") return {};
  const out = {};
  for (const k of PLACE_FIELDS) {
    if (place[k] == null) continue;
    out[k] = String(place[k]).slice(0, 200);
  }
  return out;
}

export function rssFor(w, siteUrl) {
  const title = `GeoScope watch — ${w.label || "watched area"}`;
  const items = (w.changes || []).slice(0, 50).map((c) => `
  <item>
    <title>${xmlEsc(c.summary)}</title>
    <description>${xmlEsc((c.items || []).map((i) => `${i.text}${i.detail ? ` — ${i.detail}` : ""}`).join("\n"))}</description>
    ${c.items?.find((i) => i.link) ? `<link>${xmlEsc(c.items.find((i) => i.link).link)}</link>` : ""}
    <guid isPermaLink="false">${xmlEsc(c.id)}</guid>
    <pubDate>${new Date(c.at).toUTCString()}</pubDate>
    <category>${xmlEsc(c.source)}</category>
  </item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${xmlEsc(title)}</title>
  <description>${xmlEsc(`Changes detected in the ${w.radiusMi}-mile circle at ${w.lat.toFixed(4)}, ${w.lon.toFixed(4)}`)}</description>
  <link>${xmlEsc(siteUrl)}</link>${items}
</channel></rss>`;
}

export function watchRoutes({ engine }) {
  const r = express.Router();

  const load = (req) => {
    const w = engine.get(req.params.id);
    if (!w) throw new HttpError(404, "Watch not found.");
    return w;
  };

  r.get("/watches", (_req, res) => {
    res.json([...engine.list()].reverse().map(engine.view));
  });

  r.post("/watches", (req, res) => {
    const { lat, lon, radiusMi, label, place } = req.body || {};
    if (!isValidLatLon(lat, lon)) throw new HttpError(400, "Valid lat and lon are required.");
    let w;
    try {
      w = engine.add({ lat, lon, radiusMi, label, place: sanitizePlace(place) });
    } catch (e) {
      if (e.code === "LIMIT") throw new HttpError(409, e.message);
      throw e;
    }
    engine.tick(w.id).catch(() => {}); // capture the baseline in the background
    res.status(201).json(engine.view(w));
  });

  r.patch("/watches/:id", (req, res) => {
    const w = load(req);
    const body = req.body || {};
    if (body.notify !== undefined) {
      const n = body.notify;
      if (!n || !n.url) {
        engine.setNotify(w, null);
      } else {
        try {
          const u = new URL(String(n.url));
          if (!/^https?:$/.test(u.protocol)) throw new Error();
        } catch {
          throw new HttpError(400, "Notification URL must be a valid http(s) URL.");
        }
        engine.setNotify(w, {
          url: String(n.url).slice(0, 500),
          format: NOTIFY_FORMATS.includes(n.format) ? n.format : "auto",
        });
      }
    }
    if (body.metrics && typeof body.metrics === "object") engine.setMetrics(w, body.metrics);
    if (body.seen) engine.markSeen(w);
    if (body.ackChange) engine.ackChange(w, body.ackChange);
    res.json(engine.view(w));
  });

  r.post("/watches/:id/check", wrap(async (req, res) => {
    const w = load(req);
    const ran = await engine.tick(w.id);
    if (!ran) throw new HttpError(409, "A check is already running — try again in a moment.");
    res.json(engine.view(w));
  }));

  r.delete("/watches/:id", (req, res) => {
    if (!engine.remove(req.params.id)) throw new HttpError(404, "Watch not found.");
    res.json({ deleted: req.params.id });
  });

  r.post("/watches/:id/notify-test", wrap(async (req, res) => {
    const w = load(req);
    if (!w.notify?.url) throw new HttpError(400, "No notification URL is set for this watch.");
    try {
      await engine.sendTest(w);
    } catch (e) {
      throw new HttpError(502, e.message);
    }
    res.json({ ok: true });
  }));

  r.get("/watches/:id/rss", (req, res) => {
    const w = load(req);
    res.type("application/rss+xml").send(rssFor(w, `${req.protocol}://${req.get("host")}/`));
  });

  return r;
}
