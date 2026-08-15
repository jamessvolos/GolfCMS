# GolfCMS · Caddie 🎯

**GeoGuessr for golf strategy.** You're dropped on a procedurally generated
hole and you don't swing — you **pick targets** for the tee shot and every
approach. Your shot lands somewhere in your real **dispersion pattern** (an
ellipse that grows with distance and worsens from rough, sand, and trees),
and every decision is scored in **strokes gained against the optimal
target**, computed by value iteration over the whole hole with the same
dispersion model. After each commit: the reveal — an expected-strokes
heatmap of every aim you could have chosen, the caddie's optimal ring, your
✕, and the SG bill. Five holes per round, 1000 points per hole, daily seed.

The original execution game (clubs, power, putting) lives on at
`arcade.html`, along with the CMS, editor, audit grid, and blind A/B test.

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
- **Creator mode** (`editor.html`): repaint any generated hole tile by tile,
  certify it with the solver, and share it as seed + patch in a URL. Tee and
  cup stay anchored; uncertifiable holes can't be shared.
- **Real holes from aerial photos**: load a satellite or drone image as the
  editor's underlay, align it (pan/zoom/rotate) so the real tee and cup sit
  on the anchors, and **Detect terrain** (`src/engine/aerial.js`) drafts the
  trace — HSV + texture classification per tile, modal smoothing, greens only
  near the cup. Correct the draft, certify, share. The photo never leaves
  your machine: a shared trace is a full-grid patch in the URL, never imagery.
- **Play on the photo**: certifying a traced hole with the aerial loaded
  bakes the aligned image into local storage (`src/ui/photo.js`), and both
  play surfaces can then play that hole **on the photograph**. The arcade
  fades tiles to a tracing layer at adjustable opacity; the Caddie surface
  (`#/traced/<seed>/<biome>?p=…`) goes full broadcast — a two-pass cone that
  reads on any exposure, a telestrator under-scrim beneath the reveal
  heatmap, luma-adaptive cased markers, hazard-truth ink baked into the
  ground, and `B` to flip photo ↔ paint instantly. Recipients without the
  photo play the identical certified hole on painted tiles; the photo is a
  private luxury, never in a URL. (Waves 1–2 of the aerial bake-off
  verdict — see `docs/bakeoff-aerial/JUDGING.md`.)
- **Pinned to Earth**: type the real tee and cup lat/lon in the editor and
  the share carries a ~23-character georeference (`src/engine/georef.js`) —
  two anchors fully determine scale, rotation, and place, so the HUD can say
  "34.051°N 118.500°W" on any machine. Coordinates travel; imagery never
  does. (Wave 3.)
- **Difficulty stars**: every certified hole is rated 1–5★ from its
  certificate (par, lie, wind, biome), and the rating self-calibrates against
  your own recorded rounds ("plays harder than rated for you").
- **Sound**: fully synthesized Web Audio — thwocks, splashes, chimes, and an
  ace fanfare, no asset files. Mute button in the HUD.

## The CMS

Open `cms.html` for the catalog: batch-generate certified candidates (any
biome), play them, approve or reject, filter, and export/import the catalog
as JSON. `audit.html` renders 50 raw generator outputs on one screen — the
fast human check against procedural blandness — and `ab.html` runs the blind
A/B gate: six hand-authored holes shuffled with six generated ones; if you
misidentify generated holes as authored ≥45% of the time, the generator has
passed the bake-off's hardest exit criterion.

## The optional leaderboard

`npm run leaderboard` starts a zero-dependency verification service
(`server/leaderboard.js`, node:http only). A score submission is a ghost
replay string; the server re-simulates it against the seed with the same
engine and only accepts runs that actually hole out — client-claimed stroke
counts are ignored, making forged scores structurally impossible. The game
never depends on it: set `localStorage['golfcms.leaderboard.url']` to opt in,
and results silently include your rank when the service is reachable.
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
npm test   # node --test: 90+ tests, ~5s
```

The engine (`src/engine/`) is pure functions with no DOM imports; the UI
(`src/ui/`) is a thin canvas interpreter.

## Deploy

The game is a static site and ships itself: every push to `main` runs the
test suite and, if green, publishes the repo root to GitHub Pages
(`.github/workflows/pages.yml`). The deploy stamps the service-worker cache
name with the commit SHA, so installed clients sweep stale caches and pick
up each release. Icons regenerate with `node scripts/make-icons.mjs` (zero
dependencies — it hand-encodes the PNGs). The optional leaderboard service
deploys separately via `Dockerfile` + `fly.toml` or `render.yaml`
(see `docs/deploy-leaderboard.md`). Golden-replay fixtures in
`test/golden.test.js` pin known seeds' exact behavior — any physics change
that would alter an already-shared hole fails CI loudly.

## Provenance

This app was built through a five-firm design bake-off followed by five waves
of feature development. The proposals, judging scorecard, and verdict live in
[`docs/bakeoff/`](docs/bakeoff/), and the full build story is in
[`AUTHOR_NOTE.md`](AUTHOR_NOTE.md).
