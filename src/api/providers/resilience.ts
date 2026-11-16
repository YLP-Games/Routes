/**
 * Graceful degradation for live providers.
 *
 * A configured TomTom key can still be expired, out of quota or temporarily unreachable. Instead of
 * failing every request, the wrappers below catch a failing primary and use the bundled offline
 * provider, marking the response with a warning and recording the failure in a shared status object
 * that /api/health can report. Nothing here logs (and therefore never exposes) the API key or URL.
 */
import type { ProviderComponentStatus } from '../../shared/api';
import type { PlaceSearchProvider } from '../places/types';
import type { ProviderRouteInput, ProviderRouteResult, RoutingProvider } from './types';

export const LIVE_ROUTING_UNAVAILABLE_WARNING = 'Live routing is unavailable; showing estimated routes and times.';

/** Stable keys for the two capabilities that can degrade independently. */
export const ROUTING_COMPONENT = 'routing';
export const PLACES_COMPONENT = 'places';

/** Last-known health of the live providers, as exposed by /api/health. */
export interface ProviderStatusSnapshot {
  degraded: boolean;
  components: Record<string, ProviderComponentStatus>;
}

/** In-memory record of upstream successes and failures. */
export interface ProviderStatus {
  recordSuccess(component: string): void;
  recordError(component: string, message: string): void;
  snapshot(): ProviderStatusSnapshot;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Creates a synchronous, in-memory status recorder. A component is healthy after a success and
 * degraded after an error; `degraded` is true while any component is in its error state.
 */
export function createProviderStatus(opts: { now?: () => Date } = {}): ProviderStatus {
  const now = opts.now ?? (() => new Date());
  const components: Record<string, ProviderComponentStatus> = {};

  return {
    recordSuccess(component) {
      components[component] = { ok: true };
    },
    recordError(component, message) {
      components[component] = { ok: false, lastError: message, lastErrorAt: now().toISOString() };
    },
    snapshot() {
      // Hand out copies so callers cannot mutate the recorded state.
      const copy: Record<string, ProviderComponentStatus> = {};
      for (const [name, status] of Object.entries(components)) copy[name] = { ...status };
      return { degraded: Object.values(copy).some((s) => !s.ok), components: copy };
    },
  };
}

/**
 * Uses `fallback` whenever `primary.calculate` fails. The fallback result is tagged with a warning
 * so the UI can explain why live traffic/routing is not being used; the primary's identity (`name`)
 * is kept so health and results still report the configured provider.
 */
export function withRoutingFallback(
  primary: RoutingProvider,
  fallback: RoutingProvider,
  status: ProviderStatus,
): RoutingProvider & { status(): ProviderStatusSnapshot } {
  return {
    name: primary.name,
    async calculate(input: ProviderRouteInput): Promise<ProviderRouteResult> {
      try {
        const result = await primary.calculate(input);
        status.recordSuccess(ROUTING_COMPONENT);
        return result;
      } catch (err) {
        status.recordError(ROUTING_COMPONENT, errorMessage(err));
        const fallbackResult = await fallback.calculate(input);
        return {
          ...fallbackResult,
          warnings: [LIVE_ROUTING_UNAVAILABLE_WARNING, ...(fallbackResult.warnings ?? [])],
        };
      }
    },
    status: () => status.snapshot(),
  };
}

/** Same degradation policy as routing, for place search (which has no warnings field). */
export function withPlaceSearchFallback(
  primary: PlaceSearchProvider,
  fallback: PlaceSearchProvider,
  status: ProviderStatus,
): PlaceSearchProvider & { status(): ProviderStatusSnapshot } {
  return {
    name: primary.name,
    async search(query: string) {
      try {
        const result = await primary.search(query);
        status.recordSuccess(PLACES_COMPONENT);
        return result;
      } catch (err) {
        status.recordError(PLACES_COMPONENT, errorMessage(err));
        return fallback.search(query);
      }
    },
    status: () => status.snapshot(),
  };
}
