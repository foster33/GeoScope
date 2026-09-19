/**
 * Report summarizer
 * -----------------
 * Composes the one-glance overview paragraph from a finished report object.
 * Pure (no I/O), so it is unit-tested directly in test/summary.test.js.
 */
import { WMO } from "./format.js";

export function buildSummary(r) {
  const parts = [];
  r.location = r.location || {};
  const where = r.location.ocean
    ? "an area of open water or unpopulated terrain"
    : [r.location.locality, r.location.county, r.location.state, r.location.country].filter(Boolean).join(", ");
  parts.push(`This ${r.radiusMi}-mile radius is centered at ${r.lat.toFixed(5)}°, ${r.lon.toFixed(5)}° — ${where}.`);

  if (r.settlements?.length) {
    const withPop = r.settlements.filter((s) => s.population);
    const total = withPop.reduce((s, x) => s + x.population, 0);
    const biggest = r.settlements[0];
    parts.push(
      `The circle contains ${r.settlements.length} mapped settlement${r.settlements.length === 1 ? "" : "s"}` +
      (biggest ? `, the largest being ${biggest.name}${biggest.population ? ` (pop. ~${biggest.population.toLocaleString()})` : ""}` : "") +
      (total ? `. Summing the ${withPop.length} settlements with recorded census figures gives an estimated ${total.toLocaleString()} residents inside or near the circle.` : ".")
    );
  } else if (!r.location.ocean) {
    parts.push("No mapped settlements fall inside the circle — this appears to be a sparsely populated area.");
  }

  if (r.weather?.current) {
    const c = r.weather.current;
    parts.push(
      `Right now it is ${c.temperature_2m}°C (${Math.round(c.temperature_2m * 9 / 5 + 32)}°F) with ${WMO[c.weather_code] || "mixed conditions"}, ` +
      `${c.relative_humidity_2m}% humidity and ${c.wind_speed_10m} km/h wind.`
    );
  }

  if (r.history?.months?.length) {
    const hs = r.history.months;
    const hottest = hs.reduce((a, b) => (b.avgHighC > a.avgHighC ? b : a));
    const coldest = hs.reduce((a, b) => (b.avgLowC < a.avgLowC ? b : a));
    const rain = hs.reduce((s, m) => s + (m.precipMm || 0), 0);
    parts.push(
      `Over the last 12 months the warmest stretch was ${hottest.month} (avg high ${hottest.avgHighC}°C) and the coldest was ${coldest.month} (avg low ${coldest.avgLowC}°C), with roughly ${rain.toLocaleString()} mm of total precipitation.`
    );
  }

  if (r.people?.length) {
    const top = r.people.slice(0, 3).map((p) => p.name).join(", ");
    parts.push(`Notable people born within this radius include ${top}${r.people.length > 3 ? ` and ${r.people.length - 3} others` : ""}.`);
  }

  if (r.air?.us_aqi != null) {
    const aqi = r.air.us_aqi;
    const cat = aqi <= 50 ? "good" : aqi <= 100 ? "moderate" : aqi <= 150 ? "unhealthy for sensitive groups" : aqi <= 200 ? "unhealthy" : aqi <= 300 ? "very unhealthy" : "hazardous";
    parts.push(`Air quality is currently ${cat} (US AQI ${aqi}).`);
  }

  if (r.quakes?.count) {
    parts.push(
      `Seismically, USGS records ${r.quakes.count.toLocaleString()} earthquake${r.quakes.count === 1 ? "" : "s"} of M2.5+ within this radius over the past decade` +
      (r.quakes.largest ? `, the largest a M${r.quakes.largest.mag} on ${r.quakes.largest.date}.` : ".")
    );
  } else if (r.quakes) {
    parts.push("USGS records no M2.5+ earthquakes within this radius in the past decade.");
  }

  if (r.elevationM != null) parts.push(`Elevation at the center point is ${Math.round(r.elevationM)} m (${Math.round(r.elevationM * 3.281)} ft).`);
  return parts.join(" ");
}
