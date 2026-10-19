import type { Vehicle } from '../../shared/types';
import vehiclesJson from '../data/vehicles.sa.json';

const byMakeModel = (a: Vehicle, b: Vehicle) =>
  a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.variant.localeCompare(b.variant);

export function createVehicleService(data: Vehicle[]) {
  const sorted = [...data].sort(byMakeModel);
  const index = new Map(sorted.map((v) => [v.id, v]));

  /** Case-insensitive search across make, model and variant; every word must match. Empty q returns all. */
  function search(q?: string): Vehicle[] {
    const terms = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [...sorted];
    return sorted.filter((v) => {
      const hay = `${v.make} ${v.model} ${v.variant}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  function getById(id: string): Vehicle | undefined {
    return index.get(id);
  }

  return { search, getById };
}

export type VehicleService = ReturnType<typeof createVehicleService>;

export const VEHICLES = vehiclesJson as Vehicle[];
export const vehicles = createVehicleService(VEHICLES);
