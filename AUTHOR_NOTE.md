# Author's Note — how GolfCMS went from two words to a game in one sitting

*2026-08-07, on branch `claude/design-dev-bakeoff-features-dwtcjx`*

You asked for four things: hire five design/dev firms, run a bake-off on how to
10x the app and make the puzzles dynamic (random courses, random ball starting
locations), pick a winner, and complete five waves of feature development —
with proof. Here is all of it, receipts attached.

## 1. Five firms were hired

Five independently-run agent "firms," each with a distinct philosophy, wrote
full proposals in parallel. Every proposal is preserved verbatim in
[`docs/bakeoff/`](docs/bakeoff/):

| Firm | Philosophy | Proposal |
|---|---|---|
| Fairway Labs | Engine-first: deterministic sim, solver certificates | [`01-fairway-labs.md`](docs/bakeoff/01-fairway-labs.md) |
| Birdie & Bloom Studio | Delight-first: daily ritual, emoji share cards | [`02-birdie-and-bloom.md`](docs/bakeoff/02-birdie-and-bloom.md) |
| Mulligan Systems | CMS-is-the-product: curation pipeline, share codes | [`03-mulligan-systems.md`](docs/bakeoff/03-mulligan-systems.md) |
| TopoGolf Collective | Generation quality: archetypes, interesting lies | [`04-topogolf-collective.md`](docs/bakeoff/04-topogolf-collective.md) |
| Scratch & Par Digital | Ship fast: zero deps, no build step, tested core | [`05-scratch-and-par.md`](docs/bakeoff/05-scratch-and-par.md) |

Bake-off commits: `0605ab5`, `eeefb7a`.

## 2. A winner was picked

Full scorecard and deliberation in [`docs/bakeoff/JUDGING.md`](docs/bakeoff/JUDGING.md)
(commit `079c968`). **Scratch & Par Digital won (42/50)** — the only plan
guaranteed to produce a working, maintainable game — but the winning plan was
required to absorb the field's best ideas:

- **TopoGolf** (41, runner-up): *"the lie is the puzzle statement; the course
  is just the board"* — ball starts sampled from the interesting frontier,
  degenerate lies rejected explicitly.
- **Fairway Labs** (38): solver certification — no puzzle publishes without a
  machine-verified winning line.
- **Mulligan** (37): puzzles as `(seed, difficulty)` content tuples with
  curation states and share codes.
- **Birdie & Bloom** (32): the daily ritual and spoiler-free emoji result trace.

## 3. Five waves of feature development were completed

Each wave is one commit on this branch, tested before it shipped:

| Wave | Commit | Delivered |
|---|---|---|
| 1 — Engine | `c47c82b` | Seeded RNG with named substreams, 40×24 course model, archetype generator (straight/doglegs/long) with hazards biased onto the direct line and a corridor guarantee, 4-club shot resolution with full terrain rules, replay-based undo. 21 tests. |
| 2 — Dynamic puzzles | `fb95b88` | Dijkstra solver over the real engine (its winning line is a replayable certificate; par is its stroke count), interesting-lie ball-start sampler with easy/standard/rude tiers, deterministic reroll certification, date-seeded daily puzzle with day-of-week difficulty ritual. 31 tests. |
| 3 — Playable client | `15bd4fd` | `index.html`: canvas game with mouse aiming, honest landing previews, lie-aware club HUD, undo, shot trail, `#/hole/<seed>/<difficulty>` share URLs, daily mode. Verified by scripted play in headless Chromium. |
| 4 — The CMS | `5d24655` | `cms.html`: batch generation of certified candidates, engine-rendered thumbnails, approve/reject curation states, tamper-rejecting `GLF-XXXX-XXXX-D` share codes, versioned JSON export/import. 38 tests. |
| 5 — Clubhouse | `75fe500` | Stats and daily streaks wired into the result toast and share text, golden-replay regression fixtures pinning known seeds' exact behavior, GitHub Actions CI, full README. 46 tests. |

## 4. Proof

- **Test suite:** `npm test` → **46 tests, 46 passing, 0 failing, ~3s** —
  including a 1,000-seed generator invariant sweep with flood-fill
  reachability, 100-seed solver-certificate replay verification, 200-seed
  share-code round-trips, and golden replays.
- **It really plays:** screenshots taken from headless Chromium during
  scripted verification are committed in [`docs/proof/`](docs/proof/):
  - [`wave3-play.png`](docs/proof/wave3-play.png) — mid-round on seed
    1837462913; note the ball in a bunker with Driver/Iron correctly disabled
    by the sand lie rule.
  - [`wave4-cms.png`](docs/proof/wave4-cms.png) — the CMS catalog after batch
    generation: eight certified candidates with share codes, one approved,
    one rejected, states persisted across a page reload.
  - [`wave5-holeout.png`](docs/proof/wave5-holeout.png) — a scripted player
    holing out; the round was recorded to stats and the streak/average
    surfaced in the result toast.
  - A greedy aim-at-the-hole bot took 5 strokes on a hole the solver
    certified at par 2 — the dynamic puzzles have real depth.
- **Dynamic puzzles, as ordered:** every course is procedurally generated
  from a 32-bit seed (`src/engine/generate.js`), every ball starting location
  is randomly sampled but certified interesting and solvable
  (`src/engine/puzzle.js`), and the same seed reproduces the same hole, lie,
  and scatter on any machine.
- **The whole game + CMS is ~1,900 lines** of dependency-free JavaScript and
  HTML, exactly as the winning firm promised.

## 5. Addendum — five more waves (6–10)

The client asked for five more. Delivered, one commit per wave, with the
governing rule that already-shared classic seeds must keep playing
identically — the golden fixtures from Wave 5 never changed and never failed:

| Wave | Commit | Delivered |
|---|---|---|
| 6 — Biomes | `0cb2e9d` | ICE (the ball keeps sliding) and directional SLOPE tiles (downhill shed) with bounded settle physics; winter and alpine biomes on dedicated RNG substreams; biome-aware URLs and backward-compatible share codes. Classic courses proven byte-identical. |
| 7 — Rounds | `69bb0d0` | 9-hole rounds from one seed with a shaped difficulty curve, running scorecard, next-hole flow, emoji-per-hole round shares. Verified by playing all nine holes in Chromium via solver-certificate replay: 27 strokes on par 27. |
| 8 — Ghosts | `3ab6444` | Shot lists packed into URLs (6 hex chars per stroke, zero backend); aim input snaps to the codec's 16-bit angle lattice so ghosts reproduce the sharer's round bit-exactly; translucent ghost racing and animated ball flight. |
| 9 — Wind | `31d0d45` | Links biome: near-treeless dunes with pot bunkers and an always-on wind that drifts airborne shots scaled by carry (putts immune); on-canvas wind sock; solver certifies every links hole in its wind. |
| 10 — Clubhouse II | see `git log` | Weekly gauntlet (five certified holes per ISO week escalating classic → winter → alpine → rude links), full keyboard play, `audit.html` (50 generator outputs at a glance for oatmeal-spotting), docs. |

**Proof, round two:** the suite grew from 46 to 74 tests, all passing —
including cross-biome solvability sweeps, a zero-wind regression proving
old biomes stay calm, lossless ghost-codec round-trips over 50 seeds, and
ISO-week edge cases. New browser-verified screenshots live in
[`docs/proof/`](docs/proof/): `wave6-winter/alpine.png`, `wave7-scorecard.png`,
`wave8-ghost.png`, `wave9-links.png`, `wave10-gauntlet.png`,
`wave10-audit.png`. The 9-hole round proof doubles as a cross-environment
determinism guarantee: certificates computed in Node replayed identically
through the live page in Chromium.

— Claude, general contractor to five imaginary but very opinionated firms,
now ten waves deep and still under par
