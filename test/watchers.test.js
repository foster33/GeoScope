import { test } from "node:test";
import assert from "node:assert/strict";
import { WATCHERS } from "../watch/watchers.js";
import { quakeKey } from "../lib/format.js";

/* The watch differ is the code whose silent failure would quietly undermine
   GeoScope's "trustworthy change log" premise, so it gets the most coverage.
   Every diff()/next() is pure: snapshot in, change/snapshot out. */

test("airquality: only a band crossing is a change", () => {
  const aq = WATCHERS.airquality;
  assert.equal(aq.diff({ aqi: 40 }, { us_aqi: 49 }), null, "Good -> Good is not a change");
  const worse = aq.diff({ aqi: 40 }, { us_aqi: 80 });
  assert.match(worse.summary, /worsened/);
  assert.match(worse.summary, /Good → Moderate/);
  const better = aq.diff({ aqi: 160 }, { us_aqi: 30 });
  assert.match(better.summary, /improved/);
  assert.equal(aq.diff({ aqi: null }, { us_aqi: 80 }), null, "no baseline -> no change");
  assert.equal(aq.diff({ aqi: 40 }, { us_aqi: null }), null, "no reading -> no change");
});

test("weather: alerts only on entering/leaving a severe code", () => {
  const wx = WATCHERS.weather;
  const enter = wx.diff({ code: 0 }, { weather_code: 95, temperature_2m: 18, wind_speed_10m: 40, precipitation: 3 });
  assert.match(enter.summary, /Severe weather: thunderstorm/);
  const leave = wx.diff({ code: 95 }, { weather_code: 1 });
  assert.match(leave.summary, /cleared/);
  assert.equal(wx.diff({ code: 0 }, { weather_code: 1 }), null, "calm -> calm is not a change");
  assert.equal(wx.diff({ code: 65 }, { weather_code: 95 }), null, "severe -> severe is not a new alert");
  assert.equal(wx.diff({ code: null }, { weather_code: 95 }), null, "no baseline -> no change");
});

test("earthquakes: dedup against previously seen keys", () => {
  const eq = WATCHERS.earthquakes;
  const e1 = { date: "2024-01-01", mag: 3.2, place: "A", depthKm: 5 };
  const e2 = { date: "2024-02-01", mag: 4.0, place: "B", depthKm: 9 };
  const prev = { keys: [quakeKey(e1)] };
  const d = eq.diff(prev, { recent: [e1, e2] });
  assert.equal(d.items.length, 1, "only the unseen quake is fresh");
  assert.match(d.items[0].text, /M4 — B/);
  assert.equal(eq.diff(prev, { recent: [e1] }), null, "nothing new -> no change");
  // next() accumulates both keys for future dedup
  const nx = eq.next(prev, { recent: [e1, e2] });
  assert.ok(nx.keys.includes(quakeKey(e1)) && nx.keys.includes(quakeKey(e2)));
});

test("settlements: detects additions, removals, and population edits", () => {
  const s = WATCHERS.settlements;
  const prev = { places: { Alpha: 100, Beta: null } };
  const list = [
    { name: "Alpha", population: 250 }, // population tag changed
    { name: "Gamma", population: null }, // newly mapped
    // Beta is gone -> removed
  ];
  const d = s.diff(prev, list);
  const texts = d.items.map((i) => i.text).join("\n");
  assert.match(texts, /Alpha population tag: 100 → 250/);
  assert.match(texts, /New settlement mapped: Gamma/);
  assert.match(texts, /No longer mapped as a settlement: Beta/);
  assert.equal(d.items.length, 3);
  // unchanged -> no diff
  assert.equal(s.diff({ places: { Alpha: 100 } }, [{ name: "Alpha", population: 100 }]), null);
});

test("infrastructure: only changed counts surface, unknown labels ignored", () => {
  const inf = WATCHERS.infrastructure;
  const prev = { counts: { Hospitals: 2, Schools: 10 } };
  const list = [
    { label: "Hospitals", count: 3 },  // changed
    { label: "Schools", count: 10 },   // unchanged
    { label: "Museums", count: 4 },    // no baseline -> ignored
    { label: "Parks", count: null },   // null -> ignored
  ];
  const d = inf.diff(prev, list);
  assert.equal(d.items.length, 1);
  assert.match(d.items[0].text, /Hospitals: 2 → 3/);
});

test("landmarks/people: fresh items are those not previously seen", () => {
  const lm = WATCHERS.landmarks;
  const d = lm.diff({ titles: ["Old Tower"] }, [
    { title: "Old Tower", url: "u1", distanceKm: 1 },
    { title: "New Bridge", url: "u2", distanceKm: 2 },
  ]);
  assert.equal(d.items.length, 1);
  assert.match(d.items[0].text, /New Bridge/);

  const pp = WATCHERS.people;
  const dp = pp.diff({ names: ["Ada Lovelace"] }, [
    { name: "Ada Lovelace", url: "u", occupations: ["mathematician"] },
    { name: "Alan Turing", url: "u", occupations: ["mathematician", "logician"] },
  ]);
  assert.equal(dp.items.length, 1);
  assert.match(dp.items[0].text, /Alan Turing/);
});

test("surveillance: dedups by category + rounded position", () => {
  const sv = WATCHERS.surveillance;
  const p1 = { cat: "alpr", lat: 40.123456, lon: -74.123456, manufacturer: "Flock" };
  const p2 = { cat: "camera", lat: 41.0, lon: -75.0 };
  const prev = { keys: ["alpr|40.12346,-74.12346"] }; // p1 already seen (5-dp rounding)
  const d = sv.diff(prev, { points: [p1, p2] });
  assert.equal(d.items.length, 1, "only the unseen camera is fresh");
  assert.match(d.items[0].text, /surveillance camera/);
});

test("news: a headline is fresh only if unseen AND published recently", () => {
  const n = WATCHERS.news;
  const prev = { asOf: "2024-01-10T00:00:00Z", titles: ["seen headline"] };
  const items = [
    { title: "Fresh story", link: "l1", pubDate: "2024-01-09T12:00:00Z", source: "Src" }, // within 48h slack
    { title: "Seen headline", link: "l2", pubDate: "2024-01-09T12:00:00Z" },               // already seen
    { title: "Ancient story", link: "l3", pubDate: "2024-01-01T00:00:00Z" },               // older than slack
  ];
  const d = n.diff(prev, items);
  assert.equal(d.items.length, 1);
  assert.match(d.items[0].text, /Fresh story/);
});

test("every watcher exposes interval, fetch, diff, next", () => {
  for (const [name, def] of Object.entries(WATCHERS)) {
    assert.ok(def.intervalMs > 0, `${name} interval`);
    assert.equal(typeof def.fetch, "function", `${name} fetch`);
    assert.equal(typeof def.diff, "function", `${name} diff`);
    assert.equal(typeof def.next, "function", `${name} next`);
  }
});
