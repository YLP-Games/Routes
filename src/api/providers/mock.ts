import type { LatLng } from '../../shared/types';
import type { ProviderRouteResult, RoutingProvider } from './types';

export const MOCK_ROAD_FACTOR = 1.25;
export const MOCK_FREE_FLOW_KMH = 70;
export const MOCK_TRAFFIC_DELAY_SHARE = 0.12;

const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two points, metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthMeters(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

/** Deterministic, offline provider used when no TomTom key is configured, and in tests. */
export function createMockProvider(opts: { now?: () => Date } = {}): RoutingProvider {
  const now = opts.now ?? (() => new Date());
  return {
    name: 'mock',
    async calculate(input): Promise<ProviderRouteResult> {
      const distanceMeters = Math.round(pathLengthMeters(input.points) * MOCK_ROAD_FACTOR);
      const noTraffic = Math.round(distanceMeters / 1000 / MOCK_FREE_FLOW_KMH * 3600);
      const delay = Math.round(noTraffic * MOCK_TRAFFIC_DELAY_SHARE);
      const travel = noTraffic + delay;
      const departure = input.departAt ? new Date(input.departAt) : now();
      return {
        distanceMeters,
        travelTimeSeconds: travel,
        noTrafficTravelTimeSeconds: noTraffic,
        trafficDelaySeconds: delay,
        departureTime: departure.toISOString(),
        arrivalTime: new Date(departure.getTime() + travel * 1000).toISOString(),
        geometry: input.points.map((p) => ({ lat: p.lat, lng: p.lng })),
      };
    },
  };
}
