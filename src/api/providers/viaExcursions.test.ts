import { describe, expect, it } from 'vitest';
import type { LatLng } from '../../shared/types';
import { CIRCLE_MARGIN_M, distanceM, excursionMeters, viaCircleRadii } from './viaExcursions';

/** `n` evenly spaced steps from a to b, excluding a. */
function to(a: LatLng, b: LatLng, n: number): LatLng[] {
  return Array.from({ length: n }, (_, k) => ({
    lat: a.lat + ((b.lat - a.lat) * (k + 1)) / n,
    lng: a.lng + ((b.lng - a.lng) * (k + 1)) / n,
  }));
}

const origin = { lat: -26.2, lng: 28.0 };
const junction = { lat: -26.2, lng: 28.005 }; // ~500 m east of the origin
const dest = { lat: -26.2, lng: 28.01 };
// A dead-end side street running ~330 m south of the junction, and a click at its end.
const deadEnd = { lat: -26.203, lng: 28.005 };
const click = { lat: -26.2031, lng: 28.0051 };

describe('via excursions', () => {
  it('finds the out-and-back into a dead end and sizes the circle to reach the main road', () => {
    const legs = [
      [origin, ...to(origin, junction, 10), ...to(junction, deadEnd, 6)],
      [deadEnd, ...to(deadEnd, junction, 6), ...to(junction, dest, 10)],
    ];
    const radii = viaCircleRadii([origin, click, dest], legs);
    expect([...radii.keys()]).toEqual([1]);
    expect(radii.get(1)).toBe(Math.ceil(distanceM(click, junction) + CIRCLE_MARGIN_M));
    expect(excursionMeters(legs.flat())).toBeCloseTo(2 * distanceM(junction, deadEnd), 0);
  });

  it('leaves a via the route passes straight through alone', () => {
    const legs = [
      [origin, ...to(origin, junction, 10)],
      [junction, ...to(junction, dest, 10)],
    ];
    expect(viaCircleRadii([origin, { lat: -26.2001, lng: 28.005 }, dest], legs).size).toBe(0);
    expect(excursionMeters(legs.flat())).toBe(0);
  });

  it('finds a U-turn across a divided road (out on one carriageway, back on the other)', () => {
    // East along the northern carriageway, turn at the far end, back west ~33 m south, then off south.
    const turn = { lat: -26.2, lng: 28.008 };
    const back = { lat: -26.2003, lng: 28.008 };
    const exit = { lat: -26.2003, lng: 28.004 };
    const legs = [
      [origin, ...to(origin, turn, 16)],
      [turn, back, ...to(back, exit, 8), ...to(exit, { lat: -26.21, lng: 28.004 }, 10)],
    ];
    const radii = viaCircleRadii([origin, turn, legs[1][legs[1].length - 1]], legs);
    expect(radii.size).toBe(1);
    // Wide enough to reach the carriageway near where the route turned off (~400 m back).
    expect(radii.get(1)).toBeGreaterThan(400);
    expect(radii.get(1)).toBeLessThan(500);
    expect(excursionMeters(legs.flat())).toBeGreaterThan(700);
  });

  it('ignores a loop ramp that crosses its own road at a different level', () => {
    // East, then a loop ramp that swings south and comes back north, passing over the eastbound
    // road ~11 m from one of its vertices at right angles.
    const ramp = [
      { lat: -26.2, lng: 28.0055 },
      { lat: -26.2004, lng: 28.0058 },
      { lat: -26.2009, lng: 28.0055 },
      { lat: -26.201, lng: 28.005 },
      { lat: -26.2008, lng: 28.0045 },
      { lat: -26.2004, lng: 28.0045 },
      { lat: -26.1999, lng: 28.0045 },
      { lat: -26.199, lng: 28.0045 },
      { lat: -26.195, lng: 28.0045 },
    ];
    const legs = [
      [origin, ...to(origin, { lat: -26.2, lng: 28.0045 }, 9), junction, ...ramp.slice(0, 3)],
      [ramp[2], ...ramp.slice(3)],
    ];
    expect(viaCircleRadii([origin, ramp[2], ramp[ramp.length - 1]], legs).size).toBe(0);
    expect(excursionMeters(legs.flat())).toBe(0);
  });

  it('treats a very long out-and-back as deliberate', () => {
    const farEnd = { lat: -26.23, lng: 28.005 }; // ~3.3 km down the side road, 6.7 km there and back
    const legs = [
      [origin, ...to(origin, junction, 10), ...to(junction, farEnd, 30)],
      [farEnd, ...to(farEnd, junction, 30), ...to(junction, dest, 10)],
    ];
    expect(viaCircleRadii([origin, farEnd, dest], legs).size).toBe(0);
    expect(excursionMeters(legs.flat())).toBe(0);

    const veryFar = { lat: -26.26, lng: 28.005 }; // 13 km there and back, beyond the search window
    const longLegs = [
      [origin, ...to(origin, junction, 10), ...to(junction, veryFar, 60)],
      [veryFar, ...to(veryFar, junction, 60), ...to(junction, dest, 10)],
    ];
    expect(viaCircleRadii([origin, veryFar, dest], longLegs).size).toBe(0);
    expect(excursionMeters(longLegs.flat())).toBe(0);
  });

  it('handles several vias independently', () => {
    const deadEnd2 = { lat: -26.203, lng: 28.008 };
    const junction2 = { lat: -26.2, lng: 28.008 };
    const legs = [
      [origin, ...to(origin, junction, 10), ...to(junction, deadEnd, 6)],
      [deadEnd, ...to(deadEnd, junction, 6), ...to(junction, { lat: -26.2, lng: 28.0065 }, 3)], // ends on the road
      [{ lat: -26.2, lng: 28.0065 }, ...to({ lat: -26.2, lng: 28.0065 }, junction2, 3), ...to(junction2, deadEnd2, 6)],
      [deadEnd2, ...to(deadEnd2, junction2, 6), ...to(junction2, dest, 4)],
    ];
    const points = [origin, click, { lat: -26.2001, lng: 28.0065 }, deadEnd2, dest];
    expect([...viaCircleRadii(points, legs).keys()]).toEqual([1, 3]);
  });
});
