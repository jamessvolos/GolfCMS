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
| 10 — Clubhouse II | `6ba0575` | Weekly gauntlet (five certified holes per ISO week escalating classic → winter → alpine → rude links), full keyboard play, `audit.html` (50 generator outputs at a glance for oatmeal-spotting), docs. |

**Proof, round two:** the suite grew from 46 to 74 tests, all passing —
including cross-biome solvability sweeps, a zero-wind regression proving
old biomes stay calm, lossless ghost-codec round-trips over 50 seeds, and
ISO-week edge cases. New browser-verified screenshots live in
[`docs/proof/`](docs/proof/): `wave6-winter/alpine.png`, `wave7-scorecard.png`,
`wave8-ghost.png`, `wave9-links.png`, `wave10-gauntlet.png`,
`wave10-audit.png`. The 9-hole round proof doubles as a cross-environment
determinism guarantee: certificates computed in Node replayed identically
through the live page in Chromium.

## 6. Addendum — the ship-it batch (all seven roadmap items)

After ten waves the client said "all seven" to the roadmap, so:

1. **Merged** — PR #1 landed the ten waves on `main`.
2. **Hosted** — a GitHub Pages workflow deploys the static site from `main`
   on every push (`.github/workflows/pages.yml`).
3. **Blind A/B gate** — six hand-authored holes (`src/engine/authored.js`,
   ASCII string-art format) shuffled against six generated ones in
   `ab.html`; the page scores TopoGolf's bake-off exit criterion directly:
   % of generated holes misidentified as authored, target ≥45%.
4. **Difficulty calibration** — 1–5★ ratings estimated from each
   certificate (`src/engine/difficulty.js`), recorded with every round, and
   calibrated against the player's own history: the result toast will tell
   you a band "plays harder than rated for you" once it has evidence.
5. **Leaderboard service** — `server/leaderboard.js`, node:http only,
   strictly optional. Scores are ghost replays; the server re-simulates
   every submission and ignores client-claimed stroke counts, so a forged
   score is structurally impossible, not just discouraged.
6. **Creator mode** — `editor.html` paints terrain over any generated hole;
   the solver certifies the edit before it can be shared as a seed+patch
   URL (4 hex chars per changed tile, tee and cup immutable).
7. **Sound** — fully synthesized Web Audio (`src/ui/sound.js`): power-scaled
   thwocks, splashes, sand thuds, ice shimmer, hole chimes, an ace fanfare.
   No asset files, mute persisted.

## 7. Addendum — the pivot: Caddie

The client called it: the arcade game had lost the plot. The real product is
**GeoGuessr meets a shot-pattern app** — a course-management trainer where
you pick aim targets for tee and approach shots and get scored on decision
quality. So:

- `src/engine/dispersion.js` — distance-scaled elliptical shot patterns
  (long-axis depth error > lateral, widened by rough/sand/tree lies), fixed
  low-discrepancy offsets for expectation math, seeded draws for the ball
  that actually flies.
- `src/engine/strategy.js` — the caddie's brain: an expected-strokes field
  over every cell via value iteration with the real dispersion model, an
  optimal-aim search, per-decision strokes-gained scoring, and the reveal
  heatmap. Tested to lay up short of water carries it can't safely clear.
- `index.html` + `src/ui/caddie.js` — the new main game: aim ellipse under
  the cursor, commit, reveal (heatmap + optimal ring + your ✕ + sampled
  ball + SG verdict), five-hole rounds, 1000 pts/hole, daily seed. The old
  execution game moved intact to `arcade.html`.

Everything under the pivot survived from the first ten waves: the seeded
generator, the terrain system, the deploy pipeline, the rituals.

## 8. Addendum — two years in one sitting

After the Caddie pivot came the yardage book, the live dispersion
intelligence, the art pass, handicap profiles, and the mobile pass. Then the
client asked for two simulated years of the roadmap. Eight quarters, one
commit each, all deployed:

| Quarter | Commit | Shipped |
|---|---|---|
| **Y1Q1 — Wind** | `99145eb` | `windShift` drifts the pattern center downwind scaled by carry, applied to live stats, sampled balls, and the strategy layer — the caddie provably aims upwind to compensate. ~28% of holes generate as windy links. |
| **Y1Q2 — Career SG log + dashboard** | `37b6a13` | Every aiming decision logged locally (SG lost, tee/approach, risk vs caddie risk, handicap); `stats.html` renders leak analysis, a risk-discipline verdict, a points sparkline with moving average, and recent rounds. |
| **Y1Q3 — Weekly Major + Championship** | `4c5d51c` | `#/major`: five fixed holes per ISO week, same for everyone; `#/champ/<seed>`: a full 18. Rounds carry their own length, label, and route. |
| **Y1Q4 — Pro mode** | `eeaa8fa` | Persisted toggle hiding the outcome dots and live odds — pure judgment, same scoring. The trainer becomes an exam. |
| **Y2Q1 — Personal dispersion** | `eeaa8fa` | Custom profile editor: pattern width, long-club blowup, and a directional miss bias shifting the pattern mean sideways scaled by carry. The caddie re-solves against *your* pattern and is tested to aim into the miss. |
| **Y2Q2 — Coach's notes** | `7ae84c6` | End-of-round recap names your two costliest targets with their SG and risk numbers, or tips its cap when every target was near-optimal. |
| **Y2Q3 — Course identity** | `7ae84c6` | Seed-derived course names (Gorse Downs National, Pine Heath G.C.) headline every round and stay fixed for the week's Major. |
| **Y2Q4 — PWA** | `7ae84c6` | Manifest + icon + stale-while-revalidate service worker: after one visit the whole trainer works offline — the generator is the content. Installable to the home screen. |

**Proof:** the suite grew to **126 tests, all passing** — wind compensation,
miss-bias compensation, and name determinism among the new behavioral
guarantees — and every quarter was verified in one end-to-end Chromium
session: the Major loaded at a named course with a wind label, Pro mode hid
the intel, a custom right-miss profile recalibrated the caddie, a played
decision landed in the career log with its full schema, `stats.html`
rendered it (screenshot in `docs/proof/twoyears-stats.png`), and an 18-hole
Championship spun up at Pine Heath G.C. Deployed to GitHub Pages through
the usual merge-to-main pipeline.

— Claude, general contractor to five imaginary but very opinionated firms,
ten waves, one pivot, and two simulated fiscal years deep — who has learned
that the client, like the caddie, always sees the better line
