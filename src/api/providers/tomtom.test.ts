import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../errors';
import { buildConsumptionCurve } from '../services/fuelModel';
import { createTomTomProvider } from './tomtom';

const KEY = 'test-key-123';
const points = [
  { lat: -26.2041, lng: 28.0473 }, // Johannesburg
  { lat: -25.9992, lng: 28.1263 }, // Midrand (shaping point)
  { lat: -25.7479, lng: 28.2293 }, // Pretoria
];

/** Trimmed, realistic TomTom calculateRoute response with two legs. */
const sample = {
  formatVersion: '0.0.12',
  routes: [
    {
      summary: {
        lengthInMeters: 58412,
        travelTimeInSeconds: 3125,
        trafficDelayInSeconds: 412,
        trafficLengthInMeters: 6100,
        departureTime: '2026-10-19T08:00:00+02:00',
        arrivalTime: '2026-10-19T08:52:05+02:00',
        noTrafficTravelTimeInSeconds: 2650,
        historicTrafficTravelTimeInSeconds: 3010,
        liveTrafficIncidentsTravelTimeInSeconds: 3125,
        fuelConsumptionInLiters: 4.8731,
      },
      legs: [
        {
          summary: { lengthInMeters: 27000, travelTimeInSeconds: 1500 },
          points: [
            { latitude: -26.20410, longitude: 28.04730 },
            { latitude: -26.10000, longitude: 28.08000 },
            { latitude: -25.99920, longitude: 28.12630 },
          ],
        },
        {
          summary: { lengthInMeters: 31412, travelTimeInSeconds: 1625 },
          points: [
            { latitude: -25.99920, longitude: 28.12630 },
            { latitude: -25.87000, longitude: 28.18000 },
            { latitude: -25.74790, longitude: 28.22930 },
          ],
        },
      ],
      sections: [{ startPointIndex: 0, endPointIndex: 5, sectionType: 'TRAVEL_MODE', travelMode: 'car' }],
    },
  ],
};

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TomTom provider', () => {
  it('requests a route through every user point with traffic and consumption params', async () => {
    const fetchMock = stubFetch(200, sample);
    const provider = createTomTomProvider({ apiKey: KEY });
    const curve = buildConsumptionCurve({ urban: 7.0, extraUrban: 4.5, combined: 5.4 });
    await provider.calculate({
      points,
      departAt: '2026-10-19T08:00:00+02:00',
      consumptionCurve: curve,
      vehicleWeightKg: 1230,
      fuelType: 'petrol',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin).toBe('https://api.tomtom.com');
    expect(decodeURIComponent(url.pathname)).toBe(
      '/routing/1/calculateRoute/-26.2041,28.0473:-25.9992,28.1263:-25.7479,28.2293/json',
    );
    const q = url.searchParams;
    expect(q.get('key')).toBe(KEY);
    expect(q.get('traffic')).toBe('true');
    expect(q.get('computeTravelTimeFor')).toBe('all');
    expect(q.get('routeType')).toBe('fastest');
    expect(q.get('travelMode')).toBe('car');
    expect(q.get('routeRepresentation')).toBe('polyline');
    expect(q.get('departAt')).toBe('2026-10-19T08:00:00+02:00');
    expect(q.get('vehicleEngineType')).toBe('combustion');
    expect(q.get('constantSpeedConsumptionInLitersPerHundredkm')).toBe(curve.map(([s, l]) => `${s},${l}`).join(':'));
    expect(q.get('vehicleWeight')).toBe('1230');
    expect(q.get('fuelEnergyDensityInMJoulesPerLiter')).toBe('34.2');
    // Speed changes are energy-neutral (the curve already includes stop-start losses); hills are not.
    expect(q.get('accelerationEfficiency')).toBe('1');
    expect(q.get('decelerationEfficiency')).toBe('1');
    expect(q.get('uphillEfficiency')).toBe('0.27');
    expect(q.get('downhillEfficiency')).toBe('0.51');
  });

  it('uses diesel energy density and omits efficiency params without a weight', async () => {
    const fetchMock = stubFetch(200, sample);
    const provider = createTomTomProvider({ apiKey: KEY });
    await provider.calculate({ points, consumptionCurve: [[50, 6], [90, 6.5]], vehicleWeightKg: 2000, fuelType: 'diesel' });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('fuelEnergyDensityInMJoulesPerLiter')).toBe('35.8');

    await provider.calculate({ points, consumptionCurve: [[50, 6], [90, 6.5]], fuelType: 'petrol' });
    const q = new URL(String(fetchMock.mock.calls[1][0])).searchParams;
    expect(q.get('constantSpeedConsumptionInLitersPerHundredkm')).toBe('50,6:90,6.5');
    for (const k of ['vehicleWeight', 'fuelEnergyDensityInMJoulesPerLiter', 'accelerationEfficiency', 'downhillEfficiency']) {
      expect(q.has(k)).toBe(false);
    }
  });

  it('omits consumption and departAt params when not provided', async () => {
    const fetchMock = stubFetch(200, sample);
    await createTomTomProvider({ apiKey: KEY }).calculate({ points: [points[0], points[2]], fuelType: 'petrol' });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(decodeURIComponent(url.pathname)).toContain('/-26.2041,28.0473:-25.7479,28.2293/json');
    expect(url.searchParams.has('departAt')).toBe(false);
    expect(url.searchParams.has('vehicleEngineType')).toBe(false);
    expect(url.searchParams.has('constantSpeedConsumptionInLitersPerHundredkm')).toBe(false);
  });

  it('parses summary, fuel litres and concatenated multi-leg geometry', async () => {
    stubFetch(200, sample);
    const r = await createTomTomProvider({ apiKey: KEY }).calculate({ points, fuelType: 'petrol' });
    expect(r).toMatchObject({
      distanceMeters: 58412,
      travelTimeSeconds: 3125,
      trafficDelaySeconds: 412,
      noTrafficTravelTimeSeconds: 2650,
      departureTime: '2026-10-19T06:00:00.000Z',
      arrivalTime: '2026-10-19T06:52:05.000Z',
      fuelLitres: 4.8731,
    });
    expect(r.geometry).toHaveLength(6);
    expect(r.geometry[0]).toEqual({ lat: -26.2041, lng: 28.0473 });
    expect(r.geometry[3]).toEqual({ lat: -25.9992, lng: 28.1263 });
    expect(r.geometry[5]).toEqual({ lat: -25.7479, lng: 28.2293 });
  });

  it('derives no-traffic time when TomTom omits it and leaves fuel undefined', async () => {
    const { noTrafficTravelTimeInSeconds: _n, fuelConsumptionInLiters: _f, ...summary } = sample.routes[0].summary;
    stubFetch(200, { routes: [{ ...sample.routes[0], summary }] });
    const r = await createTomTomProvider({ apiKey: KEY }).calculate({ points, fuelType: 'petrol' });
    expect(r.noTrafficTravelTimeSeconds).toBe(3125 - 412);
    expect(r.fuelLitres).toBeUndefined();
  });

  it('maps TomTom errors to a 502 ProviderError without leaking the key', async () => {
    stubFetch(400, {
      formatVersion: '0.0.12',
      error: { description: 'Engine model parameters are inconsistent' },
      detailedError: { code: 'BAD_INPUT', message: 'constantSpeedConsumption: invalid curve' },
    });
    const err = await createTomTomProvider({ apiKey: KEY })
      .calculate({ points, fuelType: 'petrol' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(502);
    expect((err as ProviderError).code).toBe('PROVIDER_ERROR');
    expect((err as ProviderError).message).toContain('constantSpeedConsumption: invalid curve');
    expect((err as ProviderError).message).not.toContain(KEY);
  });

  it('handles non-JSON error bodies and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })));
    await expect(createTomTomProvider({ apiKey: KEY }).calculate({ points, fuelType: 'petrol' })).rejects.toThrow(
      /TomTom routing failed \(403\)/,
    );
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(createTomTomProvider({ apiKey: KEY }).calculate({ points, fuelType: 'petrol' })).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it('treats an empty routes array as a provider error', async () => {
    stubFetch(200, { routes: [] });
    await expect(createTomTomProvider({ apiKey: KEY }).calculate({ points, fuelType: 'petrol' })).rejects.toThrow(/no route/);
  });
});
