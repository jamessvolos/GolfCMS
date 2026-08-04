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
- ✅ **Milestone 4 — annotation studio + content.** `/admin/annotate`
  traces holes over live satellite imagery into one validated ingest
  pipeline; 13 holes / 30 puzzles ship as committed `data/holes/*.json`
  (Sawgrass 17 & 18, Pebble 8 & 18, Bay Hill 18, Scottsdale 17, Harbour
  Town 18, Doral 18, the Road Hole and the synthetic cape fixture, plus
  Royal County Down 4, Royal Birkdale 12 and Carnoustie 17 imported from
  OpenStreetMap).
- ✅ **Milestone 5 — progression.** `/play` serves puzzles near your rating
  (±150, widening as needed); XP by band with an upset bonus, levels every
  500 XP, inked tally-mark streaks, per-category accuracy, and a `/summary`
  folio card with the 1px ink rating sparkline.
- ✅ **Milestone 6 — the caddie's note.** A rule-based explanation
  generator ([`lib/explain/`](lib/explain/)) turns the reveal into two
  beats — THE READ, then THE MOVE — with every sentence entailed by a
  number the engine computed. No runtime model: the note is generated in
  the worker inside the 900ms reveal budget.
  [A simulated year of its roadmap](docs/roadmap-year-one.md).

## Content

```bash
npm run content:audit    # ring validity, lie classification, distances
npm run content:export   # DB → data/holes/*.json (commit the result)
npm run content:import -- --course "Royal Birkdale" --hole 12   # from OSM
```

Holes are traced in the studio, saved through `/api/admin/hole`, then
exported to `data/holes/` so a fresh clone seeds the whole library.
`data/holes-draft/` holds annotated-but-untrusted holes; it is never
seeded.

Where a course is already mapped in OpenStreetMap, `/admin/import` (or
`content:import`) pulls the hole instead: features come from OSM tagging and
the engine plays the hole to place each puzzle's ball. It previews first and
lists every decision it made — reversed centrelines, inferred par, dropped
features — before anything is written, and goes through the same
`ingestHole` gates a traced hole does. Limits, tag mapping and the ODbL
credit: [docs/osm-import.md](docs/osm-import.md).

## Try it

```bash
npm install
npm run db:migrate && npm run db:seed   # create + seed the SQLite dev DB
npm run dev                             # then open http://localhost:3000

npm test        # engine + cache unit tests
npm run demo    # ASCII expected-strokes contours for a 5- vs 20-handicap
```

If your dev database predates migrations (created with `db:push`), baseline
it once with `npx prisma migrate resolve --applied 0_init`.

In a sandboxed container whose browser can't reach Esri directly, build
with `NEXT_PUBLIC_TILE_PROXY=1` to route imagery through the same-origin
relay.

## Deploying

```bash
docker build -t sg-trainer .
docker run -p 3000:3000 -v sg-data:/data sg-trainer
```

One container, one SQLite file on a volume; first boot migrates and seeds
itself. Full notes — environment, the Postgres path, why Vercel doesn't
work — in [docs/deploy.md](docs/deploy.md). CI runs typecheck, migration
drift, tests, the content audit, the production build, and a Docker
build-and-boot on every push.

## Layout

```
lib/engine/       pure engine library (no framework deps) — see its README
lib/engine/holes/ yard-space hole authoring + the fixture hole
scripts/demo.ts   ASCII contour acceptance demo
scripts/build-hole.ts  regenerates data/holes/cape-01.json
data/holes/       committed hole/puzzle artifacts (future DB seeds)
docs/spec.md      product spec (engine, UI, art direction, milestones)
```
