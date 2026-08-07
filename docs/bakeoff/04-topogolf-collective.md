# TopoGolf Collective — Bake-off Proposal for GolfCMS

## Who We Are

TopoGolf Collective is a procedural-generation specialist firm. We have one belief and we are
annoying about it: **generation quality is the product**. A golf puzzle game with a mediocre
generator is a demo; one with a great generator is a hobby people keep for years. We do not lead
with UI frameworks or monetization funnels. We lead with terrain synthesis, constraint solvers,
and the difference between "random" and "designed-feeling."

## Vision Statement

GolfCMS becomes an infinite golf-course architect. Every hole is generated on demand from a seed:
terrain, hazards, pin, and a randomized ball lie chosen to pose a *puzzle* — a specific
shot-planning problem with a discoverable clever answer. Two players entering the same seed play
the identical hole (daily challenges, sharing, leaderboards); no seed ever repeats meaningfully.
The generator is the content team. Our success metric: a player screenshots a generated hole
because it *looks authored*.

## Technical Architecture

**Stack: TypeScript end-to-end.** One language across generator, client, and server means the
generation library runs identically everywhere — which is the entire ballgame for seeded play.

- **Core generation library** (`@golfcms/gen`): pure TypeScript, zero DOM/IO dependencies.
  Deterministic, side-effect free, runs identically in browser, Node, and web workers. This is
  the crown jewel; it must be trivially testable and portable.
- **Rendering**: Canvas 2D for Wave 1 (fast to ship, sufficient for top-down golf), PixiJS
  (WebGL) from Wave 3 for slope shading, water shimmer, and lighting. We reject Three.js/full 3D:
  it triples art cost and adds nothing to the puzzle. Top-down/2.5D is the correct read for shot
  planning — the player is studying a map, and we should render a beautiful map.
- **Physics**: custom 2D ball simulation (position + spin + a vertical "2.5D" component),
  fixed-timestep, integer-quantized state so replays and solvability checks are bit-exact across
  machines. Off-the-shelf engines (Box2D, Rapier) diverge across platforms in subtle float ways —
  fatal for seeded challenges. We've been burned; we write our own ~800-line integrator.
- **App shell**: React + Vite PWA. Offline-first — the generator means there is no content to
  download, ever.
- **Backend (deliberately thin)**: Node/Fastify + Postgres, only for leaderboards, the daily-seed
  registry, and telemetry. Generation never happens server-side except for validation batch jobs.
  The server stores *seeds and scores*, never course geometry — a course is ~40 bytes of seed
  plus a `genVersion`, not megabytes of tiles.
- **RNG**: `xoshiro256**` with splittable named streams (`terrain`, `hazards`, `pin`, `lie`,
  `decor`). Splitting matters: changing tree decoration must never reshuffle the fairway of an
  already-shared seed. Stream isolation is our forward-compatibility contract.

## The Generation Pipeline

Six stages, each a pure function `(seed, params) -> data`, each independently testable and
independently re-rollable.

### Stage 1 — Archetype selection

We do not generate freeform and hope. A weighted grammar first picks a **hole archetype**:

- dogleg-left / dogleg-right (the bend hides the green; the question is how much to cut)
- island green (all-carry approach; the question is club confidence)
- links (open, windy, few trees; the ground game is the answer)
- gauntlet (narrow corridor between paired hazards; precision over power)
- cape (diagonal water carry you bite off as much of as you dare)
- amphitheater / punchbowl (slopes gather the ball; banking shots is rewarded)
- terrace (multi-tier elevation; landing on the wrong shelf is the trap)

Archetypes carry parameter ranges (length, fairway width, hazard budget, elevation variance) and
hard constraints. This is the single biggest lever for "designed, not random": the archetype
gives every hole a *thesis*, and every later stage serves that thesis.

### Stage 2 — Skeleton routing

The hole centerline is a spline from tee to green: 1–3 control points sampled inside
archetype-defined annular sectors (e.g., a dogleg bends 30–60° at 55–70% of hole length). We run
Poisson-disc rejection on control points against minimum-curvature and self-intersection
constraints. The skeleton also assigns par (3/4/5) from arc length plus a carry-difficulty
estimate — par is derived from geometry, never decorative.

### Stage 3 — Terrain synthesis

- **Heightfield**: 2–3 octaves of simplex noise, then *warped toward the skeleton* — we suppress
  high-frequency noise near the centerline and amplify it at the margins, so fairways sit in
  playable corridors the way real architects rout holes through terrain. Archetypes inject
  macro-features (terrace steps, punchbowl depressions) as analytic height primitives blended
  over the noise field.
- **Surface zoning**: fairway is a variable-width buffer around the skeleton (width modulated by
  1D noise + archetype), rough beyond it, green as a distorted superellipse at the terminus.
  Zone borders get cellular-automata smoothing passes so edges read organic, not buffered-GIS.
- **Green slopes**: the green gets a dedicated low-amplitude noise pass with 1–3 guaranteed
  "readable break" ridges — putting must be a read, not a lottery.

### Stage 4 — Hazard & feature placement (constraint solver)

Hazards are placed by a small **constraint-satisfaction pass**, never scattered. Each archetype
defines hazard *roles*: "punish the greedy line," "guard the short side," "frame the fairway."
Candidate positions come from Poisson-disc sampling; a greedy solver with backtracking scores
candidates against rules: minimum spacing between bunkers, water must touch the skeleton's
risk-line for capes, trees cluster via clump-growth in rough only, and no configuration may block
100% of lines to the green (verified by ray fans from fairway landing zones). If the solver can't
satisfy all roles within N attempts, we re-roll Stage 2 — we never ship a compromise hole.

### Stage 5 — Pin & tee microplacement

Pin position is sampled on the green weighted by slope (prefer plateaus; allow ~15% "spicy" shelf
pins at higher difficulty). The tee box is aligned to give a *slightly* offset view of the ideal
line — a hole should ask a question from the tee, not answer it.

### Stage 6 — Decoration

A purely cosmetic pass on its own RNG stream: tree species, mow lines, flowers, shoreline detail.
Guaranteed zero gameplay impact, so art can improve forever without invalidating a single old seed.

## Random Ball Starting Locations — Puzzles, Not Punishment

This is where naive competitors will fail. Uniform-random ball placement yields degenerate
puzzles: unplayable lies against a tree trunk, trivial tap-ins, or "just hit it straight"
boredom. Our approach:

1. **Generate the reachable-lie manifold.** After the course exists, a coarse shot-graph analysis
   (see Validation) produces, for every cell, minimum strokes-to-hole `S(cell)` and the number of
   *distinct viable shot plans* `P(cell)` — clusters in launch-angle/power space that hole out
   within S or S+1.
2. **Sample from the interesting frontier.** A good puzzle start satisfies all of:
   - `S` falls in the target band for the requested difficulty;
   - `P ≥ 2` — there is a safe line *and* a hero line, i.e., a real decision;
   - the best plan's trajectory corridor intersects at least one hazard-influence region (carry a
     bunker, use a slope, thread trees). Pure open-field lies are rejected as boring.
3. **Reject degeneracy explicitly.** Blacklisted: cells within 1.5 ball-radii of a static
   obstacle; slopes above the rollaway threshold; water/OB cells; cells where every viable plan
   collapses to one plan (`P = 1` with corridor width below epsilon — that's an execution test,
   not a puzzle); cells on the green closer than a par-band minimum.
4. **Difficulty is the sampling temperature.** Easy: wide-corridor, high-`P` lies. Hard: narrow
   corridors, recovery-shaped lies (punch-out vs. flop decisions from rough or trees), spicier
   pin interaction. The daily challenge samples one lie per difficulty tier from the *same*
   course — same terrain, three genuinely different puzzles.

The organizing insight: **the lie is the puzzle statement; the course is just the board.** We
spend as much compute choosing the lie as generating the terrain, and we consider that a feature.

## Validation & Solvability

- **Shot-graph solver**: discretize position space; edges are simulated shots over a quantized
  (angle × power × club) lattice using the real physics at coarse resolution; Dijkstra from
  tee/lie to cup. A hole ships only if it is solvable within par+3 from the tee, every sampled
  lie is solvable, and no solution is "solver-only" — the best plan must survive ±2° / ±3% power
  perturbation, i.e., human-executable margins.
- **Property-based test suite**: 10k seeds per CI run asserting invariants — connectivity, no
  orphan fairway islands, hazard-role satisfaction, par distribution within tolerance, and a
  lie-sampler acceptance rate above 60% (a collapsing acceptance rate is our early-warning smoke
  alarm for generator drift).
- **Determinism harness**: golden-hash tests — seed → SHA-256 of the canonical course
  serialization — run on Linux, macOS, and browser CI targets. Any cross-platform divergence is a
  release blocker, full stop.
- **Quality telemetry**: opt-in capture of abandon-rate and retry-rate *per archetype and
  parameter bucket*, feeding tuning. The generator gets a feedback loop, not vibes.

## Five-Wave Roadmap

- **Wave 1 — Deterministic Core (weeks 1–4).** `@golfcms/gen` with Stages 1–3 and three
  archetypes (straight, dogleg, cape); xoshiro split-stream RNG; custom physics integrator with
  golden-hash determinism CI; Canvas 2D top-down renderer; play-a-seed via URL.
  *Exit criterion: a shared seed plays identically on two machines.*
- **Wave 2 — The Puzzle Engine (weeks 5–9).** Constraint-based hazard solver; shot-graph
  validator; the full interesting-lie sampler with degeneracy rejection; difficulty bands; six
  archetypes. *Exit criterion: in a blind A/B against a hand-authored control set, playtesters
  misidentify generated holes as authored at ≥45%.*
- **Wave 3 — Depth & Feel (weeks 10–14).** Green-slope pass and putting reads; wind system (the
  links archetype comes alive); PixiJS renderer with slope shading and water; recovery-lie puzzle
  class (rough/tree punch-outs); ten archetypes including island green, gauntlet, terrace.
  *Exit criterion: full generated 9-hole rounds with a shaped par/difficulty curve.*
- **Wave 4 — The Social Seed (weeks 15–18).** Thin backend: daily seed, leaderboards with replay
  verification (replays re-simulated server-side — determinism doubles as anti-cheat), seed
  sharing with preview thumbnails rendered by the gen library in a worker.
  *Exit criterion: daily challenge with a verified global leaderboard.*
- **Wave 5 — Living Generator (weeks 19–24).** Telemetry-driven parameter tuning; the archetype
  grammar opened as CMS-editable data files (community archetypes — honoring the "CMS" in
  GolfCMS); campaign mode as seed-chains with escalating constraint difficulty; versioned
  generation (`genVersion` pinned per seed so old seeds replay forever under old rules).
  *Exit criterion: generator v2 ships without breaking one previously shared seed.*

## Risks

1. **"Procedural oatmeal"** — 10,000 holes that all feel the same. *Mitigation:* the archetype
   grammar and hazard roles give each hole a thesis; the blind A/B is a Wave 2 gate, not an
   afterthought; feature-vector distance between consecutive holes is tracked in CI as a variety
   metric.
2. **Cross-platform float divergence** breaks seeded challenges and replay verification.
   *Mitigation:* integer-quantized fixed-timestep physics and golden-hash CI on three platforms
   from Wave 1. This is precisely why we refuse off-the-shelf physics engines.
3. **Validator cost** — shot-graph solving per lie could blow up generation latency.
   *Mitigation:* coarse-lattice solve on a 50–150 ms budget in a worker; the per-course graph is
   memoized and reused across all lie samples; daily seeds are precomputed server-side.
4. **Solver-blind difficulty** — the validator says par+1 but humans find it miserable.
   *Mitigation:* human-executable perturbation margins baked into the solver, plus retry-rate
   telemetry recalibrating difficulty bands in Wave 5.
5. **Generator evolution vs. seed permanence** — improving the generator must not corrupt shared
   history. *Mitigation:* versioned generation and split RNG streams from day one; cosmetic and
   gameplay passes constitutionally separated.
6. **Scope seduction** — 3D, real-time multiplayer, career modes. *Mitigation:* the waves above
   are the contract; anything not serving generation quality queues behind Wave 5.

## Why Us

Every firm in this bake-off will show you screenshots. We are showing you a pipeline in which
every stage is pure, seeded, validated, and version-pinned — because in a procedural game the
generator *is* the art team, the level designer, and the QA department. Fund the generator, and
GolfCMS never runs out of golf.
