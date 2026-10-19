# Routes

Draw your own driving route on a map (origin, shaping points, destination) and get a traffic-aware
estimate for exactly that route: ETA, no-traffic time, traffic delay, arrival time, fuel litres and
petrol/diesel cost in rands using South Africa's monthly regulated fuel prices (inland/coastal,
93/95/diesel). The backend reconstructs the drawn route with the TomTom Routing API
(`calculateRoute` with `supportingPoints`, live traffic, combustion consumption model).

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
| `npm start`          | Run the API server                                   |
| `npm test`           | Run all tests once (Vitest projects `api` and `web`) |
| `npm run test:watch` | Vitest in watch mode                                 |
| `npm run typecheck`  | TypeScript type check                                |

### Ports

The API picks its port from `API_PORT`, then a `--port <n>` argument, then `PORT`, then 8787.
The dev scripts pass `--port 8787`, and the Vite dev server proxies `/api` to `API_PORT` (default
8787), so a `PORT` set for Vite (for example by a preview launcher) can't move the API onto Vite's
port. To use another API port in dev, set `API_PORT` in `.env` or the environment: both sides
follow it. `PORT` only matters for `npm start` on hosts that assign one.

## Folder ownership

- `src/components` - UI (React components)
- `src/api` - backend (Express server, routing provider, fuel prices, vehicles)
- `src/shared` - the contract between them (`types.ts`, `api.ts`); change with care
