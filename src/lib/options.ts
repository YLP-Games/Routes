/** Fuel / zone option lists and the vehicle-choice model shared by VehiclePicker and App. */
import type { FuelType, PriceZone, Vehicle } from '../shared/types';

export const FUEL_OPTIONS: { value: FuelType; label: string }[] = [
  { value: 'petrol93', label: 'Petrol 93' },
  { value: 'petrol95', label: 'Petrol 95' },
  { value: 'diesel50ppm', label: 'Diesel 50ppm' },
  { value: 'diesel500ppm', label: 'Diesel 500ppm' },
];

export const ZONE_OPTIONS: { value: PriceZone; label: string }[] = [
  { value: 'inland', label: 'Inland' },
  { value: 'coastal', label: 'Coastal' },
];

export const fuelLabel = (fuel: FuelType) => FUEL_OPTIONS.find((o) => o.value === fuel)?.label ?? fuel;
export const zoneLabel = (zone: PriceZone) => ZONE_OPTIONS.find((o) => o.value === zone)?.label ?? zone;

/** Default regulated grade for a vehicle's fuel type. */
export function defaultFuelFor(fuelType: Vehicle['fuelType']): FuelType {
  return fuelType === 'diesel' ? 'diesel50ppm' : 'petrol95';
}

export const MIN_CONSUMPTION = 1;
export const MAX_CONSUMPTION = 40;

/** What the user has chosen in the VehiclePicker. */
export interface VehicleChoice {
  vehicle: Vehicle | null;
  useCustom: boolean;
  /** Raw text of the custom consumption input (L/100 km). */
  customConsumption: string;
  fuel: FuelType;
  zone: PriceZone;
}

export const DEFAULT_VEHICLE_CHOICE: VehicleChoice = {
  vehicle: null,
  useCustom: false,
  customConsumption: '',
  fuel: 'petrol95',
  zone: 'inland',
};

/** Parsed custom consumption, or undefined when empty / out of range. */
export function parseCustomConsumption(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n < MIN_CONSUMPTION || n > MAX_CONSUMPTION) return undefined;
  return n;
}

/** True when the choice yields a usable consumption figure (vehicle or valid custom value). */
export function hasConsumption(choice: VehicleChoice): boolean {
  return choice.useCustom ? parseCustomConsumption(choice.customConsumption) !== undefined : choice.vehicle !== null;
}

export function vehicleName(v: Vehicle): string {
  return [v.make, v.model, v.variant].filter(Boolean).join(' ');
}
