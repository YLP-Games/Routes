import type { LatLng } from '../../shared/types';
import { ProviderError } from '../errors';
import type { ProviderRouteInput, ProviderRouteResult, RoutingProvider } from './types';

const DEFAULT_BASE_URL = 'https://api.tomtom.com/routing/1/calculateRoute';
const REQUEST_TIMEOUT_MS = 20_000;

/** Lower heating value of the fuel, MJ per litre (TomTom combustion model). */
export const FUEL_ENERGY_DENSITY_MJ_PER_L = { petrol: 34.2, diesel: 35.8 } as const;

/**
 * Efficiency parameters sent with vehicleWeight. Our consumption curve is a drive-cycle average
 * (its low-speed points come from the urban figure, which already includes stop-start losses), so
 * speed changes are made energy-neutral (1/1) to avoid counting acceleration twice. Hills keep
 * TomTom's recommended combustion values, so climbs cost fuel in proportion to vehicle weight.
 * (With TomTom's default 0.33/0.83 speed-change efficiencies, a Polo Vivo came out at
 * ~10.4 L/100km on the Joburg-Pretoria highway even with a pure steady-cruise curve.)
 */
export const COMBUSTION_EFFICIENCY = {
  accelerationEfficiency: '1',
  decelerationEfficiency: '1',
  uphillEfficiency: '0.27',
  downhillEfficiency: '0.51',
} as const;

interface TomTomPoint { latitude: number; longitude: number }
interface TomTomSummary {
  lengthInMeters: number;
  travelTimeInSeconds: number;
  trafficDelayInSeconds?: number;
  noTrafficTravelTimeInSeconds?: number;
  departureTime: string;
  arrivalTime: string;
  fuelConsumptionInLiters?: number;
}
interface TomTomResponse {
  routes?: Array<{ summary: TomTomSummary; legs?: Array<{ points?: TomTomPoint[] }> }>;
}
interface TomTomErrorBody {
  error?: { description?: string };
  detailedError?: { code?: string; message?: string };
}

export interface TomTomProviderOptions {
  apiKey: string;
  baseUrl?: string;
}

const fmt = (n: number) => String(Number(n.toFixed(6)));

/** Builds the calculateRoute URL. Exported for tests; the URL contains the API key, never log it. */
export function buildTomTomUrl(input: ProviderRouteInput, opts: TomTomProviderOptions): string {
  const locations = input.points.map((p) => `${fmt(p.lat)},${fmt(p.lng)}`).join(':');
  const params = new URLSearchParams({
    key: opts.apiKey,
    traffic: 'true',
    computeTravelTimeFor: 'all',
    routeType: 'fastest',
    travelMode: 'car',
    routeRepresentation: 'polyline',
  });
  if (input.departAt) params.set('departAt', input.departAt);
  if (input.consumptionCurve && input.consumptionCurve.length > 0) {
    params.set('vehicleEngineType', 'combustion');
    params.set(
      'constantSpeedConsumptionInLitersPerHundredkm',
      input.consumptionCurve.map(([speed, l100]) => `${speed},${l100}`).join(':'),
    );
    // The efficiency parameters are only valid together with vehicleWeight and fuel energy density.
    if (input.vehicleWeightKg && input.vehicleWeightKg > 0) {
      params.set('vehicleWeight', String(Math.round(input.vehicleWeightKg)));
      params.set('fuelEnergyDensityInMJoulesPerLiter', String(FUEL_ENERGY_DENSITY_MJ_PER_L[input.fuelType]));
      for (const [k, v] of Object.entries(COMBUSTION_EFFICIENCY)) params.set(k, v);
    }
  }
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;
  return `${base}/${locations}/json?${params.toString()}`;
}

function errorMessage(body: unknown, status: number): string {
  const b = (body ?? {}) as TomTomErrorBody;
  return b.detailedError?.message ?? b.error?.description ?? `HTTP ${status}`;
}

/** Maps a TomTom calculateRoute response onto our summary shape. */
export function parseTomTomResponse(body: TomTomResponse): ProviderRouteResult {
  const route = body.routes?.[0];
  if (!route) throw new ProviderError('TomTom returned no route for these points');
  const s = route.summary;
  const delay = s.trafficDelayInSeconds ?? 0;
  const geometry: LatLng[] = [];
  for (const leg of route.legs ?? []) {
    for (const p of leg.points ?? []) geometry.push({ lat: p.latitude, lng: p.longitude });
  }
  const result: ProviderRouteResult = {
    distanceMeters: s.lengthInMeters,
    travelTimeSeconds: s.travelTimeInSeconds,
    noTrafficTravelTimeSeconds: s.noTrafficTravelTimeInSeconds ?? Math.max(0, s.travelTimeInSeconds - delay),
    trafficDelaySeconds: delay,
    departureTime: new Date(s.departureTime).toISOString(),
    arrivalTime: new Date(s.arrivalTime).toISOString(),
    geometry,
  };
  if (typeof s.fuelConsumptionInLiters === 'number') result.fuelLitres = s.fuelConsumptionInLiters;
  return result;
}

export function createTomTomProvider(opts: TomTomProviderOptions): RoutingProvider {
  if (!opts.apiKey) throw new Error('TomTom API key is required');
  return {
    name: 'tomtom',
    async calculate(input) {
      const url = buildTomTomUrl(input, opts);
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (err) {
        const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
        throw new ProviderError(`TomTom routing service ${reason}`);
      }
      let body: unknown = undefined;
      try {
        body = await res.json();
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        throw new ProviderError(`TomTom routing failed (${res.status}): ${errorMessage(body, res.status)}`);
      }
      return parseTomTomResponse(body as TomTomResponse);
    },
  };
}
