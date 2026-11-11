import { resolve } from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { HealthResponse } from '../shared/api';
import type { ApiError, FuelPrice, Place, RouteResponse, Vehicle } from '../shared/types';
import { HttpError } from './errors';
import { createOfflinePlaceSearch } from './places/offline';
import type { PlaceSearchProvider } from './places/types';
import { createMockProvider } from './providers/mock';
import type { RoutingProvider } from './providers/types';
import { rateLimit } from './rateLimit';
import { formatZodError, fuelPricesQuerySchema, placesQuerySchema, routeRequestSchema, vehiclesQuerySchema } from './schemas';
import { fuelPrices as defaultFuelPrices, type FuelPriceService } from './services/fuelPrices';
import { planRoute } from './services/routePlanner';
import { vehicles as defaultVehicles, type VehicleService } from './services/vehicles';

export interface AppOptions {
  provider?: RoutingProvider;
  /** Place search; defaults to the bundled offline list of South African towns. */
  places?: PlaceSearchProvider;
  now?: () => Date;
  vehicles?: VehicleService;
  fuelPrices?: FuelPriceService;
  /**
   * Route calculations allowed per client per minute (place search gets four times as many, since
   * it runs as the user types). Unset or 0: no limit.
   */
  rateLimitPerMinute?: number;
  /** Other origins allowed to call the API from a browser. Unset: same-origin only. */
  corsOrigins?: string[];
  /** Directory holding the built frontend (`vite build` output) to serve alongside the API. */
  staticDir?: string;
  /** Express "trust proxy" setting, for when the app runs behind a reverse proxy. */
  trustProxy?: boolean | number | string;
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, 'VALIDATION_ERROR', formatZodError(r.error));
  return r.data;
}

const unlimited: RequestHandler = (_req, _res, next) => next();

export function createApp(opts: AppOptions = {}) {
  const now = opts.now ?? (() => new Date());
  const provider = opts.provider ?? createMockProvider({ now });
  const places = opts.places ?? createOfflinePlaceSearch();
  const vehicles = opts.vehicles ?? defaultVehicles;
  const fuelPrices = opts.fuelPrices ?? defaultFuelPrices;
  const perMinute = opts.rateLimitPerMinute ?? 0;
  const routeLimit = perMinute > 0 ? rateLimit({ limit: perMinute }) : unlimited;
  const placesLimit = perMinute > 0 ? rateLimit({ limit: perMinute * 4 }) : unlimited;

  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy !== undefined) app.set('trust proxy', opts.trustProxy);
  // Route geometry is long, repetitive JSON, and the frontend bundle is text: both shrink severalfold.
  app.use(compression());
  if (opts.corsOrigins?.length) app.use(cors({ origin: opts.corsOrigins }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { ok: true, provider: provider.name };
    res.json(body);
  });

  app.post('/api/route', routeLimit, async (req: Request, res) => {
    const body = parse(routeRequestSchema, req.body ?? {});
    const result: RouteResponse = await planRoute(body, { provider, vehicles, fuelPrices, now });
    res.json(result);
  });

  app.get('/api/places', placesLimit, async (req, res) => {
    const { q } = parse(placesQuerySchema, req.query);
    const list: Place[] = await places.search(q);
    res.json(list);
  });

  app.get('/api/vehicles', (req, res) => {
    const { q } = parse(vehiclesQuerySchema, req.query);
    const list: Vehicle[] = vehicles.search(q);
    res.json(list);
  });

  app.get('/api/vehicles/:id', (req, res) => {
    const v = vehicles.getById(req.params.id);
    if (!v) throw new HttpError(404, 'VEHICLE_NOT_FOUND', `Unknown vehicle "${req.params.id}"`);
    res.json(v);
  });

  app.get('/api/fuel-prices/months', (_req, res) => {
    res.json(fuelPrices.listMonths());
  });

  app.get('/api/fuel-prices', (req, res) => {
    const filter = parse(fuelPricesQuerySchema, req.query);
    const list: FuelPrice[] = fuelPrices.listPrices(filter, now());
    res.json(list);
  });

  if (opts.staticDir) {
    const dir = resolve(opts.staticDir);
    app.use(
      express.static(dir, {
        index: false,
        setHeaders(res, filePath) {
          // Vite fingerprints everything under assets/, so those files never change.
          if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    // Every other non-API page request gets the app shell; a trip link restores itself from the URL.
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile('index.html', { root: dir });
    });
  }

  app.use((req, res) => {
    const body: ApiError = { error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } };
    res.status(404).json(body);
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json(err.toBody());
      return;
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } } satisfies ApiError);
      return;
    }
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } } satisfies ApiError);
      return;
    }
    console.error('[api] unhandled error:', e?.message ?? err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } } satisfies ApiError);
  };
  app.use(errorHandler);

  return app;
}
