# GolfCMS Bake-off — Judging & Verdict

**Date:** 2026-08-07 · **Judge:** Claude (acting client-side technical lead)

Five firms submitted proposals for how to 10x GolfCMS into a dynamic golf puzzle app
with procedurally generated random courses and random ball starting locations. All five
proposals are in this directory. Each was scored 1–10 on five criteria.

## Criteria

1. **Dynamic-puzzle quality** — how well random courses + random ball starts become
   *good puzzles*, not just random noise.
2. **10x vision** — does the plan credibly transform a bare repo into a product?
3. **Feasibility** — can the five waves actually be built and verified, starting now,
   with a solo maintainer afterward?
4. **Determinism & correctness** — reproducible seeds, solvability guarantees, testability.
5. **Honors the name** — GolfCMS should end up with a real content-management story.

## Scorecard

| Criterion | Fairway Labs | Birdie & Bloom | Mulligan Systems | TopoGolf Collective | Scratch & Par |
|---|---|---|---|---|---|
| Dynamic-puzzle quality | 8 | 7 | 7 | **10** | 8 |
| 10x vision | 8 | 9 | 8 | 9 | 8 |
| Feasibility | 6 | 5 | 4 | 6 | **10** |
| Determinism & correctness | **10** | 7 | 8 | 9 | 9 |
| Honors the name (CMS) | 6 | 4 | **10** | 7 | 7 |
| **Total** | **38** | **32** | **37** | **41** | **42** |

## Deliberation

- **Fairway Labs** wrote the best correctness story in the field — fixed-point math,
  solver certificates, replay proofs. But 20 weeks of engine before an editor touches
  anything is a heavy bet, and Q16.16 fixed-point everywhere is over-engineering for a
  turn-based grid game where integer tile math is already exact.
- **Birdie & Bloom** understood the *product* best — the daily ritual, the emoji trace
  card, "the ball start defines the story." But the stack (Svelte + PixiJS + Rapier WASM
  + Cloudflare Workers/D1/Durable Objects) is a lot of moving parts for a client who is
  one person, and the physics-feel bet is the hardest thing in the field to verify.
- **Mulligan Systems** took the repo's name most seriously: puzzles as
  (generator version, parameters, seed, ball-start policy) tuples, generate→review→publish,
  share codes as managed rows. The content model is excellent. But Postgres + Redis +
  BullMQ + worker pools before a single player exists is a platform in search of a game.
- **TopoGolf Collective** had the single best idea in the bake-off: **"the lie is the
  puzzle statement; the course is just the board"** — sample ball starts from the
  *interesting frontier* (solvable, multiple viable plans, hazard engagement) and reject
  degenerate lies explicitly. Their archetype grammar is the right answer to procedural
  oatmeal. Close second overall.
- **Scratch & Par Digital** wins on the only criterion that gates all others: it ships.
  Zero dependencies, no build step, pure-function engine, Node's built-in test runner,
  solver-computed par from day one, seeds as URLs, and a five-wave plan where Wave 1 is
  already a playable game. Turn-based grid golf makes determinism trivial instead of
  heroic — the same guarantee Fairway Labs spends fixed-point libraries on, for free.

## Verdict

**Winner: Scratch & Par Digital**, with three grafts the winning plan must absorb:

1. From **TopoGolf**: the interesting-lie sampler — random ball starts must pass
   solvability *and* interestingness gates, and hole archetypes give courses a thesis.
2. From **Fairway Labs / Mulligan**: solver certification as a publishing gate — every
   generated hole ships with computed par and a machine-verified solvability record.
3. From **Mulligan / Birdie & Bloom**: the CMS wave manages puzzles as content
   (catalog, curation states, share codes) and the daily seed is a first-class ritual.

The five contracted waves of feature development, restated for the build:

- **Wave 1 — Engine:** seeded RNG, grid course model, archetype-driven procedural
  generator, club/terrain shot resolution. Pure functions, fully unit-tested.
- **Wave 2 — Dynamic puzzles:** BFS solver, computed par, solvability gate, the
  interesting-lie ball-start sampler (incl. recovery lies), daily seed mode.
- **Wave 3 — Playable client:** single-page canvas game — aim, club, power, landing
  preview, seed-in-URL sharing.
- **Wave 4 — The CMS:** puzzle catalog with curation states (generated/approved/
  rejected), share codes encoding course + ball start, audit grid, import/export.
- **Wave 5 — Clubhouse:** stats, streaks, emoji share card, golden-replay regression
  suite, documentation.
