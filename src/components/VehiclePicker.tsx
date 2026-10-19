import { useEffect, useId, useState } from 'react';
import type { FuelType, PriceZone, Vehicle } from '../shared/types';
import { searchVehicles } from '../lib/apiClient';
import {
  FUEL_OPTIONS,
  MAX_CONSUMPTION,
  MIN_CONSUMPTION,
  ZONE_OPTIONS,
  defaultFuelFor,
  parseCustomConsumption,
  vehicleName,
  type VehicleChoice,
} from '../lib/options';

export interface VehiclePickerProps {
  value: VehicleChoice;
  onChange: (next: VehicleChoice) => void;
  /** Debounce for the search box, in ms. */
  debounceMs?: number;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: Vehicle[] }
  | { status: 'error'; message: string };

export function VehiclePicker({ value, onChange, debounceMs = 300 }: VehiclePickerProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearch({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearch({ status: 'loading' });
      searchVehicles(q, controller.signal)
        .then((results) => setSearch({ status: 'done', results }))
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setSearch({ status: 'error', message: err instanceof Error ? err.message : 'Search failed.' });
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, debounceMs]);

  const update = (patch: Partial<VehicleChoice>) => onChange({ ...value, ...patch });

  function selectVehicle(v: Vehicle) {
    update({ vehicle: v, useCustom: false, fuel: defaultFuelFor(v.fuelType) });
    setQuery('');
    setSearch({ status: 'idle' });
  }

  const customInvalid = value.useCustom && value.customConsumption.trim() !== '' && parseCustomConsumption(value.customConsumption) === undefined;

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Your car</h2>

      {!value.useCustom && (
        <>
          {value.vehicle && (
            <div className="selected-vehicle">
              <div>
                <div className="selected-vehicle-name">{vehicleName(value.vehicle)}</div>
                <div className="muted">
                  {value.vehicle.consumption.combined.toFixed(1)} L/100 km combined · {value.vehicle.fuelType === 'diesel' ? 'Diesel' : 'Petrol'}
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => update({ vehicle: null })}>
                Change
              </button>
            </div>
          )}
          {!value.vehicle && (
            <div className="vehicle-search">
              <label className="field">
                <span className="field-label">Search make or model</span>
                <input
                  type="search"
                  placeholder="e.g. Polo Vivo, Hilux, Corolla"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
              </label>
              {search.status === 'loading' && <p className="muted hint--small">Searching…</p>}
              {search.status === 'error' && (
                <p className="error-text" role="alert">
                  {search.message}
                </p>
              )}
              {search.status === 'done' && search.results.length === 0 && <p className="muted hint--small">No cars found. Try another search or enter your own consumption.</p>}
              {search.status === 'done' && search.results.length > 0 && (
                <ul className="vehicle-results" aria-label="Matching cars">
                  {search.results.map((v) => (
                    <li key={v.id}>
                      <button type="button" className="vehicle-result" onClick={() => selectVehicle(v)}>
                        <span className="vehicle-result-name">{vehicleName(v)}</span>
                        <span className="vehicle-result-meta">
                          {v.consumption.combined.toFixed(1)} L/100 km · {v.yearFrom}
                          {v.yearTo ? `–${v.yearTo}` : '+'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <label className="checkbox">
        <input type="checkbox" checked={value.useCustom} onChange={(e) => update({ useCustom: e.target.checked })} />
        Enter my own consumption
      </label>

      {value.useCustom && (
        <label className="field">
          <span className="field-label">Consumption (L/100 km)</span>
          <input
            type="number"
            inputMode="decimal"
            min={MIN_CONSUMPTION}
            max={MAX_CONSUMPTION}
            step={0.1}
            placeholder="e.g. 7.5"
            value={value.customConsumption}
            aria-invalid={customInvalid || undefined}
            onChange={(e) => update({ customConsumption: e.target.value })}
          />
          {customInvalid && (
            <span className="error-text">
              Enter a value between {MIN_CONSUMPTION} and {MAX_CONSUMPTION} L/100 km.
            </span>
          )}
        </label>
      )}

      <div className="field-row">
        <label className="field">
          <span className="field-label">Fuel</span>
          <select value={value.fuel} onChange={(e) => update({ fuel: e.target.value as FuelType })}>
            {FUEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Price zone</span>
          <select value={value.zone} onChange={(e) => update({ zone: e.target.value as PriceZone })}>
            {ZONE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
