/**
 * Browser end-to-end configuration
 * --------------------------------
 * Boots the REAL server with every upstream API replaced by fixtures
 * (fixtures/preload.js) on a fresh temp data directory, then drives the UI
 * in headless Chromium. CesiumJS needs WebGL, so Chromium runs on its
 * software renderer. Tests share one server and its saved state, hence a
 * single worker.
 */
import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8089;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "geoscope-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: "node --import ./fixtures/preload.js server.js",
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), DATA_DIR: dataDir, AREA_CACHE_MS: "1000" },
  },
});
