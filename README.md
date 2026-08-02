# SG Trainer

Strokes-gained course-management training: chess.com puzzles × GeoGuessr for
golf. A puzzle is a real hole in satellite view; you drop a pin where you'd
aim, and the engine scores your target in expected strokes against the
optimal aim for *your* dispersion — then shows you why with labeled
expected-strokes isolines.

Full product spec: [docs/spec.md](docs/spec.md)

## Status

- ✅ **Milestone 1 — engine core.** Pure-TypeScript strokes-gained engine in
  [`lib/engine/`](lib/engine/) (dispersion sampling, lie classification,
  Broadie-style baselines, Monte Carlo `evaluateAim`, candidate-grid
  optimizer, scoring bands, Elo), unit-tested, with one hand-annotated hole
  and an ASCII acceptance demo.
- ✅ **Milestone 2 — puzzle UI.** MapLibre instrument with toned Esri
  imagery, tap/keyboard aiming with the live HUD, and the three-beat reveal
  (lock → pen-plot isolines → band stamp), skippable and reduced-motion
  safe, measured on the 150/650/900ms budget.
- ✅ **Milestone 3 — profiles.** Folio settings screen; Prisma + SQLite
  (Postgres-ready); the engine scores every aim with your bucketed profile;
  heatmap grids cached server-side per `(puzzleId, profileBucket)`;
  attempts and Elo persisted.
- ⏳ Milestone 4 — annotation admin + 10 real holes.

## Try it

```bash
npm install
npm run db:push && npm run db:seed   # create + seed the SQLite dev DB
npm run dev                          # then open http://localhost:3000

npm test        # engine + cache unit tests
npm run demo    # ASCII expected-strokes contours for a 5- vs 20-handicap
```

In a sandboxed container whose browser can't reach Esri directly, build
with `NEXT_PUBLIC_TILE_PROXY=1` to route imagery through the same-origin
relay.

## Layout

```
lib/engine/       pure engine library (no framework deps) — see its README
lib/engine/holes/ yard-space hole authoring + the fixture hole
scripts/demo.ts   ASCII contour acceptance demo
scripts/build-hole.ts  regenerates data/holes/cape-01.json
data/holes/       committed hole/puzzle artifacts (future DB seeds)
docs/spec.md      product spec (engine, UI, art direction, milestones)
```
