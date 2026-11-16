# Functionality & feature improvements — follow-up audit

Date: 2026-11-16. Commit reviewed: `c0d3d8f` (main). Methods: three read-only audits
(frontend, backend, data/edge cases) plus live API smoke tests in demo mode.

## P0 — fix now

None found. Core planning, calculation, sharing, validation and deployment all work.

## Status: P1 implemented (2026-11-16)

All three P1 items below have been fixed: the November inland 50ppm row was added and data
integrity is now enforced; TomTom failures fall back to the mock/offline providers with a user
warning and health status; and the app re-decodes pasted/back-forward trip-link hashes.
Verification: `npm run check` passes (22 files / 219 tests), and a live run with an invalid TomTom
key confirmed the fallback warning, degraded health status, and the corrected R32.09 price.

## P1 — high value / user-visible

1. **November inland diesel 50ppm price is missing** (`src/api/data/fuelPrices.za.json`).
   The current month has 7 of 8 zone×grade rows; `inland/diesel50ppm` falls back to the coastal
   wholesale price R30.83/L. Oct inland 33.29 − announced 119.82c → **R32.09**, consistent with
   neighbouring grades; verify against DMPR and add. ~4% understatement (~R100 per 1 000 km at
   8 L/100 km). Live-confirmed via `POST /api/route` (warning names the fallback). No staleness
   warning fires because the month itself is on file.
   Also add a data-integrity test asserting 8 rows/month, a shared `effectiveDate`, and that it
   equals the first Wednesday (`src/api/data/README.md` states these rules but the test doesn't).

2. **No degradation when TomTom is configured but failing/out of quota**
   (`src/api/server.ts:15-25`, `src/api/providers/tomtom.ts:161-163`, `src/api/places/tomtom.ts:74`).
   An expired key, 403/429 or 5xx makes both routing and place search return 502 for every user,
   although mock/offline providers exist. `/api/health` still reports `{ok:true, provider:'tomtom'}`.
   Fix: wrap providers to fall back to mock/offline on `ProviderError` and attach a warning; expose
   last-upstream-error in health.

3. **Trip links desync from the UI** (`src/App.tsx:63,127-142`). The hash is decoded once at mount;
   pasting a new `#p=…` URL into an open tab or using back/forward fires `hashchange`/`popstate`,
   which the app ignores. The address bar shows trip B while the planner shows trip A. Fix: add a
   `hashchange` listener that re-decodes and restores state.

## P2 — worth doing

**Frontend / UX**
- Long-press + `contextmenu` can remove two markers on Android (both call `onRemovePoint`);
  guard with a per-marker `removed` flag (`MapView.tsx:225-243`).
- "Compare with fastest" is a no-op for 2-point routes but looks active; disable it below 3 points
  (`App.tsx:282`, `routePlanner.ts:70`).
- Error banner survives input fixes because `error` isn't cleared by `changePoints`/`setChoice`
  (`App.tsx:85,144-205`).
- Aborted searches can render stale results: `.then` lacks the `controller.signal.aborted` guard
  in `PlaceSearch.tsx:34-39` and `VehiclePicker.tsx:42-47`.
- Route line is effectively unclickable on touch (±7 px hit box, mouse-only `cursor:copy` hint);
  use a coarse-pointer hit box of 18-24 px (`MapView.tsx:49,171-195`).
- Clicking the faded stale route line inserts a via against current points; exclude
  `your-route-line` from `LINE_LAYERS` when `stale` (`MapView.tsx:57,172-188`).
- Trip-link fragments are unbounded (~15-20 kB for 150 labelled points); cap ~4 kB, drop labels
  first and tell the user (`tripLink.ts:26,32-53`).
- Search lists lack combobox/listbox semantics, live result counts and arrow-key navigation;
  reorderable point rows use `key={i}` (`PlaceSearch`, `VehiclePicker`, `RouteBuilder`).
- Markers advertise `role="button"` but ignore Enter/Space (`MapView.tsx:221-223,255-275`).
- "Choose your car or enter your own consumption" is misleading when a car is selected but
  custom mode with an empty value is on (`ActionBar.tsx:22-23`).

**Backend / data**
- Malformed 200 (`{routes:[{}]}`) throws on the primary call → 500 instead of 502; validate
  `summary` fields and timestamps in `parseTomTomResponse` (`tomtom.ts:113-144,199-206`).
- Custom consumption omits `vehicleWeight`, so TomTom's default speed-change model inflates fuel
  above the figure the user entered (~+3.5 L/100km per the module comment); send a nominal weight
  or ignore provider litres for `realWorld` (`tomtom.ts:98-102`, `routePlanner.ts:67`).
- `TRUST_PROXY=true` makes `req.ip` spoofable via `X-Forwarded-For`, bypassing the rate limit;
  document hop counts (e.g. `TRUST_PROXY=1`) instead (`.env.example:28`, `server.ts:39-44`).
- Cache key uses the raw `departAt` string, so equivalent instants with different offsets miss
  and spend extra quota; normalize to `Date.getTime()` (`cache.ts:19-27`).
- TomTom place search returns unranked near-duplicates that fill the 6 slots; dedupe by rounded
  coordinates (`places/tomtom.ts:40-54`).
- Past departures up to 60 s are forwarded silently; use a 0 ms threshold (`routePlanner.ts:58-62`).
- Rate-limiter map can grow with ≥5 000 concurrently active IPs; sweep on a timer or LRU
  (`rateLimit.ts:19-31`).
- Health is static liveness, not provider health; add last-success/last-error to the response.
- Staleness warning only checks the month immediately after current; report the latest missed
  adjustment when >1 month behind (`fuelPrices.ts:58-67`).
- Offline place search ranks province-only matches equally with name matches ("cape" → all Cape
  towns); demote/drop region-only hits (`places/offline.ts:22,33-35`).
- Vehicle search has no relevance ranking; catalogue lacks Haval H6, Jimny/Vitara, Golf, RAV4,
  Ford EcoSport/Fiesta, hybrids/EVs, and `yearTo` for superseded variants.
- `vitest.config.ts` silently skips future `src/lib/**` and `src/shared/**` tests (`passWithNoTests`).
- Standing copy calls diesel prices "regulated **retail**" although diesel is regulated
  **wholesale** (`App.tsx:308`, README); only a post-calculation warning corrects it.

## P2 — product features to consider

- **Toll costs**: absent entirely; on N1/N3/N4 long trips they can rival fuel. At minimum warn
  "toll costs not included" when toll roads are used; ideally add an SA tariff table + `tollRands`.
- **Cross-vehicle comparison**: compare two catalogue cars' fuel cost on the same route (reuses
  existing request/result structures).
- **Saved trips / history** via localStorage (a URL fragment is lost unless copied).
- **Round-trip / return leg** and route alternatives beyond "fastest".
- Be explicit in-product that demo routing uses straight lines and tiles need network.

## Live checks performed

- `GET /api/health`, fuel months/prices, place search: correct; security headers present.
- `POST /api/route`: correct ETA/fuel math (mock), month switching (Nov/Oct/Sep), 429 with
  `Retry-After`, past-departure warning, zone fallback warning, vehicle/fuel mismatch warning.
- Identical points return a 200 with zero distance/time/fuel; consider rejecting as invalid.
- Cache correctly restarts "leave now" departure/arrival times on a hit.
- 150-point limit and validation errors behave as documented; no API key in error bodies.
- `npm test`: 21 files / 203 tests pass.
