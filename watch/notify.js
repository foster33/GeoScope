/**
 * Watch notifications
 * -------------------
 * Every recorded watch change can be pushed through a per-watch URL: an ntfy
 * topic (free phone push, no accounts), a Discord webhook, or any JSON endpoint.
 * One dispatch point, fire-and-forget with a single retry (the retry lives in
 * the engine); the outcome is stored on the watch so the card can show it.
 */
import { UA, postNotify } from "../lib/net.js";
import { distLabel } from "../lib/geo.js";

export const NOTIFY_FORMATS = ["auto", "ntfy", "discord", "json"];

const NTFY_TAGS = {
  news: "newspaper", earthquakes: "warning", airquality: "fog", weather: "thunder_cloud_rain",
  settlements: "house", landmarks: "round_pushpin", people: "bust_in_silhouette",
  surveillance: "camera", infrastructure: "building_construction",
};

/* HTTP headers must stay latin-1; ntfy decodes RFC 2047 for everything else */
const headerSafe = (s) =>
  /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

export function notifyKind(cfg) {
  if (cfg.format && cfg.format !== "auto") return cfg.format;
  if (/discord(?:app)?\.com\/api\/webhooks\//.test(cfg.url)) return "discord";
  if (/ntfy/i.test(new URL(cfg.url).host)) return "ntfy";
  return "json";
}

export async function sendNotification(cfg, w, change) {
  const kind = notifyKind(cfg);
  const where = `${w.label || "watched area"} (${distLabel(w.radiusMi)} radius)`;
  const lines = (change.items || []).slice(0, 8).map((i) => `• ${i.text}${i.detail ? ` — ${i.detail}` : ""}`);
  if (kind === "ntfy") {
    return postNotify(cfg.url, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Title: headerSafe(`GeoScope: ${where}`),
        Tags: NTFY_TAGS[change.source] || "globe_with_meridians",
      },
      body: `${change.summary}${lines.length ? "\n" + lines.join("\n") : ""}`,
    });
  }
  if (kind === "discord") {
    return postNotify(cfg.url, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `${where}: ${change.summary}`.slice(0, 256),
          description: lines.join("\n").slice(0, 4000),
          color: 0xd9a441,
          timestamp: change.at,
          footer: { text: `GeoScope · ${w.lat.toFixed(4)}, ${w.lon.toFixed(4)} · source: ${change.source}` },
        }],
      }),
    });
  }
  return postNotify(cfg.url, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "watch.change",
      watch: { id: w.id, label: w.label, lat: w.lat, lon: w.lon, radiusMi: w.radiusMi },
      change,
    }),
  });
}
