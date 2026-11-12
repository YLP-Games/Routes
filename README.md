# Routes

Draw your own driving route on a map (origin, shaping points, destination) and get a traffic-aware
estimate for exactly that route: ETA, no-traffic time, traffic delay, arrival time, fuel litres and
petrol/diesel cost in rands using South Africa's monthly regulated fuel prices (inland/coastal,
93/95/diesel). The backend routes through every point you placed, in order, with the TomTom
Routing API (`calculateRoute` with each point as a waypoint, live traffic, combustion consumption
model), and can compare the result with TomTom's own fastest route between the two ends.

Building a route:

- Search for a place, or click the map, to add points in order: start, via points, destination.
- Click the route line to add a via point between its neighbours; drag a marker to move it.
- The trip lives in the page address, so a reload keeps it and **Copy link to this trip** shares it.
- When anything the result depends on changes, the figures are marked out of date until you update.

Stack: React + TypeScript + Vite (frontend), Node + Express (backend), single package.

## Setup

Requires Node 20+.

```sh
npm install
cp .env.example .env
```

Get a free TomTom API key at https://developer.tomtom.com and set `TOMTOM_API_KEY` in `.env`.
Without a key the API runs with a **mock** provider (synthetic routes and timings), so the app
still works end to end for development.

## Scripts

| Script               | What it does                                         |
|----------------------|------------------------------------------------------|
| `npm run dev`        | Vite dev server + API server (watch mode) together   |
| `npm run dev:web`    | Vite dev server only (proxies `/api` to :8787)       |
| `npm run dev:api`    | API server only, watch mode, on :8787                |
| `npm run build`      | Production build of the frontend to `dist/`          |
| `npm start`          | Run the API server (also serves `dist/` if it exists) |
| `npm run build:server` | Bundle the API server to `dist-server/server.cjs`  |
| `npm run start:prod` | Run the bundled server on plain Node (no `tsx`)      |
| `npm test`           | Run all tests once (Vitest projects `api` and `web`) |
| `npm run test:watch` | Vitest in watch mode                                 |
| `npm run typecheck`  | TypeScript type check                                |

### Ports

The API picks its port from `API_PORT`, then a `--port <n>` argument, then `PORT`, then 8787.
The dev scripts pass `--port 8787`, and the Vite dev server proxies `/api` to `API_PORT` (default
8787), so a `PORT` set for Vite (for example by a preview launcher) can't move the API onto Vite's
port. To use another API port in dev, set `API_PORT` in `.env` or the environment: both sides
follow it. `PORT` only matters for `npm start` on hosts that assign one.

## Running in production

```sh
npm run build && npm run build:server
npm run start:prod
```

One process then serves both the API and the built frontend, with compressed responses and
long-lived caching for the fingerprinted assets. The bundled server starts in about 0.13 s and
holds about 70 MB; `npm start` (TypeScript run through `tsx`) takes about 0.7 s and about three
times the memory across its helper processes, and is meant for development.

Settings, all optional (see `.env.example`):

| Variable                | Default | Purpose                                                              |
|-------------------------|---------|----------------------------------------------------------------------|
| `TOMTOM_API_KEY`        | unset   | Live routing, traffic and place search. Unset: demo mode.            |
| `RATE_LIMIT_PER_MINUTE` | 30      | Route calculations per client per minute (place search: four times). |
| `ROUTE_CACHE_SECONDS`   | 90      | How long an identical route calculation is reused.                   |
| `CORS_ORIGINS`          | unset   | Other sites allowed to call the API. Unset: same-origin only.        |
| `TRUST_PROXY`           | unset   | Set behind a reverse proxy so the rate limit sees real client IPs.   |

Every route calculation spends TomTom quota (two calls when comparing with the fastest route), so
keep the rate limit on for anything public. Never commit `.env`: a key that reaches git history
must be revoked, not just deleted.

Without a TomTom key, place search uses a bundled list of South African towns and airports
(`src/api/data/places.za.json`, approximate town-centre coordinates) and routes are straight lines.

## Design system

The interface follows one set of rules, written at the top of `src/styles.css`: a neutral ground
and ink with a single accent, one radius scale, one filled button, and buttons that step on hover
and press on click. The palette and typeface came from the `design-taste-frontend` skill
(`Leonxlnx/taste-skill`), recorded in `skills-lock.json`. The skill's files are not in the
repository; to work on the design with it again, restore them:

```sh
npx skills experimental_install
```

## Folder ownership

- `src/components` - UI (React components)
- `src/api` - backend (Express server, routing provider, fuel prices, vehicles)
- `src/shared` - the contract between them (`types.ts`, `api.ts`); change with care
