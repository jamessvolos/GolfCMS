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

---

## W-D as shipped — what the measurements actually said

Release D is the first one where the plan above was wrong in ways worth writing
down, because the instrument (`certify.js`) was built before the generator and
then kept disagreeing with it.

**The literal reading of G2 makes holes worse.** "Move the landing-zone hazard
off the centre line and onto the pin side" was implemented exactly as written
and the measured fork rate fell from 30% to zero. A hazard beside a wide
fairway does not create two options; it creates one option with a bruise on it.
The expected-strokes field stays a single smooth basin whose floor has moved a
couple of tiles away from the sand — no ridge, so no decision.

**A fork needs a wall, and progress beats angle.** Two attempts followed. The
first separated the options LATERALLY — a narrow shelf on one flank, a wide bail
on the other, a wall between. It never tied: every tile sideways costs real
progress toward the green, and in this engine the angle gained is not worth the
advance given up. The second separated them by CARRY — a hazard band across the
corridor with a lay-up short of it and a landing area beyond — and that ties,
because the value of the extra progress and the cost of the risk are both
continuous in one number (where the band sits) and can be tuned against each
other. `LZ_SHAPE` is that tuning surface.

**The angle rule is the opposite of the obvious one.** A pin tucked behind a
left-hand bunker is short-sided FROM the left. The flank worth driving to is
the one away from the tuck, which is why `shelfSide === -tuckSide`.

**A tuning pass will happily tune a bug.** An early band was placed from its
near edge outward, so a deep band pushed its own far edge past the driver and
the "carry target", clamped back to maximum reach, sat inside the hazard. The
fork rate went UP, because the aim heatmap was reading an unclearable wall. The
band is now placed from the far edge inward, and both aim points are chosen as
TILES inside a permitted annulus rather than as floats rounded afterwards —
rounding moves a point by up to 0.7 tiles, enough to drop a target computed at
14.1 tiles back onto the tile at 13.6.

**G3's premise was wrong.** It estimated the classic corridor at 24–40 yards
from the fairway stamp radius. Measured against the tee→cup line the real thing
is far wider, because the spine wanders a tile per step: a corridor hugging the
route within 2.5 tiles still sweeps five or six tiles either side of the
straight line. The stage survives for its ASYMMETRY, not its width, and is
tested by which side of the hole the newly mown ground lands on (37/40 holes
favour the bail side, median 5.7×).

**Par 3s are not applicable, not failures.** M1 asks whether there are two
viable lines. On a one-shotter there is one, at the green, and that is correct
golf. `certifyHole` reports `applicable: false` below `TEE_FORK_MIN`, and
`certifySweep` reports both rates. Certifying a par 3 needs a green-scale
metric; release D does not have one and does not pretend to.

### The numbers (42 par-4/5 holes per generator, six lengths, scratch profile)

| | classic | strategic |
|---|---|---|
| M1 fork | 8/42 (19%) | 14/42 (**33%**) |
| M3 centre-line penalty | 25/42 (60%) | 29/42 (**69%**) |
| median second-basin gap, 22t | 0.277 | **0.118** |
| median second-basin gap, 26t | 0.766 | **0.090** |
| median second-basin gap, 33t | 0.127 | **0.117** |

The honest summary: the *gap* result is strong and consistent — the second-best
line on a strategic hole is much closer in value to the best one, which is what
turns "there is an answer" into "there is an argument". The M1 pass RATE
improvement is real but modest, because M1's 0.10-stroke tie threshold is
strict and this engine's expected-strokes field is steep. Loosening the
threshold would have made the release look better and mean less, so it was left
at the value `01` specified.

## W-E as shipped — the cone

Built as specified, with one correction found by looking at it.

**The scale has to be local.** The first version normalised `V` across the
whole hole. On a 400-yard par 4 that spans about four strokes of expectation
end to end, so the two or three tenths separating the good half of a landing
zone from the bad half compressed into a single shade and the beam lit up
uniformly — a picture of nothing. The cost image is now normalised over the
ground *this swing can reach*, and cached per lie rather than per hole. The
cone's question is "which of the ground in front of me is better", and the
answer has to be scaled to the ground in front of you.

The rest held: one greyscale pixel per tile, drawn scaled with smoothing on
(that is the bilinear upscale — a coarse field drawn sharp looks like a
mosaic), clipped to a beam whose half-width follows the real lateral sigma at
each distance so it flares superlinearly the way dispersion actually does,
capped past the target by the depth sigma, composited in `soft-light` at 18%.
On a putt the beam bends with `puttBreakDrift`, and bends LATE — displacement
grows with the square of progress, because a putt barely moves in its first
foot and does most of its work as it dies.

`costShades` is split out from `renderCostImage` so the arithmetic that decides
what is lit and what is shadowed is testable without a DOM: cheap ground is
strictly lighter than dear ground, water shades below fairway, a degenerate
field falls back to neutral rather than to noise.

---

## W-F — Certified holes, and why par 3s are not among them

Release D built the instrument and reported an uncomfortable number: about a
third of generated par 4s and 5s clear M1. Two holes in three had one obvious
answer. The generator cannot fix that at runtime — a single `strokesField` is
about a second, so a certify-and-reroll loop would freeze the browser mid-round.

So the fork is filtered **offline**. `scripts/certify-seeds.mjs` sweeps the seed
space, keeps the seeds that pass, and writes `src/engine/certified.js`;
`caddieHoleSeed` then deals its two-shotters from that table instead of from the
raw stream. Runtime cost is an array index.

Three things the design has to get right, all pinned in `certified.test.js`:

- **The swap preserves par.** Length mix belongs to the round, not to whichever
  pars happened to certify more often. Swapping naively would quietly stop
  dealing par 5s.
- **It stays a pure function of `(roundSeed, index)`.** `verifyCaddieRound`
  re-derives every hole from the round seed; anything else and legitimate rounds
  fail verification.
- **An empty pool is a no-op.** The table ships empty while a sweep runs, and a
  half-built table must never take the game down.

Certification runs at the **scratch** profile. M2 exists precisely because a
hole plays differently across dispersions; certifying per handicap would
quadruple the sweep to buy four disjoint hole pools nobody asked for.

### Par 3s are excluded, and it is not a shortcoming of the generator

The obvious par-3 metric is "is aiming at the pin within 0.10 strokes of aiming
at the fat side of the green?" That question cannot be asked here. Measured over
24 par 3s, **the two aims are the same tile on 22 of them** — median separation
1.0 tile. The arithmetic:

```
240-yd par 3: shot pattern 2σ = 5.6 tiles wide
median green:                   5.4 tiles across
```

The pattern is wider than the green, so every aim on the green is the same
distribution. Two fixes were built and measured before being reverted:

- **Bigger greens, firmer tuck for one-shotters.** Same-aim holes 22/24 → 15/24,
  pin trouble 2% → 4%. Real movement, not enough.
- **Shorter par 3s.** At 112–144 yds aiming at the pin beats the fat side by
  0.19–0.54 strokes — not a decision, an obvious answer with 0% risk.

Underneath both sits a hard floor. A legal pin needs all eight neighbours green,
so a cup sits ≥1.4 tiles inside the edge, and `carveBunker` adds another
0.75–1.45 beyond it: **cup-to-sand is structurally ≥2 tiles.** In σ:

| carry | 2 tiles | pattern share in that sand |
|---|---|---|
| 112 yds | 3.9σ | ~0.0% |
| 176 yds | 2.2σ | ~4.3% |
| 240 yds | 1.4σ | ~17.9% |

A greenside bunker cannot threaten a shot at the flag until the hole is 240
yards long, by which point nothing else on the green is distinguishable either.

The real statement: **a real pin is cut about four paces from an edge, which at
16 yards per tile is a fifth of a tile. The board cannot represent a pin
position.** Par 3s are not under-designed; they are below the grid's resolution.
That is the same wall the putting game hit and answered with a sub-tile field
(`GREEN_SUB = 4` in `paint.js`).

So par 3s keep coming from the raw stream and are honestly labelled as
execution tests rather than decisions. Certifying them needs sub-tile
resolution for the APPROACH shot — which would sharpen every approach in the
game, not just one-shotters, and is the natural next piece of engine work.
