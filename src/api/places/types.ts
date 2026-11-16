import type { Place } from '../../shared/types';

/** Finds places by name so they can be added as route points. */
export interface PlaceSearchProvider {
  name: 'tomtom' | 'offline';
  search(query: string): Promise<Place[]>;
}

export const MAX_PLACE_RESULTS = 6;
