import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng, RouteResponse } from './shared/types';
import { calculateRoute, getHealth } from './lib/apiClient';
import { DEFAULT_VEHICLE_CHOICE, fuelLabel, hasConsumption, zoneLabel, type VehicleChoice } from './lib/options';
import { buildRouteRequest } from './lib/routeRequest';
import { MapView } from './components/MapView';
import { RouteBuilder } from './components/RouteBuilder';
import { DepartureTimePicker } from './components/DepartureTimePicker';
import { VehiclePicker } from './components/VehiclePicker';
import { PriceMonthToggle, type PriceMonthChoice } from './components/PriceMonthToggle';
import { TripSummary } from './components/TripSummary';
import { FuelCostCard } from './components/FuelCostCard';
import { Warnings } from './components/Warnings';

/** Matches the API limit on RouteRequest.points. */
export const MAX_POINTS = 150;

interface CalculatedTrip {
  response: RouteResponse;
  fuelDescription: string;
}

export function App() {
  const [points, setPoints] = useState<LatLng[]>([]);
  const [departAt, setDepartAt] = useState<string | undefined>(undefined);
  const [choice, setChoice] = useState<VehicleChoice>(DEFAULT_VEHICLE_CHOICE);
  const [priceMonth, setPriceMonth] = useState<PriceMonthChoice>('current');
  const [compareFastest, setCompareFastest] = useState(true);

  const [trip, setTrip] = useState<CalculatedTrip | null>(null);
  const [stale, setStale] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getHealth()
      .then((h) => setDemoMode(h?.provider === 'mock'))
      .catch(() => {
        // Health is informational only; calculate() surfaces real errors.
      });
    return () => abortRef.current?.abort();
  }, []);

  const changePoints = useCallback((updater: (prev: LatLng[]) => LatLng[]) => {
    setPoints((prev) => updater(prev));
    setStale(true);
    setNotice(null);
  }, []);

  const addPoint = useCallback(
    (p: LatLng) => {
      if (points.length >= MAX_POINTS) {
        setNotice(`You can add at most ${MAX_POINTS} points.`);
        return;
      }
      changePoints((prev) => (prev.length >= MAX_POINTS ? prev : [...prev, p]));
    },
    [points.length, changePoints],
  );
  const movePoint = useCallback(
    (index: number, p: LatLng) => changePoints((prev) => prev.map((q, i) => (i === index ? p : q))),
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
    setStale(false);
    setError(null);
    setNotice(null);
  }, []);

  const canCalculate = points.length >= 2 && hasConsumption(choice);

  async function calculate(month: PriceMonthChoice = priceMonth) {
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
      setTrip({ response, fuelDescription: `${fuelLabel(choice.fuel)} · ${zoneLabel(choice.zone)}` });
      setStale(false);
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

  function changePriceMonth(next: PriceMonthChoice) {
    setPriceMonth(next);
    if (trip && canCalculate) void calculate(next);
  }

  const result = trip?.response;

  return (
    <div className="app">
      <aside className="panel" aria-label="Trip planner">
        <header className="app-header">
          <h1>Routes</h1>
          <p className="tagline">Draw your own route. Get the real traffic ETA and fuel cost in rands.</p>
          {demoMode && <span className="badge">Demo mode</span>}
        </header>

        <RouteBuilder
          points={points}
          hasConsumption={hasConsumption(choice)}
          calculating={calculating}
          onRemove={removePoint}
          onMove={reorderPoint}
          onClear={clearPoints}
          onCalculate={() => void calculate()}
        >
          {notice && <p className="hint hint--small">{notice}</p>}
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

        <div className="results" aria-live="polite" aria-busy={calculating}>
          {calculating && !result && <p className="muted loading">Calculating your trip…</p>}
          {result && (
            <>
              <Warnings warnings={result.warnings} />
              {stale && <p className="stale-note">Your points changed — press Calculate trip to update.</p>}
              <TripSummary yourRoute={result.yourRoute} fastestRoute={result.fastestRoute} />
              <FuelCostCard fuel={result.yourRoute.fuel} fuelDescription={trip?.fuelDescription} />
              <p className="muted hint--small source-line">
                Traffic data: {result.provider === 'tomtom' ? 'TomTom' : 'demo (simulated)'}. Fuel prices: South African regulated retail prices.
              </p>
            </>
          )}
        </div>
      </aside>

      <main className="map-area">
        <MapView
          points={points}
          geometry={result?.yourRoute.geometry}
          fastestGeometry={result?.fastestRoute?.geometry}
          onAddPoint={addPoint}
          onMovePoint={movePoint}
          onRemovePoint={removePoint}
        />
      </main>
    </div>
  );
}

export default App;
