# Contributing

Thanks for looking under the hood. GeoScope is small enough to read in an afternoon; this page is the map.

## Running it locally

```bash
npm install
npm run dev        # the server with every upstream API faked — works offline
npm start          # the real thing (needs internet; be polite to the public APIs)
```

`npm run dev` uses `fixtures/upstream.js`, a deterministic stand-in for Nominatim, Overpass, Open-Meteo, Wikidata, Wikipedia, USGS, Google News, CelesTrak and Launch Library. It is the same fake the tests use, so you can build and check a UI change without hitting a single real service.

## Checks

```bash
npm run lint       # ESLint, recommended rules
npm test           # node:test — unit, source, scheduler, saved-place and route tests
npm run test:e2e   # Playwright browser suite (first time: npx playwright install chromium)
```

CI runs all three plus a Docker build. Please run at least `npm run lint && npm test` before opening a pull request; run the browser suite for anything that touches `public/`.

## Where things live

- `server/` — Express wiring. `app.js` builds the app without starting it; each feature has its own router under `routes/`. Validation shared by every coordinate-keyed route is in `http.js`.
- `sources/` — one module per upstream service. Each exports plain async functions that take coordinates and return plain data; nothing in here knows about HTTP routes.
- `watch/` — the scheduler (`engine.js`), the per-source change detectors (`watchers.js`) and notification dispatch (`notify.js`). The detectors are pure: snapshot in, change out.
- `public/js/` — the browser, as ES modules with no build step. `main.js` wires things together; `globe.js` owns the Cesium viewer; `analyze.js` owns the live report; `render.js` turns a report into HTML. Pure helpers (`format.js`, `diff.js`, `astro.js`, `permalink.js`, `report-model.js`) have no DOM dependency and are unit-tested under Node.

## Ground rules

- **Coordinates, never names.** Every upstream lookup is keyed by the exact point the user clicked. The only name-based source (news) takes names the geocode verified for that point and anchors each to its state or country. Keep it that way.
- **One request per source per analysis**, cached where data moves slowly. If you add a source, read its usage policy first, send the shared `User-Agent` from `lib/net.js`, and give it a fixture.
- **A failed source never sinks the report.** Throw a descriptive error from the source; the routes turn it into a 502 with that message and the UI shows a Retry button.
- **No machine translation.** Localized names come from OpenStreetMap `name:*` tags and Wikipedia's own editions.
- **Tests pin behavior, not implementation.** Prefer a route test or a pure-function test over asserting on internals.

## Adding a report section

1. A source module in `sources/` returning plain data, plus a fixture route in `fixtures/upstream.js`.
2. A handler in `server/parts.js` (and a cache-key rule if it depends on more than coordinates).
3. Its name in `SOURCES` / `SOURCE_LABELS` / `SOURCE_FIELD` in `public/js/report-model.js`.
4. A `…Html(rep, pend)` function in `public/js/render.js`, called from `renderReport`.
5. If it should be watchable, a detector in `watch/watchers.js` with a `diff`/`next` pair and a test in `test/watchers.test.js`.
