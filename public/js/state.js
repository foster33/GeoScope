/**
 * Shared UI state
 * ---------------
 * The two facts several modules need to agree on. Everything else is owned by
 * the module that renders it.
 *
 *   picked         the selected point on the globe, { lat, lng } or null
 *   currentReport  the live Explore analysis; render paths compare against it
 *                  so a superseded analysis can never paint over a newer one
 */
export const state = {
  picked: null,
  currentReport: null,
};
