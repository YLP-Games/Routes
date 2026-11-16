import { describe, expect, it, vi } from 'vitest';
import type { Place } from '../../shared/types';
import type { PlaceSearchProvider } from '../places/types';
import {
  LIVE_ROUTING_UNAVAILABLE_WARNING,
  PLACES_COMPONENT,
  ROUTING_COMPONENT,
  createProviderStatus,
  withPlaceSearchFallback,
  withRoutingFallback,
} from './resilience';
import type { ProviderRouteInput, ProviderRouteResult, RoutingProvider } from './types';

const NOW_ISO = '2026-10-19T08:00:00.000Z';
const now = () => new Date(NOW_ISO);

const input: ProviderRouteInput = {
  points: [
    { lat: -26.2041, lng: 28.0473 },
    { lat: -25.7479, lng: 28.2293 },
  ],
  fuelType: 'petrol',
};

const fallbackResult: ProviderRouteResult = {
  distanceMeters: 60_000,
  travelTimeSeconds: 3000,
  noTrafficTravelTimeSeconds: 3000,
  trafficDelaySeconds: 0,
  departureTime: NOW_ISO,
  arrivalTime: '2026-10-19T08:50:00.000Z',
  geometry: input.points,
};

const place: Place = { name: 'Sandton', detail: 'Johannesburg, Gauteng', lat: -26.107, lng: 28.056 };

describe('createProviderStatus', () => {
  it('starts healthy and flips degraded on error, back on success', () => {
    const status = createProviderStatus({ now });
    expect(status.snapshot()).toEqual({ degraded: false, components: {} });

    status.recordError(ROUTING_COMPONENT, 'TomTom routing failed (403): Developer Inactive');
    expect(status.snapshot()).toEqual({
      degraded: true,
      components: {
        [ROUTING_COMPONENT]: {
          ok: false,
          lastError: 'TomTom routing failed (403): Developer Inactive',
          lastErrorAt: NOW_ISO,
        },
      },
    });

    status.recordSuccess(ROUTING_COMPONENT);
    expect(status.snapshot()).toEqual({
      degraded: false,
      components: { [ROUTING_COMPONENT]: { ok: true } },
    });
  });

  it('stays degraded while any component is failing', () => {
    const status = createProviderStatus({ now });
    status.recordError(PLACES_COMPONENT, 'TomTom place search failed (429)');
    status.recordSuccess(ROUTING_COMPONENT);
    expect(status.snapshot().degraded).toBe(true);
    status.recordSuccess(PLACES_COMPONENT);
    expect(status.snapshot().degraded).toBe(false);
  });

  it('hands out snapshots that cannot mutate the recorded state', () => {
    const status = createProviderStatus({ now });
    status.recordError(ROUTING_COMPONENT, 'boom');
    const snapshot = status.snapshot();
    snapshot.components[ROUTING_COMPONENT].ok = true;
    snapshot.degraded = false;
    expect(status.snapshot().degraded).toBe(true);
  });
});

describe('withRoutingFallback', () => {
  it('uses the fallback with a warning when the primary throws', async () => {
    const status = createProviderStatus({ now });
    const primary: RoutingProvider = {
      name: 'tomtom',
      calculate: async () => {
        throw new Error('TomTom routing failed (403): Developer Inactive');
      },
    };
    const fallback: RoutingProvider = { name: 'mock', calculate: async () => ({ ...fallbackResult }) };
    const wrapped = withRoutingFallback(primary, fallback, status);

    const result = await wrapped.calculate(input);
    expect(result.distanceMeters).toBe(fallbackResult.distanceMeters);
    expect(result.warnings).toEqual([LIVE_ROUTING_UNAVAILABLE_WARNING]);
    expect(wrapped.name).toBe('tomtom'); // health/results still report the configured provider
    expect(wrapped.status()).toEqual({
      degraded: true,
      components: {
        [ROUTING_COMPONENT]: {
          ok: false,
          lastError: 'TomTom routing failed (403): Developer Inactive',
          lastErrorAt: NOW_ISO,
        },
      },
    });
  });

  it('records non-Error failures too (any thrown value triggers fallback)', async () => {
    const status = createProviderStatus({ now });
    const primary: RoutingProvider = {
      name: 'tomtom',
      calculate: async () => {
        throw 'upstream quota';
      },
    };
    const fallback: RoutingProvider = { name: 'mock', calculate: async () => ({ ...fallbackResult }) };
    const result = await withRoutingFallback(primary, fallback, status).calculate(input);
    expect(result.warnings).toEqual([LIVE_ROUTING_UNAVAILABLE_WARNING]);
    expect(status.snapshot().components[ROUTING_COMPONENT].lastError).toBe('upstream quota');
  });

  it('prepends the warning to any warnings the fallback already returned', async () => {
    const status = createProviderStatus({ now });
    const primary: RoutingProvider = {
      name: 'tomtom',
      calculate: async () => {
        throw new Error('timeout');
      },
    };
    const fallback: RoutingProvider = {
      name: 'mock',
      calculate: async () => ({ ...fallbackResult, warnings: ['fallback fuel estimate'] }),
    };
    const result = await withRoutingFallback(primary, fallback, status).calculate(input);
    expect(result.warnings).toEqual([LIVE_ROUTING_UNAVAILABLE_WARNING, 'fallback fuel estimate']);
  });

  it('returns the primary result unchanged on success, without calling the fallback', async () => {
    const status = createProviderStatus({ now });
    const primaryResult: ProviderRouteResult = { ...fallbackResult, fuelLitres: 4.2 };
    const primary: RoutingProvider = { name: 'tomtom', calculate: async () => primaryResult };
    const fallbackCalculate = vi.fn(async () => ({ ...fallbackResult }));
    const wrapped = withRoutingFallback(primary, { name: 'mock', calculate: fallbackCalculate }, status);

    const result = await wrapped.calculate(input);
    expect(result).toBe(primaryResult);
    expect(result.warnings).toBeUndefined();
    expect(fallbackCalculate).not.toHaveBeenCalled();
    expect(wrapped.status().degraded).toBe(false);
    expect(wrapped.status().components[ROUTING_COMPONENT]).toEqual({ ok: true });
  });
});

describe('withPlaceSearchFallback', () => {
  it('falls back and records the error when place search fails', async () => {
    const status = createProviderStatus({ now });
    const primary: PlaceSearchProvider = {
      name: 'tomtom',
      search: async () => {
        throw new Error('TomTom place search failed (429)');
      },
    };
    const fallback: PlaceSearchProvider = { name: 'offline', search: async () => [place] };
    const wrapped = withPlaceSearchFallback(primary, fallback, status);

    const result = await wrapped.search('sandton');
    expect(result).toEqual([place]);
    expect(result).not.toHaveProperty('warnings');
    expect(wrapped.name).toBe('tomtom');
    expect(wrapped.status().degraded).toBe(true);
    expect(wrapped.status().components[PLACES_COMPONENT]).toEqual({
      ok: false,
      lastError: 'TomTom place search failed (429)',
      lastErrorAt: NOW_ISO,
    });
  });

  it('uses a successful primary and does not call the fallback', async () => {
    const status = createProviderStatus({ now });
    const primary: PlaceSearchProvider = { name: 'tomtom', search: async () => [place] };
    const fallbackSearch = vi.fn(async () => []);
    const wrapped = withPlaceSearchFallback(primary, { name: 'offline', search: fallbackSearch }, status);

    expect(await wrapped.search('sandton')).toEqual([place]);
    expect(fallbackSearch).not.toHaveBeenCalled();
    expect(wrapped.status().degraded).toBe(false);
  });
});
