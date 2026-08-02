# SG Trainer engine

Pure-TypeScript strokes-gained engine for course-management puzzles. No
framework dependencies — it runs in a web worker or on the server. All
tunable numbers live in [`constants.ts`](./constants.ts); everything below
them is mechanism.

## What it does

Given a hole (GeoJSON polygons), a situation (ball position, lie, pin), and
a player profile (handicap, club speed, shot shape), the engine:

1. Derives a club distance table (`clubs.ts`) — driver carry from club
   speed, fixed gapping fractions below it, partial wedges below lob-wedge
   carry. Club selection is automatic: smallest club whose carry reaches
   the aim point, with lie caps (no driver/3-wood from rough, wedges only
   from sand).
2. Models dispersion (`dispersion.ts`) as a 2D normal oriented along the
   aim line — longitudinal σ 5.5% of shot distance, lateral σ from a
   handicap table, both inflated from rough/sand. Shot shape (draw/fade)
   shifts the lateral *mean*: the player aims at their pin and the
   distribution is biased by their curve, deliberately.
3. Evaluates an aim point (`evaluate.ts`) by Monte Carlo: sample landing
   points, classify each against the hole polygons (`hole.ts`), price each
   outcome with the Broadie-style baseline (`baseline.ts`), and average.
4. Finds the optimal aim (`optimize.ts`) by evaluating a regular 6-yard
   candidate grid over the reachable area with common random numbers. The
   same grid feeds the isoline renderer in the UI. The argmin also considers
   the pin and the naive aim as explicit candidates, so the reported optimal
   is never worse than the obvious play (`trapSize ≥ 0` by construction) and
   short greenside puzzles aren't hostage to cell quantization — the only
   excluded aims are within 2 yards of the ball, where the aim direction
   degenerates.
5. Scores the player's aim (`scoring.ts`):
   `sgLoss = E[player aim] − E[optimal aim]`, banded into
   Perfect/Good/Okay/Miss, driving Elo for both player and puzzle.

Scoring is always in strokes-gained space, never distance-to-optimal: two
aims 10 yards apart can be nearly identical (wide fairway) or a full stroke
apart (water carry line), and distance-based scoring would teach the wrong
lesson.

## Deliberate simplifications (v1)

- **Water** costs the shot, a one-stroke penalty, then plays as **rough**
  from a drop point: where the ball-to-landing segment first enters the
  water polygon, offset 5 yards back toward the ball. Real drop options
  (lateral relief, re-tee) are not modeled.
- **OB** is stroke-and-distance without recursion:
  `cost = 2 + baseline(original distance to pin, original lie)`.
- **Carry = total.** No roll-out modeling; the sampled landing point is
  where the ball finishes.
- **Putting is distance-only.** No green reading, slope, or break — the
  putt table interpolates expected putts by distance in feet.
- **Shape bias is fixed**, not distributional: a draw shifts the lateral
  mean by −0.8% of distance, a fade by +0.8%. Curvature variance is
  absorbed by the lateral σ.
- **The handicap multiplier (1 + 0.011 × handicap) applies to all baseline
  values, putts included.** It largely cancels in sgLoss comparisons but
  keeps absolute expected strokes plausible per skill level.
- **Table edges extrapolate linearly** using the nearest segment's slope
  (e.g. tee shots under 150y, sand beyond 250y), with a floor of 1.5
  strokes off-green and a cap of 3.0 expected putts on it.
- **Dispersion centers on the aim point** (the player flights the selected
  club to the target); only aims beyond the longest allowed club are
  clamped to max carry along the aim line.
- **No wind, elevation, or temperature** (out of scope for v1).

## Determinism

All randomness flows through a seeded RNG (`rng.ts`). Grid searches reuse
one buffer of standard-normal pairs across every candidate (common random
numbers), which keeps the expected-strokes surface smooth for contouring
and makes the argmin stable. Same seed + same inputs → identical output,
which is what the unit tests rely on.

Serialization note for the heatmap cache: `EvalGrid.values` masks
out-of-sector cells with `NaN`, and JSON turns `NaN` into `null` — code
rehydrating a cached grid must map `null` back to `NaN` before contouring.

## Coordinate frames

Storage and the map layer use GeoJSON lon/lat. The engine works in a local
planar frame in **yards** (x = east, y = north) via an equirectangular
projection around the hole's `imageryCenter` (`projection.ts`) — accurate
to well under 0.5% at golf-hole scale. Lie classification uses turf
point-in-polygon on the projected geometry behind a bounding-box pre-check;
anything inside no polygon is rough. Overlaps resolve by fixed priority:
ob → water → green → bunker → recovery → fairway.

## Fixture content

`holes/build.ts` converts holes authored in yard space into GeoJSON.
`holes/cape.ts` is the hand-annotated Milestone 1 hole (a cape-style par 4
with water right, bunkers/trees/OB left) plus its two puzzles. The
committed artifact `data/holes/cape-01.json` is regenerated with
`npm run build:hole`.

## Trying it

```
npm test        # unit tests
npm run demo    # ASCII expected-strokes contours + optimal aim for a
                # 5-handicap vs a 20-handicap on the cape hole
```
