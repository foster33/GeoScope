/**
 * Live clocks
 * -----------
 * One global ticker drives every element carrying a data-tz-clock attribute
 * (the report's local-time block, the UTC and "your time" rows), formatting
 * the current instant in that element's IANA zone.
 */
import { settings } from "./settings.js";

export function tickClocks(now = new Date()) {
  document.querySelectorAll("[data-tz-clock]").forEach((el) => {
    try {
      el.textContent = new Intl.DateTimeFormat("en-US", {
        timeZone: el.dataset.tzClock,
        weekday: "short", month: "short", day: "numeric",
        hour: settings.clock === "12" ? "numeric" : "2-digit",
        minute: "2-digit", second: "2-digit", hour12: settings.clock === "12",
      }).format(now);
    } catch { /* unknown zone string */ }
  });
}

export function startClocks() {
  setInterval(() => tickClocks(), 1000);
}
