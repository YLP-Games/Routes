import type { FuelPrice, FuelType, PriceMonthSelector, PriceZone } from '../../shared/types';
import { HttpError } from '../errors';
import pricesJson from '../data/fuelPrices.za.json';

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Calendar date (YYYY-MM-DD) in South Africa (UTC+2, no DST) for a given instant. */
export function saDate(now: Date): string {
  return new Date(now.getTime() + 2 * 3600_000).toISOString().slice(0, 10);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const monthName = (month: string) => `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

/** The month after a 'YYYY-MM' month. */
export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** First Wednesday of a 'YYYY-MM' month as 'YYYY-MM-DD': the day regulated prices change. */
export function firstWednesday(month: string): string {
  const weekday = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1)).getUTCDay(); // 0 = Sunday
  return `${month}-${String(1 + ((3 - weekday + 7) % 7)).padStart(2, '0')}`;
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

  /**
   * Warning for when the table has fallen behind: the month after the current one has no prices
   * on file although its adjustment date (first Wednesday) has passed. Undefined when up to date.
   */
  function staleWarning(now: Date): string | undefined {
    const today = saDate(now);
    const cur = monthsDesc.find((month) => (effective.get(month) as string) <= today);
    if (!cur) return undefined;
    const next = nextMonth(cur);
    if (effective.has(next)) return undefined; // on file, just not in effect yet
    const due = firstWednesday(next);
    if (today < due) return undefined;
    return `Fuel prices may be out of date: the newest on file are for ${monthName(cur)}, but prices were due to change on ${due}`;
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

  return { listMonths, resolveMonth, getPrice, listPrices, staleWarning };
}

export type FuelPriceService = ReturnType<typeof createFuelPriceService>;

export const FUEL_PRICES = pricesJson as FuelPrice[];
export const fuelPrices = createFuelPriceService(FUEL_PRICES);
