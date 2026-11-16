# Routes — audit & follow-up

Audit date: 2026-11-16. Scope: full source tree, data files, tests, configs and GitHub metadata.

## Status at audit time

The audit was performed against the then-current `main` (`eb1d1d0`): a compact React 19 + Vite +
Express app with ~3.6k lines, 120 passing tests, clean typecheck, a 1.31 MB single JS bundle, an
open unmerged PR #1, no CI/license, and no deployment configuration.

While the follow-up work was being prepared, `main` advanced by nine commits (PR #2 and related
work) that independently delivered a **substantial redesign** plus place search, trip links, rate
limiting, a provider cache, fresh fuel-price data, and a bundled production server. That work was
preserved: the follow-up was rebased onto `origin/main` and only genuinely missing items were
applied. The earlier self-contained version of the audit and its changes is kept in the local
`backup/audit-base` branch.

## Findings and current resolution

| Priority | Finding | Resolution |
|---|---|---|
| P0 | Fuel-price data could go stale silently | Remote main added a `staleWarning` and updated price data. Verified present. |
| P0 | PR #1 (via-point detour loops) unmerged | Advisory review → `docs/pr-1-review.md`, verdict **Request changes** (see below). |
| P0 | No deployable production server | Remote main added static hosting, `build:server` and `start:prod`. Verified present. |
| P1 | Unprotected `/api/route` | Remote main added per-IP rate limiting and a short-TTL provider cache. Verified present. |
| P1 | Single 1.31 MB bundle | Remote main lazy-loads MapLibre into an async chunk. Verified present. |
| P1 | Hardcoded 20 s routing timeout | **Added** `TOMTOM_TIMEOUT_MS` with validation, option override and tests. |
| P1 | No security headers | **Added** `nosniff`, `X-Frame-Options`, `Referrer-Policy` on all responses, with tests. |
| P1 | No graceful shutdown | **Added** SIGTERM/SIGINT handling that drains in-flight requests, with a force-exit fallback. |
| P2 | Missing component tests | **Added** suites for `DepartureTimePicker`, `PriceMonthToggle` and `Warnings`. |
| P2 | Map markers not keyboard-operable | **Added** focusable markers, arrow-key nudging, Delete/Backspace removal, and an "add point at map centre" button. |
| P2 | No CI/license/contributing guide | **Added** GitHub Actions (Node 20/22), MIT license, `CONTRIBUTING.md`. |
| P2 | No one-command verification gate | **Added** `npm run check` (typecheck + test + build). |

## PR #1 review — headline

`docs/pr-1-review.md` is a full advisory review (no code from the PR was applied). Verdict:
**Request changes**.

1. **(P0)** The retry is accepted purely on reduced excursion length; distance, ETA and fuel are
   never compared, so a retry that removes a small spur but adds a long detour can win.
2. **(P0)** Excursion detection is quadratic in polyline vertices within a 10 km window and can run
   for up to 148 vias; the 150-point schema cap limits waypoints, not vertices. Needs decimation,
   an operation budget, and caps on vias/radius.
3. **(P1)** Only `ProviderError` is caught on the retry; malformed 200 bodies or leg-less routes can
   fail the whole request or beat a valid original.

The approach itself is sound (one extra call for all vias, consistent figures provenance) and the
review recommends merging a hardened follow-up.

## Verification

`npm run check` on the final tree: **188 tests passed** (20 files), typecheck clean, production
build succeeds. The remaining >500 kB build warning is MapLibre itself, which now loads as an async
chunk and is off the initial critical path.

## Remaining follow-ups

- PR #1 findings have been addressed in [PR #3](https://github.com/YLP-Games/Routes/pull/3)
  (`fix/via-point-detours`): hardened retry selection, complete fallback, bounded geometry analysis
  and radius cap. Decide whether to merge #3 or fold it back into #1.
- Shared (Redis-backed) rate limiting/caching for multi-instance deployments; current guards are
  in-process.
- Coverage thresholds via `@vitest/coverage-v8`.
- Automated MapView test (jsdom lacks WebGL); keyboard behaviour is covered by code review only.
