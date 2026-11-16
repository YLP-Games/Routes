# Contributing

Thanks for helping improve Routes. This guide covers local setup, data-integrity rules and the
pull-request process.

## Development setup

Requires Node 22.19+ and npm (`undici`, pulled in by jsdom, needs it).

```sh
npm install
cp .env.example .env
```

Get a free TomTom API key from https://developer.tomtom.com and set `TOMTOM_API_KEY` in `.env`.
Leave it empty to use the built-in **mock** provider, which generates synthetic routes and timings
so the whole app still works end to end without a key.

`npm run dev` starts Vite and the API together; Vite proxies `/api` to port 8787. See `.env.example`
for the optional rate-limit, cache, CORS, proxy and timeout settings.

## Scripts

| Script                | What it does                                               |
|-----------------------|------------------------------------------------------------|
| `npm run dev`         | Vite dev server + API server (watch mode) together         |
| `npm run dev:web`     | Vite dev server only                                       |
| `npm run dev:api`     | API server only, watch mode, on :8787                      |
| `npm run build`       | Production build of the frontend to `dist/`                |
| `npm run build:server`| Bundle the API server to `dist-server/`                    |
| `npm start`           | Run the API server (also serves `dist/` when built)        |
| `npm run start:prod`  | Run the bundled production server                          |
| `npm test`            | Run all tests once (Vitest projects `api` and `web`)       |
| `npm run test:watch`  | Vitest in watch mode                                       |
| `npm run typecheck`   | TypeScript type check                                      |
| `npm run check`       | Typecheck, test and build in one command                    |

## Before opening a PR

Run `npm run check` (or all three commands separately) and make sure it passes. CI runs the same
checks on Node 22 and 24 for every push to `main` and every pull request.

Changes to `src/shared/api.ts` and `src/shared/types.ts` affect both the frontend and backend — keep
them in sync and call them out in the PR description.

## Adding a month of fuel prices

Fuel price data lives in `src/api/data/fuelPrices.za.json` with strict integrity rules. Read
[`src/api/data/README.md`](src/api/data/README.md) in full before editing it. In short:

1. Verify every figure against the official DMPR media statement on gov.za and a published price
   schedule. **Never guess a price** — if a row cannot be verified, leave it out; the API falls back
   to the other zone and returns a warning.
2. Add one row per zone (`inland`, `coastal`) and grade (`petrol93`, `petrol95`, `diesel500ppm`,
   `diesel50ppm`). All rows for a month share the same `effectiveDate`, the **first Wednesday** of
   the month (`YYYY-MM-DD`). Cross-check each value against last month's price plus the announced
   change in cents per litre. Diesel figures are regulated wholesale prices; say so in `source`.
3. Run `npx vitest run --project api`.

## Adding a vehicle or place

- Vehicles live in `src/api/data/vehicles.sa.json`. Use a unique kebab-case `id`, fill in every
  `Vehicle` field from `src/shared/types.ts`, and note the source (and any derived figures).
- Places live in `src/api/data/places.za.json` and back offline search when no TomTom key is set.
- Run `npm test` after either change; data-integrity tests check ids and field ranges.

## Pull-request process

1. Fork/branch from `main` and keep changes focused.
2. Make your change, add or update tests, and run `npm run check`.
3. Open a PR describing what changed and why, with sources for data updates and any API contract
   changes.
4. Make sure CI is green and address review feedback.

By contributing you agree that your work is licensed under the [MIT License](LICENSE).
