/**
 * A trip as a URL fragment, so a planned route survives a page reload and can be sent to someone.
 * Example: #p=-26.2041,28.0473~Johannesburg;-25.7479,28.2293&car=vw-polo-vivo-1-4-trendline&m=previous
 * Everything is validated on the way in: a link is untrusted input.
 */
import type { FuelType, PriceZone } from '../shared/types';
import { FUEL_OPTIONS, ZONE_OPTIONS, parseCustomConsumption, type PriceMonthChoice, type RoutePoint } from './options';

export interface TripLinkState {
  points: RoutePoint[];
  /** Catalogue vehicle id; absent when a custom consumption is used or nothing is chosen. */
  vehicleId?: string;
  /** Raw custom consumption text, when "enter my own consumption" is on. */
  customConsumption?: string;
  fuel: FuelType;
  zone: PriceZone;
  priceMonth: PriceMonthChoice;
  compareFastest: boolean;
  /** ISO datetime, or undefined for "leave now". */
  departAt?: string;
}

export const TRIP_LINK_DEFAULTS = { fuel: 'petrol95', zone: 'inland', priceMonth: 'current', compareFastest: true } as const;

const MAX_POINTS = 150;
const MAX_LABEL = 80;
const coord = (n: number) => String(Number(n.toFixed(5)));
/** ';' separates points and '~' starts a label, so neither may appear inside one. */
const cleanLabel = (label: string) => label.replace(/[;~]/g, ',').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);

/** The fragment (without '#') for a trip, or '' when there is nothing worth keeping. */
export function encodeTripLink(state: TripLinkState): string {
  const params = new URLSearchParams();
  if (state.points.length > 0) {
    params.set(
      'p',
      state.points
        .map((p) => {
          const label = p.label ? cleanLabel(p.label) : '';
          return `${coord(p.lat)},${coord(p.lng)}${label ? `~${label}` : ''}`;
        })
        .join(';'),
    );
  }
  if (state.customConsumption !== undefined) params.set('c', state.customConsumption.trim());
  else if (state.vehicleId) params.set('car', state.vehicleId);
  if (state.fuel !== TRIP_LINK_DEFAULTS.fuel) params.set('f', state.fuel);
  if (state.zone !== TRIP_LINK_DEFAULTS.zone) params.set('z', state.zone);
  if (state.priceMonth !== TRIP_LINK_DEFAULTS.priceMonth) params.set('m', state.priceMonth);
  if (!state.compareFastest) params.set('cmp', '0');
  if (state.departAt) params.set('t', state.departAt);
  return params.toString();
}

function decodePoint(raw: string): RoutePoint | null {
  const tilde = raw.indexOf('~');
  const [latText, lngText, ...rest] = (tilde === -1 ? raw : raw.slice(0, tilde)).split(',');
  if (rest.length > 0 || !latText?.trim() || !lngText?.trim()) return null;
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const label = tilde === -1 ? '' : cleanLabel(raw.slice(tilde + 1));
  return label ? { lat, lng, label } : { lat, lng };
}

/**
 * Reads a fragment (with or without '#') back into trip state. Returns null when it holds no trip;
 * otherwise every field is present, with defaults for anything missing or invalid. Invalid points
 * are dropped rather than failing the whole link.
 */
export function decodeTripLink(hash: string): TripLinkState | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text) return null;
  const params = new URLSearchParams(text);
  const known = ['p', 'car', 'c', 'f', 'z', 'm', 'cmp', 't'];
  if (!known.some((k) => params.has(k))) return null;

  const points = (params.get('p') ?? '')
    .split(';')
    .filter(Boolean)
    .map(decodePoint)
    .filter((p): p is RoutePoint => p !== null)
    .slice(0, MAX_POINTS);

  const state: TripLinkState = { points, ...TRIP_LINK_DEFAULTS };

  const custom = params.get('c');
  const car = params.get('car');
  if (custom !== null && parseCustomConsumption(custom) !== undefined) state.customConsumption = custom.trim();
  else if (car && /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(car)) state.vehicleId = car;

  const fuel = params.get('f');
  if (FUEL_OPTIONS.some((o) => o.value === fuel)) state.fuel = fuel as FuelType;
  const zone = params.get('z');
  if (ZONE_OPTIONS.some((o) => o.value === zone)) state.zone = zone as PriceZone;
  if (params.get('m') === 'previous') state.priceMonth = 'previous';
  if (params.get('cmp') === '0') state.compareFastest = false;

  const t = params.get('t');
  if (t) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) state.departAt = d.toISOString();
  }
  return state;
}
