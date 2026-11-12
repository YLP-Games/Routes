import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LatLng, Place, RouteResponse } from './shared/types';
import { calculateRoute, getHealth, getVehicle } from './lib/apiClient';
import {
  DEFAULT_VEHICLE_CHOICE,
  fuelLabel,
  hasConsumption,
  parseCustomConsumption,
  zoneLabel,
  type PriceMonthChoice,
  type RoutePoint,
  type VehicleChoice,
} from './lib/options';
import { formatDuration, formatRands } from './lib/format';
import { buildRouteRequest, tripKey } from './lib/routeRequest';
import { decodeTripLink, encodeTripLink } from './lib/tripLink';
import { ActionBar } from './components/ActionBar';
import { BrandMark, Icon } from './components/Icon';
import { RouteBuilder } from './components/RouteBuilder';
import { PlaceSearch } from './components/PlaceSearch';
import { DepartureTimePicker } from './components/DepartureTimePicker';
import { VehiclePicker } from './components/VehiclePicker';
import { PriceMonthToggle } from './components/PriceMonthToggle';
import { TripSummary } from './components/TripSummary';
import { FuelCostCard } from './components/FuelCostCard';
import { Warnings } from './components/Warnings';

// The map library is most of the app's JavaScript. As its own chunk it no longer holds up the
// planner panel; the download starts right away rather than waiting for the first render.
const mapModule = import('./components/MapView');
const MapView = lazy(() => mapModule.then((m) => ({ default: m.MapView })));

/** Matches the API limit on RouteRequest.points. */
export const MAX_POINTS = 150;

interface CalculatedTrip {
  response: RouteResponse;
  fuelDescription: string;
  /** tripKey of the inputs this result was calculated for. */
  key: string;
}

/** Keeps the planner usable if the map chunk fails to load (offline, blocked CDN, old browser). */
class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="map-placeholder" role="alert">
        The map could not be loaded. Reload the page to try again; you can still add places by searching.
      </div>
    );
  }
}

export function App() {
  // A trip link (#p=...&car=...) restores the planner: reloads keep the trip, and links can be shared.
  const [link] = useState(() => decodeTripLink(window.location.hash));

  const [points, setPoints] = useState<RoutePoint[]>(() => link?.points ?? []);
  const [departAt, setDepartAt] = useState<string | undefined>(link?.departAt);
  const [choice, setChoice] = useState<VehicleChoice>(() => ({
    ...DEFAULT_VEHICLE_CHOICE,
    fuel: link?.fuel ?? DEFAULT_VEHICLE_CHOICE.fuel,
    zone: link?.zone ?? DEFAULT_VEHICLE_CHOICE.zone,
    useCustom: link?.customConsumption !== undefined,
    customConsumption: link?.customConsumption ?? '',
  }));
  const [priceMonth, setPriceMonth] = useState<PriceMonthChoice>(link?.priceMonth ?? 'current');
  const [compareFastest, setCompareFastest] = useState(link?.compareFastest ?? true);
  /** The linked car while its details are still loading, so the URL keeps it meanwhile. */
  const [pendingVehicleId, setPendingVehicleId] = useState(link?.vehicleId);
  /** A link that holds a complete trip calculates itself once, as soon as it can. */
  const [autoCalculate, setAutoCalculate] = useState(
    () => (link?.points.length ?? 0) >= 2 && (link?.vehicleId !== undefined || link?.customConsumption !== undefined),
  );

  const [trip, setTrip] = useState<CalculatedTrip | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  /** Bumped when a new result should be brought into view. */
  const [revealCount, setRevealCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const shareTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    getHealth()
      .then((h) => setDemoMode(h?.provider === 'mock'))
      .catch(() => {
        // Health is informational only; calculate() surfaces real errors.
      });
    return () => {
      abortRef.current?.abort();
      clearTimeout(shareTimer.current);
    };
  }, []);

  // Load the car named in a trip link.
  useEffect(() => {
    const id = link?.vehicleId;
    if (!id) return;
    const controller = new AbortController();
    getVehicle(id, controller.signal)
      .then((vehicle) => {
        setChoice((c) => (c.vehicle || c.useCustom ? c : { ...c, vehicle }));
        setPendingVehicleId(undefined);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPendingVehicleId(undefined);
        setAutoCalculate(false);
        setNotice('The car in this link could not be loaded. Choose your car to continue.');
      });
    return () => controller.abort();
  }, [link]);

  // Keep the address bar in step with the trip, without adding history entries.
  useEffect(() => {
    const custom = choice.useCustom && parseCustomConsumption(choice.customConsumption) !== undefined ? choice.customConsumption : undefined;
    const fragment = encodeTripLink({
      points,
      vehicleId: choice.useCustom ? undefined : choice.vehicle?.id ?? pendingVehicleId,
      customConsumption: custom,
      fuel: choice.fuel,
      zone: choice.zone,
      priceMonth,
      compareFastest,
      departAt,
    });
    const url = fragment ? `#${fragment}` : window.location.pathname + window.location.search;
    window.history.replaceState(window.history.state, '', url);
  }, [points, choice, priceMonth, compareFastest, departAt, pendingVehicleId]);

  const changePoints = useCallback((updater: (prev: RoutePoint[]) => RoutePoint[]) => {
    setPoints((prev) => updater(prev));
    setNotice(null);
  }, []);

  /** Adds a point at `index` (default: the end), unless the route is full. */
  const insertPoint = useCallback(
    (p: RoutePoint, index?: number) => {
      if (points.length >= MAX_POINTS) {
        setNotice(`You can add at most ${MAX_POINTS} points.`);
        return;
      }
      changePoints((prev) => {
        if (prev.length >= MAX_POINTS) return prev;
        const at = index === undefined ? prev.length : Math.min(Math.max(index, 0), prev.length);
        return [...prev.slice(0, at), p, ...prev.slice(at)];
      });
    },
    [points.length, changePoints],
  );
  const addPoint = useCallback((p: LatLng) => insertPoint(p), [insertPoint]);
  const insertPointAt = useCallback((index: number, p: LatLng) => insertPoint(p, index), [insertPoint]);
  const addPlace = useCallback((place: Place) => insertPoint({ lat: place.lat, lng: place.lng, label: place.name }), [insertPoint]);
  // A dragged point is no longer the place it was named after, so it goes back to plain coordinates.
  const movePoint = useCallback(
    (index: number, p: LatLng) => changePoints((prev) => prev.map((q, i) => (i === index ? { lat: p.lat, lng: p.lng } : q))),
    [changePoints],
  );
  const removePoint = useCallback((index: number) => changePoints((prev) => prev.filter((_, i) => i !== index)), [changePoints]);
  const reorderPoint = useCallback(
    (index: number, direction: -1 | 1) =>
      changePoints((prev) => {
        const target = index + direction;
        if (target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      }),
    [changePoints],
  );
  const clearPoints = useCallback(() => {
    setPoints([]);
    setTrip(null);
    setError(null);
    setNotice(null);
  }, []);

  const canCalculate = points.length >= 2 && hasConsumption(choice);
  // The result on screen is out of date as soon as anything it depends on differs from what it was
  // calculated for: points, car, fuel, zone, departure, price month or the comparison option.
  const stale = trip !== null && trip.key !== tripKey({ points, departAt, choice, priceMonth, compareFastest });

  async function calculate(month: PriceMonthChoice = priceMonth, reveal = true) {
    if (!canCalculate) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const request = buildRouteRequest({ points, departAt, choice, priceMonth: month, compareFastest });

    setCalculating(true);
    setError(null);
    try {
      const response = await calculateRoute(request, controller.signal);
      if (controller.signal.aborted) return;
      setTrip({ response, fuelDescription: `${fuelLabel(choice.fuel)} · ${zoneLabel(choice.zone)}`, key: JSON.stringify(request) });
      if (reveal) setRevealCount((n) => n + 1);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Something went wrong while calculating the trip.');
    } finally {
      if (abortRef.current === controller) {
        setCalculating(false);
        abortRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (!autoCalculate || !canCalculate) return;
    setAutoCalculate(false);
    void calculate();
    // Runs once, when a linked trip first becomes calculable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCalculate, canCalculate]);

  // Bring a new result into view: on a phone, and on a short desktop window, it lands below the fold.
  useEffect(() => {
    if (revealCount === 0) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    resultsRef.current?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [revealCount]);

  function changePriceMonth(next: PriceMonthChoice) {
    setPriceMonth(next);
    // Re-price the trip on screen straight away, but only if nothing else is waiting to be applied:
    // otherwise a price toggle would silently recalculate for a different car or route.
    if (trip && canCalculate && !stale) void calculate(next, false);
  }

  async function copyLink() {
    clearTimeout(shareTimer.current);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus('copied');
    } catch {
      setShareStatus('failed');
    }
    shareTimer.current = setTimeout(() => setShareStatus('idle'), 4000);
  }

  const result = trip?.response;
  const searchLabel = points.length === 0 ? 'Search for a starting place' : points.length === 1 ? 'Search for a destination' : 'Search for another place to add';

  return (
    <div className="app">
      <aside className="panel" aria-label="Trip planner">
        <div className="panel-scroll">
        <header className="app-header">
          <div className="brand">
            <BrandMark />
            <h1>Routes</h1>
            {demoMode && <span className="badge">Demo mode</span>}
          </div>
          <p className="tagline">Draw your own route. Get the traffic ETA and the fuel cost in rands.</p>
        </header>

        <RouteBuilder points={points} onRemove={removePoint} onMove={reorderPoint} onClear={clearPoints}>
          <PlaceSearch onSelect={addPlace} label={searchLabel} />
          {notice && <p className="notice">{notice}</p>}
        </RouteBuilder>

        <VehiclePicker value={choice} onChange={setChoice} />

        <section className="card" aria-label="Trip options">
          <DepartureTimePicker value={departAt} onChange={setDepartAt} />
          <PriceMonthToggle value={priceMonth} onChange={changePriceMonth} />
          <label className="checkbox">
            <input type="checkbox" checked={compareFastest} onChange={(e) => setCompareFastest(e.target.checked)} />
            Compare with the fastest route
          </label>
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <strong>Couldn't calculate the trip.</strong> {error}
          </div>
        )}

        <div ref={resultsRef} className={`results ${stale ? 'results--stale' : ''}`} aria-live="polite" aria-busy={calculating}>
          {calculating && !result && <p className="muted loading">Calculating your trip…</p>}
          {result && (
            <>
              {stale && (
                <p className="stale-note">
                  {canCalculate
                    ? 'Your trip details changed since this was calculated — press Update trip to refresh the figures.'
                    : 'Your trip details changed since this was calculated. These figures are for the earlier trip.'}
                </p>
              )}
              <Warnings warnings={result.warnings} />
              <TripSummary yourRoute={result.yourRoute} fastestRoute={result.fastestRoute} />
              <FuelCostCard fuel={result.yourRoute.fuel} fuelDescription={trip?.fuelDescription} />
              <p className="muted hint--small source-line">
                Traffic data: {result.provider === 'tomtom' ? 'TomTom' : 'demo (simulated)'}. Fuel prices: South African regulated retail prices.
              </p>
              <div className="share-row">
                <button type="button" className="btn btn-secondary btn-small" onClick={() => void copyLink()}>
                  <Icon name={shareStatus === 'copied' ? 'check' : 'link'} />
                  Copy link to this trip
                </button>
                <span className="muted hint--small" aria-live="polite">
                  {shareStatus === 'copied' && 'Link copied.'}
                  {shareStatus === 'failed' && 'Could not copy. The link is in your address bar.'}
                </span>
              </div>
            </>
          )}
        </div>
        </div>

        <ActionBar
          pointCount={points.length}
          hasConsumption={hasConsumption(choice)}
          calculating={calculating}
          stale={stale}
          summary={result ? { duration: formatDuration(result.yourRoute.travelTimeSeconds), cost: formatRands(result.yourRoute.fuel.costRands) } : undefined}
          onCalculate={() => void calculate()}
        />
      </aside>

      <main className="map-area">
        {points.length === 0 && <p className="map-hint">Click the map to set your start, or search for a place.</p>}
        <MapBoundary>
          <Suspense
            fallback={
              <div className="map-placeholder" aria-live="polite">
                Loading map…
              </div>
            }
          >
            <MapView
              points={points}
              geometry={result?.yourRoute.geometry}
              fastestGeometry={result?.fastestRoute?.geometry}
              stale={stale}
              onAddPoint={addPoint}
              onInsertPoint={insertPointAt}
              onMovePoint={movePoint}
              onRemovePoint={removePoint}
            />
          </Suspense>
        </MapBoundary>
      </main>
    </div>
  );
}

export default App;
