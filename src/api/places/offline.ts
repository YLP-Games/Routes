import type { Place } from '../../shared/types';
import placesJson from '../data/places.za.json';
import { MAX_PLACE_RESULTS, type PlaceSearchProvider } from './types';

export interface GazetteerEntry extends Place {
  /** Other names people search by (old names, abbreviations). */
  aliases?: string[];
}

export const GAZETTEER = placesJson as GazetteerEntry[];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Search over the bundled list of South African towns and airports, used when no TomTom key is
 * configured. Every word of the query must appear in the name, an alias or the region; places whose
 * name or alias starts with the query come first.
 */
export function createOfflinePlaceSearch(entries: GazetteerEntry[] = GAZETTEER): PlaceSearchProvider {
  const index = entries.map((e) => {
    const names = [e.name, ...(e.aliases ?? [])].map(norm);
    return { entry: e, names, hay: [...names, norm(e.detail ?? '')].join(' | ') };
  });

  return {
    name: 'offline',
    async search(query) {
      const q = norm(query);
      const terms = q.split(' ').filter(Boolean);
      if (terms.length === 0) return [];
      return index
        .filter((i) => terms.every((t) => i.hay.includes(t)))
        .map((i, order) => ({ i, order, rank: i.names.some((n) => n === q) ? 0 : i.names.some((n) => n.startsWith(q)) ? 1 : 2 }))
        .sort((a, b) => a.rank - b.rank || a.order - b.order)
        .slice(0, MAX_PLACE_RESULTS)
        .map(({ i }) => ({ name: i.entry.name, detail: i.entry.detail, lat: i.entry.lat, lng: i.entry.lng }));
    },
  };
}
