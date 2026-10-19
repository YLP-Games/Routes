import type { LatLng } from '../../shared/types';
import { ProviderError } from '../errors';
import type { ProviderRouteInput, ProviderRouteResult, RoutingProvider } from './types';
import { excursionMeters, viaCircleRadii } from './viaExcursions';

const DEFAULT_BASE_URL = 'https://api.tomtom.com/routing/1/calculateRoute';

/** Fallback upstream timeout when TOMTOM_TIMEOUT_MS is unset or invalid. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/** Positive integer from the environment, otherwise the 20 s fallback. Never log the API key. */
export function requestTimeoutFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TOMTOM_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_REQUEST_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_REQUEST_TIMEOUT_MS;
}

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
interface TomTomRoute { summary: TomTomSummary; legs?: Array<{ points?: TomTomPoint[] }> }
interface TomTomResponse {
  routes?: TomTomRoute[];
}
interface TomTomErrorBody {
  error?: { description?: string };
  detailedError?: { code?: string; message?: string };
}

export interface TomTomProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /** Per-request upstream timeout in ms; defaults to TOMTOM_TIMEOUT_MS (or 20000). */
  timeoutMs?: number;
}

const fmt = (n: number) => String(Number(n.toFixed(6)));

/**
 * Builds the calculateRoute URL. Exported for tests; the URL contains the API key, never log it.
 * Points listed in `circles` (index -> radius in metres) are sent as circle waypoints: the route
 * must pass within the radius but need not touch the point, and no extra leg is created.
 */
export function buildTomTomUrl(
  input: ProviderRouteInput,
  opts: TomTomProviderOptions,
  circles?: ReadonlyMap<number, number>,
): string {
  const locations = input.points
    .map((p, i) => {
      const at = `${fmt(p.lat)},${fmt(p.lng)}`;
      const radius = circles?.get(i);
      return radius === undefined ? at : `circle(${at},${Math.round(radius)})`;
    })
    .join(':');
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

function firstRoute(body: TomTomResponse): TomTomRoute {
  const route = body.routes?.[0];
  if (!route) throw new ProviderError('TomTom returned no route for these points');
  return route;
}

const legGeometry = (route: TomTomRoute): LatLng[][] =>
  (route.legs ?? []).map((leg) => (leg.points ?? []).map((p) => ({ lat: p.latitude, lng: p.longitude })));

/** Maps a TomTom calculateRoute response onto our summary shape. */
export function parseTomTomResponse(body: TomTomResponse): ProviderRouteResult {
  const route = firstRoute(body);
  const s = route.summary;
  // "Traffic delay" is the with-traffic time minus the free-flow time, so the three figures the UI
  // shows always add up (the mock provider and the fallback fuel model assume the same). TomTom's
  // own trafficDelayInSeconds is a separate figure that need not equal that difference, so it is
  // only used when TomTom omits the free-flow time.
  const noTraffic = s.noTrafficTravelTimeInSeconds;
  const delay = Math.max(0, noTraffic !== undefined ? s.travelTimeInSeconds - noTraffic : s.trafficDelayInSeconds ?? 0);
  const geometry = legGeometry(route).flat();
  const result: ProviderRouteResult = {
    distanceMeters: s.lengthInMeters,
    travelTimeSeconds: s.travelTimeInSeconds,
    noTrafficTravelTimeSeconds: noTraffic ?? Math.max(0, s.travelTimeInSeconds - delay),
    trafficDelaySeconds: delay,
    departureTime: new Date(s.departureTime).toISOString(),
    arrivalTime: new Date(s.arrivalTime).toISOString(),
    geometry,
  };
  if (typeof s.fuelConsumptionInLiters === 'number') result.fuelLitres = s.fuelConsumptionInLiters;
  return result;
}

/** GETs a calculateRoute URL, mapping failures to ProviderError. */
async function requestRoute(url: string, timeoutMs: number): Promise<TomTomResponse> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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
  return body as TomTomResponse;
}

/** A retry must be genuinely better, not merely free of detectable short excursions. */
function isBetterRetry(original: ProviderRouteResult, retry: ProviderRouteResult): boolean {
  // A summary with no usable polyline must never win just because excursionMeters([]) is 0.
  // A shorter route naturally has fewer vertices, so do not compare raw vertex counts.
  if (retry.geometry.length < 2) return false;
  // Excursion length is a proxy for local doubling-back, not for overall quality. Require the
  // retry to be no slower and not much longer as well, so a removed spur cannot hide a big detour.
  if (retry.travelTimeSeconds > original.travelTimeSeconds + 1) return false;
  if (retry.distanceMeters > original.distanceMeters * 1.1) return false;
  return excursionMeters(retry.geometry) < excursionMeters(original.geometry);
}

/**
 * Via points are first sent as exact waypoints, which TomTom must touch. When a click lands on a
 * dead-end side street or the far carriageway, that makes the route drive out to the point and back.
 * Only then are those vias re-sent as circle waypoints. The retry is kept only when it has less
 * doubling back AND is not slower or substantially longer; all figures always come from the one
 * response whose geometry is returned. Any failure of the optional retry falls back to the original.
 */
export function createTomTomProvider(opts: TomTomProviderOptions): RoutingProvider {
  if (!opts.apiKey) throw new Error('TomTom API key is required');
  // An explicit option wins; otherwise read TOMTOM_TIMEOUT_MS. Never log the key or the full URL.
  const timeoutMs = opts.timeoutMs ?? requestTimeoutFromEnv();
  return {
    name: 'tomtom',
    async calculate(input) {
      const body = await requestRoute(buildTomTomUrl(input, opts), timeoutMs);
      const result = parseTomTomResponse(body);
      if (input.points.length <= 2) return result;

      const circles = viaCircleRadii(input.points, legGeometry(firstRoute(body)));
      if (circles.size === 0) return result;
      try {
        const retry = parseTomTomResponse(await requestRoute(buildTomTomUrl(input, opts, circles), timeoutMs));
        return isBetterRetry(result, retry) ? retry : result;
      } catch {
        // The exact-waypoint route is still a valid answer; the retry is best-effort. This also
        // covers malformed 200 responses, which need not throw a ProviderError.
        return result;
      }
    },
  };
}
