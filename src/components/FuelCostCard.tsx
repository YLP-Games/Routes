import type { FuelEstimate } from '../shared/types';
import { formatLitres, formatMonth, formatRands } from '../lib/format';

export interface FuelCostCardProps {
  fuel: FuelEstimate;
  /** e.g. "Petrol 95 · Inland" */
  fuelDescription?: string;
}

export function FuelCostCard({ fuel, fuelDescription }: FuelCostCardProps) {
  return (
    <section className="card" aria-labelledby="fuel-heading">
      <h2 id="fuel-heading">Fuel cost</h2>
      <div className="headline">
        <span className="headline-value" data-testid="fuel-cost">
          {formatRands(fuel.costRands)}
        </span>
        <span className="headline-label">{formatRands(fuel.costPerKmRands)} per km</span>
      </div>

      <dl className="stats">
        <div className="stat">
          <dt>Fuel used</dt>
          <dd>{formatLitres(fuel.litres)}</dd>
        </div>
        <div className="stat">
          <dt>Consumption</dt>
          <dd>{fuel.litresPer100km.toFixed(1)} L/100 km</dd>
        </div>
        <div className="stat stat--wide">
          <dt>Price</dt>
          <dd>
            {formatRands(fuel.priceRandsPerLitre)}/L · {formatMonth(fuel.priceMonth)}
            {fuelDescription && <span className="muted"> · {fuelDescription}</span>}
          </dd>
        </div>
      </dl>

      <p className="note">
        Estimate — real use varies with driving style, load and aircon.
        {fuel.method === 'fallback-average' && ' (simplified estimate)'}
      </p>
    </section>
  );
}
