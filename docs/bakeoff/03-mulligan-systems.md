# GolfCMS Bake-Off Proposal — Mulligan Systems

**Firm:** Mulligan Systems · Platform & CMS Engineering
**Contact:** bids@mulligansystems.dev · Proposal 03 · August 2026

---

## 1. Who We Are

Mulligan Systems builds content platforms for games. We have shipped level-editor pipelines, live-ops catalogs, and curation backends for three mobile puzzle studios. Our founding belief, and the reason we want this contract: **the studios that win at puzzle games are not the ones with the best renderer — they are the ones with the best content pipeline.** Everyone can draw a golf ball. Almost nobody can ship 50 great holes a week, know which ones players love, and retire the duds automatically. That is a CMS problem, and it is our home turf.

## 2. Vision Statement

It is called **GolfCMS** for a reason. The product is not a golf game with an admin panel bolted on; it is a **content management system that happens to emit golf puzzles**. The playable client is a thin, deterministic interpreter of published content. Everything else — generation parameters, curation state, difficulty ratings, share codes, analytics — lives in the CMS as first-class managed content.

Concretely: a "puzzle" in GolfCMS is never a hand-placed pile of sprites. It is a **(generator version, seed, parameter-set, ball-start policy)** tuple plus a curation record. That one decision unlocks everything the client asked for: procedural courses are reproducible, share codes are 12 characters instead of kilobytes of JSON, A/B-testing difficulty is a parameter diff, and "10x the content" means tuning distributions, not hiring level designers.

## 3. Technical Architecture

### Stack (and why)

| Layer | Choice | Justification |
|---|---|---|
| Play client | **TypeScript + Phaser 3** (Canvas/WebGL) | Golf puzzles are 2D physics-lite; Phaser gives us arcade physics, tweens, and input for free. Web-first means share codes open instantly in a browser — critical for virality. Wraps to mobile later via Capacitor. |
| Physics core | **Custom deterministic fixed-point sim**, shared package | Ball rolling must replay identically on every device and on the server. Floating-point + Box2D drift across platforms; we write a small fixed-timestep, integer-math sim (~800 LOC) instead. Same package runs in client, generator, and validator. |
| CMS backend | **Node.js + Fastify + PostgreSQL** | One language across sim/generator/API means the generation code literally *is* shared code, not a port. Postgres JSONB stores parameter-sets with schema versioning; row-level curation state; LISTEN/NOTIFY drives the review queue. No Mongo — puzzle content is relational (puzzle → generator version → parameter-set → analytics rollups). |
| Admin UI | **React + TanStack Query**, embedded Phaser preview | Curators must *play* a candidate inside the review screen. We mount the same Phaser client in an iframe against draft content. |
| Generation workers | **Node worker pool (BullMQ + Redis)** | Batch-generate 10k candidates overnight; solver-validation is CPU-bound and queue-shaped. |
| Analytics | **Postgres + nightly rollups; ClickHouse only if >5M attempts/day** | Start boring. Difficulty scoring is a SQL view, not a data-science project, until scale proves otherwise. |

### The load-bearing invariant

`simulate(courseSpec, ballStart, inputs)` is a **pure function** in a shared `@golfcms/sim` package. The generator uses it to auto-solve candidates, the client uses it to play, the server uses it to verify submitted solutions (anti-cheat) and to compute par. If the sim is not deterministic and shared, every other promise in this document collapses. We budget Wave 1 accordingly.

## 4. The Content Model

Entities the CMS manages (all versioned, all with audit trails):

- **GeneratorVersion** — a tagged, immutable build of the procedural generator. Old puzzles must regenerate byte-identically forever, so generator code is content too.
- **ParameterSet** — the designer-facing knobs: terrain roughness, hazard density (water/sand/walls), green size, slope frequency, obstacle vocabulary weights, target par range. JSONB with a JSON Schema per generator version; the admin UI renders sliders from the schema. Named presets ("Tuesday Twisters", "Beginner Meadows") are themselves curated content.
- **PuzzleSeed** — `(generatorVersion, parameterSetVersion, seed)` → deterministic course. This is the atom of content.
- **BallStartPolicy** — how the tee position is drawn per play (see §6). Separate entity because one course can ship with several policies at different difficulties.
- **Puzzle** — PuzzleSeed + BallStartPolicy + curation state machine: `generated → screened → in_review → approved → scheduled → published → retired/rejected`. Carries curator notes, auto-solver stats, and computed par.
- **Collection** — ordered puzzle groups: Daily rotation, themed packs, difficulty ladders. Scheduling lives here (publish windows, timezone policy for the Daily).
- **ShareCode** — short base32 code (e.g. `GLF-K7Q2-M9XD`) minted per puzzle *and* per player-completed round (code replays the exact course + ball start the sharer got). Codes are rows, so we can expire, attribute, and count them.
- **AttemptRecord** — anonymized play telemetry: strokes, time, quit-point, replay hash. Feeds difficulty analytics.
- **DifficultyProfile** — computed content: solver-estimated difficulty at generation time, corrected by live player performance (see §8, Wave 4).
- **User/Role** — Designer, Curator, Publisher, Analyst; publish requires Curator approval + Publisher action (two-person rule for the Daily).

## 5. Procedural Generation Meets Curation: Generate → Review → Publish

The pipeline is a funnel with machines at the top and humans at the bottom:

1. **Generate.** A designer picks a ParameterSet and requests a batch ("give me 500 candidates"). Workers roll seeds and build courses.
2. **Auto-screen (the robot bouncer).** Every candidate is attacked by our solver (beam search over discretized shot angles/powers on the shared sim). Hard rejects: unsolvable, solvable in 1 trivial shot, degenerate geometry, solution requires pixel-perfect precision beyond input tolerance. Each survivor gets machine metrics: min strokes, solution-path diversity, hazard engagement rate, estimated difficulty percentile. Expect ~60–80% culled here; that is the point — curators should never see garbage.
3. **Human review.** Survivors land in a queue ranked by "interestingness" (solution diversity × difficulty-target fit). The curator plays the puzzle in the embedded client, sees the solver's best path as a ghost overlay, and hits approve / reject / flag-for-retune in under 60 seconds. Rejection reasons are structured (boring / unfair / ugly / too-similar) — this taxonomy becomes generator training feedback.
4. **Publish.** Approved puzzles are assigned to Collections and scheduled. Publishing snapshots the resolved course JSON to a CDN-cached, immutable artifact — the client never runs the generator, so a generator bug can never break a live puzzle.
5. **Close the loop.** Live AttemptRecords flow back onto the puzzle. Puzzles whose real difficulty diverges badly from the estimate, or whose quit-rate spikes, are auto-flagged for retirement review.

Opinionated stance: **no fully-automatic publishing in v1.** Studios that pipe generators straight to players ship one viral bad hole and lose the audience's trust. Humans gate the Daily until Wave 4's calibrated difficulty model earns limited autonomy (auto-publish into low-stakes "Endless" collections only).

## 6. Random Ball Starts, Parameterized

Ball starts are a **policy, not a point**, drawn fresh per play session from a seeded RNG (seed = puzzleSeed ⊕ playerNonce, so shares can replay exactly):

- **Zone policy** — generator emits candidate tee zones (polygons) with per-zone weights; ball position sampled within. Knobs: zone count, min distance-to-hole, allowed surface types (never sand in Beginner presets).
- **Difficulty-band policy** — solver pre-computes stroke-distance fields from a grid of start points; policy samples starts whose solver difficulty falls in a target band (e.g. "always a par-3-feel regardless of where you spawn"). This is the flagship feature: same course, tuned challenge.
- **Fixed policy** — degenerate single point, used for tournaments and head-to-head shares where fairness demands identical starts.
- **Constraints (all policies):** minimum clear line-of-first-shot arc, no spawn inside hazard or within N units of the cup, per-policy exclusion masks painted by curators in the admin UI.

The auto-screener validates policies too: it samples 200 starts per candidate and rejects the puzzle if any start is unsolvable or if the difficulty spread across starts exceeds the policy's declared band.

## 7. Feature Roadmap — Five Waves

### Wave 1 — Deterministic Core (weeks 1–4)

- `@golfcms/sim`: fixed-point, fixed-timestep physics package with golden replay tests running in CI on Chrome, Safari (WebKit), and Node.
- Minimal Phaser client: aim, power meter, shoot, hole-out, stroke counter.
- Course JSON schema v1 (surfaces, walls, hazards, cup, tee zones) with schema versioning from day one.
- Generator v0: terrain + cup + walls + sand emitted from a ParameterSet.
- CLI tooling: `golfcms roll --preset beginner --count 20` to generate seeds and play them locally.
- *Exit criterion: same seed + same input stream = identical stroke count on all three platforms.*

### Wave 2 — The CMS Spine (weeks 5–9)

- Postgres schema and Fastify API for every entity in §4, with audit trails.
- Admin UI: ParameterSet slider editor rendered from JSON Schema, batch-generate button, live candidate count.
- Review queue with embedded playable preview and ghost-solver overlay; structured rejection reasons.
- Curation state machine with Designer/Curator/Publisher roles and the two-person publish rule.
- Publish-to-CDN immutable snapshot pipeline; solver v1 auto-screening with hard-reject rules.
- *Exit: a curator ships a 9-puzzle Collection end-to-end without touching a terminal.*

### Wave 3 — Players & Share Codes (weeks 10–14)

- Public play site serving the Daily Collection; anonymous-first accounts with optional upgrade.
- BallStartPolicy engine live with zone and fixed policies; per-play seeded sampling.
- Share codes: minting, redemption, expiry, attribution counters, OG-image course previews for link unfurls.
- AttemptRecord ingestion pipeline with replay hashes.
- Anti-cheat v1: server-side replay verification of submitted input streams against the shared sim.
- *Exit: a player beats the Daily, shares a code, and a friend replays the identical course and ball start.*

### Wave 4 — Analytics & Calibrated Difficulty (weeks 15–19)

- Difficulty dashboard: predicted vs. actual stroke distributions, quit-rate funnels, per-puzzle heatmaps of where balls die.
- DifficultyProfile correction model: isotonic regression from solver score to observed median strokes — deliberately simple and inspectable, no black boxes in the curation loop.
- Difficulty-band ball-start policy ships (the flagship: same course, tuned challenge from any spawn).
- Auto-flagging of miscalibrated or high-quit live puzzles into a retirement review queue.
- A/B parameter experiments ("hazard density 0.3 vs 0.4") with guardrail metrics and automatic stop rules.
- *Exit: predicted difficulty within ±0.5 strokes of observed median for 80% of new publishes.*

### Wave 5 — Scale & Live-Ops (weeks 20–26)

- Auto-publish for calibrated puzzles only, restricted to the low-stakes Endless collection.
- Seasonal ParameterSet presets with scheduled takeovers (holiday themes as content, not code deploys).
- Curator productivity tooling: bulk actions, keyboard-driven review, similarity dedup via course-geometry embeddings.
- Import/export: signed `.golfpack` bundles for partner distribution, backup, and cross-environment promotion.
- Public read-only API for community leaderboard and stats sites.
- Multi-tenant groundwork so GolfCMS can white-label to other studios — the CMS itself becomes a sellable product.
- *Exit: 500 published puzzles; under 2 curator-hours/day sustains the Daily + Endless.*

## 8. Risks (and our mitigations)

1. **Determinism is genuinely hard.** Cross-platform float drift or a stray `Math.random()` silently breaks replays, share codes, and anti-cheat. *Mitigation:* fixed-point math from day one, golden-replay CI on three engines, lint rule banning nondeterministic APIs in `@golfcms/sim`. This is why it is Wave 1, not Wave 3.
2. **Generator quality plateau — "procedurally generated" reads as "randomly boring."** *Mitigation:* the solver-driven interestingness score and structured curator rejection taxonomy exist precisely to tune distributions against human judgment; budget standing weekly "generator tasting" sessions.
3. **Difficulty model cold start.** Before live data, solver estimates will miss (solvers don't get nervous on the green). *Mitigation:* conservative launch bands, humans gate everything, Wave 4 correction model retrofits all historical puzzles.
4. **Curation bottleneck.** If screening only culls 60%, curators drown. *Mitigation:* throughput SLO (≥1 approval/minute) tracked from Wave 2; similarity dedup in Wave 5; if the queue backs up, we tighten auto-screen thresholds rather than lower the review bar.
5. **Random starts feel unfair.** A player spawns in a brutal spot on the Daily and screenshots it angrily. *Mitigation:* difficulty-band policy for all competitive collections; fixed-start mode for tournaments; every complaint is replayable from its share code, so support can verify in seconds.
6. **Scope gravity toward "just make the game prettier."** The bake-off's other firms will pitch shaders. *Mitigation:* our contract structure ties payment to content-pipeline exit criteria per wave; the renderer stays deliberately thin until the pipeline sustains itself.
7. **Anti-cheat arms race.** Client-submitted scores are forgeable. *Mitigation:* server-side replay verification of the input stream against the shared sim (cheap because the sim is deterministic — risk 1's mitigation pays twice).

## 9. How We Measure Success

- **Content throughput:** candidates generated per curator-hour of review; target 10:1 approved-to-effort improvement by Wave 5 vs. Wave 2 baseline.
- **Calibration:** the ±0.5-stroke prediction target above, tracked weekly per generator version.
- **Virality:** share-code redemption rate (codes redeemed / codes minted); every Daily should mint codes measured in percent of players, not fractions of one.
- **Trust:** zero unsolvable puzzles ever reaching a published Collection — the auto-screener makes this a testable invariant, not an aspiration.

---

*Mulligan Systems — because every great course deserves a second look before it ships.*
