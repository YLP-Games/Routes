import type { FuelType, RouteResponse, RouteWithFuel } from '../../shared/types';
import { HttpError } from '../errors';
import type { ProviderRouteInput, ProviderRouteResult, RoutingProvider } from '../providers/types';
import type { ParsedRouteRequest } from '../schemas';
import { buildConsumptionCurve, customConsumption, estimateFuel, type Consumption } from './fuelModel';
import type { FuelPriceService } from './fuelPrices';
import type { VehicleService } from './vehicles';

/** Approximate driver + light load added to the catalogue kerb mass. */
const DRIVER_LOAD_KG = 80;

export const MOCK_WARNING = 'Demo mode: no TomTom key, times are estimates';
export const DIESEL_WHOLESALE_WARNING =
  'Diesel prices are regulated wholesale prices; pump prices are set by retailers and are usually higher';

export const engineFuel = (fuel: FuelType): 'petrol' | 'diesel' => (fuel.startsWith('diesel') ? 'diesel' : 'petrol');

export interface PlannerDeps {
  provider: RoutingProvider;
  vehicles: VehicleService;
  fuelPrices: FuelPriceService;
  now: () => Date;
}

export async function planRoute(req: ParsedRouteRequest, deps: PlannerDeps): Promise<RouteResponse> {
  const warnings: string[] = [];
  const now = deps.now();
  if (deps.provider.name === 'mock') warnings.push(MOCK_WARNING);

  // Vehicle / consumption. Custom consumption wins over the vehicle's figures. It is the user's own
  // real-world figure, so unlike the catalogue's lab figures it is not scaled by REAL_WORLD_FACTOR.
  const vehicle = req.vehicleId ? deps.vehicles.getById(req.vehicleId) : undefined;
  let consumption: Consumption;
  const realWorld = req.customConsumptionL100km !== undefined;
  if (req.customConsumptionL100km !== undefined) {
    consumption = customConsumption(req.customConsumptionL100km);
    if (req.vehicleId && !vehicle) warnings.push(`Unknown vehicle "${req.vehicleId}" ignored; using custom consumption`);
  } else if (vehicle) {
    consumption = vehicle.consumption;
  } else {
    throw new HttpError(404, 'VEHICLE_NOT_FOUND', `Unknown vehicle "${req.vehicleId}"`);
  }
  const fuelType = engineFuel(req.fuel);
  if (vehicle && vehicle.fuelType !== fuelType) {
    warnings.push(`${vehicle.make} ${vehicle.model} runs on ${vehicle.fuelType}, but ${req.fuel} prices were requested`);
  }

  // Price (resolved before routing so bad months fail fast without a provider call).
  const month = deps.fuelPrices.resolveMonth(req.priceMonth, now);
  const { price, warning: priceWarning } = deps.fuelPrices.getPrice(month, req.zone, req.fuel);
  if (priceWarning) warnings.push(priceWarning);
  if (fuelType === 'diesel') warnings.push(DIESEL_WHOLESALE_WARNING);

  let departAt = req.departAt;
  if (departAt && new Date(departAt).getTime() < now.getTime() - 60_000) {
    warnings.push('Departure time is in the past; using the current time');
    departAt = undefined;
  }

  const base: Omit<ProviderRouteInput, 'points'> = {
    departAt,
    consumptionCurve: buildConsumptionCurve(consumption, { realWorld }),
    vehicleWeightKg: vehicle ? vehicle.massKg + DRIVER_LOAD_KG : undefined,
    fuelType,
  };
  const compare = req.compareFastest && req.points.length > 2;
  const [yours, fastest] = await Promise.all([
    deps.provider.calculate({ ...base, points: req.points }),
    compare ? deps.provider.calculate({ ...base, points: [req.points[0], req.points[req.points.length - 1]] }) : undefined,
  ]);

  const withFuel = ({ fuelLitres, ...summary }: ProviderRouteResult): RouteWithFuel => ({
    ...summary,
    fuel: estimateFuel({
      summary,
      consumption,
      realWorld,
      providerLitres: fuelLitres,
      price: { randsPerLitre: price.randsPerLitre, month: price.month },
    }),
  });

  const response: RouteResponse = { yourRoute: withFuel(yours), provider: deps.provider.name, warnings };
  if (fastest) response.fastestRoute = withFuel(fastest);
  return response;
}
