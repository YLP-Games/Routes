import { describe, expect, it } from 'vitest';
import type { FuelPrice } from '../../shared/types';
import { HttpError } from '../errors';
import { FUEL_PRICES, createFuelPriceService, fuelPrices, saDate } from './fuelPrices';

const p = (month: string, effectiveDate: string, zone: FuelPrice['zone'], fuel: FuelPrice['fuel'], r: number): FuelPrice => ({
  month, effectiveDate, zone, fuel, randsPerLitre: r, source: 'test',
});

const svc = createFuelPriceService([
  p('2026-08', '2026-08-05', 'inland', 'petrol95', 25.0),
  p('2026-09', '2026-09-02', 'inland', 'petrol95', 26.92),
  p('2026-09', '2026-09-02', 'coastal', 'petrol95', 26.05),
  p('2026-10', '2026-10-07', 'inland', 'petrol95', 30.25),
  p('2026-10', '2026-10-07', 'inland', 'diesel50ppm', 33.29),
]);

function expectHttp(fn: () => unknown, status: number, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(status);
    expect((e as HttpError).code).toBe(code);
    return;
  }
  throw new Error('expected an HttpError');
}

describe('fuel price service', () => {
  it('lists months newest first', () => {
    expect(svc.listMonths()).toEqual(['2026-10', '2026-09', '2026-08']);
  });

  it('resolves current by effective date, not calendar month', () => {
    expect(svc.resolveMonth('current', new Date('2026-10-19T08:00:00Z'))).toBe('2026-10');
    // October prices only start on Wednesday 7 October
    expect(svc.resolveMonth('current', new Date('2026-10-06T12:00:00Z'))).toBe('2026-09');
    // 23:30 UTC on the 6th is already the 7th in South Africa
    expect(svc.resolveMonth('current', new Date('2026-10-06T23:30:00Z'))).toBe('2026-10');
  });

  it('resolves previous as the month before current in the table', () => {
    expect(svc.resolveMonth('previous', new Date('2026-10-19T08:00:00Z'))).toBe('2026-09');
    expect(svc.resolveMonth('previous', new Date('2026-10-01T08:00:00Z'))).toBe('2026-08');
    expectHttp(() => svc.resolveMonth('previous', new Date('2026-08-10T08:00:00Z')), 404, 'PRICE_MONTH_NOT_FOUND');
  });

  it('accepts explicit YYYY-MM months that exist and rejects others', () => {
    expect(svc.resolveMonth('2026-08', new Date())).toBe('2026-08');
    expectHttp(() => svc.resolveMonth('2025-01', new Date()), 404, 'PRICE_MONTH_NOT_FOUND');
    expectHttp(() => svc.resolveMonth('October', new Date()), 400, 'VALIDATION_ERROR');
  });

  it('404s when nothing is effective yet', () => {
    expectHttp(() => svc.resolveMonth('current', new Date('2020-01-01T00:00:00Z')), 404, 'PRICE_MONTH_NOT_FOUND');
  });

  it('returns exact prices without a warning', () => {
    const r = svc.getPrice('2026-09', 'coastal', 'petrol95');
    expect(r.price.randsPerLitre).toBe(26.05);
    expect(r.warning).toBeUndefined();
  });

  it('falls back to the other zone with a warning', () => {
    const r = svc.getPrice('2026-10', 'coastal', 'petrol95');
    expect(r.price.zone).toBe('inland');
    expect(r.price.randsPerLitre).toBe(30.25);
    expect(r.warning).toMatch(/coastal petrol95.*inland/);
  });

  it('throws PRICE_NOT_FOUND when no zone has the fuel', () => {
    expectHttp(() => svc.getPrice('2026-09', 'inland', 'diesel500ppm'), 404, 'PRICE_NOT_FOUND');
  });

  it('filters price lists', () => {
    const now = new Date('2026-10-19T08:00:00Z');
    expect(svc.listPrices({ month: 'current', fuel: 'petrol95' }, now).map((x) => x.randsPerLitre)).toEqual([30.25]);
    expect(svc.listPrices({ zone: 'coastal' }, now)).toHaveLength(1);
    expect(svc.listPrices({}, now)[0].month).toBe('2026-10');
  });

  it('computes the South African calendar date', () => {
    expect(saDate(new Date('2026-10-06T21:59:00Z'))).toBe('2026-10-06');
    expect(saDate(new Date('2026-10-06T22:00:00Z'))).toBe('2026-10-07');
  });
});

describe('bundled fuelPrices.za.json', () => {
  it('has well-formed, unique rows', () => {
    const keys = new Set<string>();
    for (const r of FUEL_PRICES) {
      expect(r.month).toMatch(/^\d{4}-\d{2}$/);
      expect(r.effectiveDate.startsWith(r.month)).toBe(true);
      expect(['inland', 'coastal']).toContain(r.zone);
      expect(['petrol93', 'petrol95', 'diesel50ppm', 'diesel500ppm']).toContain(r.fuel);
      expect(r.randsPerLitre).toBeGreaterThan(5);
      expect(r.randsPerLitre).toBeLessThan(60);
      expect(r.source.length).toBeGreaterThan(0);
      const key = `${r.month}|${r.zone}|${r.fuel}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  });

  it('contains the verified October 2026 figures', () => {
    expect(fuelPrices.getPrice('2026-10', 'inland', 'petrol95').price.randsPerLitre).toBe(30.25);
    expect(fuelPrices.getPrice('2026-10', 'inland', 'petrol93').price.randsPerLitre).toBe(29.88);
    expect(fuelPrices.getPrice('2026-10', 'coastal', 'petrol95').price.randsPerLitre).toBe(29.38);
    expect(fuelPrices.getPrice('2026-09', 'inland', 'petrol95').price.randsPerLitre).toBe(26.92);
    expect(fuelPrices.resolveMonth('current', new Date('2026-10-19T08:00:00Z'))).toBe('2026-10');
  });
});
