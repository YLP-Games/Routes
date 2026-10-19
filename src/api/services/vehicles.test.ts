import { describe, expect, it } from 'vitest';
import { VEHICLES, vehicles } from './vehicles';

describe('vehicle service', () => {
  it('returns all vehicles sorted by make/model for an empty query', () => {
    const all = vehicles.search('');
    expect(all).toHaveLength(VEHICLES.length);
    expect(vehicles.search()).toHaveLength(VEHICLES.length);
    for (let i = 1; i < all.length; i++) {
      const prev = `${all[i - 1].make}|${all[i - 1].model}`;
      const cur = `${all[i].make}|${all[i].model}`;
      expect(prev.localeCompare(cur)).toBeLessThanOrEqual(0);
    }
  });

  it('searches case-insensitively across make, model and variant', () => {
    expect(vehicles.search('HILUX').every((v) => v.model === 'Hilux')).toBe(true);
    expect(vehicles.search('hilux').length).toBeGreaterThanOrEqual(2);
    expect(vehicles.search('toyota').every((v) => v.make === 'Toyota')).toBe(true);
    expect(vehicles.search('2.8GD-6').map((v) => v.id)).toContain('toyota-hilux-2-8gd6-legend-dc-4x4-at');
    expect(vehicles.search('hilux 2.4').map((v) => v.id)).toEqual(['toyota-hilux-2-4gd6-raider-dc']);
    expect(vehicles.search('  polo   vivo ').every((v) => v.model === 'Polo Vivo')).toBe(true);
    expect(vehicles.search('no-such-car')).toEqual([]);
  });

  it('gets by id', () => {
    expect(vehicles.getById('suzuki-swift-1-2-gl')?.make).toBe('Suzuki');
    expect(vehicles.getById('nope')).toBeUndefined();
  });
});

describe('bundled vehicles.sa.json', () => {
  it('has ~40 well-formed vehicles with unique kebab-case ids', () => {
    expect(VEHICLES.length).toBeGreaterThanOrEqual(35);
    const ids = new Set<string>();
    for (const v of VEHICLES) {
      expect(v.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ids.has(v.id)).toBe(false);
      ids.add(v.id);
      expect(['petrol', 'diesel']).toContain(v.fuelType);
      expect(v.engineCc).toBeGreaterThan(600);
      expect(v.engineCc).toBeLessThan(5000);
      expect(v.massKg).toBeGreaterThan(600);
      expect(v.massKg).toBeLessThan(3500);
      const { urban, extraUrban, combined } = v.consumption;
      expect(combined).toBeGreaterThan(3);
      expect(combined).toBeLessThan(15);
      expect(urban).toBeGreaterThan(combined);
      expect(extraUrban).toBeLessThan(combined);
      expect(v.source.length).toBeGreaterThan(0);
    }
  });
});
