import type { ReactNode } from 'react';
import { formatLatLng } from '../lib/format';
import type { RoutePoint } from '../lib/options';
import { Icon } from './Icon';

export interface RouteBuilderProps {
  points: RoutePoint[];
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onClear: () => void;
  /** Controls rendered under the point list (place search, notices). */
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

/** The ordered list of route points, as a line of stops from start to end. */
export function RouteBuilder({ points, onRemove, onMove, onClear, children }: RouteBuilderProps) {
  return (
    <section className="card" aria-labelledby="route-heading">
      <div className="card-header">
        <h2 id="route-heading">Your route</h2>
        {points.length > 0 && (
          <button type="button" className="btn btn-secondary btn-small" onClick={onClear}>
            Clear route
          </button>
        )}
      </div>

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
                  <span className="point-coords" title={p.label ? `${p.label} (${formatLatLng(p)})` : undefined}>
                    {p.label ?? formatLatLng(p)}
                  </span>
                </span>
                <span className="point-actions">
                  <button type="button" className="icon-btn" aria-label={`Move ${name} up`} title="Move up" disabled={i === 0} onClick={() => onMove(i, -1)}>
                    <Icon name="arrow-up" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move ${name} down`}
                    title="Move down"
                    disabled={i === points.length - 1}
                    onClick={() => onMove(i, 1)}
                  >
                    <Icon name="arrow-down" />
                  </button>
                  <button type="button" className="icon-btn icon-btn--danger" aria-label={`Remove ${name}`} title="Remove" onClick={() => onRemove(i)}>
                    <Icon name="close" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {children}

      <p className="hint hint--small">
        Search for a place or click the map to add points in order. Drag a marker to move it, or click the line to add a via point in between.
      </p>
    </section>
  );
}
