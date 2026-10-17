/**
 * GeoScope entry point
 * --------------------
 * Reads configuration from the environment, builds the app (server/app.js),
 * starts the watch scheduler, and listens. Everything else is importable
 * without side effects.
 *
 *   PORT             listen port (default 8080)
 *   DATA_DIR         where saved places and watches persist (default ./data)
 *   AREA_CACHE_MS    hot-path report cache TTL (default 5 minutes)
 *   GEOSCOPE_CONTACT contact shown in the outbound User-Agent (see lib/net.js)
 */
import path from "path";
import { fileURLToPath } from "url";
import { createApp, DEFAULT_AREA_CACHE_MS } from "./server/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const { app, engine } = createApp({
  dataDir: process.env.DATA_DIR || path.join(__dirname, "data"),
  areaCacheMs: parseInt(process.env.AREA_CACHE_MS || "", 10) || DEFAULT_AREA_CACHE_MS,
});

engine.start();
app.listen(PORT, () => console.log(`GeoScope running on http://localhost:${PORT}`));
