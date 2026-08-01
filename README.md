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
- ⏳ Milestone 2 — puzzle UI (MapLibre + d3-contour reveal).

## Try it

```bash
npm install
npm test        # engine unit tests
npm run demo    # ASCII expected-strokes contours for a 5- vs 20-handicap
```

The demo prints the "Cape" fixture hole twice — the optimal tee-shot aim
visibly shifts away from the water as the dispersion widens between a 5- and
a 20-handicap, which is the Milestone 1 acceptance check.

## Layout

```
lib/engine/       pure engine library (no framework deps) — see its README
lib/engine/holes/ yard-space hole authoring + the fixture hole
scripts/demo.ts   ASCII contour acceptance demo
scripts/build-hole.ts  regenerates data/holes/cape-01.json
data/holes/       committed hole/puzzle artifacts (future DB seeds)
docs/spec.md      product spec (engine, UI, art direction, milestones)
```
