import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { FuelPrice, RouteResponse, Vehicle } from '../shared/types';
import { createApp } from './app';
import { ProviderError } from './errors';
import { createMockProvider } from './providers/mock';
import type { RoutingProvider } from './providers/types';
import { DIESEL_WHOLESALE_WARNING, MOCK_WARNING } from './services/routePlanner';

const NOW = new Date('2026-10-19T08:00:00.000Z');
const now = () => NOW;
const app = createApp({ provider: createMockProvider({ now }), now });

const jhb = { lat: -26.2041, lng: 28.0473 };
const midrand = { lat: -25.9992, lng: 28.1263 };
const pta = { lat: -25.7479, lng: 28.2293 };

const baseBody = { points: [jhb, midrand, pta], vehicleId: 'vw-polo-vivo-1-4-trendline', fuel: 'petrol95' };

describe('GET /api/health', () => {
  it('reports ok and the provider', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, provider: 'mock' });
  });
});

describe('POST /api/route', () => {
  it('returns a route with fuel estimate for a catalogue vehicle', async () => {
    const res = await request(app).post('/api/route').send(baseBody);
    expect(res.status).toBe(200);
    const body = res.body as RouteResponse;
    expect(body.provider).toBe('mock');
    expect(body.warnings).toContain(MOCK_WARNING);
    expect(body.fastestRoute).toBeUndefined();
    const r = body.yourRoute;
    expect(r.distanceMeters).toBeGreaterThan(50_000);
    expect(r.travelTimeSeconds).toBe(r.noTrafficTravelTimeSeconds + r.trafficDelaySeconds);
    expect(r.departureTime).toBe(NOW.toISOString());
    expect(r.geometry).toEqual([jhb, midrand, pta]);
    expect(r).not.toHaveProperty('fuelLitres');
    expect(r.fuel).toMatchObject({ method: 'fallback-average', priceMonth: '2026-10', priceRandsPerLitre: 30.25 });
    expect(r.fuel.litres).toBeGreaterThan(2);
    expect(r.fuel.costRands).toBeCloseTo(r.fuel.litres * 30.25, 0);
  });

  it('adds the fastest origin->destination route when requested', async () => {
    const res = await request(app).post('/api/route').send({ ...baseBody, compareFastest: true });
    expect(res.status).toBe(200);
    const body = res.body as RouteResponse;
    expect(body.fastestRoute).toBeDefined();
    expect(body.fastestRoute!.geometry).toEqual([jhb, pta]);
    expect(body.fastestRoute!.distanceMeters).toBeLessThanOrEqual(body.yourRoute.distanceMeters);
  });

  it('skips the comparison for a 2-point route', async () => {
    const res = await request(app).post('/api/route').send({ ...baseBody, points: [jhb, pta], compareFastest: true });
    expect(res.status).toBe(200);
    expect(res.body.fastestRoute).toBeUndefined();
  });

  it('custom consumption wins over the vehicle', async () => {
    const a = await request(app).post('/api/route').send({ ...baseBody, customConsumptionL100km: 12 });
    const b = await request(app).post('/api/route').send({ points: baseBody.points, customConsumptionL100km: 12, fuel: 'petrol95' });
    expect(a.status).toBe(200);
    expect(a.body.yourRoute.fuel.litres).toBe(b.body.yourRoute.fuel.litres);
    const vehicleOnly = await request(app).post('/api/route').send(baseBody);
    expect(a.body.yourRoute.fuel.litres).toBeGreaterThan(vehicleOnly.body.yourRoute.fuel.litres);
  });

  it('uses a custom consumption as a real-world figure (no lab-to-real-world factor)', async () => {
    // Steady 80 km/h, no traffic: the estimate should equal what the user entered.
    const steady: RoutingProvider = {
      name: 'mock',
      calculate: async (input) => {
        const r = await createMockProvider({ now }).calculate(input);
        const travel = Math.round((r.distanceMeters / 1000 / 80) * 3600);
        return { ...r, travelTimeSeconds: travel, noTrafficTravelTimeSeconds: travel, trafficDelaySeconds: 0 };
      },
    };
    const res = await request(createApp({ provider: steady, now }))
      .post('/api/route')
      .send({ points: baseBody.points, customConsumptionL100km: 7.4, fuel: 'petrol95' });
    expect(res.status).toBe(200);
    expect(res.body.yourRoute.fuel.litresPer100km).toBeCloseTo(7.4, 2);
  });

  it('passes an unscaled consumption curve to the provider for custom consumption', async () => {
    const calculate = vi.fn(createMockProvider({ now }).calculate);
    await request(createApp({ provider: { name: 'mock', calculate }, now }))
      .post('/api/route')
      .send({ points: baseBody.points, customConsumptionL100km: 7.4, fuel: 'petrol95' });
    const curve = calculate.mock.calls[0][0].consumptionCurve!;
    expect(curve.find(([s]) => s === 70)![1]).toBeCloseTo(7.4, 2);
  });

  it('uses previous month and explicit months, zones and diesel', async () => {
    const prev = await request(app).post('/api/route').send({ ...baseBody, priceMonth: 'previous' });
    expect(prev.body.yourRoute.fuel).toMatchObject({ priceMonth: '2026-09', priceRandsPerLitre: 26.92 });
    const coastal = await request(app).post('/api/route').send({ ...baseBody, zone: 'coastal', priceMonth: '2026-10' });
    expect(coastal.body.yourRoute.fuel.priceRandsPerLitre).toBe(29.38);
    const diesel = await request(app)
      .post('/api/route')
      .send({ ...baseBody, vehicleId: 'toyota-hilux-2-4gd6-raider-dc', fuel: 'diesel50ppm' });
    expect(diesel.status).toBe(200);
    expect(diesel.body.warnings).toContain(DIESEL_WHOLESALE_WARNING);
  });

  it('warns about a vehicle/fuel mismatch and a past departure time', async () => {
    const res = await request(app)
      .post('/api/route')
      .send({ ...baseBody, fuel: 'diesel500ppm', departAt: '2026-10-18T08:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w: string) => w.includes('runs on petrol'))).toBe(true);
    expect(res.body.warnings.some((w: string) => w.includes('in the past'))).toBe(true);
    expect(res.body.yourRoute.departureTime).toBe(NOW.toISOString());
  });

  it('honours a future departAt', async () => {
    const res = await request(app).post('/api/route').send({ ...baseBody, departAt: '2026-10-20T07:30:00+02:00' });
    expect(res.status).toBe(200);
    expect(res.body.yourRoute.departureTime).toBe('2026-10-20T05:30:00.000Z');
  });

  it('passes all points, curve and weight to the provider', async () => {
    const calculate = vi.fn(createMockProvider({ now }).calculate);
    const spyApp = createApp({ provider: { name: 'tomtom', calculate }, now });
    const res = await request(spyApp).post('/api/route').send({ ...baseBody, compareFastest: true });
    expect(res.status).toBe(200);
    expect(res.body.warnings).not.toContain(MOCK_WARNING);
    expect(calculate).toHaveBeenCalledTimes(2);
    const first = calculate.mock.calls[0][0];
    expect(first.points).toEqual([jhb, midrand, pta]);
    expect(first.fuelType).toBe('petrol');
    expect(first.vehicleWeightKg).toBeGreaterThan(1000);
    expect(first.consumptionCurve?.length).toBe(7);
    expect(calculate.mock.calls[1][0].points).toEqual([jhb, pta]);
  });

  it('reports provider fuel as provider-model', async () => {
    const provider: RoutingProvider = {
      name: 'tomtom',
      calculate: async (input) => ({ ...(await createMockProvider({ now }).calculate(input)), fuelLitres: 4.5 }),
    };
    const res = await request(createApp({ provider, now })).post('/api/route').send(baseBody);
    expect(res.body.yourRoute.fuel).toMatchObject({ method: 'provider-model', litres: 4.5, costRands: 136.13 });
  });

  it('maps provider failures to 502', async () => {
    const provider: RoutingProvider = {
      name: 'tomtom',
      calculate: async () => { throw new ProviderError('TomTom routing failed (403): Developer Inactive'); },
    };
    const res = await request(createApp({ provider, now })).post('/api/route').send(baseBody);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: { code: 'PROVIDER_ERROR', message: 'TomTom routing failed (403): Developer Inactive' } });
  });

  it.each([
    ['one point', { ...baseBody, points: [jhb] }],
    ['151 points', { ...baseBody, points: Array.from({ length: 151 }, () => jhb) }],
    ['latitude out of range', { ...baseBody, points: [{ lat: 91, lng: 28 }, pta] }],
    ['longitude out of range', { ...baseBody, points: [jhb, { lat: -25, lng: 181 }] }],
    ['missing fuel', { points: baseBody.points, vehicleId: baseBody.vehicleId }],
    ['bad fuel', { ...baseBody, fuel: 'petrol97' }],
    ['bad zone', { ...baseBody, zone: 'northern' }],
    ['bad month', { ...baseBody, priceMonth: '2026-13' }],
    ['consumption too low', { points: baseBody.points, fuel: 'petrol95', customConsumptionL100km: 0.5 }],
    ['consumption too high', { points: baseBody.points, fuel: 'petrol95', customConsumptionL100km: 41 }],
    ['neither vehicle nor consumption', { points: baseBody.points, fuel: 'petrol95' }],
    ['bad departAt', { ...baseBody, departAt: 'tomorrow' }],
  ])('400 for %s', async (_name, body) => {
    const res = await request(app).post('/api/route').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.error.message).toBe('string');
  });

  it('400 for malformed JSON', async () => {
    const res = await request(app).post('/api/route').set('content-type', 'application/json').send('{"points":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('404 for an unknown vehicle and an unknown price month', async () => {
    const v = await request(app).post('/api/route').send({ ...baseBody, vehicleId: 'tesla-cybertruck' });
    expect(v.status).toBe(404);
    expect(v.body.error.code).toBe('VEHICLE_NOT_FOUND');
    const m = await request(app).post('/api/route').send({ ...baseBody, priceMonth: '2020-01' });
    expect(m.status).toBe(404);
    expect(m.body.error.code).toBe('PRICE_MONTH_NOT_FOUND');
  });
});

describe('GET /api/vehicles', () => {
  it('lists all vehicles without q', async () => {
    const res = await request(app).get('/api/vehicles');
    expect(res.status).toBe(200);
    expect((res.body as Vehicle[]).length).toBeGreaterThanOrEqual(35);
  });

  it('searches with q', async () => {
    const res = await request(app).get('/api/vehicles').query({ q: 'hilux' });
    expect(res.status).toBe(200);
    expect((res.body as Vehicle[]).every((v) => v.model === 'Hilux')).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('400 for repeated q', async () => {
    const res = await request(app).get('/api/vehicles?q=a&q=b');
    expect(res.status).toBe(400);
  });

  it('gets one vehicle by id, 404 for unknown', async () => {
    const ok = await request(app).get('/api/vehicles/suzuki-swift-1-2-gl');
    expect(ok.status).toBe(200);
    expect(ok.body.model).toBe('Swift');
    const missing = await request(app).get('/api/vehicles/nope');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Unknown vehicle "nope"' } });
  });
});

describe('GET /api/fuel-prices', () => {
  it('lists months newest first', async () => {
    const res = await request(app).get('/api/fuel-prices/months');
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 2)).toEqual(['2026-10', '2026-09']);
  });

  it('filters by month, zone and fuel', async () => {
    const res = await request(app).get('/api/fuel-prices').query({ month: 'current', zone: 'inland', fuel: 'petrol93' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect((res.body as FuelPrice[])[0]).toMatchObject({ month: '2026-10', randsPerLitre: 29.88, effectiveDate: '2026-10-07' });
    const prev = await request(app).get('/api/fuel-prices').query({ month: 'previous', fuel: 'petrol95' });
    expect((prev.body as FuelPrice[]).map((p) => p.randsPerLitre).sort()).toEqual([26.05, 26.92]);
  });

  it('returns everything without filters', async () => {
    const res = await request(app).get('/api/fuel-prices');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(6);
  });

  it('400 for invalid filters, 404 for unknown month', async () => {
    expect((await request(app).get('/api/fuel-prices').query({ zone: 'mars' })).status).toBe(400);
    expect((await request(app).get('/api/fuel-prices').query({ fuel: 'lpg' })).status).toBe(400);
    expect((await request(app).get('/api/fuel-prices').query({ month: 'Oct' })).status).toBe(400);
    const res = await request(app).get('/api/fuel-prices').query({ month: '2019-01' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRICE_MONTH_NOT_FOUND');
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
