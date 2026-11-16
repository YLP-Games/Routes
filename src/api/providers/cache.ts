import { TtlCache } from '../ttlCache';
import type { ProviderRouteInput, ProviderRouteResult, RoutingProvider } from './types';

export interface RouteCacheOptions {
  /** How long a result is reused, in ms. Traffic moves slowly at this scale. Default 90 s. */
  ttlMs?: number;
  /** Default 200 routes. */
  maxEntries?: number;
  now?: () => number;
}

export interface CachedRoutingProvider extends RoutingProvider {
  stats(): { hits: number; misses: number; size: number };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Everything that changes the provider's answer. "Leave now" (no departAt) is its own key. */
export function routeCacheKey(input: ProviderRouteInput): string {
  return JSON.stringify([
    input.points.map((p) => [round6(p.lat), round6(p.lng)]),
    input.departAt ?? null,
    input.consumptionCurve ?? null,
    input.vehicleWeightKg ?? null,
    input.fuelType,
  ]);
}

/**
 * Reuses identical route calculations for a short time. The routing provider is the slow, metered
 * part of a request, and the app asks for the same route again whenever only the price changes
 * (the price-month toggle) or the user recalculates without moving anything. Requests that arrive
 * while the same route is still being calculated share that one call. Failures are not cached.
 */
export function withRouteCache(provider: RoutingProvider, opts: RouteCacheOptions = {}): CachedRoutingProvider {
  const now = opts.now ?? Date.now;
  const cache = new TtlCache<Promise<ProviderRouteResult>>(opts.ttlMs ?? 90_000, opts.maxEntries ?? 200, now);
  let hits = 0;
  let misses = 0;

  return {
    name: provider.name,
    async calculate(input) {
      const key = routeCacheKey(input);
      const cached = cache.get(key);
      if (cached) {
        hits++;
        const result = await cached;
        if (input.departAt) return result;
        // A reused "leave now" result is restated from the present, so the clock times stay true.
        const t = now();
        return {
          ...result,
          departureTime: new Date(t).toISOString(),
          arrivalTime: new Date(t + result.travelTimeSeconds * 1000).toISOString(),
        };
      }
      misses++;
      const pending = provider.calculate(input);
      cache.set(key, pending);
      pending.catch(() => cache.deleteIf(key, pending));
      return pending;
    },
    stats: () => ({ hits, misses, size: cache.size }),
  };
}
