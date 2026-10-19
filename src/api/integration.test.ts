/**
 * Cross-boundary test: the frontend's real request builder and API client talking to the real
 * Express app (mock provider) over HTTP, so paths, methods, headers, bodies, query params and
 * error bodies are exercised exactly as the browser would (minus the Vite proxy).
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  calculateRoute,
  getFuelPriceMonths,
  getFuelPrices,
  getHealth,
  searchVehicles,
} from '../lib/apiClient';
import { formatDistance, formatDuration, formatMonth, formatRands, formatTime } from '../lib/format';
import { DEFAULT_VEHICLE_CHOICE, defaultFuelFor, type VehicleChoice } from '../lib/options';
import { buildRouteRequest } from '../lib/routeRequest';
import type { RouteRequest, RouteResponse, RouteWithFuel } from '../shared/types';
import { createApp } from './app';
import { createMockProvider } from './providers/mock';

const NOW = new Date('2026-10-19T08:00:00.000Z');
const now = () => NOW;

const jhb = { lat: -26.2041, lng: 28.0473 };
const midrand = { lat: -25.9992, lng: 28.1263 };
const pta = { lat: -25.7479, lng: 28.2293 };

let server: Server;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  server = createApp({ provider: createMockProvider({ now }), now }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The client uses relative '/api/...' URLs (the Vite proxy's job in the browser); prefix the test server.
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => realFetch(base + url, init));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Everything TripSummary / FuelCostCard / MapView read from a route. */
function expectRenderableRoute(r: RouteWithFuel, expectedPoints: number) {
  expect(r.distanceMeters).toBeGreaterThan(60_000);
  expect(r.distanceMeters).toBeLessThan(80_000);
  expect(r.travelTimeSeconds).toBeGreaterThan(0);
  expect(r.noTrafficTravelTimeSeconds).toBeGreaterThan(0);
  expect(r.trafficDelaySeconds).toBeGreaterThanOrEqual(0);
  expect(new Date(r.arrivalTime).getTime()).toBeGreaterThan(new Date(r.departureTime).getTime());
  expect(r.geometry.length).toBeGreaterThanOrEqual(expectedPoints);
  for (const p of r.geometry) expect(p).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });

  const f = r.fuel;
  expect(f.costRands).toBeGreaterThan(0);
  expect(f.costPerKmRands).toBeGreaterThan(0);
  expect(f.litres).toBeGreaterThan(0);
  expect(f.litresPer100km).toBeGreaterThan(0);
  expect(f.priceRandsPerLitre).toBeGreaterThan(0);
  expect(f.priceMonth).toMatch(/^\d{4}-\d{2}$/);
  expect(['provider-model', 'fallback-average']).toContain(f.method);

  // The frontend's formatters produce real values, not their fallbacks.
  expect(formatDuration(r.travelTimeSeconds)).toMatch(/min/);
  expect(formatDistance(r.distanceMeters)).toMatch(/ km$/);
  expect(formatTime(r.arrivalTime)).toMatch(/^\d{2}:\d{2}$/);
  expect(formatRands(f.costRands)).toMatch(/^R \d/);
  expect(formatMonth(f.priceMonth)).not.toBe(f.priceMonth);
}

describe('frontend client <-> API', () => {
  it('health reports the mock provider', async () => {
    expect(await getHealth()).toEqual({ ok: true, provider: 'mock' });
  });

  it('calculates a catalogue-vehicle trip exactly as App sends it', async () => {
    const [vehicle] = await searchVehicles('hilux');
    expect(vehicle).toBeDefined();
    // What VehiclePicker produces when the user picks a search result.
    const choice: VehicleChoice = { ...DEFAULT_VEHICLE_CHOICE, vehicle, fuel: defaultFuelFor(vehicle.fuelType) };
    const departAt = new Date(NOW.getTime() + 3600_000).toISOString();
    const body = buildRouteRequest({ points: [jhb, midrand, pta], departAt, choice, priceMonth: 'current', compareFastest: true });

    expect(body).toMatchObject<Partial<RouteRequest>>({ vehicleId: vehicle.id, compareFastest: true, fuel: 'diesel50ppm' });
    expect(body).not.toHaveProperty('customConsumptionL100km');

    const res: RouteResponse = await calculateRoute(body);
    expect(res.provider).toBe('mock');
    expect(Array.isArray(res.warnings)).toBe(true);
    expectRenderableRoute(res.yourRoute, 3);
    expect(res.yourRoute.departureTime).toBe(departAt);
    expect(res.fastestRoute).toBeDefined();
    expectRenderableRoute(res.fastestRoute!, 2);
    expect(res.yourRoute.fuel.priceMonth).toBe('2026-10');
  });

  it("calculates a custom-consumption trip with 'previous' prices, matching the toggle's label", async () => {
    const choice: VehicleChoice = { ...DEFAULT_VEHICLE_CHOICE, useCustom: true, customConsumption: '7,4', zone: 'coastal' };
    const body = buildRouteRequest({ points: [jhb, midrand, pta], departAt: undefined, choice, priceMonth: 'previous', compareFastest: true });

    expect(body.customConsumptionL100km).toBe(7.4);
    expect(body).not.toHaveProperty('vehicleId');

    const res = await calculateRoute(body);
    expectRenderableRoute(res.yourRoute, 3);
    expect(res.yourRoute.departureTime).toBe(NOW.toISOString());

    // PriceMonthToggle labels 'previous' with the month the server resolves for it.
    const [previous] = await getFuelPrices({ month: 'previous', zone: 'coastal', fuel: 'petrol95' });
    expect(res.yourRoute.fuel.priceMonth).toBe(previous.month);
    expect(res.yourRoute.fuel.priceRandsPerLitre).toBe(previous.randsPerLitre);
    expect(await getFuelPriceMonths()).toContain(previous.month);
  });

  it('surfaces the server error message through ApiRequestError', async () => {
    const choice: VehicleChoice = { ...DEFAULT_VEHICLE_CHOICE, vehicle: { ...(await searchVehicles('hilux'))[0], id: 'no-such-car' } };
    const body = buildRouteRequest({ points: [jhb, pta], departAt: undefined, choice, priceMonth: 'current', compareFastest: false });
    const err = await calculateRoute(body).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 404, code: 'VEHICLE_NOT_FOUND', message: expect.stringContaining('no-such-car') });
  });
});
