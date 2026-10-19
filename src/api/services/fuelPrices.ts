import type { FuelPrice, FuelType, PriceMonthSelector, PriceZone } from '../../shared/types';
import { HttpError } from '../errors';
import pricesJson from '../data/fuelPrices.za.json';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Calendar date (YYYY-MM-DD) in South Africa (UTC+2, no DST) for a given instant. */
export function saDate(now: Date): string {
  return new Date(now.getTime() + 2 * 3600_000).toISOString().slice(0, 10);
}

export interface PriceLookup { price: FuelPrice; warning?: string }

export function createFuelPriceService(data: FuelPrice[]) {
  const prices = [...data];
  /** month -> effective date (earliest effectiveDate listed for that month). */
  const effective = new Map<string, string>();
  for (const p of prices) {
    const cur = effective.get(p.month);
    if (!cur || p.effectiveDate < cur) effective.set(p.month, p.effectiveDate);
  }
  const monthsDesc = [...effective.keys()].sort().reverse();

  function listMonths(): string[] {
    return [...monthsDesc];
  }

  function currentMonth(now: Date): string {
    const today = saDate(now);
    const m = monthsDesc.find((month) => (effective.get(month) as string) <= today);
    if (!m) throw new HttpError(404, 'PRICE_MONTH_NOT_FOUND', `No fuel prices are effective on ${today}`);
    return m;
  }

  /** Resolve 'current' | 'previous' | 'YYYY-MM' to a month present in the table. */
  function resolveMonth(selector: PriceMonthSelector, now: Date): string {
    if (selector === 'current') return currentMonth(now);
    if (selector === 'previous') {
      const cur = currentMonth(now);
      const prev = monthsDesc[monthsDesc.indexOf(cur) + 1];
      if (!prev) throw new HttpError(404, 'PRICE_MONTH_NOT_FOUND', `No fuel prices before ${cur}`);
      return prev;
    }
    if (!MONTH_RE.test(selector)) {
      throw new HttpError(400, 'VALIDATION_ERROR', `Invalid month "${selector}"; use 'current', 'previous' or YYYY-MM`);
    }
    if (!effective.has(selector)) {
      throw new HttpError(404, 'PRICE_MONTH_NOT_FOUND', `No fuel prices for ${selector}; available: ${monthsDesc.join(', ')}`);
    }
    return selector;
  }

  /** Exact price, or the other zone's price for the same fuel (with a warning). */
  function getPrice(month: string, zone: PriceZone, fuel: FuelType): PriceLookup {
    const exact = prices.find((p) => p.month === month && p.zone === zone && p.fuel === fuel);
    if (exact) return { price: exact };
    const otherZone: PriceZone = zone === 'inland' ? 'coastal' : 'inland';
    const other = prices.find((p) => p.month === month && p.zone === otherZone && p.fuel === fuel);
    if (other) {
      return {
        price: other,
        warning: `No ${zone} ${fuel} price for ${month}; using the ${otherZone} price (R${other.randsPerLitre.toFixed(2)}/L) instead`,
      };
    }
    throw new HttpError(404, 'PRICE_NOT_FOUND', `No ${fuel} price for ${month} in any zone`);
  }

  /** Prices filtered by optional month selector, zone and fuel; newest month first. */
  function listPrices(filter: { month?: PriceMonthSelector; zone?: PriceZone; fuel?: FuelType }, now: Date): FuelPrice[] {
    const month = filter.month ? resolveMonth(filter.month, now) : undefined;
    return prices
      .filter((p) => (!month || p.month === month) && (!filter.zone || p.zone === filter.zone) && (!filter.fuel || p.fuel === filter.fuel))
      .sort((a, b) => b.month.localeCompare(a.month) || a.zone.localeCompare(b.zone) || a.fuel.localeCompare(b.fuel));
  }

  return { listMonths, resolveMonth, getPrice, listPrices };
}

export type FuelPriceService = ReturnType<typeof createFuelPriceService>;

export const FUEL_PRICES = pricesJson as FuelPrice[];
export const fuelPrices = createFuelPriceService(FUEL_PRICES);
