export interface ActionBarProps {
  /** How many route points have been placed. */
  pointCount: number;
  /** True when a vehicle or a valid custom consumption has been chosen. */
  hasConsumption: boolean;
  calculating?: boolean;
  /** True when a result is on screen that no longer matches the inputs. */
  stale?: boolean;
  /** Headline figures of the result on screen, shown while they are current. */
  summary?: { duration: string; cost: string };
  onCalculate: () => void;
}

/**
 * The planner's one main action, pinned to the bottom of the panel so it is always in reach, with
 * a line beside it that says what is still missing or, once calculated, the answer.
 */
export function ActionBar({ pointCount, hasConsumption, calculating = false, stale = false, summary, onCalculate }: ActionBarProps) {
  const enoughPoints = pointCount >= 2;
  const disabled = !enoughPoints || !hasConsumption || calculating;
  let reason = '';
  if (!enoughPoints) reason = pointCount === 0 ? 'Add a start and an end point on the map.' : 'Add an end point on the map.';
  else if (!hasConsumption) reason = 'Choose your car or enter your own consumption.';

  return (
    <div className="action-bar">
      <div className="action-status">
        {reason ? (
          <p id="calc-reason">{reason}</p>
        ) : stale ? (
          <p>Trip details changed since the last calculation.</p>
        ) : summary ? (
          <p>
            <strong data-testid="bar-summary">
              {summary.duration} · {summary.cost}
            </strong>
            With traffic, fuel only
          </p>
        ) : (
          <p>Ready when you are.</p>
        )}
      </div>
      <button type="button" className="btn btn-primary" disabled={disabled} onClick={onCalculate} aria-describedby={reason ? 'calc-reason' : undefined}>
        {calculating ? 'Calculating…' : stale ? 'Update trip' : 'Calculate trip'}
      </button>
    </div>
  );
}
