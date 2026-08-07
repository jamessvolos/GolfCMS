# Fairway Labs — Bake-Off Proposal: GolfCMS → Dynamic Golf Puzzles

**Submission:** 01 | **Firm:** Fairway Labs | **Date:** 2026-08-07 | **Contact:** bakeoff@fairwaylabs.dev

---

## 1. Who We Are

Fairway Labs is a five-person simulation-engineering firm. We build deterministic game
cores for a living: lockstep RTS netcode, replay-verified roguelike dailies, and physics
puzzlers where a byte-identical replay is a contractual requirement, not a nice-to-have.
We do not start with screens. We start with the engine, because in a puzzle game the
engine *is* the product — everything else is presentation.

Our philosophy in one sentence: **if you can't reproduce a puzzle from a 64-bit seed and
verify it's solvable before a human ever sees it, you don't have a puzzle game — you have
a slot machine with grass textures.**

## 2. Vision Statement

GolfCMS becomes a **daily-puzzle golf engine**: every day (or on demand), a seed produces
a procedurally generated hole — terrain, hazards, wind, pin, and ball start — that is
provably solvable in a known stroke count, difficulty-rated by a solver, and replayable
bit-for-bit on any device. Players share seeds the way chess players share FENs.
"Seed 0x9F3A, par 3, I did it in 2" is the entire viral loop. The CMS part of GolfCMS
stops being a content-management chore and becomes a *content-generation* pipeline:
editors curate seeds, they don't hand-author holes.

## 3. Technical Architecture

### 3.1 Layered design (dependency arrows point down only)

```
+--------------------------------------------------+
|  UI Shell (React + Canvas/WebGL renderer)        |
+--------------------------------------------------+
|  Replay & Telemetry (shot logs, ghost playback)  |
+--------------------------------------------------+
|  Solver & Difficulty Rater (search over engine)  |
+--------------------------------------------------+
|  Course Generator (seeded, constraint-driven)    |
+--------------------------------------------------+
|  Simulation Core: physics + shot resolution      |
|  (pure, deterministic, zero I/O, zero Date.now)  |
+--------------------------------------------------+
```

The simulation core has **no dependencies, no floats-from-the-platform, no wall clock**.
Everything above it consumes it as a pure function: `step(state, input) -> state`.

### 3.2 Tech stack — and why

- **TypeScript everywhere, core compiled with strict settings.** One language across
  engine, solver, generator, server, and client means the *same* engine bytes run in the
  browser, in Node for server-side verification, and in CI. No "the server sim disagrees
  with the client sim" class of bugs — there is only one sim.
- **Fixed-point arithmetic (Q16.16 integers) in the core. No IEEE floats.** This is our
  most opinionated call. Cross-platform float determinism (x87 vs SSE vs ARM NEON, fused
  multiply-add, transcendental libm differences) is a tar pit. Integer math is
  deterministic everywhere by construction. We ship a small fixed-point lib with sqrt,
  sin/cos via lookup tables, and property tests proving closure.
- **xoshiro256++ seeded PRNG**, with *named substreams* derived via splitmix64:
  `rng("terrain")`, `rng("wind")`, `rng("ballstart")`. Substreams mean adding a new
  random feature never perturbs existing puzzles' terrain — seed stability across
  versions is a feature we guarantee, per engine version tag.
- **Hex grid + heightfield terrain model** (not free 2D physics). Discrete-ish state
  keeps the solver's search space tractable while the intra-cell ballistic sim keeps
  shots feeling analog. This hybrid is the key to making solvability *provable* rather
  than sampled.
- **Node + Fastify + SQLite (litefs-ready)** for the service tier. Puzzles are ~200-byte
  rows (seed, version, par, difficulty, solver cert). SQLite is boring, embeddable in CI,
  and sufficient until well past 10M puzzles; we refuse to propose Kubernetes for this.
- **Rendering: Canvas 2D first, PixiJS when juice demands it.** The renderer is a dumb
  interpolator over engine snapshots. It can be deleted and rewritten without touching a
  single puzzle.
- **Vitest + golden-replay tests in CI.** Every merge re-simulates a corpus of 500 known
  seeds and diffs final states hash-for-hash. A determinism regression fails the build.

## 4. How Course Generation Works

Generation is a **seeded, staged pipeline with constraint repair** — not naive noise.

1. **Skeleton:** derive hole length and dogleg profile from the seed's `layout`
   substream; walk a spine from tee-area to green-area across the hex field.
2. **Terrain:** layered value noise (seeded, integer-domain) sets elevation; quantize to
   Q16.16 heights. Slopes steeper than a threshold become cliffs/walls.
3. **Feature placement:** hazards (water, bunkers, rough, trees, boost pads in arcade
   mode) placed by weighted rejection sampling along and off the spine, with hard
   constraints: the tee cell, green cell, and a minimum-width corridor may be *shaped*
   but never fully blocked.
4. **Wind & pin:** per-hole wind vector from the `wind` substream; pin placed on the
   green with a tiered offset (center/edge/tucked) that the difficulty target selects.
5. **Repair pass:** a flood-fill reachability check runs *inside generation*. If the
   corridor is severed, the generator deterministically carves the cheapest repair (same
   seed → same repair), rather than rerolling — so generation is total: every seed yields
   a course, and generation time is bounded.
6. **Certification:** the solver (Section 6) runs; its output (min strokes, branch
   factor, hazard-adjacency score) is stored as the puzzle's certificate. Seeds whose
   certificate falls outside the requested difficulty band are skipped by the *curation*
   layer — never mutated.

A puzzle is fully identified by `(engineVersion, seed, ruleset)`. Nothing else is stored;
the course is re-derived on demand and hash-checked against the certificate.

## 5. How Random Ball Starts Work

Ball starts are a **first-class difficulty dial**, not an afterthought:

- The `ballstart` substream picks the start from a *validity mask*: any non-hazard,
  non-green cell with slope under the settle threshold and solver-verified reachability
  to the pin. This enables "recovery puzzles" — you start in the trees, 40 yards off the
  fairway, and par is 2.
- **One seed, many lies:** a single course seed supports N indexed ball starts
  (`ballstart[k]`), giving us puzzle *families* — same hole, escalating lies — for free.
  This is our weekly-ladder mechanic: Monday starts on the fairway, Sunday starts in the
  bunker behind the cart shed.
- Each start is certified independently: the solver re-runs from that lie, so a start is
  only published with its own (min strokes, difficulty) certificate.
- Starts are biased, not uniform: the sampler weights by distance-to-pin band and
  hazard adjacency to hit a requested difficulty tier deterministically.

## 6. How Solvability Is Guaranteed

Three gates, in increasing strength — every published puzzle passes all three:

1. **Topological gate (in-generator):** flood-fill proves a traversable corridor exists
   from ball start to pin. Necessary, cheap (<1ms), not sufficient.
2. **Solver gate:** shots in our engine come from a *finite lattice* — club × aim
   (discretized bearings) × power notches. That finiteness is deliberate: it makes the
   shot graph enumerable. We run IDA* over (ball cell, remaining strokes) with a
   distance/terrain admissible heuristic. If the solver finds a hole-out within the
   stroke budget, the puzzle is solvable *by construction in the same engine the player
   uses* — the solver's winning line is literally a valid replay, stored as the proof.
3. **Humanity gate:** a noisy solver (aim/power perturbed within human-tolerance bands)
   must succeed in ≥X% of trials at the target tier. This kills "solvable only by the
   one pixel-perfect input" degenerates that pure search would happily certify.

Difficulty rating is derived from solver telemetry — search effort, solution-line
narrowness, penalty exposure of near-miss branches, noisy-solver success rate — and
calibrated against real player stroke distributions starting in Wave 3.

## 7. Roadmap — Five Waves

**Wave 1 — Deterministic Core (weeks 1–3).** Fixed-point math lib with property tests;
hex/heightfield terrain model; ballistic + roll/settle shot resolution; `step()` API;
seeded PRNG with substreams; golden-replay CI harness with 500-seed corpus. *Exit
criterion: identical state hashes for the corpus on Linux CI, macOS, and two browsers.*

**Wave 2 — Generator + Solver (weeks 4–7).** Staged generation pipeline with repair
pass; IDA* solver with admissible heuristic; noisy-solver humanity gate; certificate
format; CLI: `golfcms gen --seed 0x9F3A --tier hard` emits course JSON + proof replay.
*Exit criterion: 10,000 seeds generated, 100% certified solvable, p95 gen+solve < 2s.*

**Wave 3 — Playable Client + Daily (weeks 8–11).** Canvas renderer with snapshot
interpolation; aim/power input UI; Fastify service serving the daily seed; local replay
save/share via seed links; difficulty calibration against first-cohort stroke data.
*Exit criterion: a stranger can play today's hole in a browser and share the seed.*

**Wave 4 — Puzzle Families + CMS (weeks 12–15).** Multi-ball-start ladders (weekly
escalation); editor curation console — browse certified seeds by difficulty band, pin
tomorrow's daily, ban degenerate seeds; ghost replays of the solver's proof line as a
post-round "par machine" reveal; leaderboards keyed by (seed, ruleset).
*Exit criterion: an editor schedules a full week of ladders without touching JSON.*

**Wave 5 — Depth + Live Ops (weeks 16–20).** Wind/elevation-heavy rulesets and arcade
modifiers (portals, bumpers) as new certified substreams; puzzle-of-the-week tournaments
with server-side replay verification (anti-cheat: submit inputs, server re-simulates);
engine versioning policy with archived-version replay support; public seed API.
*Exit criterion: a cheated score is impossible to post; v1 replays still verify.*

## 8. Risks (and our mitigations)

- **Fixed-point tuning makes physics feel "digital."** Mitigation: Q16.16 gives ~1.5e-5
  precision — ample; the feel risk is in tables, so we tune loft/bounce curves against a
  float reference sim used *only* offline as a tuning oracle, never at runtime.
- **Solver cost blows up on large holes.** Mitigation: finite shot lattice bounds branch
  factor by design; hole size is capped; certification is offline/async, so gen-time
  spikes never touch player latency. Budget: hard 10s kill-switch per seed, seed skipped.
- **Humanity gate miscalibrated → puzzles technically fair, actually miserable.**
  Mitigation: it's a tunable published in the certificate; Wave 3 calibrates thresholds
  against real stroke distributions, and editors can ban seeds instantly in Wave 4.
- **Seed stability across engine updates.** The hardest promise. Mitigation: puzzles are
  keyed by `(engineVersion, seed)`; old versions are archived as frozen artifacts for
  replay verification; substream isolation limits blast radius of new features. We
  budget for this in Wave 5 rather than pretending it won't happen.
- **Scope seduction — "just add multiplayer."** Mitigation: the waves are gated by exit
  criteria, not dates alone; the deterministic core makes async ghost-race multiplayer
  nearly free *later*, which is exactly why we won't build realtime netcode now.

---

*Fairway Labs — we make the engine honest, so the fun can be wild.*
