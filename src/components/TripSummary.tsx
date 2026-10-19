import type { RouteWithFuel } from '../shared/types';
import { formatDistance, formatDuration, formatRands, formatTime } from '../lib/format';

export interface TripSummaryProps {
  yourRoute: RouteWithFuel;
  fastestRoute?: RouteWithFuel;
}

/** Traffic delay above this many seconds is highlighted. */
export const DELAY_HIGHLIGHT_SECONDS = 5 * 60;

/** Sentence comparing the user's route with the provider's fastest route. */
export function comparisonText(yours: RouteWithFuel, fastest: RouteWithFuel): string {
  const dt = yours.travelTimeSeconds - fastest.travelTimeSeconds;
  const dc = yours.fuel.costRands - fastest.fuel.costRands;
  const sameTime = Math.abs(dt) < 30;
  const sameCost = Math.abs(dc) < 0.005;
  if (sameTime && sameCost) return 'Your route takes about the same time and costs about the same as the fastest route.';

  const timePart = sameTime ? 'about as fast' : `${formatDuration(Math.abs(dt))} ${dt > 0 ? 'slower' : 'faster'}`;
  const costPart = sameCost ? 'costs about the same as' : `${formatRands(Math.abs(dc))} ${dc > 0 ? 'more' : 'cheaper'} than`;
  return `Your route is ${timePart} and ${costPart} the fastest route.`;
}

export function TripSummary({ yourRoute, fastestRoute }: TripSummaryProps) {
  const delayed = yourRoute.trafficDelaySeconds > DELAY_HIGHLIGHT_SECONDS;

  return (
    <section className="card" aria-labelledby="trip-heading">
      <h2 id="trip-heading">Trip</h2>
      <div className="headline">
        <span className="headline-value" data-testid="travel-time">
          {formatDuration(yourRoute.travelTimeSeconds)}
        </span>
        <span className="headline-label">with traffic · {formatDistance(yourRoute.distanceMeters)}</span>
      </div>

      <dl className="stats">
        <div className="stat">
          <dt>Arrive</dt>
          <dd>{formatTime(yourRoute.arrivalTime)}</dd>
        </div>
        <div className="stat">
          <dt>Depart</dt>
          <dd>{formatTime(yourRoute.departureTime)}</dd>
        </div>
        <div className="stat">
          <dt>Distance</dt>
          <dd>{formatDistance(yourRoute.distanceMeters)}</dd>
        </div>
        <div className="stat">
          <dt>Without traffic</dt>
          <dd>{formatDuration(yourRoute.noTrafficTravelTimeSeconds)}</dd>
        </div>
        <div className={`stat ${delayed ? 'stat--warning' : ''}`} data-testid="traffic-delay">
          <dt>Traffic delay</dt>
          <dd>{yourRoute.trafficDelaySeconds > 0 ? `+${formatDuration(yourRoute.trafficDelaySeconds)}` : 'None'}</dd>
        </div>
      </dl>

      {fastestRoute && (
        <div className="comparison">
          <p className="comparison-text">{comparisonText(yourRoute, fastestRoute)}</p>
          <p className="muted hint--small">
            Fastest route: {formatDuration(fastestRoute.travelTimeSeconds)} · {formatDistance(fastestRoute.distanceMeters)} ·{' '}
            {formatRands(fastestRoute.fuel.costRands)}
          </p>
        </div>
      )}
    </section>
  );
}
