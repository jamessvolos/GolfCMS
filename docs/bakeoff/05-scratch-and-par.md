# Scratch & Par Digital — Bake-off Proposal for GolfCMS

## Who We Are

Scratch & Par Digital ships small, sharp web games on boring technology. We have no
designers who need a component library, no architects who need a message queue, and no
invoices for infrastructure you don't need. Our house rule: **if you can't open it from a
file:// URL and play it, it isn't done.** We deliver a playable game in Wave 1, then
iterate in public with the client every wave after.

## Vision

GolfCMS becomes **"Daily Links"**: an infinite, procedurally generated, turn-based golf
puzzle. Every course is a seed. Every seed is a shareable URL. You get a hole you have
never seen, a ball dropped somewhere awkward, a bag of clubs, and a par to beat. Think
Wordle's daily ritual crossed with a roguelike's infinite variety — except the whole thing
is one static HTML page the client can host on GitHub Pages forever, for free.

## Technical Architecture

**Stack: vanilla ES modules + `<canvas>` + Node's built-in test runner. Zero npm
dependencies. Zero build step.**

- **Language:** Plain JavaScript with JSDoc type annotations, checked by `tsc --noEmit
  --checkJs` in CI only. You get TypeScript's safety net without a compile step, a
  `node_modules` folder, or a bundler. The browser runs the exact files in the repo.
- **Rendering:** A single `<canvas>` drawn tile-by-tile. No sprite frameworks. Terrain is
  flat-color tiles with 2-line procedural texture (fairway stripes, water shimmer) — cheap
  to draw, instantly readable, and it makes the grid honest: what you see is the sim.
- **Structure:** `src/engine/` (pure logic: RNG, generator, physics, rules — no DOM
  imports allowed, enforced by a lint script), `src/ui/` (canvas renderer, input,
  animation), `index.html` (one page, loads `src/ui/main.js` as a module).
- **State:** The entire game state is one serializable object `{seed, ballPos, strokes,
  windSeed, history}`. Undo, replays, share-links, and save games all fall out of this
  one decision for free.
- **Hosting:** GitHub Pages. Deploy is `git push`. There is no step two.

Why not a framework? A grid puzzle re-renders one canvas on user input — React solves a
problem this game does not have, and every dependency is a future maintenance debt the
client carries alone. Vanilla code written in 2026 still runs in 2036.

## The Shot Model: Simple Physics, Deep Choices

The course is a hex-free rectangular grid (default 40×24 tiles). A shot is:
**pick a club → pick a direction (aim line, any angle) → pick power (3 notches)**.

### Clubs

| Club    | Range (tiles) | Scatter | Flight  | Notes                                   |
|---------|---------------|---------|---------|-----------------------------------------|
| Driver  | 10–14         | ±2 tile | airborne| Ignores terrain under flight path       |
| Iron    | 6–9           | ±1 tile | airborne| The reliable workhorse                  |
| Wedge   | 2–4           | ±1 tile | high arc| Stops dead on landing — no roll         |
| Putter  | 1–5           | 0       | rolling | Ground travel: every tile en route matters |

Scatter is deterministic-from-seed-plus-stroke-count: the same shot on the same seed
always lands the same way. Skill is reading risk, not fighting dice.

### Landing and roll

Airborne shots resolve at the landing tile, then roll 0–3 tiles along the aim vector
depending on landing terrain. Rolling shots (putter) evaluate terrain tile-by-tile.

### Terrain effects

- **Fairway:** normal range, roll +1.
- **Rough:** next shot's range −25%, roll 0. Landing here is fine; leaving is the tax.
- **Sand:** next shot must be wedge or putter at half range. The classic trap, literal.
- **Water:** ball returns to the pre-shot tile, +1 penalty stroke.
- **Trees:** block airborne flight paths — a shot whose arc crosses a tree tile stops in
  front of it. Putters can thread between them. This creates real routing puzzles.
- **Ice (Wave 3):** rolling balls don't stop until non-ice terrain. Puzzle gold.
- **Slopes (Wave 3):** tiles with an arrow; any ball ending its move there slides 1 tile.
- **Green + hole:** putter-only zone; sink it from up to 5 tiles with a clean line.
- **Wind (Wave 2):** per-hole constant vector, shown as an arrow; shifts airborne landing
  by 0–2 tiles. Deterministic from seed.

Depth comes from interaction, not complexity: driver-over-water is safe but scatters into
trees; the wedge's dead-stop makes island greens solvable; ice plus slope makes Wave 3
holes feel like Chip's Challenge with a 9-iron.

## Procedural Courses and Random Ball Starts

- **One RNG to rule them all:** `mulberry32(seed)` — 4 lines, deterministic, fast. The
  seed is a 32-bit int shown in the URL: `#/hole/1837462913`. Same seed, same hole, same
  wind, same scatter rolls, on every device. Shareable challenges cost us nothing.
- **Generation pipeline (each step a pure, unit-tested function):**
  1. Pick hole length archetype from seed (short/dogleg/long: weights 30/40/30).
  2. Random-walk a fairway spine from tee zone to green zone with bounded turn angles.
  3. Buffer the spine into fairway, ring it with rough, scatter hazard blobs (cellular
     noise) biased *toward* the direct tee-to-hole line — hazards must threaten the
     obvious route or they're decoration.
  4. Stamp the green, place the hole, place the ball at a random tee-zone tile — and
     10% of the time, drop the ball somewhere rude (rough or behind trees) and lower
     par by one. Recovery holes are the best holes.
  5. **Validate:** a BFS/greedy solver plays the hole; if it can't finish within par+3,
     or finishes under 2 strokes, reroll from `seed+1` (audit shows <8% reroll target).
- **Par is computed, not guessed:** par = solver strokes. "Beat the robot" is the game.

## Testing Strategy

Test-driven where it pays: the engine is 100% pure functions, so it gets real tests; the
canvas layer gets eyeballs and a smoke test.

- **Runner:** `node --test test/` — built into Node since v18. No Jest, no config.
- **Unit tests:** RNG determinism, every club's range table, every terrain rule as its
  own named test (`test('water returns ball and adds penalty stroke', ...)`).
- **Property tests (plain loops, no library):** generate 1,000 seeded holes and assert
  invariants — tee exists, hole reachable, solver finishes, par in [2..6], no water on
  green, reroll rate under 8%.
- **Golden replays:** a recorded shot-list per seed replayed against the engine; any
  physics change that alters an old hole's outcome fails loudly. This is our regression
  wall for "we tweaked roll and broke the daily hole."
- **CI:** one GitHub Action: `tsc --noEmit --checkJs && node --test`. Runs in ~15 seconds.

## Five-Wave Roadmap

- **Wave 1 — Playable (1 week):** Engine (grid, 4 clubs, fairway/rough/sand/water/trees),
  mulberry32 + generator + solver-validated par, canvas renderer with aim line and
  power notches, seed-in-URL, stroke counter, "New Hole" button. **You can play golf.**
- **Wave 2 — The Ritual (1 week):** Daily hole (seed = days-since-epoch), wind,
  shot-trail animation, undo, emoji share card ("Daily Links #142 — 3/5 🏌️⛳"),
  localStorage streaks and per-hole best.
- **Wave 3 — Depth (2 weeks):** Ice, slopes, bridges; 9-hole rounds with total-vs-par
  scorecard; hole archetype variety pass (island greens, forced carries, putting mazes);
  difficulty dial that biases generator weights.
- **Wave 4 — Craft (2 weeks):** Tile-based hole editor that exports a seed-plus-patch
  code (still just a URL); curated "Classics" pack of 18 hand-tuned seeds; sound (Web
  Audio, synthesized, no asset files); colorblind-safe palette and full keyboard play.
- **Wave 5 — Clubhouse (2 weeks):** Ghost replays encoded in share URLs (race a friend's
  shot history — still zero backend); weekly gauntlet of 5 seeds; stats page; optional
  thin leaderboard *only if the client asks*, as a separate service, never a Wave 1–4
  dependency.

## Risks (and our mitigations)

1. **Generator produces boring or broken holes.** Highest real risk. Mitigation: the
   solver-validation gate from day one, the 1,000-seed property suite, and a `#/audit`
   dev page that renders 50 random holes on one screen for fast human review.
2. **"Deterministic scatter" feels unfair if misread.** Mitigation: preview the landing
   zone (shaded tiles) before committing every shot. No hidden information, ever.
3. **Scope creep toward realism** (spin, elevation, club fitting). Mitigation: the golden
   replay suite makes physics churn expensive on purpose; new depth ships as new terrain,
   not new physics parameters.
4. **Canvas UI outgrows vanilla.** Mitigation: engine/UI wall is enforced by lint; worst
   case, a future team swaps the renderer without touching one tested engine line.
5. **Solo-maintainer bus factor.** Mitigation: zero dependencies means zero upgrade
   treadmill; the whole engine targets under 2,000 lines with tests as living docs.

**The pitch in one line:** a golf roguelike the size of a homework folder, playable in
Wave 1, infinite by design, and maintainable by one person for a decade.
