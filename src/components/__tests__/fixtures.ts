import type { RouteResponse, RouteWithFuel, Vehicle } from '../../shared/types';

export const yourRoute: RouteWithFuel = {
  distanceMeters: 32_430,
  travelTimeSeconds: 2_880, // 48 min
  noTrafficTravelTimeSeconds: 2_100, // 35 min
  trafficDelaySeconds: 780, // 13 min
  departureTime: '2026-10-19T07:30:00',
  arrivalTime: '2026-10-19T08:18:00',
  geometry: [
    { lat: -26.2041, lng: 28.0473 },
    { lat: -26.1, lng: 28.05 },
    { lat: -25.95, lng: 28.1 },
  ],
  fuel: {
    litres: 2.4013,
    litresPer100km: 7.4,
    priceRandsPerLitre: 22.86,
    priceMonth: '2026-10',
    costRands: 54.89,
    costPerKmRands: 1.69,
    method: 'provider-model',
  },
};

export const fastestRoute: RouteWithFuel = {
  ...yourRoute,
  distanceMeters: 28_100,
  travelTimeSeconds: 2_520, // 42 min
  noTrafficTravelTimeSeconds: 1_980,
  trafficDelaySeconds: 540,
  arrivalTime: '2026-10-19T08:12:00',
  geometry: [
    { lat: -26.2041, lng: 28.0473 },
    { lat: -25.95, lng: 28.1 },
  ],
  fuel: { ...yourRoute.fuel, litres: 1.86, costRands: 42.49, costPerKmRands: 1.51 },
};

export const sampleResponse: RouteResponse = {
  yourRoute,
  fastestRoute,
  provider: 'mock',
  warnings: ['Demo mode: traffic data is simulated.'],
};

export const polo: Vehicle = {
  id: 'vw-polo-vivo-1.4',
  make: 'Volkswagen',
  model: 'Polo Vivo',
  variant: '1.4 Trendline',
  yearFrom: 2018,
  fuelType: 'petrol',
  engineCc: 1398,
  massKg: 1050,
  consumption: { urban: 7.8, extraUrban: 4.9, combined: 5.9 },
  source: 'test',
};

export const hilux: Vehicle = {
  id: 'toyota-hilux-2.4gd6',
  make: 'Toyota',
  model: 'Hilux',
  variant: '2.4 GD-6 Raider',
  yearFrom: 2016,
  yearTo: 2024,
  fuelType: 'diesel',
  engineCc: 2393,
  massKg: 1900,
  consumption: { urban: 9.4, extraUrban: 6.8, combined: 7.8 },
  source: 'test',
};

/** Minimal Response-like object for fetch stubs. */
export function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}
