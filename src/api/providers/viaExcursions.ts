import type { LatLng } from '../../shared/types';

/**
 * Detects the detours a routing engine makes to touch a via point exactly: when a click lands on a
 * dead-end side street or the far carriageway, the route drives out to the point and comes back
 * (an out-and-back or a small loop) before carrying on from where it left.
 */

/** Vertices this close are the same road position (the engine repeats a node's coordinates). */
const SAME_NODE_M = 3;
/** Widest gap across a divided road's median for an out-and-back on its two carriageways. */
const CARRIAGEWAY_GAP_M = 40;
/** Leaving and returning headings at least this far apart count as travelling back the other way. */
const OPPOSITE_HEADING_DEG = 135;
/** Excursions shorter than this are noise (e.g. the repeated vertex where two legs meet). */
const MIN_EXCURSION_M = 100;
/** Longer detours are treated as deliberate: the user really wanted to go there. */
export const MAX_EXCURSION_M = 5000;
/**
 * How far to look. Searching beyond MAX_EXCURSION_M means a long deliberate detour is seen whole
 * (and rejected) rather than as its last few kilometres, which on their own look like a short one.
 */
const SEARCH_M = 2 * MAX_EXCURSION_M;
/** Slack added to a via circle so the route the excursion left from is safely inside it. */
export const CIRCLE_MARGIN_M = 50;

export interface Excursion {
  /** Index (in the concatenated geometry) where the route leaves its path. */
  from: number;
  /** Index where it is back on that path. */
  to: number;
  lengthMeters: number;
}

const RAD = Math.PI / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing of a -> b in degrees (flat approximation; fine over a few metres). */
function bearing(a: LatLng, b: LatLng): number {
  const dx = (b.lng - a.lng) * Math.cos(a.lat * RAD);
  const dy = b.lat - a.lat;
  return (Math.atan2(dx, dy) / RAD + 360) % 360;
}

/** Bearing of travel leaving pts[i] (step 1) or arriving at pts[i] (step -1), skipping repeated vertices. */
function heading(pts: LatLng[], i: number, step: 1 | -1): number | undefined {
  for (let n = i + step; n >= 0 && n < pts.length; n += step) {
    if (distanceM(pts[i], pts[n]) >= 1) return step === 1 ? bearing(pts[i], pts[n]) : bearing(pts[n], pts[i]);
  }
  return undefined;
}

/** True when the route at `to` is back where it was at `from`, ready to carry on as if it never left. */
function rejoins(pts: LatLng[], from: number, to: number): boolean {
  const gap = distanceM(pts[from], pts[to]);
  if (gap <= SAME_NODE_M) return true;
  if (gap > CARRIAGEWAY_GAP_M) return false;
  // Close but not the same node: only an out-and-back on a divided road (leave one way, come back the
  // other). Grade-separated crossings such as cloverleaf ramps cross at an angle and are left alone.
  const out = heading(pts, from, 1);
  const back = heading(pts, to, -1);
  if (out === undefined || back === undefined) return false;
  const diff = Math.abs(out - back) % 360;
  return Math.min(diff, 360 - diff) >= OPPOSITE_HEADING_DEG;
}

function cumulative(pts: LatLng[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + distanceM(pts[i - 1], pts[i]));
  return cum;
}

/** The excursion that starts at or before index `at` and ends at or after it, if it is short enough. */
function excursionAround(pts: LatLng[], cum: number[], at: number): Excursion | undefined {
  let best: Excursion | undefined;
  for (let i = at; i >= 0 && cum[at] - cum[i] <= SEARCH_M; i--) {
    for (let j = at; j < pts.length && cum[j] - cum[i] <= SEARCH_M; j++) {
      const length = cum[j] - cum[i];
      if (length < MIN_EXCURSION_M || (best && length <= best.lengthMeters)) continue;
      if (rejoins(pts, i, j)) best = { from: i, to: j, lengthMeters: length };
    }
  }
  return best && best.lengthMeters <= MAX_EXCURSION_M ? best : undefined;
}

/**
 * For each via point whose exact position makes the route detour (legs[k] ends at via point k + 1),
 * the radius of a circle around the user's point that the route without the detour already passes
 * through. Keyed by index into `points`; vias the route reaches cleanly are absent.
 */
export function viaCircleRadii(points: LatLng[], legs: LatLng[][]): Map<number, number> {
  const pts = legs.flat();
  const cum = cumulative(pts);
  const radii = new Map<number, number>();
  let end = 0;
  for (let k = 0; k < legs.length - 1 && k + 1 < points.length - 1; k++) {
    end += legs[k].length;
    if (end === 0) continue;
    const excursion = excursionAround(pts, cum, end - 1);
    if (excursion) radii.set(k + 1, Math.ceil(distanceM(points[k + 1], pts[excursion.from]) + CIRCLE_MARGIN_M));
  }
  return radii;
}

/**
 * Total length of the short out-and-backs and loops anywhere along a route. Longest first, so an
 * excursion nested inside a longer one is not counted, and deliberate (too long) ones count as zero.
 */
export function excursionMeters(pts: LatLng[]): number {
  const cum = cumulative(pts);
  const candidates: Excursion[] = [];
  let last = 0; // furthest vertex within SEARCH_M of vertex i
  for (let i = 0; i < pts.length; i++) {
    while (last + 1 < pts.length && cum[last + 1] - cum[i] <= SEARCH_M) last++;
    for (let j = last; j > i; j--) {
      const length = cum[j] - cum[i];
      if (length < MIN_EXCURSION_M) break;
      if (rejoins(pts, i, j)) {
        candidates.push({ from: i, to: j, lengthMeters: length });
        break;
      }
    }
  }
  candidates.sort((a, b) => b.lengthMeters - a.lengthMeters);
  const picked: Excursion[] = [];
  for (const c of candidates) {
    if (picked.every((p) => c.to <= p.from || c.from >= p.to)) picked.push(c);
  }
  return picked.reduce((sum, p) => sum + (p.lengthMeters <= MAX_EXCURSION_M ? p.lengthMeters : 0), 0);
}
