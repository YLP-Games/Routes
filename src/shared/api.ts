/**
 * HTTP API contract. All endpoints are served by the Express app (src/api) under API_BASE
 * and proxied by Vite in development. Request/response shapes live in ./types.ts.
 *
 * | Method | Path                                      | Request                         | Response                                  |
 * |--------|-------------------------------------------|---------------------------------|-------------------------------------------|
 * | GET    | /api/health                               | -                               | { ok: true, provider: 'tomtom' \| 'mock' } |
 * | POST   | /api/route                                | body: RouteRequest              | RouteResponse (400 ApiError if invalid)   |
 * | GET    | /api/vehicles?q=                          | q: free-text search (optional)  | Vehicle[]                                 |
 * | GET    | /api/vehicles/:id                         | -                               | Vehicle (404 ApiError if unknown)         |
 * | GET    | /api/fuel-prices?month=&zone=&fuel=       | month: 'current' \| 'previous' \| 'YYYY-MM'; zone: PriceZone; fuel: FuelType (all optional) | FuelPrice[] |
 * | GET    | /api/fuel-prices/months                   | -                               | string[] ('YYYY-MM', newest first)        |
 */

import type { ApiError, FuelPrice, RouteRequest, RouteResponse, Vehicle } from './types';

export const API_BASE = '/api';

export const API_PATHS = {
  health: `${API_BASE}/health`,
  route: `${API_BASE}/route`,
  vehicles: `${API_BASE}/vehicles`,
  vehicle: (id: string) => `${API_BASE}/vehicles/${encodeURIComponent(id)}`,
  fuelPrices: `${API_BASE}/fuel-prices`,
  fuelPriceMonths: `${API_BASE}/fuel-prices/months`,
} as const;

/** Response of GET /api/health. */
export interface HealthResponse { ok: true; provider: 'tomtom' | 'mock' }

/** Type map of endpoint responses, for typed fetch helpers. */
export interface ApiResponses {
  health: HealthResponse;
  route: RouteResponse;
  vehicles: Vehicle[];
  vehicle: Vehicle;
  fuelPrices: FuelPrice[];
  fuelPriceMonths: string[];
}

export type { ApiError, RouteRequest };
