/** Builds the POST /api/route body from the planner's UI state. Pure; shared by App and tests. */
import type { PriceMonthSelector, RouteRequest } from '../shared/types';
import { parseCustomConsumption, type RoutePoint, type VehicleChoice } from './options';

export interface RouteRequestInput {
  points: RoutePoint[];
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
    points: points.map(({ lat, lng }) => ({ lat, lng })), // place names stay in the browser
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

/**
 * Identity of a calculation: two UI states with the same key would get the same answer. The planner
 * stores the key of the trip on screen and compares it with the current inputs, so any change that
 * matters (points, car, fuel, zone, departure, price month, comparison) marks the result out of date.
 */
export function tripKey(input: RouteRequestInput): string {
  return JSON.stringify(buildRouteRequest(input));
}
