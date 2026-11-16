import type { Place } from '../../shared/types';
import { ProviderError } from '../errors';
import { TtlCache } from '../ttlCache';
import { MAX_PLACE_RESULTS, type PlaceSearchProvider } from './types';

const DEFAULT_BASE_URL = 'https://api.tomtom.com/search/2/search';
const REQUEST_TIMEOUT_MS = 8_000;
/** Place names do not change by the minute, and people retype the same few letters. */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_ENTRIES = 500;

interface TomTomSearchResult {
  type?: string;
  poi?: { name?: string };
  address?: { freeformAddress?: string; municipality?: string; countrySubdivision?: string };
  position?: { lat?: number; lon?: number };
}
interface TomTomSearchResponse { results?: TomTomSearchResult[] }

export interface TomTomPlaceSearchOptions {
  apiKey: string;
  baseUrl?: string;
  /** ISO 3166 country codes to search in. Default South Africa. */
  countrySet?: string;
}

/** Builds the Fuzzy Search URL. Exported for tests; the URL contains the API key, never log it. */
export function buildPlaceSearchUrl(query: string, opts: TomTomPlaceSearchOptions): string {
  const params = new URLSearchParams({
    key: opts.apiKey,
    typeahead: 'true',
    limit: String(MAX_PLACE_RESULTS),
    countrySet: opts.countrySet ?? 'ZA',
    language: 'en-GB',
  });
  return `${opts.baseUrl ?? DEFAULT_BASE_URL}/${encodeURIComponent(query)}.json?${params.toString()}`;
}

/** Maps a Fuzzy Search response onto places; results without a usable position are dropped. */
export function parsePlaceSearchResponse(body: TomTomSearchResponse): Place[] {
  const places: Place[] = [];
  for (const r of body.results ?? []) {
    const lat = r.position?.lat;
    const lng = r.position?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const address = r.address?.freeformAddress;
    const name = r.poi?.name ?? address;
    if (!name) continue;
    const region = [r.address?.municipality, r.address?.countrySubdivision].filter(Boolean).join(', ');
    const detail = r.poi?.name ? address : region && !name.includes(region) ? region : undefined;
    places.push(detail ? { name, detail, lat, lng } : { name, lat, lng });
  }
  return places.slice(0, MAX_PLACE_RESULTS);
}

export function createTomTomPlaceSearch(opts: TomTomPlaceSearchOptions): PlaceSearchProvider {
  if (!opts.apiKey) throw new Error('TomTom API key is required');
  const cache = new TtlCache<Place[]>(CACHE_TTL_MS, CACHE_ENTRIES);

  return {
    name: 'tomtom',
    async search(query) {
      const key = query.trim().toLowerCase();
      const cached = cache.get(key);
      if (cached) return cached;

      let res: Response;
      try {
        res = await fetch(buildPlaceSearchUrl(query.trim(), opts), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (err) {
        const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
        throw new ProviderError(`TomTom place search ${reason}`);
      }
      if (!res.ok) throw new ProviderError(`TomTom place search failed (${res.status})`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ProviderError('TomTom place search returned an unreadable response');
      }
      const places = parsePlaceSearchResponse((body ?? {}) as TomTomSearchResponse);
      cache.set(key, places);
      return places;
    },
  };
}
