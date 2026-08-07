# TopoGolf Collective — Bake-off Proposal for GolfCMS

## Who We Are

TopoGolf Collective is a procedural-generation specialist firm. We have one belief and we are annoying about it: **generation quality is the product**. A golf puzzle game with a mediocre generator is a demo; one with a great generator is a hobby people keep for years. We do not lead with UI frameworks or monetization funnels. We lead with terrain synthesis, constraint solvers, and the difference between "random" and "designed-feeling."

## Vision Statement

GolfCMS becomes an infinite golf-course architect. Every hole is generated on demand from a seed: terrain, hazards, pin, and a randomized ball lie chosen to pose a *puzzle* — a specific shot-planning problem with a discoverable clever answer. Two players entering the same seed play the identical hole (daily challenges, sharing, leaderboards); no seed ever repeats meaningfully. The generator is the content team. Our success metric: a player screenshots a generated hole because it *looks authored*.

## Technical Architecture

**Stack: TypeScript end-to-end.**

- **Core generation library** (`@golfcms/gen`): pure TypeScript, zero DOM/IO dependencies. Deterministic, side-effect free, runs identically in browser, Node, and web workers. This is the crown jewel and it must be trivially testable and portable.
- **Rendering**: Canvas 2D for Wave 1 (fast to ship, sufficient for top-down golf), PixiJS (WebGL) from Wave 2 for lighting, water shimmer, and slope shading. We reject Three.js/full 3D: it triples art cost and adds nothing to the puzzle. Top-down/2.5D is the correct read for shot planning.
- **Physics**: custom 2D ball simulation (position + spin + vertical component "2.5D"), fixed-timestep, integer-quantized state so replays and solvability checks are bit-exact across machines. Off-the-shelf engines (Box2D, Rapier) are non-deterministic across platforms in subtle float ways — fatal for seeded challenges. We've been burned; we write our own ~800-line integrator.
- **App shell**: React + Vite PWA. Offline-first — the generator means there is no content to download.
- **Backend (thin)**: Node/Fastify + Postgres, only for leaderboards, seed registry, and telemetry. Generation never happens server-side except for validation batch jobs. Server stores *seeds and scores*, never course geometry.
- **RNG**: `xoshiro256**` with splittable named streams (`terrain`, `hazards`, `pin`, `lie`, `decor`). Splitting matters: changing tree decoration must never reshuffle the fairway of an already-shared seed. Stream isolation is our forward-compatibility contract.

## The Generation Pipeline

Six stages, each pure `(seed, params) -> data`, each independently testable and re-rollable.

### 1. Archetype selection

We do not generate freeform and hope. A weighted grammar first picks a **hole archetype** — dogleg-left/right, island green, links (open, windy, few trees), gauntlet (narrow corridor between hazards), amphitheater (bowl green), cape (diagonal water carry you can bite off), punchbowl, terrace (multi-tier elevation). Archetypes carry parameter ranges (length, fairway width, hazard budget, elevation variance) and hard constraints. This is the single biggest lever for "designed, not random": the archetype gives every hole a *thesis*.

### 2. Skeleton routing

The hole centerline is a spline from tee to green: 1–3 control points sampled inside archetype-defined annular sectors (e.g., dogleg = 30–60° bend at 55–70% of hole length). We run **Poisson-disc rejection** on control points against min-curvature and self-intersection constraints. The skeleton also assigns a par (3/4/5) from arc length plus a carry-difficulty estimate — par is derived, never decorative.

### 3. Terrain synthesis

- **Heightfield**: 2–3 octaves of simplex noise, then *warped toward the skeleton* — we suppress high-frequency noise near the centerline and amplify it at the margins, so fairways sit in playable corridors the way real architects rout holes through terrain. Archetypes inject macro-features (terrace steps, punchbowl depression) as analytic height primitives blended over the noise.
- **Surface zoning**: fairway is a variable-width buffer around the skeleton (width modulated by 1D noise + archetype), rough beyond it, green as a distorted superellipse at the terminus. Zone borders are smoothed with cellular-automata passes so edges read organic, not buffered-GIS.
- **Slopes**: green undergoes a dedicated low-amplitude noise pass with a guaranteed 1–3 "readable break" gradient ridges — putting must be a read, not a lottery.

### 4. Hazard & feature placement (constraint solver)

Hazards are placed by a small **constraint-satisfaction pass**, not scattered. Each archetype defines hazard *roles*: "punish the greedy line," "guard the short side," "frame the fairway." Candidate positions come from Poisson-disc sampling; a greedy solver with backtracking scores candidates against rules: min distance between bunkers, water must touch the skeleton's risk-line for capes, trees cluster via Wang-tile-ish clumping in rough only, never blocking 100% of lines to the green (checked by ray fans). If the solver can't satisfy roles in N attempts, we re-roll stage 2 — never ship a compromise hole.

### 5. Pin & tee microplacement

Pin position sampled on the green weighted by slope (prefer plateaus, allow 15% "spicy" shelf pins at higher difficulty). Tee box aligned to give a *slightly* offset view of the ideal line — a hole should ask a question from the tee.

### 6. Decoration

Purely cosmetic pass (own RNG stream): tree species, mow lines, flowers, shoreline detail. Guaranteed zero gameplay impact, so we can improve art forever without invalidating old seeds.

## Random Ball Starting Locations — Puzzles, Not Punishment

This is where naive competitors will fail. Uniform-random ball placement yields degenerate puzzles: unplayable lies against a tree trunk, trivial 2-foot tap-ins, or "just hit it straight" boredom. Our approach:

1. **Generate the reachable-lie manifold.** After the course exists, we run a coarse shot-graph analysis (see Validation) producing, for every cell, the minimum strokes-to-hole `S(cell)` and the number of *distinct viable shot plans* `P(cell)` (clusters in launch-angle/power space that hole out within S+0 or S+1).
2. **Sample from the interesting frontier.** A good puzzle start satisfies: `S ∈ [target band]` for the requested difficulty; `P ≥ 2` (there is a safe line *and* a hero line — a real decision); the best line requires engaging with at least one generated feature (carry a bunker, use a slope, thread trees) — we check that the optimal shot's trajectory corridor intersects a hazard-influence region. Pure open-field lies are rejected as boring.
3. **Reject degeneracy explicitly.** Blacklist: within 1.5 ball-radii of a static obstacle, slopes above rollaway threshold, water/OB cells, cells where every viable plan is the same plan (`P = 1` *and* corridor width below epsilon — that's execution, not puzzling), and cells inside the green closer than a par-band minimum.
4. **Difficulty is the sampling temperature.** Easy: wide-corridor, high-`P` lies. Hard: narrow corridors, recovery-shaped lies (punch-out vs. flop decisions from rough/trees), spicier pin interaction. The daily challenge samples one lie per difficulty from the *same* course — same terrain, three different puzzles.

The insight: **the lie is the puzzle statement; the course is just the board.** We spend as much compute choosing the lie as generating the terrain.

## Validation & Solvability

- **Shot-graph solver**: discretize position space; edges are simulated shots over a quantized (angle × power × club) lattice using the real physics at coarse resolution. Dijkstra from tee/lie to cup. A hole ships only if: solvable within par+3 from the tee, every sampled lie solvable, and no "solver-only" solutions (best plan must survive ±2° / ±3% power perturbation — human-executable margins).
- **Property-based test suite**: 10k seeds per CI run asserting invariants (connectivity, no orphan fairway islands, hazard-role satisfaction, par distribution within tolerance, lie-sampler acceptance rate > 60% — a collapsing acceptance rate is our early-warning smoke alarm for generator drift).
- **Determinism harness**: golden-hash tests — seed → SHA-256 of canonical course serialization — run on Linux/macOS/browser CI targets. Any cross-platform divergence is a release blocker.
- **Quality telemetry**: opt-in capture of abandon-rate and retry-rate *per archetype and parameter bucket*, feeding tuning — the generator gets a feedback loop, not vibes.

## Five-Wave Roadmap

- **Wave 1 — Deterministic Core (weeks 1–4).** `@golfcms/gen` with stages 1–3 and 3 archetypes (straight, dogleg, cape); xoshiro split-stream RNG; custom physics integrator with golden-hash determinism CI; Canvas 2D top-down renderer; play-a-seed via URL. *Deliverable: shareable seed plays identically on two machines.*
- **Wave 2 — The Puzzle Engine (weeks 5–9).** Constraint-based hazard solver; shot-graph validator; the full interesting-lie sampler with degeneracy rejection; difficulty bands; 6 archetypes. *Deliverable: "Random Puzzle" mode where playtesters can't distinguish generated holes from a hand-authored control set (blind A/B, target ≥45% authored-guess rate).*
- **Wave 3 — Depth & Feel (weeks 10–14).** Green-slope pass + putting reads; wind system (links archetype comes alive); PixiJS renderer with slope shading and water; recovery-lie puzzle class (rough/tree punch-outs); 10 archetypes incl. island green, gauntlet, terrace. *Deliverable: full 9-hole generated rounds with par/difficulty curve shaping across the round.*
- **Wave 4 — The Social Seed (weeks 15–18).** Thin backend: daily seed, leaderboards with replay verification (replays re-simulated server-side — determinism pays off as anti-cheat), seed sharing with preview thumbnails rendered from the gen library in a worker. *Deliverable: daily challenge with verified global leaderboard.*
- **Wave 5 — Living Generator (weeks 19–24).** Telemetry-driven parameter tuning; archetype grammar opened as data files (community archetypes, CMS-editable — honoring the "CMS" in GolfCMS); campaign mode: seed-chains with escalating constraint difficulty; versioned generation (`genVersion` pinned per seed so old seeds replay forever under old rules). *Deliverable: generator v2 ships without breaking a single previously shared seed.*

## Risks (and our mitigations)

1. **"Procedural oatmeal"** — 10,000 holes that all feel the same. *Mitigation:* archetype grammar + hazard roles give per-hole theses; blind A/B against authored holes is a Wave 2 gate, not an afterthought; variety metrics (feature-vector distance between consecutive holes) tracked in CI.
2. **Cross-platform float divergence** breaks seeded challenges and replay verification. *Mitigation:* integer-quantized fixed-timestep physics, golden-hash CI on three platforms from Wave 1. This is why we refuse off-the-shelf physics.
3. **Validator cost** — shot-graph solving per lie could blow up generation latency. *Mitigation:* coarse-lattice solve (~50–150 ms budget in a worker), memoized per-course graph reused across all lie samples, and precomputed daily seeds server-side.
4. **Solver-blind difficulty** — the validator says par+1 but humans find it miserable. *Mitigation:* human-executable perturbation margins baked into the solver, plus retry-rate telemetry recalibrating difficulty bands in Wave 5.
5. **Generator evolution vs. seed permanence.** *Mitigation:* versioned generation and split RNG streams from day one; cosmetic and gameplay passes constitutionally separated.
6. **Scope seduction** — 3D, multiplayer physics, career modes. *Mitigation:* the waves above are the contract; anything not serving generation quality queues behind Wave 5.

## Why Us

Every firm in this bake-off will show you screenshots. We're showing you a pipeline in which every stage is pure, seeded, validated, and version-pinned — because in a procedural game, the generator *is* the art team, the level designer, and the QA department. Fund the generator, and GolfCMS never runs out of golf.
