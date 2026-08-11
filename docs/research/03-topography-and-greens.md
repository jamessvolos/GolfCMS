# Topography, Green Architecture, and the Honest Model — the plan

*Written 2026-08-11, after the green camera shipped. Companion to
`01-architecture-and-sg.md` (findings) and `02-scoring-zone-mode.md`.*

## The diagnosis

Three problems, one root.

1. **Every green is the same shape.** `generate.js:117` is
   `stampDisc(course, hole.x, hole.y, 2.5, GREEN)`. One radius, one disc,
   every hole, every biome. The green camera we just built zooms into a
   circle. Green *shape* is the most legible signature a golf hole has, and
   we have exactly one.
2. **There is no elevation.** The engine has no height field. "Slope" is four
   discrete tile types (`SLOPE_N/S/E/W`) sprinkled on alpine greens as an
   overlay, affecting only putt break and ball settle. Elevation does not
   affect carry, roll, lie, or strategy — the three things it governs in real
   golf. The contour lines on the new green page integrate a height field the
   physics does not have: the art is drawing land the simulation cannot feel.
3. **The model runs hot.** Measured in-engine against Broadie: 8 ft makes 86%
   (PGA ~50%), 20 ft 65% (PGA 15%). `CUP_R` is a 2.8-ft capture radius and
   `PUTT_OVERRUN` allows 120 ft of past-cup pace. Everything downstream is
   compressed — a 100-yd approach prices at 2.15 strokes vs Broadie's 2.80,
   rough costs 0.03 vs a real 0.22 — so lies and proximity barely move the
   caddie's advice, and the new Cost page displays those wrong numbers
   beautifully.

**The root:** the ground is a flat mosaic of terrain *labels* with a
miscalibrated stroke model on top. Golf architecture is the shaping of
*ground*. We have been painting a picture of a golf course rather than
building one.

## The thesis

Elevation is the missing dimension, and it is the one that makes the other
two asks trivial instead of arbitrary.

- Green *shapes* without topography are outlines; with it, a boomerang wraps a
  bunker that sits in a hollow, and a punchbowl gathers because it is a bowl.
- Greenside *hazards* without topography are paint; with it, a false front
  rejects a short approach back down the hill, and a run-off collects it.
- *Strategy* without topography is a hazard-avoidance exercise; with it, the
  preferred side of a fairway is the one that gives a level lie and an open
  angle, which is what course architecture has always actually been about.

So: build the height field first, then shape greens with it, then let the
strategic generator use both.

## The releases

### W-A — Calibration (prerequisite, `dispersion.js` / `strategy.js`)

Nothing else is worth building on a model this hot. Per `01`'s C1–C9:

- Replace the capture-radius holing model with an **empirical make curve**
  anchored to published make rates (3 ft ~96%, 6 ft ~65%, 8 ft ~50%, 10 ft
  ~40%, 15 ft ~23%, 20 ft ~15%, 30 ft ~7%, 60 ft ~2%), with the aggressive-pace
  trade-off preserved as a *modifier* on that curve rather than the mechanism.
- `PUTT_OVERRUN` 2.5 tiles → ~0.06 (3 ft): past-cup pace beyond a yard is a
  penalty, not a strategy.
- Rebuild `PACE_CANDIDATES` on the new scale (the current grid is 10× too coarse).
- Re-anchor `expectedPutts` and the `strokesField` green initialisation to
  Broadie's baselines so approach values land near 2.80 at 100 yds.
- **Expect the golden fixtures to break loudly.** That is the test suite doing
  its job; regenerate them deliberately, in one commit, with the old and new
  numbers recorded in the message.

Exit: engine-measured make rates within a few points of the published curve at
3/8/20/30/60 ft, and E(100 yd, fairway) within ~0.15 of 2.80.

### W-B — Topography (`src/engine/terrain.js`, new `src/engine/relief.js`)

A real height field, generated with the hole and consulted by the physics.

- **`relief.js`**: per-hole heightfield in feet, seeded, at tile resolution
  with bilinear sampling — landform macro-shapes (ridge, valley, plateau,
  punchbowl, tilted plane) blended with low-octave noise, then *stitched to the
  routing* so the fairway corridor is playable and the green sits on a
  deliberate landform. Exports `heightAt(course, x, y)`, `gradientAt(...)`,
  `playsLike(from, to)`.
- **Physics consequences** (in `dispersion.js` / `strategy.js`):
  - *Plays-like yardage*: uphill plays longer, downhill shorter (~1 yd per foot
    of rise is the standard rule). The HUD says "165 yds — plays 178".
  - *Roll-out*: the landing kick follows the fall line; downslope releases,
    upslope stops.
  - *Lie*: uphill/downhill/sidehill lies widen the pattern and bias the miss —
    ball-above-feet pulls, ball-below pushes.
  - Putt break becomes a *continuous* read of the same field rather than four
    tile types. `SLOPE_*` tiles stay as a legacy input that writes into the
    field, so classic seeds and the arcade game do not change.
- **The art already agrees**: `paint.js` integrates elevation for contours —
  point it at the real field instead and the picture and the physics finally
  describe the same land.

Exit: a documented plays-like number on every shot; contours drawn from the
engine's own field; classic-seed regression green.

### W-C — Green architecture (`src/engine/greens.js`)

Replace the disc. Greens become shaped surfaces chosen from an archetype set,
sited on the landform, with hazards placed by *role*.

- **Shapes**: round, kidney, boomerang (wrapping a bunker), long-and-narrow
  (Biarritz, with a swale), L-shaped/tiered (two shelves at different heights),
  punchbowl (gathering), crowned/turtleback (shedding on all sides), island.
  Implemented as parametric silhouettes on the tile grid, not stamps.
- **Green-complex hazards by role** (per `01`'s architecture findings): guard
  the short side, punish the greedy line, frame the entrance, leave one open
  ground route. Greenside bunkers, false fronts, run-off collection areas,
  closely-mown chipping swales, water short/long.
- **Pin placement follows the shape**: tiers and shelves become legal pin
  zones; a back-right pin behind a bunker on an upper shelf is a genuinely
  different puzzle from a front-left pin in a bowl. Pins vary per day/round.
- The Cost page becomes genuinely informative here — on a tiered green the
  expected-putts field will show the wrong shelf costing a full stroke.

Exit: an audit page of 50 greens showing real variety; every green certified
puttable; the blind A/B gate re-run on green complexes.

### W-D — Strategic generator + certification (`generate.js`, new `certify.js`)

Now the generator has material to be strategic with. Per `01`'s G1–G8 and
M1–M4: side-biased landing-zone hazards instead of centre-line ones, diagonal
carries, width with a preferred side (the side that opens the angle to the
shelf the pin is on), template holes (Redan, Cape, Road, Punchbowl, Short)
expressed as landform + green archetype + hazard roles. Certification metrics
gate publication: a two-basin fork in the aim heatmap, tour-vs-20-handicap
optimal aim divergence ≥ 3 tiles, a real centre-line penalty.

### W-E — The expected-strokes cone (`caddie.js`, `paint.js`)

Last, because it renders `V` and should render an honest one. Dispersion-shaped
beam from the ball, `V` sampled coarse and bilinearly upscaled, monochrome
light-and-shadow in `soft-light` at ≤18% alpha — cheap ground stays lit,
expensive ground falls into shadow. On by default, off in Pro mode. Bends with
break on putts.

## Order and risk

A → B → C → D → E. A is riskiest (it moves every number and breaks goldens);
B is the biggest (a new engine dimension touching physics and art); C is the
most visible; D is where the puzzles finally get *meaningful*; E is the payoff
display. Each ships behind the existing regression wall: classic seeds
byte-identical where they should be, 173+ tests green, browser-verified.
