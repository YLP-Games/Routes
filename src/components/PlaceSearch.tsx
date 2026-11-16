import { useEffect, useState } from 'react';
import type { Place } from '../shared/types';
import { searchPlaces } from '../lib/apiClient';

export interface PlaceSearchProps {
  onSelect: (place: Place) => void;
  /** Label of the search box; it changes as the route fills up. */
  label?: string;
  disabled?: boolean;
  /** Debounce for the search box, in ms. */
  debounceMs?: number;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: Place[] }
  | { status: 'error'; message: string };

/** Search box that adds a named place to the route, for people who would rather type than click the map. */
export function PlaceSearch({ onSelect, label = 'Search for a place', disabled = false, debounceMs = 300 }: PlaceSearchProps) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearch({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearch({ status: 'loading' });
      searchPlaces(q, controller.signal)
        .then((results) => setSearch({ status: 'done', results }))
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setSearch({ status: 'error', message: err instanceof Error ? err.message : 'Search failed.' });
        });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, debounceMs]);

  function select(place: Place) {
    onSelect(place);
    setQuery('');
    setSearch({ status: 'idle' });
  }

  return (
    <div className="vehicle-search">
      <label className="field">
        <span className="field-label">{label}</span>
        <input
          type="search"
          placeholder="e.g. Sandton, Durban, O.R. Tambo"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </label>
      {search.status === 'loading' && <p className="muted hint--small">Searching…</p>}
      {search.status === 'error' && (
        <p className="error-text" role="alert">
          {search.message}
        </p>
      )}
      {search.status === 'done' && search.results.length === 0 && (
        <p className="muted hint--small">No places found. Try another name, or click the map instead.</p>
      )}
      {search.status === 'done' && search.results.length > 0 && (
        <ul className="vehicle-results" aria-label="Matching places">
          {search.results.map((place, i) => (
            <li key={`${place.lat},${place.lng},${i}`}>
              <button type="button" className="vehicle-result" onClick={() => select(place)}>
                <span className="vehicle-result-name">{place.name}</span>
                {place.detail && <span className="vehicle-result-meta">{place.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
