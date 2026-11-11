import { distanceMeters, insertionIndex } from '../../lib/geo';
import { DEFAULT_VEHICLE_CHOICE, type VehicleChoice } from '../../lib/options';
import { buildRouteRequest, tripKey, type RouteRequestInput } from '../../lib/routeRequest';
import { decodeTripLink, encodeTripLink, type TripLinkState } from '../../lib/tripLink';
import { hilux, polo } from './fixtures';

const jhb = { lat: -26.2041, lng: 28.0473 };
const midrand = { lat: -25.9992, lng: 28.1263 };
const pta = { lat: -25.7479, lng: 28.2293 };
const rustenburg = { lat: -25.6676, lng: 27.2421 };

describe('geo', () => {
  it('measures great-circle distance', () => {
    expect(distanceMeters(jhb, jhb)).toBe(0);
    expect(distanceMeters(jhb, pta) / 1000).toBeGreaterThan(52);
    expect(distanceMeters(jhb, pta) / 1000).toBeLessThan(56);
  });

  it('inserts a clicked point into the leg it lies on', () => {
    // Midrand sits between Johannesburg and Pretoria.
    expect(insertionIndex([jhb, pta], midrand)).toBe(1);
    // On Johannesburg -> Pretoria -> Rustenburg, Midrand belongs on the first leg...
    expect(insertionIndex([jhb, pta, rustenburg], midrand)).toBe(1);
    // ...and a point west of Pretoria on the second.
    expect(insertionIndex([jhb, pta, rustenburg], { lat: -25.72, lng: 27.9 })).toBe(2);
    expect(insertionIndex([jhb, midrand, pta], { lat: -25.87, lng: 28.18 })).toBe(2);
  });

  it('appends when there is no leg yet', () => {
    expect(insertionIndex([], jhb)).toBe(0);
    expect(insertionIndex([jhb], pta)).toBe(1);
  });
});

describe('tripKey', () => {
  const base: RouteRequestInput = {
    points: [jhb, pta],
    departAt: undefined,
    choice: { ...DEFAULT_VEHICLE_CHOICE, vehicle: polo },
    priceMonth: 'current',
    compareFastest: true,
  };
  const withChoice = (patch: Partial<VehicleChoice>): RouteRequestInput => ({ ...base, choice: { ...base.choice, ...patch } });

  it('is stable for inputs that would get the same answer', () => {
    expect(tripKey({ ...base, points: [{ ...jhb }, { ...pta }] })).toBe(tripKey(base));
    // A place name is display-only: it is not sent and does not change the trip.
    expect(tripKey({ ...base, points: [{ ...jhb, label: 'Johannesburg' }, pta] })).toBe(tripKey(base));
    expect(buildRouteRequest({ ...base, points: [{ ...jhb, label: 'Johannesburg' }, pta] }).points[0]).toEqual(jhb);
    // 7.4 and 7.40 are the same consumption.
    expect(tripKey(withChoice({ useCustom: true, customConsumption: '7.40' }))).toBe(tripKey(withChoice({ useCustom: true, customConsumption: '7,4' })));
  });

  it('changes with anything that changes the answer', () => {
    const key = tripKey(base);
    const variants: RouteRequestInput[] = [
      { ...base, points: [pta, jhb] },
      { ...base, points: [jhb, midrand, pta] },
      { ...base, departAt: '2026-11-12T05:30:00.000Z' },
      { ...base, priceMonth: 'previous' },
      { ...base, compareFastest: false },
      withChoice({ vehicle: hilux }),
      withChoice({ vehicle: null }),
      withChoice({ fuel: 'petrol93' }),
      withChoice({ zone: 'coastal' }),
      withChoice({ useCustom: true, customConsumption: '7.4' }),
    ];
    for (const v of variants) expect(tripKey(v)).not.toBe(key);
    expect(new Set(variants.map(tripKey)).size).toBe(variants.length);
  });
});

describe('trip links', () => {
  const full: TripLinkState = {
    points: [{ ...jhb, label: 'Johannesburg' }, midrand, { ...pta, label: '83 Church St; Pretoria ~ CBD' }],
    vehicleId: 'vw-polo-vivo-1-4-trendline',
    fuel: 'petrol93',
    zone: 'coastal',
    priceMonth: 'previous',
    compareFastest: false,
    departAt: '2026-11-12T05:30:00.000Z',
  };

  it('round-trips a full trip', () => {
    const decoded = decodeTripLink(`#${encodeTripLink(full)}`);
    expect(decoded).toEqual({
      ...full,
      // Separator characters in a name are replaced so the link stays parseable.
      points: [full.points[0], midrand, { ...pta, label: '83 Church St, Pretoria , CBD' }],
    });
  });

  it('keeps links short: defaults are left out and coordinates are rounded to about a metre', () => {
    const link = encodeTripLink({ points: [{ lat: -26.204103456, lng: 28.047305123 }, pta], fuel: 'petrol95', zone: 'inland', priceMonth: 'current', compareFastest: true });
    expect(decodeURIComponent(link)).toBe('p=-26.2041,28.04731;-25.7479,28.2293');
    expect(encodeTripLink({ points: [], fuel: 'petrol95', zone: 'inland', priceMonth: 'current', compareFastest: true })).toBe('');
  });

  it('carries a custom consumption instead of a car', () => {
    const link = encodeTripLink({ ...full, vehicleId: 'ignored', customConsumption: ' 7,4 ' });
    const decoded = decodeTripLink(link)!;
    expect(decoded.customConsumption).toBe('7,4');
    expect(decoded.vehicleId).toBeUndefined();
  });

  it('returns null when the fragment holds no trip', () => {
    expect(decodeTripLink('')).toBeNull();
    expect(decodeTripLink('#')).toBeNull();
    expect(decodeTripLink('#section-2')).toBeNull();
  });

  it('drops anything invalid instead of trusting the link', () => {
    const decoded = decodeTripLink(
      '#p=-26.2,28.0;91,28;abc,def;-26.1;-26,28,7;,;-25.7,28.2~<b>End</b>&car=../../etc/passwd&c=999&f=rocket&z=moon&m=2019-01&cmp=maybe&t=tomorrow',
    )!;
    expect(decoded.points).toEqual([{ lat: -26.2, lng: 28.0 }, { lat: -25.7, lng: 28.2, label: '<b>End</b>' }]);
    expect(decoded).toMatchObject({ fuel: 'petrol95', zone: 'inland', priceMonth: 'current', compareFastest: true });
    expect(decoded.vehicleId).toBeUndefined();
    expect(decoded.customConsumption).toBeUndefined();
    expect(decoded.departAt).toBeUndefined();
  });

  it('caps the number of points and the length of a name', () => {
    const many = Array.from({ length: 200 }, (_, i) => `${-26 - i / 1000},28`).join(';');
    expect(decodeTripLink(`p=${many}`)!.points).toHaveLength(150);
    expect(decodeTripLink(`p=-26,28~${'x'.repeat(300)}`)!.points[0].label).toHaveLength(80);
  });
});
