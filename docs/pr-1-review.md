# Advisory review — PR #1 "Stop via points from forcing detour loops"

| | |
|---|---|
| PR | [YLP-Games/Routes#1](https://github.com/YLP-Games/Routes/pull/1) by `layla310803` |
| Head reviewed | `b36501347e83556223d4c005611ff521a26969fc` (`claude/via-point-loops`) |
| Base | `eb1d1d00adaaf2c27359710012cc427298d1277b` (= current local `main`) |
| Files changed | `src/api/providers/viaExcursions.ts` (new), `viaExcursions.test.ts` (new), `tomtom.ts`, `tomtom.test.ts` |
| Date | 2026-11-16 |
| Status | **Advisory only — no source code was applied, no commits, no pushes.** |

> This review is advisory. The only file created in the clone is this document. The PR was opened
> 2026-10-19 and, per the GitHub API, has **0 issue comments and 0 review comments** — this appears
> to be the first review it has received.

---

## Verdict: **Request changes**

The idea is good and the implementation is unusually well thought out for a heuristic: detection
is local, the retry is a single extra call, all displayed figures are kept from one response, and
the failure path degrades to the original route. The code is small, readable and cleanly separated
from the provider. I would merge a follow-up PR built on this one.

I am **not** recommending merge as-is because three issues are substantive rather than cosmetic:

1. **(P0) The keep/reject criterion is a proxy that can select a demonstrably worse route.** The
   retry is accepted purely on `excursionMeters(retry.geometry) < excursionMeters(result.geometry)`
   (`tomtom.ts:174`). Distance, ETA, traffic delay and fuel are never compared. A retry can remove
   700 m of local doubling-back while adding 20 km of otherwise legitimate driving, and it will be
   accepted. This defeats the stated goal ("fastest of the variants" in the PR body is an observed
   outcome, not an enforced property).
2. **(P0) Unbounded CPU cost / event-loop DoS.** `excursionAround()` and `excursionMeters()` are
   quadratic in the number of polyline vertices inside a 10 km window, and they run up to ~148
   times per request. The polyline vertex count is **not** bounded by `routeRequestSchema`
   (the schema's 150 is *waypoints*, not vertices). A single request can trigger billions of
   haversine/bearing evaluations after the HTTP response has arrived, where the 20 s fetch
   timeout provides no protection. No guard exists.
3. **(P1) The retry fallback is incomplete.** Only `ProviderError` is caught (`tomtom.ts:177`).
   A 200 response with a malformed/absent `departureTime` makes `parseTomTomResponse()` throw a
   `RangeError`, which is rethrown and fails the *whole* request even though a valid original
   route is in hand. A 200 response with no legs produces empty geometry, zero excursion, and is
   therefore *preferred* over the valid original.

These are all localized fixes. Items 1 and 2 need tests before merge.

---

## Scope of review

I fetched the full `.diff`, the PR JSON, the raw files at the head SHA, the relevant `main` source
(`schemas.ts`, `types.ts`, `routePlanner.ts`, `shared/types.ts`) and the official TomTom Calculate
Route documentation. I also ran the test suite on clean `main` to check the headline numbers.

**TomTom API sanity check (passed).** The docs confirm `circle(lat,lng,radius)` is a valid
`generalizedLocation` (radius a positive integer, max 135 000 m — our radii are far below that),
and explicitly state: *"A waypoint of type `location` results in an extra leg in the response
whereas a waypoint of type `circle` does not."* This confirms the PR body's claims about the retry
behaviour and means `parseTomTomResponse()`'s flatten-all-legs approach is correct for both call
shapes. `computeBestOrder` (incompatible with circles) is not used by this app.

**Test-count note.** On current `main` I measure **123 passing tests** (12 files), not the 120 in
the task brief. The PR adds 10 `it()` blocks (4 in `tomtom.test.ts`, 6 in `viaExcursions.test.ts`)
→ **133**, not the 130 stated in the PR body. The delta is small and may reflect a different local
checkout at authoring time, but the headline count does not reproduce; reviewers should re-run
rather than rely on it. I did not apply the patch, so I did not execute the PR suite.

---

## Prioritized findings

### P0 — Retry can be chosen when it is worse for the user (`tomtom.ts:173-174`)

```ts
const retry = parseTomTomResponse(await requestRoute(buildTomTomUrl(input, opts, circles)));
return excursionMeters(retry.geometry) < excursionMeters(result.geometry) ? retry : result;
```

`excursionMeters` returns 0 for any route with no detectable local doubling-back, regardless of
length. The circle radius is derived from `excursion.from` and can be up to ~5 km (see P1), so the
circle can permit a substantially different corridor. Scenarios that are currently accepted:

- Retry removes a 700 m spur but is 10 km longer / 15 min slower because TomTom picked a parallel
  road or a longer bypass. Excursion 0 < 700 → retry returned. ETA, traffic delay, fuel and cost
  shown to the user all get worse.
- Retry introduces a single long (>5 km) detour: `excursionMeters()` deliberately counts those as
  zero (`viaExcursions.ts:134`), so the new detour is invisible to the comparison and the retry
  wins. This is a direct consequence of the "deliberate detours count as zero" design being reused
  as a scoring function.
- The PR body's own live probe table shows why this matters: `circle r=100` produced **33.5 km,
  no loop, but turned west away from the destination**; `r=485` produced 35.10 km / 36 min. A
  33.5 km route with no excursion would beat the 35.10 km route under the current criterion even
  if the former were a worse user experience.

**Recommendation:** gate on an actual user-facing metric, not just the proxy. Minimum viable:
require the retry to be no worse on `travelTimeSeconds` (or `distanceMeters`) *as well as* having
less excursion, e.g. accept only if
`excursionMeters(retry) < excursionMeters(result) && retry.travelTimeSeconds <= result.travelTimeSeconds`
(consider a small tolerance for rounding). Better: define an explicit objective, e.g. accept only
when `retry.travelTimeSeconds + excursionMeters(retry)/v < result.travelTimeSeconds + excursionMeters(result)/v`,
and return `result` on a tie. Add a regression test for "less doubling-back but slower/longer".

### P0 — Quadratic geometry analysis with no guard; request-time DoS risk

`routeRequestSchema` allows **150 points** (`schemas.ts:19`) → up to 148 vias and 149 legs. That
limit says nothing about the polyline: `routeRepresentation=polyline` returns a vertex per road
shape point, so a long/dense urban route can easily contain 10k–50k vertices in the first response.

Work per request:

| Stage | Complexity | Worst case |
|---|---|---|
| `viaCircleRadii` → `excursionAround` (`viaExcursions.ts:80-90`) | O(W²) per via, W = vertices in a 10 km window | ≤148 × W² `rejoins()` calls |
| `excursionMeters` (`viaExcursions.ts:114-135`) | O(P × W) via the sliding `last` pointer; O(P²) when the route fits in one window | up to ~P² per call, called twice (`:174`) |
| `rejoins`/`heading` (`viaExcursions.ts:52-57`, `:60-71`) | up to 2 `distanceM()` (sin/cos/asin) + 2 walks per call | sub-metre vertex spacing makes each `heading` walk O(k) |

Rough numbers: a 50 km urban route with ~25 000 vertices has W ≈ 10/50 × 25 000 = **5 000**
vertices inside a 10 km window. `excursionAround` then does ~25 M `rejoins()` checks **per via**;
across 148 vias that is **~3.7 × 10⁹** haversine/bearing evaluations, plus up to ~2 × 6 × 10⁸ from
the two `excursionMeters()` calls. At even a generous 10⁷ cheap checks/sec that is minutes of CPU,
executed synchronously on Node's single event loop, after the HTTP timeout has expired. A crafted
150-waypoint request against a dense network is an amplification vector: 1 inbound request →
several seconds-to-minutes of CPU plus 2 TomTom calls.

**Recommendation (in priority order):**
1. **Decimate before analysis.** Resample the concatenated polyline to ~5–10 m vertex spacing
   (or Ramer–Douglas–Peucker with a ~5 m tolerance) before `cumulative()`. At 10 m spacing a
   10 km window holds ≤1 000 vertices → ≤1 M checks/via (~1.5 × 10⁸ total), a ~25× reduction,
   with no loss of detection fidelity given `MIN_EXCURSION_M = 100`.
2. **Add a hard operation budget** (e.g. 5 × 10⁶ `rejoins()` evaluations per request). On overflow,
   skip the retry and return the original route — this is a safe fallback and makes the worst case
   deterministic.
3. **Cap the number of vias analysed** per request (e.g. retry at most the 10 largest excursions).
4. **Cap the computed circle radius** (e.g. `Math.min(radius, 1_000)`) — this both bounds TomTom's
   freedom and shrinks the search window.
5. Optional: replace the nested `j` scan with a spatial hash keyed on rounded coordinates, since
   `rejoins()` only cares about pairs within 40 m; that reduces the inner scan from O(W) to O(1)
   average.

### P1 — Incomplete failures/fallback; empty geometry can win (`tomtom.ts:172-179`)

The catch is selective:

```ts
} catch (err) {
  if (err instanceof ProviderError) return result;
  throw err;
}
```

- `parseTomTomResponse()` calls `new Date(s.departureTime).toISOString()` and
  `new Date(s.arrivalTime).toISOString()` (`tomtom.ts:124-125`). A 200 response with a missing or
  invalid timestamp throws `RangeError` — **not** a `ProviderError` — so it escapes and fails the
  entire `/api/route` request despite a perfectly good original route already parsed. TomTom
  documents that responses may contain additional/changed fields; defensive parsing is warranted.
- If the retry returns a route with **no legs**, `geometry` is `[]`, `excursionMeters([])` is `0`,
  and the empty-geometry retry beats any original with an excursion. The user receives a route with
  a summary but no polyline to draw. The first request has the same weakness, but that is pre-existing;
  the new code actively *prefers* it.

**Recommendation:** catch **all** errors from the retry block and return `result`; additionally
require `retry.geometry.length > 0` (and ideally `retry.geometry.length >= result.geometry.length / 2`)
before considering the retry. Add tests for a malformed 200 retry body and a leg-less retry route.

### P1 — Circle radius can be grossly oversized by "longest excursion" selection

`excursionAround()` keeps the **longest** rejoining excursion that straddles the via (`tomtom.ts`
counterpart `viaExcursions.ts:84-86`: `best` is only replaced when `length > best.lengthMeters`),
and `viaCircleRadii()` sizes the circle from that excursion's `from` vertex
(`viaExcursions.ts:105`). Two consequences:

- If a genuine longer loop (up to `MAX_EXCURSION_M = 5000`) also straddles the via, `from` can be
  kilometres away from the detour the via actually caused. The circle radius becomes ~that
  distance + 50 m, i.e. potentially multiple kilometres, allowing TomTom to choose an entirely
  different corridor. (TomTom permits radii up to 135 km, so such a request is accepted.)
- The radius is `distanceM(click, excursion.from) + 50` (`viaExcursions.ts:105`). The 50 m
  `CIRCLE_MARGIN_M` is a guess: it assumes the detour-free route passes within 50 m of the exact
  vertex where the excursion left. It does not guarantee it — the user's own probe table shows how
  sensitive the outcome is to a 30/100/485 m radius. A click far from any road (e.g. a pin in a
  field) produces a large radius for the same reason.

**Recommendation:** clamp the radius (`min(computed, 1000)` or a fraction of the excursion length),
and prefer the **shortest** rejoining excursion that contains the via when sizing the circle, while
retaining the longest-excursion view for the deliberate-detour rejection. These are two different
questions and currently share one result. Add a test for a nested long loop around a short via spur.

### P2 — Cloverleaf/grade-separated exclusion has a hole at ≤3 m

`rejoins()` returns `true` immediately when `gap <= SAME_NODE_M` (`viaExcursions.ts:61-62`),
skipping the heading check. The heading/opposite-direction test only runs in the 3–40 m band
(`:63-70`). TomTom's default coordinate precision is 5 decimals (~1 m), so a true grade-separated
crossing (overpass/underpass) whose two vertices land within 3 m is misclassified as a rejoin and
counted as an excursion. The existing cloverleaf test uses an ~11 m gap, exercising only the
heading path; the ≤3 m path is untested.

**Recommendation:** apply the heading check to the same-node case too, but allow the *dead-end*
case to be recognized by the excursion shape (large `length`, near-zero net displacement) rather
than by skipping headings outright; or at minimum add a test documenting the accepted false
positive. Also note that a small same-direction loop returning to the same node is intentionally
counted today — make that policy explicit in a test.

### P2 — `MAX`/`SEARCH` logic is sound but couples detection and scoring

`SEARCH_M = 2 × MAX_EXCURSION_M = 10 km` with the final `best.lengthMeters <= 5000` guard
(`viaExcursions.ts:23`, `:89`) correctly implements the stated intent: a deliberate 6.6 km
out-and-back is seen whole and rejected rather than mistaken for a short tail (the "long deliberate
detour" tests prove this). `viaCircleRadii`'s index arithmetic is also correct: for N points there
are N−1 legs, `end` accumulates leg lengths, `end-1` is the last vertex of leg k (the via at the
leg boundary), the loop covers vias `1..N-2`, and the `end === 0` guard prevents a `-1` index
(`viaExcursions.ts:100-105`). The duplicated-boundary-vertex assumption matches TomTom's leg
format and is absorbed by `SAME_NODE_M`.

Residual issues:
- The longest-within-10 km excursion is rejected wholesale if >5 km, even if a separate short,
  legitimate via spur also straddles the via (false negative). Low likelihood, but untested.
- `excursionMeters()`'s longest-first, non-overlapping greedy selection (`:129-133`) means a >5 km
  deliberate detour (contributing 0 at `:134`) can *suppress* a real short excursion nested inside
  it. This further distorts the P0 keep/reject comparison.
- `cumulative()`/distance/haversine use a fixed 6 371 000 m sphere and a flat bearing
  approximation. Fine at these scales; `Math.min(1, sqrt(h))` correctly guards antipodal cases.

### P2 — Cost and fallback summary (mostly good)

- **TomTom calls:** one per `provider.calculate()` for clean routes and for all 2-point routes
  (`tomtom.ts:168`, `:171`); **two when any via detours** — all offending vias are sent as circles
  in a single retry URL, so cost does not scale with the number of vias. This is the right design.
- End-to-end, `routePlanner.ts:66-70` issues a second 2-point call when `compareFastest` is set, so
  the API request worst case is 3 TomTom calls (yours exact, yours retry, fastest). Worth noting
  for quota/cost, not a bug.
- Query parity between first and retry is correct and tested (`buildTomTomUrl` mutates only the
  path; all params including `departAt` and the fuel model are identical).
- First-request failures propagate as before; that is correct.
- **Figures provenance: correct.** `parseTomTomResponse()` returns summary + geometry from the same
  `TomTomResponse`, and `calculate()` returns either `retry` or `result` wholesale. ETA, no-traffic
  time, traffic delay and `fuelLitres` therefore always correspond to the returned geometry;
  `routePlanner.ts:72-81` then derives the fuel estimate from that same pair. No mixing occurs.
  This claim in the PR body is true and is covered by the first integration test.

---

## Test quality review

**What the tests do prove (10 new tests):**

| Claim | Test | Verdict |
|---|---|---|
| Circle radius arithmetic + URL format | `tomtom.test.ts` retry test asserts `circle(-26.2031,28.0051,395)`; `viaExcursions.test.ts` asserts `ceil(dist(click,junction)+CIRCLE_MARGIN_M)` | ✓ (though circular: both sides use `distanceM`) |
| Retry chosen when doubling-back decreases | loopy (1700 m) → clean (1000 m), asserts retry's own figures & geometry | ✓ |
| Retry rejected when no improvement | retry returns same loopy geometry with slightly smaller summary; asserts original figures | ✓ (proves the `<` boundary at equality) |
| Retry failure falls back | 400 → `ProviderError` → original | ✓ |
| Single-call paths | clean via and 2-point route | ✓ |
| Detection: dead end, divided road, cloverleaf, long deliberate, multiple vias, straight-through | `viaExcursions.test.ts` | ✓ for synthetic shapes |
| Figure provenance | retry test asserts ETA/no-traffic/fuel all come from the second response | ✓ |

**Missing / weak cases (should be added before merge):**

1. **Less doubling-back but slower/longer retry** — the central policy decision (P0) is untested.
   Pin the intended behaviour explicitly.
2. **Malformed 200 retry body** (missing `departureTime`/`arrivalTime`) and **leg-less retry
   response** — the two P1 fallback holes.
3. **Multiple circle waypoints in one URL** — the unit test checks keys `[1, 3]`, but no integration
   test asserts two `circle(...)` segments are emitted and that only **2** calls are made.
4. **Mixed case** — one via needs a circle, another is clean; only the offending via should be
   converted.
5. **Boundary values** — `SAME_NODE_M=3`, `CARRIAGEWAY_GAP_M=40`, `OPPOSITE_HEADING_DEG=135`,
   `MIN_EXCURSION_M=100`, `MAX_EXCURSION_M=5000` have no ±epsilon tests; a one-character constant
   change could silently alter behaviour.
6. **Same-coordinate grade-separated crossing** (gap ≤3 m, right angles) — currently counted as an
   excursion (P2); the existing cloverleaf test uses an 11 m gap and does not cover this path.
7. **Nested/overlapping excursions** — the longest-first selection and its oversized-radius effect
   are untested.
8. **Performance** — no test or benchmark with a large polyline; no operation-budget guard.
9. **Test hygiene** — the "single call" test re-stubs `fetch` mid-test and then asserts on two
   different mock references (`fetchMock` for the first case, `vi.mocked(fetch)` for the second).
   It currently passes, but it is fragile; use one mock plus a call counter.
10. Tests remain green on clean routes (no regression) at the unit level, but there is no
    integration test that a route with a **far-away** loop (e.g. the PR's OR Tambo ramps) stays at
    one call and is returned unchanged.

---

## Suggested follow-ups (post-merge or as merge conditions)

1. **Merge conditions:** fix P0 selection criterion, add the CPU guard, harden the retry catch and
   geometry check, and add tests 1–4 above.
2. Replace the longest/shortest excursion ambiguity with two purpose-specific queries: "is there a
   deliberate detour here?" (for rejection) and "where did the local spur leave?" (for radius).
3. Consider exposing a warning (`warnings[]` in `RouteResponse`) when the retry is applied, so
   users understand why a via was not touched exactly. `routePlanner.ts` already has a warnings
   channel.
4. Consider a short TTL cache keyed by the exact-waypoint URL + circle map: the app fires two
   `calculate()` calls when `compareFastest` is on, and retried routes are likely to be re-requested.
5. Validate the chosen radius against TomTom's live behaviour with a few more real probes in dense
   grids — the PR body's 30 m/100 m results show the radius is the most sensitive parameter.
6. Add a benchmark to CI using a synthetic 25k-point polyline and a 148-via request, with an
   assertion on wall time.

---

## Advisory note

This document is the only artifact produced by this review. **No source files were modified, no
tests were run against the PR patch, and no commits, branches or pushes were created.** All
verdicts are based on static reading of the supplied diff, the raw files at the PR head SHA, the
current `main` sources, the official TomTom Calculate Route documentation, and a baseline
`vitest run` on unmodified `main`. Line references are to the PR head SHA unless stated otherwise.
