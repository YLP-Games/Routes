import { describe, expect, it } from 'vitest';
import { MOCK_ROAD_FACTOR, createMockProvider, haversineMeters } from './mock';

const now = () => new Date('2026-10-19T08:00:00.000Z');
const jhb = { lat: -26.2041, lng: 28.0473 };
const pta = { lat: -25.7479, lng: 28.2293 };

describe('mock provider', () => {
  it('computes haversine distances', () => {
    expect(haversineMeters(jhb, pta) / 1000).toBeCloseTo(53.9, 0);
    expect(haversineMeters(jhb, jhb)).toBe(0);
  });

  it('is deterministic and follows the documented model', async () => {
    const provider = createMockProvider({ now });
    const r = await provider.calculate({ points: [jhb, pta], fuelType: 'petrol' });
    expect(r).toEqual(await provider.calculate({ points: [jhb, pta], fuelType: 'petrol' }));
    expect(r.distanceMeters).toBe(Math.round(haversineMeters(jhb, pta) * MOCK_ROAD_FACTOR));
    expect(r.noTrafficTravelTimeSeconds).toBe(Math.round((r.distanceMeters / 1000 / 70) * 3600));
    expect(r.trafficDelaySeconds).toBe(Math.round(r.noTrafficTravelTimeSeconds * 0.12));
    expect(r.travelTimeSeconds).toBe(r.noTrafficTravelTimeSeconds + r.trafficDelaySeconds);
    expect(r.departureTime).toBe('2026-10-19T08:00:00.000Z');
    expect(new Date(r.arrivalTime).getTime() - new Date(r.departureTime).getTime()).toBe(r.travelTimeSeconds * 1000);
    expect(r.geometry).toEqual([jhb, pta]);
    expect(r.fuelLitres).toBeUndefined();
  });

  it('honours departAt', async () => {
    const r = await createMockProvider({ now }).calculate({
      points: [jhb, pta],
      departAt: '2026-10-20T07:30:00+02:00',
      fuelType: 'petrol',
    });
    expect(r.departureTime).toBe('2026-10-20T05:30:00.000Z');
  });
});
