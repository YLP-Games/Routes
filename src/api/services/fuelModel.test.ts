import { describe, expect, it } from 'vitest';
import {
  REAL_WORLD_FACTOR,
  buildConsumptionCurve,
  curveFromCombined,
  customConsumption,
  deriveConsumption,
  estimateFuel,
  fallbackLitres,
} from './fuelModel';

const polo = { urban: 7.0, extraUrban: 4.5, combined: 5.4 };

function assertValley(curve: Array<[number, number]>) {
  const values = curve.map(([, l]) => l);
  const minIdx = values.indexOf(Math.min(...values));
  for (let i = 1; i <= minIdx; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
  for (let i = minIdx + 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  for (let i = 1; i < curve.length; i++) {
    expect(curve[i][0]).toBeGreaterThan(curve[i - 1][0]);
    expect(curve[i][0] * curve[i][1]).toBeGreaterThan(curve[i - 1][0] * curve[i - 1][1]);
  }
}

describe('buildConsumptionCurve', () => {
  it('produces the documented speed points scaled by the real-world factor', () => {
    const curve = buildConsumptionCurve(polo);
    expect(curve.map(([s]) => s)).toEqual([10, 30, 50, 70, 90, 110, 130]);
    expect(curve[0][1]).toBeCloseTo(7.0 * 1.2 * REAL_WORLD_FACTOR, 2);
    expect(curve[1][1]).toBeCloseTo(7.0 * 0.92 * REAL_WORLD_FACTOR, 2);
    expect(curve[2][1]).toBeCloseTo(5.75 * 0.95 * REAL_WORLD_FACTOR, 2);
    expect(curve[3][1]).toBeCloseTo(4.5 * REAL_WORLD_FACTOR, 2);
    expect(curve[4][1]).toBeCloseTo(4.5 * REAL_WORLD_FACTOR, 2);
    expect(curve[5][1]).toBeCloseTo(4.5 * 1.08 * REAL_WORLD_FACTOR, 2);
    expect(curve[6][1]).toBeCloseTo(4.5 * 1.26 * REAL_WORLD_FACTOR, 2);
  });

  it('is a drive-cycle-average curve: low speeds keep the urban (stop-start) cost', () => {
    // TomTom is told speed changes are free, so the curve itself must carry the urban penalty.
    const curve = buildConsumptionCurve(polo);
    const at = (kmh: number) => curve.find(([s]) => s === kmh)![1];
    expect(at(30)).toBeGreaterThan(at(70) * 1.3);
    expect(at(110)).toBeLessThan(at(70) * 1.1);
  });

  it('rounds to 2 decimals', () => {
    for (const [, l] of buildConsumptionCurve({ urban: 7.123, extraUrban: 4.567, combined: 5.5 })) {
      expect(Math.round(l * 100) / 100).toBe(l);
    }
  });

  it('is a valley with strictly increasing fuel flow', () => {
    assertValley(buildConsumptionCurve(polo));
    assertValley(curveFromCombined(9.8));
  });

  it('repairs odd data (extra-urban higher than urban) into a valid curve', () => {
    assertValley(buildConsumptionCurve({ urban: 4, extraUrban: 6, combined: 5 }));
    assertValley(buildConsumptionCurve({ urban: 20, extraUrban: 3, combined: 9 }));
  });

  it('curveFromCombined derives urban x1.3 and extra-urban x0.85', () => {
    expect(deriveConsumption(10)).toEqual({ urban: 13, extraUrban: 8.5, combined: 10 });
    expect(curveFromCombined(10)).toEqual(buildConsumptionCurve({ urban: 13, extraUrban: 8.5, combined: 10 }));
  });
});

describe('fallbackLitres', () => {
  const c = { urban: 8, extraUrban: 5, combined: 6 };

  it('uses the urban figure at <= 30 km/h', () => {
    // 10 km in 30 min = 20 km/h, no delay
    const r = fallbackLitres({ distanceMeters: 10_000, travelTimeSeconds: 1800, trafficDelaySeconds: 0 }, c);
    expect(r.litresPer100km).toBeCloseTo(8 * REAL_WORLD_FACTOR, 6);
    expect(r.litres).toBeCloseTo((10 * 8 * REAL_WORLD_FACTOR) / 100, 6);
  });

  it('uses the extra-urban figure at >= 80 km/h', () => {
    // 100 km in 1 h
    const r = fallbackLitres({ distanceMeters: 100_000, travelTimeSeconds: 3600, trafficDelaySeconds: 0 }, c);
    expect(r.litresPer100km).toBeCloseTo(5 * REAL_WORLD_FACTOR, 6);
  });

  it('blends linearly between 30 and 80 km/h', () => {
    // 55 km/h -> urban share 0.5 -> 6.5 L/100km
    const r = fallbackLitres({ distanceMeters: 55_000, travelTimeSeconds: 3600, trafficDelaySeconds: 0 }, c);
    expect(r.litresPer100km).toBeCloseTo(6.5 * REAL_WORLD_FACTOR, 6);
  });

  it('adds a stop-go penalty proportional to traffic delay', () => {
    // 100 km/h, 25% of time is delay -> + 0.25 * 0.3 * 8 = 0.6
    const r = fallbackLitres({ distanceMeters: 100_000, travelTimeSeconds: 3600, trafficDelaySeconds: 900 }, c);
    expect(r.litresPer100km).toBeCloseTo((5 + 0.6) * REAL_WORLD_FACTOR, 6);
  });

  it('returns zero for a zero-length route', () => {
    expect(fallbackLitres({ distanceMeters: 0, travelTimeSeconds: 0, trafficDelaySeconds: 0 }, c)).toEqual({
      litres: 0,
      litresPer100km: 0,
    });
  });
});

describe('estimateFuel', () => {
  const summary = { distanceMeters: 120_000, travelTimeSeconds: 5400, trafficDelaySeconds: 300 };
  const price = { randsPerLitre: 30.25, month: '2026-10' };

  it('uses provider litres when present', () => {
    const e = estimateFuel({ summary, consumption: polo, providerLitres: 7.4321, price });
    expect(e.method).toBe('provider-model');
    expect(e.litres).toBe(7.43);
    expect(e.litresPer100km).toBe(6.19);
    expect(e.costRands).toBe(224.82); // 7.4321 * 30.25 = 224.821
    expect(e.costPerKmRands).toBe(1.87);
    expect(e.priceRandsPerLitre).toBe(30.25);
    expect(e.priceMonth).toBe('2026-10');
  });

  it('falls back to the average model without provider litres', () => {
    const e = estimateFuel({ summary, consumption: polo, price });
    expect(e.method).toBe('fallback-average');
    const fb = fallbackLitres(summary, polo);
    expect(e.litres).toBeCloseTo(fb.litres, 2);
    expect(e.costRands).toBeCloseTo(fb.litres * 30.25, 2);
    expect(e.costPerKmRands).toBeCloseTo((fb.litres * 30.25) / 120, 2);
  });

  it('handles a zero-length route without dividing by zero', () => {
    const e = estimateFuel({ summary: { distanceMeters: 0, travelTimeSeconds: 0, trafficDelaySeconds: 0 }, consumption: polo, price });
    expect(e).toMatchObject({ litres: 0, costRands: 0, costPerKmRands: 0, litresPer100km: 0 });
  });
});

describe('user-entered (real-world) consumption', () => {
  const entered = 7.4;
  const c = customConsumption(entered);
  const steady = (kmh: number) => ({ distanceMeters: kmh * 1000, travelTimeSeconds: 3600, trafficDelaySeconds: 0 });

  it('centres the figures on the entered value', () => {
    expect(c).toEqual({ urban: entered * 1.3, extraUrban: entered, combined: entered });
  });

  it('does not apply REAL_WORLD_FACTOR to the curve, and 70-90 km/h sits on the entered value', () => {
    const curve = buildConsumptionCurve(c, { realWorld: true });
    assertValley(curve);
    const at = (kmh: number) => curve.find(([s]) => s === kmh)![1];
    expect(at(70)).toBeCloseTo(entered, 2);
    expect(Math.abs(at(90) - entered) / entered).toBeLessThan(0.03);
    expect(at(10)).toBeGreaterThan(entered); // urban / crawling still costs more
    // Lab figures keep the factor.
    expect(buildConsumptionCurve(c)[3][1]).toBeCloseTo(entered * REAL_WORLD_FACTOR, 2);
  });

  it('fallback model lands near the entered value at a steady 70-90 km/h with no traffic', () => {
    for (const kmh of [70, 80, 90]) {
      const { litresPer100km } = fallbackLitres(steady(kmh), c, { realWorld: true });
      expect(Math.abs(litresPer100km - entered) / entered).toBeLessThan(0.07);
    }
    expect(fallbackLitres(steady(80), c, { realWorld: true }).litresPer100km).toBeCloseTo(entered, 6);
    expect(fallbackLitres(steady(80), c).litresPer100km).toBeCloseTo(entered * REAL_WORLD_FACTOR, 6);
  });

  it('estimateFuel passes realWorld to the fallback model', () => {
    const price = { randsPerLitre: 30, month: '2026-10' };
    const real = estimateFuel({ summary: steady(80), consumption: c, realWorld: true, price });
    const lab = estimateFuel({ summary: steady(80), consumption: c, price });
    expect(real.litresPer100km).toBeCloseTo(entered, 2);
    expect(lab.litresPer100km).toBeCloseTo(entered * REAL_WORLD_FACTOR, 2);
  });
});
