import cors from 'cors';
import express, { type ErrorRequestHandler, type Request } from 'express';
import { z } from 'zod';
import type { HealthResponse } from '../shared/api';
import type { ApiError, FuelPrice, RouteResponse, Vehicle } from '../shared/types';
import { HttpError } from './errors';
import { createMockProvider } from './providers/mock';
import type { RoutingProvider } from './providers/types';
import { formatZodError, fuelPricesQuerySchema, routeRequestSchema, vehiclesQuerySchema } from './schemas';
import { fuelPrices as defaultFuelPrices, type FuelPriceService } from './services/fuelPrices';
import { planRoute } from './services/routePlanner';
import { vehicles as defaultVehicles, type VehicleService } from './services/vehicles';

export interface AppOptions {
  provider?: RoutingProvider;
  now?: () => Date;
  vehicles?: VehicleService;
  fuelPrices?: FuelPriceService;
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, 'VALIDATION_ERROR', formatZodError(r.error));
  return r.data;
}

export function createApp(opts: AppOptions = {}) {
  const now = opts.now ?? (() => new Date());
  const provider = opts.provider ?? createMockProvider({ now });
  const vehicles = opts.vehicles ?? defaultVehicles;
  const fuelPrices = opts.fuelPrices ?? defaultFuelPrices;

  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { ok: true, provider: provider.name };
    res.json(body);
  });

  app.post('/api/route', async (req: Request, res) => {
    const body = parse(routeRequestSchema, req.body ?? {});
    const result: RouteResponse = await planRoute(body, { provider, vehicles, fuelPrices, now });
    res.json(result);
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
