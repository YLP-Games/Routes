import type { ReactNode } from 'react';
import type { LatLng } from '../shared/types';
import { formatLatLng } from '../lib/format';

export interface RouteBuilderProps {
  points: LatLng[];
  /** True when a vehicle or a valid custom consumption has been chosen. */
  hasConsumption: boolean;
  calculating?: boolean;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onClear: () => void;
  onCalculate: () => void;
  /** Extra controls rendered between the point list and the Calculate button. */
  children?: ReactNode;
}

function pointName(index: number, count: number): string {
  if (index === 0) return 'Start';
  if (index === count - 1) return 'End';
  return `Via ${index}`;
}

function pointBadge(index: number, count: number): string {
  if (index === 0) return 'A';
  if (index === count - 1) return 'B';
  return String(index);
}

export function RouteBuilder({
  points,
  hasConsumption,
  calculating = false,
  onRemove,
  onMove,
  onClear,
  onCalculate,
  children,
}: RouteBuilderProps) {
  const enoughPoints = points.length >= 2;
  const disabled = !enoughPoints || !hasConsumption || calculating;
  let reason = '';
  if (!enoughPoints) reason = points.length === 0 ? 'Add a start and an end point on the map.' : 'Add an end point on the map.';
  else if (!hasConsumption) reason = 'Choose your car or enter your own consumption.';

  return (
    <section className="card" aria-labelledby="route-heading">
      <div className="card-header">
        <h2 id="route-heading">Your route</h2>
        {points.length > 0 && (
          <button type="button" className="btn btn-ghost btn-small" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      <p className="hint">Click the map to add points in order — start, any via points, then your destination. Drag markers to adjust.</p>

      {points.length > 0 && (
        <ol className="point-list">
          {points.map((p, i) => {
            const name = pointName(i, points.length);
            return (
              <li key={i} className="point-row">
                <span className={`point-badge point-badge--${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'via'}`} aria-hidden="true">
                  {pointBadge(i, points.length)}
                </span>
                <span className="point-text">
                  <span className="point-name">{name}</span>
                  <span className="point-coords">{formatLatLng(p)}</span>
                </span>
                <span className="point-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move ${name} up`}
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => onMove(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move ${name} down`}
                    title="Move down"
                    disabled={i === points.length - 1}
                    onClick={() => onMove(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--danger"
                    aria-label={`Remove ${name}`}
                    title="Remove"
                    onClick={() => onRemove(i)}
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {children}

      <button type="button" className="btn btn-primary btn-block" disabled={disabled} onClick={onCalculate} aria-describedby={reason ? 'calc-reason' : undefined}>
        {calculating ? 'Calculating…' : 'Calculate trip'}
      </button>
      {reason && (
        <p id="calc-reason" className="hint hint--small">
          {reason}
        </p>
      )}
    </section>
  );
}
