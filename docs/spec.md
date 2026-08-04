# SG Trainer — product spec

> Working spec for the strokes-gained course-management training app.
> Milestone 1 (engine core) is built; this document is the source of truth
> for what comes next. Engine tunables live in `lib/engine/constants.ts`.

## Vision

Chess.com puzzles × GeoGuessr, for golf course management. A puzzle is a real
golf hole shown in satellite view with a ball position and lie. The player
drops a pin where they would aim their next shot. The engine evaluates that
aim point in **expected strokes** using the player's own dispersion profile,
compares it to the optimal aim point, and awards points and Elo based on the
strokes-gained difference. The learning payoff is the answer reveal: the
expected-strokes field drawn over the hole, showing *why* the optimal target
is optimal.

The product trains target selection and course management — the fastest
scoring gains available to a mid-handicap player — the way tactics puzzles
train chess pattern recognition.

Art direction is part of this spec, not a later pass: **"the strategist's
folio"** — a Golden Age architect's drawing set crossed with a tour caddie's
yardage book, executed with drafting-room precision. The identity lives in
the data language (labeled contours, survey glyphs, mono numerals), not in
ornament.

## Core loop (one puzzle)

1. Player has a profile: handicap, driver club speed, typical shot shape
   (draw / straight / fade). From this the engine derives a club distance
   table and a 2D dispersion model.
2. A puzzle = hole + situation: satellite imagery of a real hole, marker at
   the ball position, lie type (tee / fairway / rough / sand), pin location
   shown. No wind or elevation in v1.
3. The player pans/zooms and drops a single pin: "where do you aim this
   shot?" A live HUD chip near the pin shows distance and the auto-selected
   club (smallest club whose carry reaches the aim point — no manual club
   selection in v1).
4. Engine computes `sgLoss = E[strokes | player aim] − E[strokes | optimal aim]`.
5. The reveal (three beats): labeled expected-strokes isolines pen-plot
   outward from the optimal point, the player's pin vs. the optimal
   benchmark, dispersion ellipses at both, then the band stamp, sgLoss, and
   Elo delta.
6. Elo updates for both player and puzzle. Next puzzle.

**Critical design decision: score in strokes-gained space, never raw
distance-to-optimal.** Two aim points 10 yards apart can be nearly identical
(middle of a wide fairway) or a full stroke apart (water carry line).
Distance-based scoring would teach the wrong lesson. All scoring flows
through the expected-strokes engine.

## The engine (`lib/engine/`, pure TypeScript)

Zero framework dependencies so it can run in a web worker or server-side.
All tunable constants live in `lib/engine/constants.ts` — numbers below are
reasonable placeholders, not gospel.

### 1. Club distances from profile

- Driver carry ≈ `2.45 × clubSpeedMph` yards (110 mph ≈ 270y carry).
- Fixed gapping as fractions of driver carry: 3w 0.93, 5w/hybrid 0.87,
  4i 0.82, 5i 0.78, 6i 0.74, 7i 0.70, 8i 0.65, 9i 0.60, PW 0.55, GW 0.48,
  SW 0.42, LW 0.35. Partial wedges fill below that.

### 2. Dispersion model

- 2D normal distribution around the aim point, oriented along the aim line:
  longitudinal σ ≈ 5.5% of shot distance, lateral σ from a handicap table —
  scratch: 3.2% of distance, 5: 3.8%, 10: 4.6%, 15: 5.5%, 20: 6.5% (linear
  interpolation between anchors).
- Shot shape shifts the lateral **mean**: draw = −0.8% of distance (curving
  left for a right-hander), fade = +0.8%, straight = 0. The player aims at
  their pin; the distribution is biased by their shape — this is
  intentional, since real players must account for their own curve.
- Rough and sand lies multiply both σ values by 1.25 and 1.5 respectively
  and cap max club (no driver/3w from rough, wedges only from sand beyond
  greenside).

### 3. Hole geometry

- Each hole is a set of GeoJSON polygons in lon/lat: `fairway`, `green`,
  `bunker[]`, `water[]`, `ob[]`, `trees/recovery[]`, plus a `pin` point and
  one or more `tee` points, and par/yardage metadata.
- Use `@turf/turf` for point-in-polygon classification and distance
  (convert to yards). Anything inside no polygon = rough.

### 4. Expected strokes baseline

Broadie-style lookup: expected strokes to hole out, by distance and lie.
Seed with these anchors and interpolate; apply a handicap multiplier of
`1 + 0.011 × handicap` to all values.

| Distance (y) | Tee | Fairway | Rough | Sand | Recovery |
|---|---|---|---|---|---|
| 25 | — | 2.40 | 2.55 | 2.85 | 3.40 |
| 50 | — | 2.65 | 2.85 | 3.15 | 3.65 |
| 100 | — | 2.80 | 3.05 | 3.35 | 3.85 |
| 150 | 2.95 | 2.98 | 3.25 | 3.60 | 4.05 |
| 200 | 3.15 | 3.19 | 3.50 | 3.90 | 4.30 |
| 250 | 3.40 | 3.45 | 3.80 | 4.20 | 4.60 |
| 300 | 3.65 | 3.70 | 4.10 | — | — |
| 400 | 3.95 | 4.05 | 4.40 | — | — |

On the green: expected putts = 1.0 at 2ft, 1.15 at 4ft, 1.5 at 8ft, 1.87 at
20ft, 2.10 at 35ft, 2.30 at 55ft, interpolated.

### 5. Evaluating one aim point (Monte Carlo)

```
evaluateAim(hole, ballPos, lie, profile, aimPoint) -> { expectedStrokes, outcomeStats }
```

- Auto-select club: smallest club whose adjusted carry ≥ distance(ball,
  aim); if aim is beyond max club, clamp.
- Sample N = 600 landing points from the dispersion model.
- Classify each landing point's lie from the polygons; compute distance to
  pin.
- Outcome cost = `1 + baseline(distanceToPin, landingLie)`, with documented
  simplifications:
  - **Water:** +1 penalty, then baseline from a drop point = nearest point
    on the water polygon boundary (toward the ball) offset 5y toward the
    tee, treated as rough.
  - **OB:** cost = `2 + baseline(originalDistanceToPin, originalLie)` —
    stroke-and-distance approximated without recursion.
  - **Green:** 1 + expected putts at that distance.
- `expectedStrokes = mean(outcome costs)`. Also return per-hazard landing
  percentages for the explanation generator.

### 6. Optimal aim + evaluation grid

- Candidate grid: 6-yard spacing over the reachable area (max-club carry +
  15%, sensible angular bounds around the hole corridor). Evaluate every
  candidate; optimal = argmin. This same grid feeds the isoline renderer.
- Cache the computed grid per `(puzzleId, profileBucket)` where
  profileBucket = (handicap rounded to 5, speed rounded to 10, shape) —
  server-side, in the DB. Compute on first request, reuse after.

### 7. Scoring bands

`sgLoss ≤ 0.03` → Perfect (Elo score 1.0) · `≤ 0.10` → Good (0.5) ·
`≤ 0.25` → Okay (0.25) · else Miss (0). Show sgLoss to 2 decimals always.

## Elo & progression

- Player starts at 1200. Standard Elo:
  `expected = 1 / (1 + 10^((Rpuzzle − Rplayer)/400))`, update with K=24 for
  players, K=16 for puzzles (puzzle ratings drift toward observed
  difficulty).
- Seed each puzzle's rating from **trap size**: `E[naive aim] − E[optimal]`,
  where naive = straight at the pin (approach) or fairway center at driver
  distance (tee shot). Rating = `1000 + 1500 × clamp(trapSize / 0.5, 0, 1)`.
  Subtle traps = hard puzzles.
- Progression: XP per puzzle by band, levels every ~500 XP, daily streaks.
  Puzzle categories: Tee Shots, Approach, Layups, Recovery. Track
  per-category accuracy now; per-category ratings later.

## Content pipeline

- v1 ships with **10 hand-annotated holes**. Build a simple `/admin/annotate`
  page: MapLibre map with a draw plugin, click to draw polygons, tag each
  with a type, place pin and ball positions, define 2–4 puzzles per hole
  (tee shot, approach from A, trouble spot B), save to DB. This admin page
  is a required milestone — it is how all content gets made.
- Note for later (do not build now): OpenStreetMap has thousands of courses
  with `golf=fairway/bunker/green` polygons already mapped — Phase 3 is an
  OSM importer.

## Design direction — "the strategist's folio"

`/lib/design/tokens.ts` is the single source of truth for the values below.
The folio (paper, hairlines, engraved headers) frames the instrument (the
dark map viewport); it never sits on top of it.

### Tokens

- ink `#16130E` · paper `#F1EBDD` · paperEdge `#E4DCC9` · fairway `#2F5233`
  · flag `#B5342A` · brass `#9C7A2E` · viewport `#101511` · hairline
  `#C9C0AC`
- contourInk `rgba(241,235,221,0.92)` on imagery · washDanger
  `rgba(181,53,43,0.14)`
- Radii: 4px on folio surfaces, 0px inside the map viewport. Shadows: none —
  separation is done with hairlines and paper-edge color.

### Type

- Display: **Libre Caslon Display** — folio headers only ("No. 7 · Redan ·
  187y"), page titles, band stamps. Never for body or data.
- UI: **Archivo**. Map labels: **Archivo Narrow**, small caps,
  letter-spaced 0.08em.
- Numerals: **IBM Plex Mono**, tabular, everywhere a number appears (sgLoss,
  Elo, distances, streaks). No exceptions.

### Map viewport

- Imagery gets a fixed CSS filter to tone it toward the palette:
  `saturate(0.85) sepia(0.12) brightness(0.96)`. Cap the shift there — the
  ground must still read as real.
- The expected-strokes field renders as **labeled isolines, not a gradient
  blob**. Compute contours from the cached evaluation grid with
  `d3-contour` (marching squares) at sgLoss levels 0.03 / 0.10 / 0.25 /
  0.50 / 1.00 above optimal. Draw on the canvas layer: 1.5px contourInk
  lines, inline labels in Archivo Narrow with a 2px viewport-color halo.
  Add washDanger fill only inside regions ≥ 0.50. Labels carry the data, so
  the map is colorblind-safe by construction.
- Glyphs: optimal = surveyor's benchmark (circled triangle, contourInk);
  player pin = flagged stake in flag red; dispersion ellipse = 1px dashed
  pencil oval drawn at both aim points on reveal.
- While aiming: live HUD chip near the pin — distance to target and
  auto-selected club in mono — plus fine range ticks along the viewport
  frame.

### Reveal choreography (total ≤ 900ms, tap to skip, honor `prefers-reduced-motion`)

1. **Lock** (0–150ms): pin sets, imagery dims 10%, haptic tick.
2. **Draw** (150–650ms): contours pen-plot outward from the optimal point;
   ellipses dash in; labels fade up.
3. **Stamp** (650–900ms): band stamps in Libre Caslon caps, inked at −4°
   rotation (PERFECT in fairway green, GOOD in brass, OKAY in ink, MISS in
   flag red); sgLoss and Elo delta tick up in mono.

### Surfaces outside the map

- Home, profile, progression, and session summary are folio pages: paper
  background, hairline rules, Caslon headers, mono stat blocks. Streaks are
  a row of inked tally marks, not flames. Elo history is a 1px ink
  sparkline.
- Empty and error states are direction, not mood: say what to do next, in
  the interface's voice, sentence case, active verbs.

### Quality floor and kill list

- WCAG AA contrast on all text; visible keyboard focus (2px flag-red
  outline, offset 2px); responsive down to 375px with thumb-zone placement
  for the confirm-aim control.
- All motion ≤ 700ms outside the reveal, everything skippable, fully
  disabled under `prefers-reduced-motion`.
- Never: paper texture inside the map viewport; imagery tone shift beyond
  ~15%; terracotta `#D97757`; acid-lime-on-black; cream-serif landing-page
  defaults. The identity is the drafting system, not the cream.

## Tech stack

- Next.js (App Router) + TypeScript + Tailwind. Prisma with SQLite for dev,
  Postgres-ready.
- Map: **MapLibre GL JS with Esri World Imagery tiles** (free with
  attribution). Do not use Google Maps tiles — their ToS prohibits this
  kind of overlay use.
- `@turf/turf` for geometry, `d3-contour` for isolines, `zod` for
  validation. Fonts via Google Fonts: Libre Caslon Display, Archivo +
  Archivo Narrow, IBM Plex Mono.
- No auth in v1: single local profile stored in DB, editable in settings.

## Data model (Prisma sketch)

```prisma
model Profile  { id, name, handicap Float, clubSpeed Int, shotShape enum, elo Int, xp Int, streak Int }
model Hole     { id, courseName, holeNumber, par, yardage, geojson Json, imageryCenter Json }
model Puzzle   { id, holeId, ballPosition Json, lie enum, pinPosition Json, category enum, rating Int, trapSize Float }
model Attempt  { id, puzzleId, profileId, aimPoint Json, sgLoss Float, band enum, eloDelta Int, createdAt }
model HeatmapCache { id, puzzleId, profileBucket String, grid Json, optimalAim Json, optimalE Float }
```

## Milestones — build in order, each independently demoable

1. **Engine core, no UI.** ✅ Dispersion sampling, lie classification,
   baseline tables, `evaluateAim`, grid search — with unit tests and one
   hardcoded hole. Acceptance: a CLI script prints an ASCII contour map and
   the optimal aim for that hole for two different profiles, and the
   optimal visibly shifts between a 5-handicap and a 20-handicap.
   (`npm run demo`)
2. **Puzzle UI.** ✅ MapLibre viewport with toned imagery, ball/pin markers,
   pin-drop with the live aiming HUD, then the full reveal: isolines with
   labels, optimal benchmark, dispersion ellipses, band stamp, sgLoss and
   Elo readouts. Acceptance met: beats measured at ~150/650/900ms,
   skippable, reduced-motion path verified. Still one hole.
3. **Profiles.** ✅ Folio-styled setup screen (handicap, club speed, shot
   shape); engine consumes the bucketed profile everywhere; heatmap grids
   cached server-side per (puzzleId, profileBucket); attempts + Elo
   persisted via Prisma/SQLite.
4. **Annotation admin + content.** ✅ `/admin/annotate` built (terra-draw
   over Esri imagery, kind-tagged polygons, pin/tee/ball placement, up to
   four puzzles per hole, load-and-edit), feeding one validated ingest
   pipeline shared with the seed. 10 holes / 26 puzzles across all four
   categories, committed as `data/holes/*.json` and checked by
   `npm run content:audit`.
5. **Elo + progression.** ✅ Ratings persisted per attempt; `/play` queue
   serves the nearest unseen puzzle within ±150 (widening when the band is
   empty, review-by-recency when the library is exhausted); XP by band with
   an upset bonus, levels every 500 XP, daily streaks drawn as inked tally
   marks, per-category accuracy, and a folio `/summary` with the 1px ink
   sparkline.
6. **Explanation generator.** Rule-based sentences from `outcomeStats`
   deltas between player aim and optimal (hazard percentages,
   distance-to-pin tradeoffs), e.g. "Aiming at the pin puts 31% of your
   dispersion in the front bunker; bailing 12 yards left costs only 0.04
   strokes."

## Default seed profile (also used in engine tests)

Handicap 14 · club speed 110 mph · shot shape: draw.

## Explicitly out of scope for v1

Auth and accounts, multiplayer/leaderboards, wind/elevation/temperature,
manual club selection, multi-shot play-out of a hole ("career mode"), OSM
course importer, mobile apps, real course search.
