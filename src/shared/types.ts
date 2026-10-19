/**
 * Shared contract between the frontend (src/components) and the backend (src/api).
 * Changes here affect both sides; coordinate before editing.
 */

/** A WGS84 coordinate. */
export type LatLng = { lat: number; lng: number };
/** South African regulated fuel grades. */
export type FuelType = 'petrol93' | 'petrol95' | 'diesel50ppm' | 'diesel500ppm';
/** Fuel price zone: inland (Gauteng) or coastal (magisterial districts at the coast). */
export type PriceZone = 'inland' | 'coastal';
/** Which month's regulated prices to use. */
export type PriceMonthSelector = 'current' | 'previous' | string; // or 'YYYY-MM'

/** A vehicle from the catalogue, with manufacturer consumption figures. */
export interface Vehicle {
  id: string; make: string; model: string; variant: string;
  yearFrom: number; yearTo?: number;
  fuelType: 'petrol' | 'diesel';
  engineCc: number; massKg: number;
  consumption: { urban: number; extraUrban: number; combined: number }; // L/100km, manufacturer figures
  source: string;
}

/** A regulated retail fuel price for one month, zone and grade. */
export interface FuelPrice {
  month: string;          // 'YYYY-MM'
  effectiveDate: string;  // 'YYYY-MM-DD'
  zone: PriceZone; fuel: FuelType;
  randsPerLitre: number; source: string;
}

/** Body of POST /api/route. */
export interface RouteRequest {
  points: LatLng[];                 // user's route: origin, shaping points..., destination (min 2, max 150)
  departAt?: string;                // ISO datetime; default now
  vehicleId?: string;
  customConsumptionL100km?: number; // overrides vehicle combined figure
  fuel: FuelType;
  zone?: PriceZone;                 // default 'inland'
  priceMonth?: PriceMonthSelector;  // default 'current'
  compareFastest?: boolean;         // also compute the provider's own fastest route origin->destination
}

/** Distance, timing and geometry of a calculated route. */
export interface RouteSummary {
  distanceMeters: number;
  travelTimeSeconds: number;          // with traffic
  noTrafficTravelTimeSeconds: number;
  trafficDelaySeconds: number;
  departureTime: string;              // ISO
  arrivalTime: string;                // ISO
  geometry: LatLng[];
}

/** Fuel use and cost for a route. */
export interface FuelEstimate {
  litres: number; litresPer100km: number;
  priceRandsPerLitre: number; priceMonth: string;
  costRands: number; costPerKmRands: number;
  method: 'provider-model' | 'fallback-average';
}

/** A route summary with its fuel estimate. */
export type RouteWithFuel = RouteSummary & { fuel: FuelEstimate };

/** Response of POST /api/route. */
export interface RouteResponse {
  yourRoute: RouteWithFuel;
  fastestRoute?: RouteWithFuel;
  provider: 'tomtom' | 'mock';
  warnings: string[];
}

/** Error body returned with any non-2xx response. */
export interface ApiError { error: { code: string; message: string } }
