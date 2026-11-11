/** Small geometry helpers for the route editor. */
import type { LatLng } from '../shared/types';

const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two points, metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Where to insert `p` into an ordered route so the path grows least: the index of the leg whose
 * detour through `p` is shortest, plus one. Used when the user clicks on the route line to add a
 * via point, so the new point lands between the right neighbours rather than at the end.
 * With fewer than two points there is no leg, and the point is appended.
 */
export function insertionIndex(points: LatLng[], p: LatLng): number {
  if (points.length < 2) return points.length;
  let best = 1;
  let bestDetour = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const detour = distanceMeters(points[i], p) + distanceMeters(p, points[i + 1]) - distanceMeters(points[i], points[i + 1]);
    if (detour < bestDetour) {
      bestDetour = detour;
      best = i + 1;
    }
  }
  return best;
}
