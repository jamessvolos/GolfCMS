# GolfCMS · Daily Links ⛳

An infinite, seed-driven, turn-based golf puzzle game with a built-in content
management system. Every course is procedurally generated; every ball starting
location is sampled to pose a genuine puzzle; every published hole carries a
machine-verified proof that it can be beaten.

Zero dependencies. No build step. One static page.

## Play

Serve the repo root with any static file server and open `index.html`:

```sh
python3 -m http.server 8000
# → http://localhost:8000            today's daily hole
# → http://localhost:8000/#/hole/1837462913/standard   a specific shared hole
```

- **Aim** with the mouse — the shaded band previews every tile the shot can
  land on — or play entirely by keyboard: arrows aim (shift for fine) and set
  power, `C` cycles clubs, `Space` swings, `U` undoes.
- **Click** to swing. Pick a club (driver/iron/wedge/putter) and a power notch (1–3).
- Terrain is the puzzle: rough shortens your next shot, sand forces a wedge or
  putter at half range, water and out-of-bounds cost a penalty stroke, trees
  block low iron flight but not the driver's high ball, and putts roll
  tile-by-tile through everything en route. Ice keeps a moving ball moving,
  slope tiles shed it downhill, and links wind bends every airborne shot.
- **Four biomes**: classic, winter ❄️ (ice), alpine ⛰️ (slopes), links 💨
  (dunes and wind). Biomes live in the URL and in share codes.
- **Daily mode**: everyone on Earth gets the same certified hole each day —
  gentle early week, rude Saturdays (you start in trouble). Streaks and stats
  are tracked locally; results copy as spoiler-free emoji traces.
- **9-hole rounds** (`#/round/<seed>/<biome>`): one seed fans out into nine
  certified holes with a shaped difficulty curve and a running scorecard.
- **The weekly gauntlet** (`#/gauntlet`): five holes per ISO week escalating
  classic → winter → alpine → rude links in the wind.
- **Ghost races**: after any hole, copy a challenge link — your entire shot
  list packs into the URL (6 hex chars per stroke, no backend), and whoever
  opens it races your ghost stroke for stroke.

## The CMS

Open `cms.html` for the catalog: batch-generate certified candidates (any
biome), play them, approve or reject, filter, and export/import the catalog
as JSON. `audit.html` renders 50 raw generator outputs on one screen — the
fast human check against procedural blandness.
Puzzles are stored as `(seed, difficulty)` tuples — courses are re-derived,
never persisted. Share codes look like `GLF-1KZD-YYTV-S`, survive
handwriting (Crockford base32, check digit), and regenerate the exact course
and ball start anywhere.

## How dynamic puzzles work

1. **Generation** (`src/engine/generate.js`): a seeded, staged pipeline —
   archetype grammar (straight / doglegs / long), spine routing, fairway
   buffering, hazards biased onto the direct tee-to-hole line, and a fairway
   corridor guarantee so every seed yields a traversable hole.
2. **The lie is the puzzle statement** (`src/engine/puzzle.js`): ball starts
   are sampled from the *interesting frontier* — off the green, a real
   distance out, with a hazard threatening the direct line or the lie itself
   in trouble. Degenerate lies are rejected explicitly.
3. **Certification** (`src/engine/solver.js`): a Dijkstra solver plays the
   real engine over a discretized shot lattice. Its winning line is stored as
   a replayable certificate; par *is* the solver's stroke count. Unsolvable,
   trivial, or miserable candidates never publish.
4. **Determinism** (`src/engine/rng.js`): mulberry32 with named substreams —
   every random decision (layout, hazards, ball start, per-stroke scatter)
   reproduces from a 32-bit seed, so a URL is a complete puzzle.

## Development

```sh
npm test   # node --test: 74 tests, ~5s
```

The engine (`src/engine/`) is pure functions with no DOM imports; the UI
(`src/ui/`) is a thin canvas interpreter. Golden-replay fixtures in
`test/golden.test.js` pin known seeds' exact behavior — any physics change
that would alter an already-shared hole fails CI loudly.

## Provenance

This app was built through a five-firm design bake-off followed by five waves
of feature development. The proposals, judging scorecard, and verdict live in
[`docs/bakeoff/`](docs/bakeoff/), and the full build story is in
[`AUTHOR_NOTE.md`](AUTHOR_NOTE.md).
