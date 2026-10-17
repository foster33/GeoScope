/**
 * README screenshot
 * -----------------
 * Boots the server, opens a report in headless Chromium and saves
 * docs/screenshot.png. By default it runs against the REAL upstream APIs so
 * the picture shows genuine data (one analysis = one request per source);
 * pass --fixtures to use the offline fakes instead.
 *
 *   npm run screenshot            # real data, Springfield IL, 10 mi
 *   npm run screenshot -- --fixtures
 *   npm run screenshot -- --at 48.8566,2.3522,15
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const useFixtures = args.includes("--fixtures");
const at = args[args.indexOf("--at") + 1] && args.includes("--at") ? args[args.indexOf("--at") + 1] : "39.7817,-89.6501,10";
const PORT = 8092;
const out = path.resolve("docs/screenshot.png");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "geoscope-shot-"));
const server = spawn(process.execPath, [...(useFixtures ? ["--import", "./fixtures/preload.js"] : []), "server.js"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: "inherit",
});
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + "/"); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/#@${at}`);
  await page.waitForSelector(".status-board.all-good, .status-board:not(.working)", { timeout: 120_000 });
  // open the sections that photograph well, collapse the rest
  for (const sec of ["location", "settlements", "weather"]) {
    const d = page.locator(`details[data-sec="${sec}"]`);
    if (await d.count()) await d.evaluate((el) => { el.open = true; });
  }
  await page.locator('details[data-sec="sources"]').evaluate((el) => { el.open = false; }).catch(() => {});
  await page.waitForTimeout(useFixtures ? 4000 : 12000); // let imagery tiles stream in
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
