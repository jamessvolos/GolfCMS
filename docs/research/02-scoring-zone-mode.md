# Research 02 — "Scoring Zone" Mode: Short-Game Design & Build Plan

*Research memo, 2026-08-10. Companion to `docs/research/01-architecture-and-sg.md`
(whose calibration list C1–C7 is a hard prerequisite for this mode's scoring
to mean anything). All file/constant references are to this repo.*

---

## 1. Research: how short-game skill is actually trained and measured

### 1.1 Wedge distance-control systems

- **Pelz 3×4 system** (*Dave Pelz's Short Game Bible*): 4 wedges (PW/GW/SW/LW)
  × 3 backswing lengths keyed to a clock face (7:30, 9:00, 10:30) = **12
  repeatable carry distances**. The insight: remove tempo as a variable;
  distance is controlled by *discrete backswing stops*, not feel. Mickelson
  credits it for his Masters wins.
  Sources: [Pelz Golf — tribute](https://pelzgolf.com/tribute/),
  [Golf Club Brokers — wedge distance control guide](https://www.golfclubbrokers.com/blog/distance-control-with-wedges),
  [GolfWRX forum — Pelz wedge method](https://forums.golfwrx.com/topic/1238024-anyone-use-the-dave-pelz-wedge-method/).
- **Design consequence for Caddie**: the wedge shot should be presented as a
  *discrete menu of carries with known dispersion* (a 12-slot "clock book"),
  not a free-form power slider. The player's decision is *which number to
  fly and where to land it* — exactly our drag-to-aim grammar, one level
  finer.

### 1.2 Benchmarks that define "good" in the scoring zone

- **Scramble (up-and-down) % by distance, PGA Tour**: **<10 yd 85%,
  10–20 yd 64%, 20–30 yd 52%, >30 yd 27%**
  ([Golf Analytics — scrambling skill](https://golfanalytics.wordpress.com/2013/06/29/an-accurate-measurement-of-scrambling-skill/),
  [pgatour.com around-the-green stats](https://www.pgatour.com/stats/around-green),
  [pgatour.com scrambling 20–30 yd](https://www.pgatour.com/stats/detail/367)).
  Sand saves run ~50% overall; the distance leaders from 10–20 yd sit near
  75% ([golfity — sand save %](https://golfity.com/blog/what-is-sand-save-percentage/)).
- **Proximity, tour averages**: 50–75 yd ≈ **16½–25 ft** depending on season
  and lie mix; 75–100 yd ≈ **17–18 ft**. Hitting a 75–100-yd wedge to 20–25 ft
  is as "normal" for a tour player as hitting it to 3 ft
  ([Mike Bury — proximity 50–200 yd](https://mikebury.com/2023/10/22/pga-tour-averages-proximity-to-hole-50-200-yards/),
  [golf.com — how close from 100 yards](https://golf.com/instruction/approach-shots/100-yards-approach-shots-how-close/),
  [MyGolfSpy/Arccos — the 50-yard wedge](https://mygolfspy.com/labs/arccos-the-50-yard-wedge-shot/)).
  These set our SG-ARG baseline curve and our "grade" bands.
- **Broadie short-game anchors** for the baseline table: fairway 100 yd 2.80,
  rough 100 yd 3.02 (doc 01 §5); sand ~54 yd ≈ 3.0.
- **Amateur reality** (for handicap profiles): 20-hcp make% 90% from 0–3 ft,
  ~70% inside 6 ft, 7% from 18–24 ft (doc 01 §5) — the scoring-zone gap
  between handicaps is mostly *leave quality*, not putting stroke.

### 1.3 Putting practice canon (what the putt half should teach)

- **Gate drill** (line, short range — Tiger's staple), **ladder drill**
  (pace: finish between markers at 5/10/15 ft), **clock drill** (12 balls
  around the cup at 3–6 ft), **Pelz lag drill**: die the ball **6–18 in past
  the cup** (his classic number: ~17 in) — never race it.
  Sources: [Chiputt — tour-proven drills](https://thechiputt.com/blogs/golf-tips/tour-proven-putting-drills-lower-scores),
  [Phoenix Putter Co — lag drills](https://phoenixputterco.com/blogs/news/7-lag-putting-drills-that-will-transform-your-distance-control),
  [RX Golf — Pelz lag drill](https://rxgolfnetwork.com/lag-putt-drill-with-dave-pelz/),
  [Backswing — lag putting roundup](https://backswing.com/roundup/what-is-your-best-drill-for-improving-lag-putting/).
- **Design consequence**: the putt decision axis stays **pace-first** (our
  engine already got this right conceptually — `strategy.js` searches pace
  along the line) but the *taught* optimum must be ~1–2 ft past, which
  requires doc 01's C1–C3 recalibration first.

### 1.4 Green complexes (what the playfield must model)

Real greens average ~5,000–6,000 sq ft (roughly 25–30 yd deep), with 14–21
pin positions and strategy created by tiers, ridges and runoffs; multi-target
greens are deliberately divided into zones
([Golf Course Industry — determining green size](https://www.golfcourseindustry.com/article/determining-green-size/),
[Pitchmarks — average green size](https://pitchmarks.com/what-is-the-average-size-of-a-putting-green/)).
"Which section is the pin in, and can I hold that section?" is the entire
short-game question — it cannot be asked on our current 16-yd tiles.

---

## 2. Why the current engine can't host this (numbers)

- **Resolution**: 1 tile = 16 yd = 48 ft (`yards.js:YARDS_PER_TILE`). A
  30-yd pitch spans <2 tiles; `bestAim`'s integer-tile target grid offers a
  handful of aim candidates where the real decision space is continuous.
- **Green geometry**: `generate.js:117` stamps a green of radius 2.5 tiles =
  40 yd (≈80 yd across, ~13× the area of a real average green), flat, with
  the hole at its exact center. There are no sections to choose, no
  short-side, no runoffs.
- **No landing→rest separation**: `restingCell` (`dispersion.js:238-245`)
  equates landing point with rest point. Every wedge behaves like a dart;
  trajectory choice (spinny pitch vs runner) — the heart of ARG decisions —
  cannot exist. (Only slopes/ice biomes move a ball after landing, in
  `shots.js`.)
- **Lie model too coarse**: `lieParams` (`dispersion.js:14-19`) has one
  rough and one sand; no distinction between a greenside bunker splash and
  a 40-yd bunker shot (the hardest shot in golf), no fringe/collar lie.
- **Scoring**: `expectedPutts`/green handling make every leave inside 40 ft
  nearly free (doc 01 §6), so up-and-down % would grade ~100%.

---

## 3. Mode design — "Scoring Zone"

### 3.1 Session shape

- **5 scenarios per round** (mirrors the 9-hole `ROUND_CURVE` idea in
  `round.js`, but shorter — one sitting ≈ 4 min). Daily seed variant plus
  free-play seeds, reusing the `substream(seed, ...)` discipline.
- Scenario = `{start distance, lie, green complex, pin, wind?}` drawn from
  bands with fixed weights (new `src/engine/scoringzone.js`):

  | Slot | Distance | Lie | Teaches |
  |---|---|---|---|
  | 1 | 15–30 yd | fairway | chip vs pitch trajectory |
  | 2 | 30–50 yd | rough (50%) / fairway | the "in-between" distance ([Left Rough — 50–75 yd wedges](https://theleftrough.com/how-to-hit-a-wedge-shot-50-to-75-yards/)) |
  | 3 | 50–70 yd | fairway | Pelz clock carry selection |
  | 4 | 70–90 yd | fairway / rough | full-wedge proximity |
  | 5 | 10–40 yd | **sand** | splash vs the long bunker shot |

- Every scenario is **certified** like `puzzle.js` puzzles: solver proves an
  up-and-down line exists; doc 01's fork metric M1, applied at wedge scale,
  proves the landing-spot choice is a real choice (e.g. fly-to-back-tier vs
  land-front-and-release must differ by ≤0.10 E with a ridge between).

### 3.2 The two decisions

1. **Landing spot + trajectory.** Player picks a club-trajectory from a
   3-item menu — `spinny` (high, ~5% rollout), `standard` (~15%), `runner`
   (low, ~40% rollout, tighter dispersion, blocked by rough/sand carries) —
   then drags a **landing** point (not a finish point). The HUD shows the
   landing ellipse *and* the predicted roll-out cone to rest, exactly like
   today's `patternStats` dots but with the bounce/roll model applied.
   Decision scored SG-style against the best (landing, trajectory) pair.
2. **The putt.** Existing pace-first putt machinery (`bestPutt`,
   `scorePuttDecision`) on the fine green, now with **break**: slope tiles
   bend `puttPoints` trajectories (aim point ≠ cup on side slopes), so line
   joins pace as a genuine axis. Reveal keeps `puttHeatmap`.

### 3.3 Scoring: SG-ARG and SG-PUTT

- Per shot: `sg = E(before) − E(after) − 1` against the **scoring-zone
  baseline table** (below), same `points = 1000·exp(−3·sgLost)` scale as
  `strategy.js:111` so arcade scores stay comparable.
- Round summary: total SG-ARG, SG-PUTT, **up-and-down %** vs the tour
  scramble curve (85/64/52/27 by band, §1.2), **proximity** vs the tour
  proximity curve (§1.2), and a per-band skill readout ("You lose most from
  30–50 yd rough") — Broadie's diagnosis loop, miniaturized.
- Grades per handicap profile (`HANDICAPS`): a 20-hcp getting up-and-down
  from 20 yd 50% of the time is *tour-adjacent* and should be told so.

### 3.4 Engine additions (named)

- **`src/engine/greens.js` (new)** — fine green complex:
  - `GREEN_FT = 6` — feet per green-grid cell (⅛ tile). A 30-yd-deep green
    is then a ~15×15 fine grid; an 8-ft putt spans >1 cell instead of 0.17
    tiles.
  - Complex generator (own substream `'greenx'`): elliptical green 18–32 yd
    deep, 1–2 features from {back tier (+8–14 in), diagonal ridge, false
    front (2–3 cells shedding forward), collar runoff, punchbowl rim},
    fringe ring, 1–2 greenside `SAND`/`WATER` cells inherited from the
    parent tile map.
  - `pinSheet(complex)` → 6–9 legal pins ≥ 2 cells from edges/features
    (mirrors real 14–21 pin practice, §1.4); scenario picks one.
  - Elevation field drives both putt break and roll-out shedding.
- **`src/engine/rollout.js` (new, or a section in `dispersion.js`)** —
  landing→rest: `restAfterLanding(complex, landing, traj, lie)` walks the
  ball downslope with per-trajectory rollout fractions
  `ROLLOUT = { spinny: 0.05, standard: 0.15, runner: 0.40 }`, rough **flyer**
  variance (+10–15% carry σ from rough lies), and firmness scalar per
  course/biome (links = firm, doubles rollout).
- **`src/engine/wedges.js` (new)** — the Pelz clock book:
  `WEDGE_BOOK`: 12 carries from 12 to 90 yd (4 wedges × 3 clock stops), each
  with its own `sigmas` override — partial swings get *worse relative*
  distance control: `σ_long(partial) = 0.05 + 0.08·d` tiles with a per-lie
  multiplier `{fairway: 1, rough: 1.35, sand: 1.9}` and a fat/thin tail for
  `ten`/`twenty` profiles (rare ±40% carry outcome, the true amateur miss).
- **`src/engine/baselines.js` (new, shared with doc 01 C8)** — the
  published tables as data: fairway/rough/sand E-to-hole by yardage, putt
  make% and expected putts by feet, scramble% and proximity by band, with
  per-profile scaling. Single source of truth for scoring *and* career SG.
- **`src/engine/strategy.js`** — `strokesField` unchanged for full holes;
  scoring-zone uses a fine-grid variant `strokesFieldFine(complex, profile)`
  over the green grid only (value iteration over ~900 cells converges
  fast; reuse `bestAim` shape with the wedge book as the action set).
- **Renderer** — green-complex inset view (zoom to green when inside 100 yd),
  contour shading from elevation, pin flag ≠ green center. (Page work in
  `index.html`/`arcade.html` shell per the redesign charters in
  `docs/redesign/00-user-study.md`.)

Seed-stability contract: all new draws come from fresh substreams
(`'greenx'`, `'pin'`, `'scoringzone'`), so classic full-hole seeds stay
byte-identical, per the promise at the top of `generate.js`.

---

## 4. Build plan — three releases

### Release 1 — "Scenario harness" (foundation)

*Scope*: playable mode with honest scoring, coarse visuals.

1. Land doc 01 **C1–C4** (putting recalibration + one putting truth) —
   without it, up-and-down % grades ~100% and SG-ARG is noise.
2. `baselines.js` with the §1.2 tables + tests pinning them to the cited
   values.
3. `scoringzone.js`: scenario sampler (bands table §3.1), certification via
   existing `solve`/`verifyLine` (`solver.js`), 5-scenario session loop.
4. Scoring: SG-ARG/SG-PUTT per decision using the existing tile engine
   (`evaluateAim`/`evaluatePutt`), summary screen with up-and-down % and
   proximity vs tour curve.
5. Ship behind one "Scoring Zone" entry in the shared shell (players-only
   nav per the redesign; no new footer soup).

*Exit criteria*: scratch-profile simulated optimal play scores within ±10
points of the tour scramble curve per band; a blind A/B (existing
`ab.html`/`audit.html` tooling) shows scenario decisions have ≥0.15 E spread
between best and plausible-worst choices.

### Release 2 — "Real greens"

1. `greens.js` fine grid (`GREEN_FT = 6`), elevation features, `pinSheet`,
   green inset renderer with contour shading.
2. `rollout.js` landing→rest + trajectory menu (`spinny/standard/runner`);
   `wedges.js` clock book as the action set; landing-ellipse + rollout-cone
   preview.
3. Putt break from elevation (bend `puttPoints`; aim-line UI shows the
   read); `strokesFieldFine` powering both decisions.
4. Re-certify scenarios with fork metric M1 at wedge scale; retire any
   scenario where one trajectory dominates everywhere.

*Exit criteria*: pin position visibly moves the optimal landing spot
(profile-divergence metric M2 ≥ 2 fine cells between front and back pins on
≥70% of scenarios); putt make% table still matches `baselines.js` ±3 points
on the fine grid.

### Release 3 — "Practice systems & career"

1. **Drill modes** on the same engine: Pelz 3×4 ladder (hit each of the 12
   book distances to proximity targets), clock-drill putting (12× 4-footers
   with break), gate/lag drills (finish 6–18 in past — scored on finish
   pace, teaching the Pelz optimum directly).
2. **Career SG**: extend `stats.js` per doc 01 C8 with ARG/PUTT buckets and
   per-band history; "weakest band" surfaced on the summary screen.
3. **Adaptive sampler**: `scoringzone.js` serves the player's weakest band
   ~40% of the time (spaced-repetition weighting over the per-band SG
   history), dailies stay fixed-seed for fairness.
4. Streaks/leaderboard integration mirroring `dailyStreak`
   (`stats.js:16-25`) and the existing daily plumbing.

*Exit criteria*: retention instrumentation shows drill completion; per-band
SG trends visible over ≥10 sessions; zero regressions in classic-mode seeds
(byte-identical course hashes in `test/`).

---

## 5. Risks & open questions

- **Perf**: `strokesFieldFine` per scenario is ~900 cells × small action set
  — well under the full-course field cost; precompute per scenario at
  generation, cache with the certificate like `puzzle.js` does.
- **Difficulty inflation**: post-recalibration, real up-and-down rates are
  humbling (52% from 20–30 yd *for the tour*). Surface grades against the
  player's handicap profile, not against tour, or the mode will feel
  punishing (MacKenzie #12: fun for the novice too).
- **Sand realism**: the 30–50 yd bunker shot should be the hardest scenario
  in the game (tour sand save from 30+ yd is rare); make sure `wedges.js`
  sand multipliers reproduce that, and say so in the caddie voice.
- **Open**: does wind apply inside 100 yd? Real effect is small on wedges;
  `windShift` already scales with carry (`k = min(1, d/10)`), which at ≤6
  tiles gives ≤60% wind — probably fine; re-check on links biome.

---

### Sources

[Pelz Golf tribute](https://pelzgolf.com/tribute/) ·
[Golf Club Brokers — wedge distance control](https://www.golfclubbrokers.com/blog/distance-control-with-wedges) ·
[GolfWRX — Pelz wedge method](https://forums.golfwrx.com/topic/1238024-anyone-use-the-dave-pelz-wedge-method/) ·
[Golf Analytics — scrambling](https://golfanalytics.wordpress.com/2013/06/29/an-accurate-measurement-of-scrambling-skill/) ·
[pgatour.com — around the green](https://www.pgatour.com/stats/around-green) ·
[pgatour.com — scrambling 20–30 yd](https://www.pgatour.com/stats/detail/367) ·
[golfity — sand saves](https://golfity.com/blog/what-is-sand-save-percentage/) ·
[Mike Bury — tour proximity 50–200 yd](https://mikebury.com/2023/10/22/pga-tour-averages-proximity-to-hole-50-200-yards/) ·
[golf.com — 100-yd proximity](https://golf.com/instruction/approach-shots/100-yards-approach-shots-how-close/) ·
[MyGolfSpy/Arccos — 50-yd wedge](https://mygolfspy.com/labs/arccos-the-50-yard-wedge-shot/) ·
[GolfWRX — wedge tour stats](https://www.golfwrx.com/667607/the-wedge-guy-what-we-can-learn-from-tour-stats/) ·
[Left Rough — 50–75 yd wedges](https://theleftrough.com/how-to-hit-a-wedge-shot-50-to-75-yards/) ·
[Chiputt — putting drills](https://thechiputt.com/blogs/golf-tips/tour-proven-putting-drills-lower-scores) ·
[Phoenix Putter — lag drills](https://phoenixputterco.com/blogs/news/7-lag-putting-drills-that-will-transform-your-distance-control) ·
[RX Golf — Pelz lag drill](https://rxgolfnetwork.com/lag-putt-drill-with-dave-pelz/) ·
[Backswing — lag roundup](https://backswing.com/roundup/what-is-your-best-drill-for-improving-lag-putting/) ·
[Golf Course Industry — green size](https://www.golfcourseindustry.com/article/determining-green-size/) ·
[Pitchmarks — green size](https://pitchmarks.com/what-is-the-average-size-of-a-putting-green/) ·
[MyGolfSpy — make% by handicap](https://mygolfspy.com/news-opinion/putting-make-percentage-by-handicap-full-chart-are-you-above-or-below-average/) ·
[Shot Scope — make% by handicap](https://shotscope.com/blog/practice-green/stats-and-data/putting-make-percentages-by-handicap-how-do-you-compare/)
