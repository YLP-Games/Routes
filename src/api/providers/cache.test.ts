import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../errors';
import { routeCacheKey, withRouteCache } from './cache';
import { createMockProvider } from './mock';
import type { ProviderRouteInput, RoutingProvider } from './types';

const jhb = { lat: -26.2041, lng: 28.0473 };
const pta = { lat: -25.7479, lng: 28.2293 };
const input: ProviderRouteInput = { points: [jhb, pta], fuelType: 'petrol', consumptionCurve: [[50, 6], [90, 6.5]], vehicleWeightKg: 1200 };

function setup(ttlMs = 90_000) {
  let t = Date.parse('2026-11-10T08:00:00Z');
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const calculate = vi.fn(createMockProvider({ now: () => new Date(t) }).calculate);
  const inner: RoutingProvider = { name: 'tomtom', calculate };
  return { clock, calculate, cached: withRouteCache(inner, { ttlMs, now: clock.now }) };
}

describe('route cache', () => {
  it('reuses an identical calculation within the TTL and recalculates after it', async () => {
    const { clock, calculate, cached } = setup();
    expect(cached.name).toBe('tomtom');
    const first = await cached.calculate(input);
    clock.advance(30_000);
    const second = await cached.calculate({ ...input, points: [{ ...jhb }, { ...pta }] });
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(second.distanceMeters).toBe(first.distanceMeters);
    expect(cached.stats()).toEqual({ hits: 1, misses: 1, size: 1 });

    clock.advance(60_000); // 90 s after the first call
    await cached.calculate(input);
    expect(calculate).toHaveBeenCalledTimes(2);
  });

  it('restates a reused "leave now" result from the present', async () => {
    const { clock, cached } = setup();
    const first = await cached.calculate(input);
    clock.advance(45_000);
    const second = await cached.calculate(input);
    expect(Date.parse(second.departureTime) - Date.parse(first.departureTime)).toBe(45_000);
    expect(Date.parse(second.arrivalTime) - Date.parse(second.departureTime)).toBe(second.travelTimeSeconds * 1000);
  });

  it('returns a fixed-departure result unchanged', async () => {
    const { clock, calculate, cached } = setup();
    const at = { ...input, departAt: '2026-11-11T05:30:00.000Z' };
    const first = await cached.calculate(at);
    clock.advance(45_000);
    expect(await cached.calculate(at)).toEqual(first);
    expect(calculate).toHaveBeenCalledTimes(1);
  });

  it('keys on everything that changes the answer', async () => {
    const { calculate, cached } = setup();
    await cached.calculate(input);
    await cached.calculate({ ...input, points: [pta, jhb] });
    await cached.calculate({ ...input, departAt: '2026-11-11T05:30:00.000Z' });
    await cached.calculate({ ...input, consumptionCurve: [[50, 7], [90, 7.5]] });
    await cached.calculate({ ...input, vehicleWeightKg: 2000 });
    await cached.calculate({ ...input, fuelType: 'diesel' });
    expect(calculate).toHaveBeenCalledTimes(6);
    // Sub-decimetre jitter in a coordinate is the same place.
    expect(routeCacheKey({ ...input, points: [{ lat: jhb.lat + 1e-8, lng: jhb.lng }, pta] })).toBe(routeCacheKey(input));
  });

  it('shares one in-flight calculation between concurrent identical requests', async () => {
    const { calculate, cached } = setup();
    const [a, b] = await Promise.all([cached.calculate(input), cached.calculate(input)]);
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(a.distanceMeters).toBe(b.distanceMeters);
  });

  it('does not cache failures', async () => {
    let fail = true;
    const calculate = vi.fn(async (i: ProviderRouteInput) => {
      if (fail) throw new ProviderError('TomTom routing service timed out');
      return createMockProvider().calculate(i);
    });
    const cached = withRouteCache({ name: 'tomtom', calculate });
    await expect(cached.calculate(input)).rejects.toBeInstanceOf(ProviderError);
    fail = false;
    await expect(cached.calculate(input)).resolves.toMatchObject({ distanceMeters: expect.any(Number) });
    expect(calculate).toHaveBeenCalledTimes(2);
  });

  it('drops the oldest route beyond the size cap', async () => {
    const calculate = vi.fn(createMockProvider().calculate);
    const cached = withRouteCache({ name: 'mock', calculate }, { maxEntries: 2 });
    const at = (lat: number): ProviderRouteInput => ({ ...input, points: [{ lat, lng: 28 }, pta] });
    await cached.calculate(at(-26.1));
    await cached.calculate(at(-26.2));
    await cached.calculate(at(-26.3));
    expect(cached.stats().size).toBe(2);
    await cached.calculate(at(-26.1)); // evicted: calculated again
    expect(calculate).toHaveBeenCalledTimes(4);
  });
});
