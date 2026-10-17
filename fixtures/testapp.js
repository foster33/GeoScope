/**
 * Boot a full GeoScope app for route tests: fake upstream installed, a fresh
 * temp data directory, the watch scheduler idle (no timers), ephemeral port.
 *
 *   const t = await bootTestApp();
 *   const { status, body } = await t.get("/api/part/geocode?lat=1&lon=2");
 *   await t.close();
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.js";
import { installFakeUpstream } from "./upstream.js";

export async function bootTestApp({ engine = {}, areaCacheMs } = {}) {
  const fake = installFakeUpstream();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "geoscope-test-"));
  const built = createApp({
    dataDir,
    areaCacheMs,
    log: { log() {} },
    engine: { sleep: async () => {}, gapMs: 0, forcedGapMs: 0, ...engine },
  });
  const server = await new Promise((resolve) => {
    const s = built.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, url, body, rawBody) {
    const init = { method };
    if (rawBody !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = rawBody;
    } else if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const r = await fetch(base + url, init);
    const text = await r.text();
    let parsed = text;
    try { parsed = JSON.parse(text); } catch { /* html, xml */ }
    return { status: r.status, body: parsed, headers: r.headers, text };
  }

  return {
    ...built, fake, dataDir, base,
    get: (url) => call("GET", url),
    post: (url, body) => call("POST", url, body),
    postRaw: (url, raw) => call("POST", url, undefined, raw),
    patch: (url, body) => call("PATCH", url, body),
    del: (url) => call("DELETE", url),
    async close() {
      built.engine.stop();
      await new Promise((r) => server.close(r));
      fake.restore();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
