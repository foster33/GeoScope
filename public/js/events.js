/**
 * Tiny event bus
 * --------------
 * Lets a module that renders a report (render.js, flyovers.js) ask the
 * analysis owner (analyze.js) to do something — retry a source, clear the
 * report, re-render — without importing it, which keeps the module graph a
 * tree instead of a cycle.
 *
 *   report:retry     { rep, src }   re-fetch one source of the live report
 *   report:clear                    wipe the live report and the circle
 *   report:rerender  rep            repaint if `rep` is still the live report
 */
const bus = new EventTarget();

export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
