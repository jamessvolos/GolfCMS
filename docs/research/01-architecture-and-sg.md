# Research 01 — Course Architecture for Meaningful Puzzles & Strokes-Gained Calibration

*Research memo, 2026-08-10. Sources: web research (cited inline) plus measured
audits of this repo's engine (scripts run against `src/engine/dispersion.js`
and `src/engine/strategy.js`; every engine number below is reproducible from
the committed code).*

---

## 0. TL;DR

1. Our generator builds **penal** holes (hazards biased onto the direct line,
   `generate.js:107-114`), so the E-surface has one valley and the caddie's
   "optimal aim" is usually just "the obvious safe spot." Strategic-school
   design — width with a preferred side, diagonal hazards, template greens —
   is what makes the SG-optimal target genuinely fork. §3 gives the generator
   changes; §4 gives metrics to *certify* a hole is strategic before shipping.
2. Our expected-strokes numbers are far from published baselines, and the gap
   is dominated by putting: the model makes **86% from 8 ft and 65% from
   20 ft** where the PGA Tour makes **~50% and ~15%**. Consequence measured
   in-engine: E(100 yd, fairway) = **2.15** vs Broadie's **2.80**, and
   proximity is nearly worthless (8 ft vs 40 ft differ by 0.11 strokes in our
   field vs ~0.56 in real golf) — which *also* kills strategy, because no aim
   near the green is meaningfully better than any other. §6 lists exact
   constants to change.
3. Worst single bug class: `PUTT_OVERRUN = 2.5` tiles (**120 ft**) and
   `CUP_R = 0.058` tiles (**2.8 ft** capture radius vs a real cup's 2.1 in).
   Under the current model the *make-maximizing* pace on an 8-footer is to
   ram it **31 ft past** (make% rises to 98.9%). The caddie's own pace grid
   rewards this. Players are being graded against anti-golf.

---

## 1. Current system snapshot (what the research is aimed at)

- 40×24 tiles, 16 yd/tile (`src/engine/course.js`, `src/engine/yards.js:
  YARDS_PER_TILE = 16`; 1 tile = 48 ft on the green).
- Archetype grammar `['straight','dogleg-left','dogleg-right','long']`
  (`src/engine/generate.js: ARCHETYPES`), spine walk + fairway buffer of
  radius 1.5–2.5 tiles (`generate.js:89`), 3–5 sand/water blobs placed **on
  the direct tee→hole line** (`generate.js:107-114`), green = disc of radius
  2.5 tiles (**40 yd radius**, `generate.js:117`), hole at green center.
- Expected-strokes field `V` by value iteration with elliptical dispersion
  (`src/engine/strategy.js: strokesField`), aim decisions scored as
  `points = 1000·exp(−3·sgLost)` (`strategy.js:111`).
- Putting: pace-dominant ellipse, capture-radius holing
  (`src/engine/dispersion.js: puttSigmas, puttHolesOut, CUP_R,
  PUTT_OVERRUN, PUTT_MAX`), self-consistent putts table
  (`strategy.js: buildPuttTable/puttsFrom`).
- Handicap profiles scale dispersion & reach (`dispersion.js: HANDICAPS`),
  putting skill = `sqrt(base)` (`puttSkill`).

---

## 2. Architecture findings

### 2.1 The three schools

- **Penal**: one right way to play the hole; miss the demanded shot, get
  punished. **Strategic**: multiple viable routes with different risk; "the
  higher the risk, the higher should be the reward." **Heroic**: a diagonal
  do-or-die carry where the reward and the penalty are both large — the
  player chooses how much to bite off. Great holes blend all three.
  Sources: [Fried Egg — Three Schools of Golf Course Design](https://www.thefriedegg.com/articles/three-schools-of-golf-course-design),
  [golf.com — 3 schools of golf course architecture](https://golf.com/travel/3-schools-golf-course-architecture/).
- **Our generator is penal by construction**: hazards are sampled *on* the
  direct line (`generate.js:109-111` — `t·(hole−tee) ± small jitter`), trees
  only "punish wild lines" (`generate.js:92-93`). The optimal play is
  almost always "step around the obstacle"; there is rarely a second basin
  in the E-surface with comparable value.

### 2.2 Principles that create decisions

- **MacKenzie's General Principles** (1920, *Golf Architecture*): the one
  that matters most for us is **#6 — heroic carries, but "the weaker golfer,
  with the loss of a stroke, shall always have an alternate route open to
  him."** That is literally a spec for a fork in an expected-strokes field:
  route A costs E, route B costs ≈ E + ε with far less variance.
  Sources: [Golf Compendium — MacKenzie's 13 principles](https://www.golfcompendium.com/2021/11/alister-mackenzie-13-principles-golf-course-design.html),
  [golf.com — why the 13 principles remain timeless](https://golf.com/instruction/why-alister-mackenzie-13-principles-golf-course-design-remain-timeless/),
  [GCA — architects rank MacKenzie's theories](https://www.golfcoursearchitecture.net/content/architects-rank-mackenzies-theories).
- **Width with a preferred side / options**: the minimalists (Doak,
  Coore & Crenshaw) build wide corridors where position, not just distance,
  buys the next shot — "play out right or left? smash it over all that?"
  (Doak on St Andrews). Width without a reason to favor a side is
  meaningless ("width for the sake of width", Golf Club Atlas).
  Sources: [Fried Egg — Architecture 101: Playability, Width, Options, Strategy](https://www.thefriedegg.com/articles/golf-course-architecture-101-part-1-playability-width-options-strategy),
  [Golf Club Atlas — Width For The Sake Of Width](https://golfclubatlas.com/in-my-opinion/width-for-the-sake-of-width/),
  [Eamon Lynch — The Journey of Tom Doak](https://eamonlynch.com/2018/12/04/the-journey-of-tom-doak/).
- **Diagonal hazards**: a hazard crossing the line at an angle converts a
  binary carry into a continuous "choose your carry length" dial — the core
  heroic mechanic (Cape tee shots). Ian Andrew: diagonal hazards "force
  golfers to choose a line based on aggression level."
  Source: [ASGCA / Ian Andrew — The Strategy of Bunkering](https://asgca.org/qthe-origin-of-bunkersq-an-original-piece-from-ian-andrew-asgca/),
  [Golf Club Atlas — A Complete Look at Bunkering](https://golfclubatlas.com/in-my-opinion/on-bunkers-by-ian-andrew/).
- **Centerline bunkers**: a bunker in the *middle* of a wide fairway splits
  one corridor into two lanes with different next-shot value — the canonical
  example is Woking's 4th, "the bunker that changed golf," which turned a
  featureless drive into a decision. Source:
  [Fried Egg — The Bunker That Changed Golf: No. 4 at Woking](https://www.thefriedegg.com/articles/woking-golf-club-4th).

### 2.3 Template holes and how they map to our grammar

Macdonald/Raynor templates are pre-quantified strategy: each is a compact
mechanism that forces a decision. Sources:
[Fried Egg — C.B. Macdonald's Ideal Golf Holes](https://www.thefriedegg.com/articles/ideal-golf-holes-cb-macdonald),
[golf.com — What are template holes?](https://golf.com/travel/what-are-template-holes-important-golf-design/),
[Evalu18 — Template Holes](https://evalu18.com/template-holes/),
[LINKS Magazine — Template Holes](https://linksmagazine.com/template-holes/).

| Template | Mechanism | Map to our tile system | Fits grammar? |
|---|---|---|---|
| **Redan** (N. Berwick 15) | Par 3; green set diagonally, tilted back-left, deep bunker front-left; land right-front and feed left, or fly at the pin over the bunker | Par-3 archetype: green as 2×4-tile diagonal ellipse, `SLOPE_W/SLOPE_S` tiles on the green feeding away from a front `SAND` disc; pin tucked behind the bunker | Yes — needs slopes in classic biome + off-center pin |
| **Cape** (NGLA 14) | Diagonal water along the inside of a dogleg; bite off as much carry as you dare; green hangs at the water's edge | Dogleg archetype: replace on-line blobs with a `WATER` band along the *inside* of the bend; carry to reach fairway grows 8→14 tiles along the ideal line | Yes — direct swap in hazard stage |
| **Short** (Brancaster 4) | Sub-130-yd par 3, green ringed by sand; huge green with interior contour; the decision is *which section* | Par-3 ≤ 8 tiles; `SAND` ring around a 3-tile green; needs pin sections (doc 02's fine green) | Partially now; fully in doc 02 |
| **Biarritz** | Long par 3, deep green bisected by a swale; front and back plateaus | Needs sub-tile green depth/tiers → doc 02 R2 | Not yet |
| **Road** (St Andrews 17) | Trouble *behind* (road) and a pot bunker front-center; long is dead, short-right is the coward's play that leaves a hard pitch | Green with `WATER`/OB band 1 tile behind and a 1-tile `SAND` pot front-center; pin behind the pot | Yes |
| **Alps / Punchbowl** | Blind approach; punchbowl green gathers shots — forgiveness as reward for the bold line | Ring of inward-pointing `SLOPE_*` tiles around the green (gathering); pairs well with a fronting hazard | Yes — reuses alpine slope terrain |
| **Principal's Nose / centerline** | Central bunker cluster splits the driving zone | `SAND` disc *on the spine* at driver range with widened fairway both sides | Yes — trivial |

### 2.4 The quantitative critique — do angles even matter?

- Broadie's data: **distance to the hole dominates scoring**; "being closer
  to the hole is pretty much always better, course architecture be damned"
  ([MyGolfSpy — Accuracy vs. Distance](https://mygolfspy.com/news-opinion/study-accuracy-versus-distance/)).
  For elite players who fly wedges high with spin, approach *angle* has
  little measurable effect; the Fried Egg's own data review concludes
  "angles matter, just not very much" at tour level —
  [Fried Egg — Attempting to Square the Angle Debate](https://www.thefriedegg.com/articles/exploring-angle-debate).
- Fawcett/DECADE: pick the target from your *dispersion ellipse* overlaid on
  the penalty map; shade to green centers; golfers systematically
  overestimate their precision
  ([DECADE](https://decade.golf/about/), [Golf Digest — Fawcett](https://www.golfdigest.com/story/course-management-expert-scott-fawcett-tips-smarter-golf),
  [MyGolfSpy — Cracking the Course Management Code](https://mygolfspy.com/news-opinion/cracking-the-course-management-code-with-decade/)).
- Stagner: the fairway-vs-rough advantage **shrinks with distance from the
  hole** and nearly vanishes on long holes for mid-handicaps
  ([Lou Stagner Newsletter #58 — Fairway vs Rough](https://newsletter.loustagnergolf.com/p/fairway-vs-rough),
  [golf.com — GIR vs fairways, Stagner](https://golf.com/instruction/greens-in-regulation-vs-fairways-hit-lou-stagner/)).

**Design consequences for Caddie** (this is the synthesis that matters):

1. Angle value cannot be assumed; it must be **manufactured** by things our
   engine actually prices: hazard probability under the pattern, lie of the
   leave, and green-side penalty asymmetry. A "preferred side" only exists
   if the E-field says so.
2. Angles matter **more** as dispersion widens — which we model directly via
   `HANDICAPS`. This is a feature no real-world architect gets: we can
   *certify* that a hole plays differently for `tour` vs `twenty` (§4, M2).
3. The tension that survives the data is **risk-reward asymmetry on the
   shot itself** (diagonal carries, centerline hazards, short-side misses),
   not aesthetic angles. Put the fork in the landing zone, not in theory.
4. Because we're a *decision trainer*, holes where "aim at the middle" is
   always right are wasted content. Broadie/DECADE says center-of-green is
   usually right in real golf — so a good Caddie hole should be one of the
   engineered exceptions, and the certification metrics below exist to
   guarantee that.

---

## 3. Generator changes (prioritized, concrete)

All in `src/engine/generate.js` unless noted. Each new feature must draw from
a **new named RNG substream** (`substream(seed, 'templates')` etc.) to honor
the seed-stability contract at the top of `generate.js`.

- **G1 (P0) — Pin ≠ green center.** Add `course.pin` offset within the green
  (new substream `'pin'`); keep `course.hole` as green anchor for legacy.
  Update `strokesField`'s `holeD` and all `course.hole` reads in
  `strategy.js`/`dispersion.js` to use the pin. Without an off-center pin,
  no green-side hazard can create a preferred side. (Blocked on nothing;
  unblocks G2, G5.)
- **G2 (P0) — Move hazards off the line and onto a *side* at range.**
  Replace the blob placement at `generate.js:109-111`: instead of
  `t = 0.25 + hazards()·0.55` along the direct line, place the two largest
  blobs at **driver range** (11–15 tiles from tee, the scratch landing zone
  per `MAX_CARRY = 15`) offset 2–4 tiles perpendicular to the spine on the
  side *nearer the pin* (needs G1). Reward: shorter next shot / open angle
  past the greenside hazard on that side. This single change converts
  "dodge the pond" into "hug the pond."
- **G3 (P1) — Width with a preferred side.** Fairway buffer radius at
  `generate.js:89` from `randInt(1,2)+0.5` (24–40 yd wide) to per-segment
  2.5–4.5 tiles (**80–140 yd** wide in the landing zone, tapering near the
  green), then re-narrow by dropping rough/`TREES` on the *safe* side's
  outer edge. Wide corridors are what make aim choice non-trivial for wide
  dispersions ([Fried Egg 101](https://www.thefriedegg.com/articles/golf-course-architecture-101-part-1-playability-width-options-strategy)).
- **G4 (P1) — Centerline bunker.** New optional stage: 30% of straight/long
  holes get a 1–1.5-tile `SAND` disc *on the spine* at 11–14 tiles from the
  tee, with G3 width around it. Cheapest fork we can build
  ([Woking 4](https://www.thefriedegg.com/articles/woking-golf-club-4th)).
- **G5 (P1) — Cape stage for doglegs.** For `dogleg-*` archetypes, lay a
  `WATER` band along the inside of the bend from the bend control point
  toward the tee, so carry-to-clear grows linearly along the aggressive
  line (8 → 14 tiles). Delete the equivalent mass of random on-line blobs.
- **G6 (P2) — Template archetypes.** Extend `ARCHETYPES` with
  `'redan'`, `'road'`, `'short'`, `'punchbowl'` as par-3/short-4 specials
  (par-3 length via existing `opts.holeDistTiles` path, `yards.js:
  HOLE_LENGTHS`). Redan/punchbowl require allowing `SLOPE_*` terrain in the
  classic biome's green surround (today slopes are alpine-only,
  `generate.js:171-181`); `restingCell`/`shots.js` already handle slope
  shedding. Road = `SAND` pot front-center + penal band behind green.
- **G7 (P2) — Recovery asymmetry.** Bias tree clumps (`generate.js:94-103`)
  to one side of the corridor only; leave the other side open rough. A miss
  isn't a decision unless the two miss sides cost differently.
- **G8 (P3) — Certification gate.** Wire §4's metrics into
  `src/engine/puzzle.js: makePuzzle`'s reroll loop (it already rerolls
  degenerate seeds deterministically) so only certified-strategic holes
  ship in `round.js` slots marked "standard"/"rude".

## 4. Certifying a hole is *strategic* (metrics)

Implement in a new `src/engine/certify.js`, consuming `strokesField`,
`aimHeatmap`, `bestAim` — all existing. A hole passes if it clears **M1 and
at least one of M2/M3**, on the tee shot or first approach:

- **M1 — Fork.** Compute `aimHeatmap(course, V, from, 1)`. Find local minima
  basins ≥ 4 tiles (64 yd) apart. Require: second-best basin within
  **0.10 strokes** of the best, and the ridge between them ≥ best + **0.15**.
  (Two viable lines, genuinely separated — MacKenzie #6 as arithmetic.)
- **M2 — Profile divergence.** `|bestAim(tour) − bestAim(twenty)| ≥ 3 tiles`
  (48 yd), using `HANDICAPS[0]` vs `HANDICAPS[3]`. The hole must "play
  different lengths" across dispersions — strategic-school fairness.
- **M3 — Center-line penalty.** Let `c` = the naive aim (farthest safe point
  on the direct line, or pin-at-max-reach). Require
  `E(c) − E(best) ≥ 0.15` strokes. If aiming dead at it is optimal, the
  hole teaches nothing.
- **M4 — Temptation (anti-boredom).** The best aim's pattern
  (`patternStats`) must carry ≥ 10% combined sand/water/trees probability,
  *or* a second basin within 0.10 strokes must carry ≥ 25%. Guarantees the
  optimal line actually flirts with trouble (heroic ingredient).
- **Threshold notes.** 0.10/0.15 strokes ≈ 100–150 points at the
  `exp(−3·sg)` scale (`strategy.js:111`) — large enough to feel, small
  enough that both lines stay defensible. Tune after the §6 recalibration
  (today's compressed E-field would pass almost nothing).

---

## 5. Strokes-gained framework (findings)

- **Definition.** SG per shot = E(before) − E(after) − 1, against a baseline
  E(distance, lie). Adopted by the PGA Tour in 2011 from Broadie's work
  ([Broadie, *Assessing Golfer Performance on the PGA TOUR*, 2011 (PDF)](https://columbia.edu/~mnb2/broadie/Assets/strokes_gained_pga_broadie_20110408.pdf),
  [*Every Shot Counts*](http://everyshotcounts.com/248-2/)).
- **Category boundaries** (industry standard; [Shot Scope](https://shotscope.com/blog/practice-green/stats-and-data/what-is-strokes-gained/),
  [golfity](https://golfity.com/strokes-gained/)):
  **OTT** = tee shots on par 4/5; **APP** = shots toward the green outside
  30 yd (commonly "100+ yd" on tour broadcasts, 30 yd in Shot Scope-style
  trackers); **ARG** = within 30 yd of the green, not on it; **PUTT** = on
  the green.
- **Benchmark anchors** (PGA Tour, Broadie 2004–2012 unless noted):
  - Fairway E-to-hole: **100 yd 2.80, 160 yd 2.98**; rough 100 yd **3.02**;
    tee of a 400-yd par 4 **3.99** ([thediygolfer](https://www.thediygolfer.com/golf-terms/strokes-gained),
    [pinflag](https://pinflag.io/guides/strokes-gained-off-the-tee),
    [golfity](https://golfity.com/blog/understanding-strokes-gained-off-the-tee/)).
  - One-putt %: **2 ft 99, 3 ft 96, 4 ft 88, 5 ft 77, 8 ft ~50 (some
    seasons 56), 10 ft 40, 15 ft 23, 20 ft 15, 30 ft 7, 40 ft 4, 50 ft 3,
    60 ft 2** ([The Brassie](https://thebrassie.com/putt-percentage-by-distance/),
    [Golfing Focus](https://golfingfocus.com/what-percentage-of-putts-do-pros-make-tv-does-not-tell-the-story/),
    [Scott Sackett](https://www.scottsackett.com/putting-probabilities/)).
  - Expected putts: **10 ft ≈ 1.61**; ~2.0 from ~33 ft
    ([Golf Analytics](https://golfanalytics.wordpress.com/2014/10/09/predicting-putting-performance-by-distance/)); 8 ft ≈ 1.50 follows from 50% make with negligible 3-putt risk.
  - Where strokes are won: 90-shooter vs 80-shooter gap = **40% approach,
    28% driving, 17% short game, 15% putting**
    ([golfity — categories guide](https://golfity.com/blog/the-complete-guide-to-strokes-gained-categories/),
    [Golf Insider](https://golfinsideruk.com/strokes-gained-explained/));
    70 vs 80-shooter: putting explains only ~1.5 strokes vs ~6.5 from
    outside 100 yd ([golf.com — Broadie profile](https://golf.com/travel/the-man-with-two-brains-stokes-gained-guru-mark-broadies-pioneering-analytics-have-radically-altered-the-game/)).
  - Amateur putting (Shot Scope/Arccos): 20-hcp makes **90% from 0–3 ft,
    ~70% inside 6 ft, 7% from 18–24 ft**; scratch ~97% inside 2 ft
    ([MyGolfSpy make% by handicap](https://mygolfspy.com/news-opinion/putting-make-percentage-by-handicap-full-chart-are-you-above-or-below-average/),
    [Shot Scope](https://shotscope.com/blog/practice-green/stats-and-data/putting-make-percentages-by-handicap-how-do-you-compare/),
    [Golf Monthly/Arccos](https://www.golfmonthly.com/features/amateur-golfers-make-less-than-40-percent-of-putts-from-this-crucial-length-arccos-data-reveals-stark-putting-truths)).

## 6. Calibration audit — engine vs published baselines (measured)

Measured with Monte-Carlo + the committed model (scratch profile, caddie
pace ≈ 7 ft past unless noted). 1 tile = 48 ft.

| Putt | Engine make% | PGA make% | Engine E putts (`puttsFrom`) | PGA E putts |
|---|---|---|---|---|
| 3 ft | 96% | 96% | 1.00 | 1.04 |
| 8 ft | **86%** | **~50%** | **1.00** | **~1.50** |
| 20 ft | **65%** (58% via 48-pt preview) | **15%** | **1.15** | **1.87** |
| 30 ft | 53% | 7% | 1.35 | ~1.98 |
| 60 ft | 34% | 2% | 1.66 | ~2.21 |

Root causes, precisely:

- `CUP_R = 0.058` tiles = **2.8 ft capture radius** (`dispersion.js:169`).
  A real cup is 4.25 in wide (0.18 ft radius) — we're ~15× too generous.
- `PUTT_OVERRUN = 2.5` tiles = **120 ft** (`dispersion.js:170`). The
  capture-shrinks-with-overrun gradient is thus ~flat. Measured exploit:
  make% on an 8-footer is **maximized (98.9%) by aiming 31 ft past**; on
  20–60-footers best pace is 22–31 ft past. `PACE_CANDIDATES` (max 0.65
  tiles = 31 ft past, `strategy.js:150`) and `PUTT_PACE_GRID` (max 1.9
  tiles = **91 ft past**, `strategy.js:234`) happily explore this. Real
  optimal pace is ~1–2 ft past (Pelz's classic answer is ~17 in;
  [die 6–18 in past](https://rxgolfnetwork.com/lag-putt-drill-with-dave-pelz/)).
- `puttSigmas` (`dispersion.js:178-184`): pace σ at 8 ft is 5.4 ft (huge)
  while line σ grows far too slowly (2.6 ft at 8 ft → only 3.1 ft at
  20 ft). Real make-curve steepness (96% @3 ft → 15% @20 ft) requires
  effective line error growing ~4× from 8→20 ft against a fixed cup.
- `expectedPutts` (`strategy.js:18-21`): `1 + 0.13·d` ⇒ 1.05 putts from
  20 ft, 1.16 from 60 ft. **And greens are excluded from the value-iteration
  sweep** (`strokesField` only pushes non-green cells into `order`), so this
  crude curve — not the better `puttsFrom` table — is the *final* value of
  every green cell that all approach decisions are priced against.

Downstream distortion (measured on a flat all-fairway reference course,
`strokesField`, scratch):

| From fairway | Engine E | Broadie E |
|---|---|---|
| 50 yd | 2.04 | ~2.66 |
| 100 yd | 2.15 | 2.80 |
| 150 yd | 2.11 | ~2.95 |
| 200 yd | 2.18 | 3.19 |
| 400 yd (tee) | 3.14 | 3.99 |
| 100 yd rough | 2.12 | 3.02 |

Two structural effects: (a) E barely rises from 50→250 yd because any point
≤ 240 yd can reach the 80-yd-wide green disc and two-putt is nearly
impossible; (b) rough costs ~0.03 strokes vs the real ~0.22. So today the
optimal aim is insensitive to proximity, lie, and pin — the three levers
all of §3's architecture depends on. **Calibration is a prerequisite for
strategy, not a polish item.**

Also checked, and fine: full-swing `sigmas` (`dispersion.js:44-53`) give a
scratch driver lateral 1σ ≈ 21.5 yd at 240 — consistent with its own design
comment and plausible vs tour data. One flag: at 96 yd carry our lateral 1σ
is 10.7 yd (32 ft), which implies mean wedge proximity ≈ 30+ ft even for the
`tour` profile vs the real tour's **17–18 ft from 75–100 yd**
([Mike Bury — tour proximity 50–200 yd](https://mikebury.com/2023/10/22/pga-tour-averages-proximity-to-hole-50-200-yards/),
[GolfWRX wedge stats](https://www.golfwrx.com/667607/the-wedge-guy-what-we-can-learn-from-tour-stats/)) — see C6.

## 7. SG calibration change list (exact constants)

Ordered; C1–C4 are one release and must land before the §3 generator work
is evaluated (they reshape every E-field).

- **C1 — Empirical make curve (recommended design).** In
  `src/engine/dispersion.js`, add a baseline table and make holing a
  seeded Bernoulli draw against it, keeping the ellipse for *where misses
  finish*:
  ```js
  // one-putt probability by feet (PGA anchors; log-interp between)
  export const MAKE_CURVE = [[2,.99],[3,.96],[4,.88],[5,.77],[6,.66],[8,.50],
    [10,.40],[15,.23],[20,.15],[30,.07],[40,.04],[50,.03],[60,.02]];
  ```
  scaled per profile (see C5). Rationale: we fitted the geometric
  model (cup radius × shrink × ellipse) against the PGA curve and it cannot
  hit 96% @3 ft and 15% @20 ft simultaneously with distance-linear sigmas —
  the residuals were 20–30 points. An empirical curve is honest, cheap, and
  exactly what Broadie's framework does anyway.
- **C2 — If keeping the geometric model instead**, best-fit constants
  (residuals ±5–8 points at short range, documented in scratchpad fits):
  `CUP_R 0.058 → 0.030`, `PUTT_OVERRUN 2.5 → 0.09` (4.3 ft),
  `puttSigmas.long (0.08 + 0.10·d) → (0.008 + 0.09·d)`,
  `puttSigmas.lat (0.04 + 0.045·d) → (0.002 + 0.155·d + 0.02·d²)`.
- **C3 — Pace grids to human scale.** `strategy.js:150 PACE_CANDIDATES →
  [0, .01, .02, .03, .045, .065, .09, .13]` (0–6 ft past);
  `strategy.js:234 PUTT_PACE_GRID → [-.06,-.04,-.025,-.015,-.008, 0, .005,
  .01, .016, .024, .034, .05, .07, .10, .14, .19]` (÷10). `dispersion.js:165
  PUTT_MAX 20 → 2.5` tiles (120 ft — longest realistic putt; today's value
  is 960 ft).
- **C4 — One putting truth.** `strategy.js:18 expectedPutts` becomes a
  lookup of the Broadie-shaped curve (feet: 3→1.04, 8→1.50, 10→1.61,
  15→1.78, 20→1.87, 30→1.98, 40→2.06, 60→2.21, cap 2.5 at 90),
  and `strokesField:38` should call `puttsFrom` (already tabulated & cached)
  instead, so the field and the putt game price greens identically.
- **C5 — Handicap putting factors.** Replace `puttSkill = sqrt(base)`
  (`dispersion.js:173-175`) with per-profile make-curve shifts calibrated to
  Shot Scope: 20-hcp ≈ tour curve shifted ~0.75× at 6 ft (70% vs 92% inside
  6 ft), scratch ≈ 0.9×. Putting skill spreads are *narrow* (Broadie: 15% of
  the 90→80 gap), so the multipliers must be much closer to 1 than the
  full-swing `base` values (0.78–1.7).
- **C6 — Wedge-range dispersion.** `dispersion.js:51 lat: (0.22 + d·0.075)`
  → `(0.10 + d·0.082)`: keeps driver lateral ≈ 21 yd but brings 96-yd
  lateral 1σ to ≈ 8.7 yd (26 ft), putting `tour`-profile wedge proximity in
  the ~18-ft ballpark. Re-verify M1–M4 thresholds after.
- **C7 — Green size honesty.** `generate.js:117 stampDisc(course, hole.x,
  hole.y, 2.5, GREEN)` → radius `1.0–1.5` (16–24 yd radius; real greens
  average ~5–6,000 sq ft, ~26 paces deep —
  [Golf Course Industry](https://www.golfcourseindustry.com/article/determining-green-size/),
  [Pitchmarks](https://pitchmarks.com/what-is-the-average-size-of-a-putting-green/)).
  Vary per hole; `Short`-template greens stay big, `Road` greens small.
- **C8 — Career analytics restructure.** `src/engine/stats.js` stores only
  round aggregates. Add a per-shot record
  `{lieBefore, ydsBefore, lieAfter, ydsAfter, penalty}` emitted by
  `game.js`/`round.js`, compute per-shot SG against the (now-calibrated)
  field, and bucket into **OTT / APP / ARG / PUTT** using the §5
  boundaries (ARG = within 30 yd ≈ 2 tiles of green edge, off-green).
  Career screens then answer Broadie's question — *where* you lose strokes
  — instead of only streaks and vs-par (today's `summary()`).
- **C9 — Water re-drop.** `strategy.js:15 PENALTY = 1` with replay-from-spot
  is stroke-and-distance only; real golf usually allows a lateral drop
  costing less than S&D. Low priority; revisit after C1–C4 shift E-fields.

## 8. Certification thresholds depend on calibration

Re-run §4's M1–M4 only after C1–C4: in today's compressed field a 0.15-stroke
ridge is enormous; post-calibration it is ~a fifth of the real fairway-vs-
water gap. Add a regression test that pins the flat-course table in §6 to
Broadie ±0.15 strokes (new `test/` case using the reference-course script).

---

### Sources (deduplicated)

Architecture: [Fried Egg — Three Schools](https://www.thefriedegg.com/articles/three-schools-of-golf-course-design) ·
[Fried Egg — Architecture 101](https://www.thefriedegg.com/articles/golf-course-architecture-101-part-1-playability-width-options-strategy) ·
[Fried Egg — Woking 4](https://www.thefriedegg.com/articles/woking-golf-club-4th) ·
[Fried Egg — Angle Debate](https://www.thefriedegg.com/articles/exploring-angle-debate) ·
[Fried Egg — Macdonald's Ideal Holes](https://www.thefriedegg.com/articles/ideal-golf-holes-cb-macdonald) ·
[golf.com — 3 Schools](https://golf.com/travel/3-schools-golf-course-architecture/) ·
[golf.com — Template holes](https://golf.com/travel/what-are-template-holes-important-golf-design/) ·
[Evalu18 — Templates](https://evalu18.com/template-holes/) ·
[LINKS — Templates](https://linksmagazine.com/template-holes/) ·
[Golf Compendium — MacKenzie 13](https://www.golfcompendium.com/2021/11/alister-mackenzie-13-principles-golf-course-design.html) ·
[GCA — MacKenzie ranked](https://www.golfcoursearchitecture.net/content/architects-rank-mackenzies-theories) ·
[ASGCA / Ian Andrew — Strategy of Bunkering](https://asgca.org/qthe-origin-of-bunkersq-an-original-piece-from-ian-andrew-asgca/) ·
[GCA — Width for the Sake of Width](https://golfclubatlas.com/in-my-opinion/width-for-the-sake-of-width/) ·
[Eamon Lynch — Doak](https://eamonlynch.com/2018/12/04/the-journey-of-tom-doak/)

Strokes gained: [Broadie 2011 PDF](https://columbia.edu/~mnb2/broadie/Assets/strokes_gained_pga_broadie_20110408.pdf) ·
[Every Shot Counts](http://everyshotcounts.com/248-2/) ·
[thediygolfer — SG](https://www.thediygolfer.com/golf-terms/strokes-gained) ·
[golfity — SG categories](https://golfity.com/blog/the-complete-guide-to-strokes-gained-categories/) ·
[Shot Scope — SG](https://shotscope.com/blog/practice-green/stats-and-data/what-is-strokes-gained/) ·
[The Brassie — make% by distance](https://thebrassie.com/putt-percentage-by-distance/) ·
[Golfing Focus — pro make%](https://golfingfocus.com/what-percentage-of-putts-do-pros-make-tv-does-not-tell-the-story/) ·
[Golf Analytics — putting by distance](https://golfanalytics.wordpress.com/2014/10/09/predicting-putting-performance-by-distance/) ·
[Scott Sackett — putting probabilities](https://www.scottsackett.com/putting-probabilities/) ·
[MyGolfSpy — make% by handicap](https://mygolfspy.com/news-opinion/putting-make-percentage-by-handicap-full-chart-are-you-above-or-below-average/) ·
[Shot Scope — make% by handicap](https://shotscope.com/blog/practice-green/stats-and-data/putting-make-percentages-by-handicap-how-do-you-compare/) ·
[MyGolfSpy — 3-putt case study](https://mygolfspy.com/news-opinion/shot-scope-case-study/) ·
[golf.com — Broadie profile](https://golf.com/travel/the-man-with-two-brains-stokes-gained-guru-mark-broadies-pioneering-analytics-have-radically-altered-the-game/) ·
[MyGolfSpy — Accuracy vs Distance](https://mygolfspy.com/news-opinion/study-accuracy-versus-distance/) ·
[Stagner #58 — Fairway vs Rough](https://newsletter.loustagnergolf.com/p/fairway-vs-rough) ·
[golf.com — Stagner GIR](https://golf.com/instruction/greens-in-regulation-vs-fairways-hit-lou-stagner/) ·
[DECADE](https://decade.golf/about/) ·
[Golf Digest — Fawcett](https://www.golfdigest.com/story/course-management-expert-scott-fawcett-tips-smarter-golf) ·
[MyGolfSpy — DECADE](https://mygolfspy.com/news-opinion/cracking-the-course-management-code-with-decade/) ·
[Mike Bury — tour proximity](https://mikebury.com/2023/10/22/pga-tour-averages-proximity-to-hole-50-200-yards/) ·
[Golf Course Industry — green size](https://www.golfcourseindustry.com/article/determining-green-size/) ·
[Pitchmarks — green size](https://pitchmarks.com/what-is-the-average-size-of-a-putting-green/) ·
[Pelz lag drill](https://rxgolfnetwork.com/lag-putt-drill-with-dave-pelz/)
