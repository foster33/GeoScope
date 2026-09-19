/**
 * Geo + numeric helpers
 * ---------------------
 * Pure, dependency-free utilities shared across every data source. No I/O here,
 * so this module is trivially unit-testable.
 */

export const MI_TO_KM = 1.609344;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

export function isoDaysAgo(d) {
  const dt = new Date(Date.now() - d * 86400000);
  return dt.toISOString().slice(0, 10);
}

export const sanitizeLang = (l) =>
  (/^[a-z]{2,12}(-[a-z0-9-]+)?$/i.test(String(l || "")) ? String(l).toLowerCase() : "en");

export const distLabel = (mi) => `${mi} mi / ${Math.round(mi * MI_TO_KM)} km`;
