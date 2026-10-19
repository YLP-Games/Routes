import type { FuelEstimate, RouteSummary, Vehicle } from '../../shared/types';
import type { ConsumptionCurve } from '../providers/types';

/** Lab (NEDC/WLTP) figures understate real-world use; scale them up by this factor. */
export const REAL_WORLD_FACTOR = 1.15;

export type Consumption = Vehicle['consumption'];

export interface ConsumptionOptions {
  /**
   * True when the figures are already real-world (a consumption the user entered), so
   * REAL_WORLD_FACTOR is not applied. False (default) for manufacturer lab figures.
   */
  realWorld?: boolean;
}

const factorFor = ({ realWorld = false }: ConsumptionOptions = {}) => (realWorld ? 1 : REAL_WORLD_FACTOR);

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Derive urban/extra-urban figures when only a manufacturer (lab) combined figure is known. */
export function deriveConsumption(combined: number): Consumption {
  return { urban: combined * 1.3, extraUrban: combined * 0.85, combined };
}

/**
 * Figures for a real-world consumption the user entered (use with `realWorld: true`). The entered
 * value is the steady-cruise figure (extra-urban, ~70-90 km/h), so an open-road trip without traffic
 * lands on it; slow, urban and congested driving still costs more (urban = 1.3x).
 */
export function customConsumption(l100km: number): Consumption {
  return { urban: l100km * 1.3, extraUrban: l100km, combined: l100km };
}

/**
 * Speed -> L/100km curve from consumption figures; lab figures are scaled to real-world use
 * (REAL_WORLD_FACTOR), real-world figures (`realWorld: true`) are used as they are.
 * The curve falls to a minimum and rises monotonically after it, and fuel flow per hour
 * (speed x L/100km) strictly increases with speed, as TomTom's consumption model requires.
 */
export function buildConsumptionCurve(c: Consumption, opts: ConsumptionOptions = {}): ConsumptionCurve {
  const factor = factorFor(opts);
  const { urban, extraUrban } = c;
  const mid = (urban + extraUrban) / 2;
  const raw: ConsumptionCurve = [
    [10, urban * 1.3],
    [30, urban],
    [50, mid],
    [70, extraUrban],
    [90, extraUrban * 1.02],
    [110, extraUrban * 1.18],
    [130, extraUrban * 1.4],
  ];
  const curve: ConsumptionCurve = raw.map(([s, l]) => [s, round2(l * factor)]);

  // Enforce the valley shape: non-increasing up to the minimum, non-decreasing after it.
  let minIdx = 0;
  curve.forEach(([, l], i) => { if (l < curve[minIdx][1]) minIdx = i; });
  for (let i = minIdx - 1; i >= 0; i--) curve[i][1] = Math.max(curve[i][1], curve[i + 1][1]);
  for (let i = minIdx + 1; i < curve.length; i++) curve[i][1] = Math.max(curve[i][1], curve[i - 1][1]);

  // Enforce strictly increasing fuel flow (L/h) with speed.
  for (let i = 1; i < curve.length; i++) {
    const [s, l] = curve[i];
    const [ps, pl] = curve[i - 1];
    if (s * l <= ps * pl) curve[i][1] = Math.ceil(((ps * pl) / s) * 1.01 * 100) / 100;
  }
  return curve;
}

/** Curve from a single combined figure (custom consumption). */
export function curveFromCombined(combined: number): ConsumptionCurve {
  return buildConsumptionCurve(deriveConsumption(combined));
}

/**
 * Fuel estimate when the provider has no consumption figure. Blends urban vs extra-urban
 * by average speed (<=30 km/h fully urban, >=80 km/h fully extra-urban, linear between) and
 * adds a stop-go penalty of (delay / travel time) x 0.3 x the urban figure, then applies
 * REAL_WORLD_FACTOR unless the figures are already real-world.
 */
export function fallbackLitres(
  summary: Pick<RouteSummary, 'distanceMeters' | 'travelTimeSeconds' | 'trafficDelaySeconds'>,
  c: Consumption,
  opts: ConsumptionOptions = {},
): { litres: number; litresPer100km: number } {
  const km = summary.distanceMeters / 1000;
  if (km <= 0) return { litres: 0, litresPer100km: 0 };
  const hours = summary.travelTimeSeconds / 3600;
  const avgKmh = hours > 0 ? km / hours : Infinity;
  const urbanShare = avgKmh <= 30 ? 1 : avgKmh >= 80 ? 0 : (80 - avgKmh) / 50;
  const base = c.urban * urbanShare + c.extraUrban * (1 - urbanShare);
  const delayRatio = summary.travelTimeSeconds > 0
    ? Math.min(1, Math.max(0, summary.trafficDelaySeconds / summary.travelTimeSeconds))
    : 0;
  const stopGo = delayRatio * 0.3 * c.urban;
  const litresPer100km = (base + stopGo) * factorFor(opts);
  return { litres: (km * litresPer100km) / 100, litresPer100km };
}

export interface EstimateFuelInput {
  summary: Pick<RouteSummary, 'distanceMeters' | 'travelTimeSeconds' | 'trafficDelaySeconds'>;
  consumption: Consumption;
  /** True for a user-entered (real-world) figure: no REAL_WORLD_FACTOR in the fallback model. */
  realWorld?: boolean;
  /** Litres from the provider's consumption model, if it returned one. */
  providerLitres?: number;
  price: { randsPerLitre: number; month: string };
}

/** Combine litres (provider model or fallback) with a price into a FuelEstimate. */
export function estimateFuel({ summary, consumption, realWorld, providerLitres, price }: EstimateFuelInput): FuelEstimate {
  const km = summary.distanceMeters / 1000;
  const useProvider = typeof providerLitres === 'number' && Number.isFinite(providerLitres) && providerLitres >= 0;
  let litres: number;
  let litresPer100km: number;
  if (useProvider) {
    litres = providerLitres;
    litresPer100km = km > 0 ? (litres / km) * 100 : 0;
  } else {
    ({ litres, litresPer100km } = fallbackLitres(summary, consumption, { realWorld }));
  }
  const cost = litres * price.randsPerLitre;
  return {
    litres: round2(litres),
    litresPer100km: round2(litresPer100km),
    priceRandsPerLitre: price.randsPerLitre,
    priceMonth: price.month,
    costRands: round2(cost),
    costPerKmRands: km > 0 ? round2(cost / km) : 0,
    method: useProvider ? 'provider-model' : 'fallback-average',
  };
}
