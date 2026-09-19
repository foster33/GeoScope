/**
 * Weather: current + 7-day, 12-month history, and air quality (Open-Meteo)
 * ------------------------------------------------------------------------
 */
import { fetchJson } from "../lib/net.js";
import { isoDaysAgo } from "../lib/geo.js";

// 3. Current weather + 7-day outlook
export async function currentWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,pressure_msl` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code,sunrise,sunset,daylight_duration,uv_index_max` +
    `&forecast_days=7&timezone=auto`;
  return fetchJson(url);
}

// 4. Weather history: last ~12 months of daily records, aggregated to monthly
export async function weatherHistory(lat, lon) {
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${isoDaysAgo(372)}&end_date=${isoDaysAgo(6)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
  const j = await fetchJson(url, {}, 30000);
  const d = j.daily;
  if (!d?.time?.length) return { months: [] };
  const buckets = new Map();
  d.time.forEach((day, i) => {
    const key = day.slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, { hi: [], lo: [], precip: 0 });
    const b = buckets.get(key);
    if (d.temperature_2m_max[i] != null) b.hi.push(d.temperature_2m_max[i]);
    if (d.temperature_2m_min[i] != null) b.lo.push(d.temperature_2m_min[i]);
    b.precip += d.precipitation_sum[i] || 0;
  });
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : null);
  const months = [...buckets.entries()].map(([month, b]) => ({
    month,
    avgHighC: avg(b.hi),
    avgLowC: avg(b.lo),
    precipMm: Math.round(b.precip),
  }));

  // extremes across the whole period
  let hottest = null, coldest = null, wettest = null;
  let daysOver30 = 0, daysBelow0 = 0, totalPrecip = 0;
  d.time.forEach((day, i) => {
    const hi = d.temperature_2m_max[i], lo = d.temperature_2m_min[i], pr = d.precipitation_sum[i] || 0;
    if (hi != null && (!hottest || hi > hottest.tempC)) hottest = { date: day, tempC: hi };
    if (lo != null && (!coldest || lo < coldest.tempC)) coldest = { date: day, tempC: lo };
    if (!wettest || pr > wettest.precipMm) wettest = { date: day, precipMm: Math.round(pr * 10) / 10 };
    if (hi != null && hi >= 30) daysOver30++;
    if (lo != null && lo <= 0) daysBelow0++;
    totalPrecip += pr;
  });

  return {
    months: months.slice(-12),
    extremes: { hottest, coldest, wettest, daysOver30, daysBelow0, totalPrecipMm: Math.round(totalPrecip) },
  };
}

// 4b. Air quality right now (Open-Meteo air quality model)
export async function airQuality(lat, lon) {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&current=us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide&timezone=auto`;
  const j = await fetchJson(url);
  return j.current || null;
}

// 7. Elevation (Open-Meteo)
export async function elevation(lat, lon) {
  const j = await fetchJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
  return j.elevation?.[0] ?? null;
}
