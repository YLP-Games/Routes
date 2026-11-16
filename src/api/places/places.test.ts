import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../errors';
import { GAZETTEER, createOfflinePlaceSearch } from './offline';
import { buildPlaceSearchUrl, createTomTomPlaceSearch, parsePlaceSearchResponse } from './tomtom';
import { MAX_PLACE_RESULTS } from './types';

afterEach(() => vi.unstubAllGlobals());

describe('offline place search', () => {
  const search = createOfflinePlaceSearch();

  it('finds places by name, old name and abbreviation, ignoring case and punctuation', async () => {
    expect((await search.search('sandton'))[0]).toEqual({ name: 'Sandton', detail: 'Johannesburg, Gauteng', lat: -26.1076, lng: 28.0567 });
    expect((await search.search('Port Elizabeth'))[0].name).toBe('Gqeberha');
    expect((await search.search('nelspruit'))[0].name).toBe('Mbombela');
    expect((await search.search('or tambo'))[0].name).toBe('O.R. Tambo International Airport');
    expect((await search.search('BELA BELA'))[0].name).toBe('Bela-Bela');
  });

  it('puts names that start with the query ahead of other matches', async () => {
    const names = (await search.search('cape')).map((p) => p.name);
    expect(names.slice(0, 2)).toEqual(['Cape Town', 'Cape Town International Airport']);
    // "cape" also matches every place in the Western / Eastern / Northern Cape by region.
    expect(names).toHaveLength(MAX_PLACE_RESULTS);
  });

  it('requires every word to match and returns nothing for no match', async () => {
    expect((await search.search('airport durban')).map((p) => p.name)).toEqual(['King Shaka International Airport']);
    expect(await search.search('atlantis xyz')).toEqual([]);
    expect(await search.search('  ')).toEqual([]);
  });

  it('never exposes aliases in results', async () => {
    for (const p of await search.search('pretoria')) expect(p).not.toHaveProperty('aliases');
  });
});

describe('bundled places.za.json', () => {
  it('has unique names with coordinates inside South Africa', () => {
    expect(GAZETTEER.length).toBeGreaterThanOrEqual(60);
    expect(new Set(GAZETTEER.map((p) => p.name)).size).toBe(GAZETTEER.length);
    for (const p of GAZETTEER) {
      expect(p.lat).toBeGreaterThan(-35.5);
      expect(p.lat).toBeLessThan(-22);
      expect(p.lng).toBeGreaterThan(16);
      expect(p.lng).toBeLessThan(33.5);
      expect(p.detail?.length).toBeGreaterThan(0);
    }
  });
});

/** Trimmed TomTom Fuzzy Search response: an address, a POI, a locality and an entry without a position. */
const sample = {
  summary: { query: 'sandton city', numResults: 4 },
  results: [
    {
      type: 'POI',
      poi: { name: 'Sandton City' },
      address: { freeformAddress: '83 Rivonia Road, Sandhurst, Sandton, 2196', municipality: 'Sandton', countrySubdivision: 'Gauteng' },
      position: { lat: -26.10857, lon: 28.05263 },
    },
    {
      type: 'Street',
      address: { freeformAddress: 'Rivonia Road, Sandton', municipality: 'Sandton', countrySubdivision: 'Gauteng' },
      position: { lat: -26.0921, lon: 28.0571 },
    },
    {
      type: 'Geography',
      address: { freeformAddress: 'Sandton, Gauteng', municipality: 'Sandton', countrySubdivision: 'Gauteng' },
      position: { lat: -26.1076, lon: 28.0567 },
    },
    { type: 'POI', poi: { name: 'No position' }, address: { freeformAddress: 'Nowhere' } },
  ],
};

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('TomTom place search', () => {
  const KEY = 'test-key-123';

  it('asks Fuzzy Search for typeahead results in South Africa', () => {
    const url = new URL(buildPlaceSearchUrl('sandton city & co/', { apiKey: KEY }));
    expect(url.origin).toBe('https://api.tomtom.com');
    expect(url.pathname).toBe('/search/2/search/sandton%20city%20%26%20co%2F.json');
    expect(Object.fromEntries(url.searchParams)).toEqual({ key: KEY, typeahead: 'true', limit: '6', countrySet: 'ZA', language: 'en-GB' });
    expect(new URL(buildPlaceSearchUrl('x', { apiKey: KEY, countrySet: 'ZA,NA,BW' })).searchParams.get('countrySet')).toBe('ZA,NA,BW');
  });

  it('maps results onto places and drops entries without a position', () => {
    expect(parsePlaceSearchResponse(sample)).toEqual([
      { name: 'Sandton City', detail: '83 Rivonia Road, Sandhurst, Sandton, 2196', lat: -26.10857, lng: 28.05263 },
      { name: 'Rivonia Road, Sandton', detail: 'Sandton, Gauteng', lat: -26.0921, lng: 28.0571 },
      { name: 'Sandton, Gauteng', lat: -26.1076, lng: 28.0567 }, // region already in the name
    ]);
    expect(parsePlaceSearchResponse({})).toEqual([]);
  });

  it('caches a query, ignoring case and surrounding spaces', async () => {
    const fetchMock = stubFetch(200, sample);
    const search = createTomTomPlaceSearch({ apiKey: KEY });
    const first = await search.search('Sandton City');
    expect(await search.search('  sandton city ')).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await search.search('sandton');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps failures to a 502 ProviderError without leaking the key, and does not cache them', async () => {
    stubFetch(403, 'Forbidden');
    const search = createTomTomPlaceSearch({ apiKey: KEY });
    const err = await search.search('sandton').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(502);
    expect((err as ProviderError).message).toBe('TomTom place search failed (403)');
    expect((err as ProviderError).message).not.toContain(KEY);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(search.search('sandton')).rejects.toThrow(/could not be reached/);
    stubFetch(200, '<html>');
    await expect(search.search('sandton')).rejects.toThrow(/unreadable/);
    stubFetch(200, sample);
    expect(await search.search('sandton')).toHaveLength(3);
  });
});
