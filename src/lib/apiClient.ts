/**
 * Typed fetch helpers for the Routes HTTP API (see src/shared/api.ts for the contract).
 * Every helper throws an ApiRequestError carrying the server's ApiError message on non-2xx.
 */
import { API_PATHS, type HealthResponse } from '../shared/api';
import type {
  ApiError,
  FuelPrice,
  FuelType,
  PriceMonthSelector,
  PriceZone,
  RouteRequest,
  RouteResponse,
  Vehicle,
} from '../shared/types';

/** Error thrown for any failed API call; `message` is user-presentable. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code = 'UNKNOWN') {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError('Could not reach the Routes server. Check your connection and try again.', 0, 'NETWORK');
  }
  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status}).`;
    let code = 'HTTP_' + res.status;
    try {
      const body = (await res.json()) as Partial<ApiError> | null;
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.code) code = body.error.code;
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    throw new ApiRequestError(message, res.status, code);
  }
  return (await res.json()) as T;
}

/** GET /api/health */
export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>(API_PATHS.health);
}

/** POST /api/route */
export function calculateRoute(body: RouteRequest, signal?: AbortSignal): Promise<RouteResponse> {
  return request<RouteResponse>(API_PATHS.route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** GET /api/vehicles?q= */
export function searchVehicles(q: string, signal?: AbortSignal): Promise<Vehicle[]> {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  const qs = params.toString();
  return request<Vehicle[]>(qs ? `${API_PATHS.vehicles}?${qs}` : API_PATHS.vehicles, { signal });
}

/** GET /api/fuel-prices/months — 'YYYY-MM', newest first. */
export function getFuelPriceMonths(): Promise<string[]> {
  return request<string[]>(API_PATHS.fuelPriceMonths);
}

export interface FuelPriceQuery {
  month?: PriceMonthSelector;
  zone?: PriceZone;
  fuel?: FuelType;
}

/** GET /api/fuel-prices?month=&zone=&fuel= */
export function getFuelPrices(params: FuelPriceQuery = {}): Promise<FuelPrice[]> {
  const search = new URLSearchParams();
  if (params.month) search.set('month', params.month);
  if (params.zone) search.set('zone', params.zone);
  if (params.fuel) search.set('fuel', params.fuel);
  const qs = search.toString();
  return request<FuelPrice[]>(qs ? `${API_PATHS.fuelPrices}?${qs}` : API_PATHS.fuelPrices);
}
