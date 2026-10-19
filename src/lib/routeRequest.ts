/** Builds the POST /api/route body from the planner's UI state. Pure; shared by App and tests. */
import type { LatLng, PriceMonthSelector, RouteRequest } from '../shared/types';
import { parseCustomConsumption, type VehicleChoice } from './options';

export interface RouteRequestInput {
  points: LatLng[];
  /** ISO datetime, or undefined for "leave now". */
  departAt: string | undefined;
  choice: VehicleChoice;
  priceMonth: PriceMonthSelector;
  compareFastest: boolean;
}

/**
 * Always sets compareFastest, and sets exactly one of vehicleId / customConsumptionL100km
 * (callers check hasConsumption(choice) first).
 */
export function buildRouteRequest({ points, departAt, choice, priceMonth, compareFastest }: RouteRequestInput): RouteRequest {
  const request: RouteRequest = {
    points,
    departAt,
    fuel: choice.fuel,
    zone: choice.zone,
    priceMonth,
    compareFastest,
  };
  if (choice.useCustom) request.customConsumptionL100km = parseCustomConsumption(choice.customConsumption);
  else if (choice.vehicle) request.vehicleId = choice.vehicle.id;
  return request;
}
