import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { createApp } from './app';
import { createOfflinePlaceSearch } from './places/offline';
import { createTomTomPlaceSearch } from './places/tomtom';
import type { PlaceSearchProvider } from './places/types';
import { withRouteCache } from './providers/cache';
import { createMockProvider } from './providers/mock';
import { createTomTomProvider } from './providers/tomtom';
import type { RoutingProvider } from './providers/types';

dotenv.config({ quiet: true });

const apiKey = process.env.TOMTOM_API_KEY?.trim();
let provider: RoutingProvider;
let places: PlaceSearchProvider;
if (apiKey) {
  provider = createTomTomProvider({ apiKey });
  places = createTomTomPlaceSearch({ apiKey });
} else {
  console.warn('[api] TOMTOM_API_KEY is not set: using the mock routing provider (demo estimates, no live traffic).');
  provider = createMockProvider();
  places = createOfflinePlaceSearch();
}

/** A whole number >= 0 from the environment, or the fallback when unset or malformed. */
function envCount(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : fallback;
}

// Identical route calculations are reused briefly, so re-pricing a trip or pressing Calculate twice
// does not spend routing quota. ROUTE_CACHE_SECONDS=0 turns this off.
const cacheSeconds = envCount('ROUTE_CACHE_SECONDS', 90);
if (cacheSeconds > 0) provider = withRouteCache(provider, { ttlMs: cacheSeconds * 1000 });

function trustProxy(): boolean | number | string | undefined {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return undefined;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

// Serve the built frontend too when it exists, so `npm run build && npm start` is a complete deployment.
const dist = resolve(process.cwd(), 'dist');
const staticDir = existsSync(join(dist, 'index.html')) ? dist : undefined;

const DEFAULT_API_PORT = 8787;

const asPort = (v: string | undefined): number | undefined => {
  const n = Number(v);
  return v && Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
};

/** Value of `--port <n>` or `--port=<n>` on the command line. */
function cliPort(argv: string[]): number | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') return asPort(argv[i + 1]);
    if (argv[i].startsWith('--port=')) return asPort(argv[i].slice('--port='.length));
  }
  return undefined;
}

// API_PORT wins, then --port. PORT is only a fallback for hosts that assign it (production):
// in dev, tools set PORT for the Vite server, so the dev scripts pass --port explicitly.
const port = asPort(process.env.API_PORT) ?? cliPort(process.argv.slice(2)) ?? asPort(process.env.PORT) ?? DEFAULT_API_PORT;
const app = createApp({
  provider,
  places,
  rateLimitPerMinute: envCount('RATE_LIMIT_PER_MINUTE', 30),
  corsOrigins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean),
  trustProxy: trustProxy(),
  staticDir,
});
app.listen(port, () => {
  console.log(`[api] listening on http://localhost:${port} (provider: ${provider.name}${staticDir ? ', serving dist/' : ''})`);
});
