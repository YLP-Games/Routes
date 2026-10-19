import type { LatLng, RouteSummary } from '../../shared/types';

/** Speed (km/h) -> consumption (L/100km) pairs, strictly increasing in speed. */
export type ConsumptionCurve = Array<[speedKmh: number, litresPer100km: number]>;

export interface ProviderRouteInput {
  /** All user points in order: origin, shaping points..., destination. */
  points: LatLng[];
  /** ISO datetime; provider default (now) when omitted. */
  departAt?: string;
  consumptionCurve?: ConsumptionCurve;
  vehicleWeightKg?: number;
  fuelType: 'petrol' | 'diesel';
}

export type ProviderRouteResult = RouteSummary & { fuelLitres?: number };

export interface RoutingProvider {
  name: 'tomtom' | 'mock';
  calculate(input: ProviderRouteInput): Promise<ProviderRouteResult>;
}
