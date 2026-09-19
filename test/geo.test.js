import { test } from "node:test";
import assert from "node:assert/strict";
import { MI_TO_KM, clamp, haversineKm, sanitizeLang, distLabel } from "../lib/geo.js";

test("clamp keeps values inside the range", () => {
  assert.equal(clamp(5, 1, 10), 5);
  assert.equal(clamp(-3, 1, 10), 1);
  assert.equal(clamp(99, 1, 10), 10);
});

test("haversineKm: zero distance for identical points", () => {
  assert.equal(haversineKm(40, -74, 40, -74), 0);
});

test("haversineKm: known distance NYC -> LA is ~3936 km", () => {
  const d = haversineKm(40.7128, -74.006, 34.0522, -118.2437);
  assert.ok(Math.abs(d - 3936) < 20, `got ${d}`);
});

test("haversineKm is symmetric", () => {
  const a = haversineKm(51.5, -0.12, 48.85, 2.35);
  const b = haversineKm(48.85, 2.35, 51.5, -0.12);
  assert.equal(a, b);
});

test("sanitizeLang accepts language codes and rejects junk", () => {
  assert.equal(sanitizeLang("en"), "en");
  assert.equal(sanitizeLang("PT-BR"), "pt-br");
  assert.equal(sanitizeLang("zh-hans"), "zh-hans");
  assert.equal(sanitizeLang("../etc/passwd"), "en");
  assert.equal(sanitizeLang(""), "en");
  assert.equal(sanitizeLang(undefined), "en");
});

test("distLabel formats miles + km", () => {
  assert.equal(distLabel(10), "10 mi / 16 km");
  assert.equal(Math.round(1 * MI_TO_KM * 1000) / 1000, 1.609);
});
