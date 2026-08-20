# Parallax Party — Aerial Overlay Proposal for GolfCMS / Caddie

**Firm:** Parallax Party · **Date:** 2026-08-15
**Philosophy:** This isn't a feature, it's the second act — **Play Earth**: any golf hole on the planet becomes a certified Caddie puzzle, and the reveal heatmap breathes over real ground.

## 1. Who We Are

Parallax Party builds the demo the keynote is remembered for — and we lost enough
bake-offs to firms like Scratch & Par to have learned the lesson the judge wrote down in
`docs/bakeoff/JUDGING.md`: feasibility gates everything. So this proposal is our ambition
run through your constitution. Every claim below cites a file that already exists in this
repo, every house rule we propose bending carries a price tag in the same sentence, and
Wave 1 ships in days on code you already trust. The pitch is big; the plan is small.

## 2. Vision — the full product arc

Today the pipeline already exists in embryo: `editor.html` loads a local aerial photo as
an underlay, you align it (pan/zoom/rotate in `src/ui/editor.js`), `detectTerrain()` in
`src/engine/aerial.js` drafts the trace by HSV + texture classification, you correct it,
`solve()` in `src/engine/solver.js` certifies it, and `encodeGridPatch()` in
`src/engine/patch.js` ships the whole board as ~961 URL characters. What's missing is the
second act: **the traced hole never comes home to the Caddie surface**, and the photo dies
at the editor's edge.

The full arc we're proposing:

1. **Import** — drop a photo (today's path), or paste coordinates and let Tier-1 imagery
   arrive in the browser (§4).
2. **Detect** — `detectTerrain()` drafts the trace live as you align; corrections are
   paint strokes (`editor.js` already does both, just not continuously).
3. **Certify** — `solve()` for par + solvability, and for daily-candidate holes the full
   strategic instrument `certifyHole()` from `src/engine/certify.js` (M1 fork, M3
   centre-line penalty): a real hole publishes only if it's a real *decision*.
4. **Play** — the Caddie surface (`src/ui/caddie.js`) renders aim ellipse, dispersion
   band, and the reveal heatmap **over the photograph** (§5's overlay design).
5. **Share** — seed + grid patch in the URL, exactly as today, plus an optional ~40-char
   geo sidecar so recipients can re-derive imagery (§6). The mask always travels; the
   photo never does.
6. **Daily real hole** — community-certified hole packs flow through the existing catalog
   (`src/engine/catalog.js` export format, `cms.html` curation states), and a dated pick
   from the approved pack becomes "today's real hole" alongside the procedural daily.

## 3. Overlay rendering design — the game over the photo

The Caddie surface is a world-space canvas with a camera (`makeCamera`/`worldTransform`
via `src/ui/camera.js`, consumed in `caddie.js`). Today it blits `renderCourseArt()` from
`src/ui/paint.js` as the ground. Photo mode inserts the aligned image *under* that art and
demotes the art to a whisper. One extraction, one insertion:

- **Extract** the editor's alignment block (`drawUnderlayTo`, `uZoom`/`uRot`/`uPan`,
  `editor.js:57–123`) into a shared `src/ui/underlay.js` used by both editor and caddie.
- **Insert** in the caddie's world pass, where `art = renderCourseArt(course)` is drawn:

```js
// src/ui/caddie.js — world pass, photo mode (sketch)
import { drawAligned } from './underlay.js';

beginWorld();
if (photo) {
  drawAligned(ctx, photo);                    // the real ground, aligned once in the editor
  ctx.fillStyle = `rgba(8,12,8,${scrimAlpha})`; // the caddie scrim — contrast budget (§ below)
  ctx.fillRect(0, 0, course.width * TILE, course.height * TILE);
  ctx.globalAlpha = 0.20;                     // tile art becomes a tracing, not the ground
}
ctx.drawImage(art, 0, 0);
ctx.globalAlpha = 1;
if (photo) strokeHazards(ctx, course);        // water/sand as inked outlines via
                                              // paint.js terrainPath(), no fill —
                                              // the photo already shows the pond
```

**Legibility on photography** is a contract, not a vibe. Four rules:

1. **The scrim is adaptive.** We sample the aligned photo's mean luma once per hole (same
   offscreen-canvas trick as the editor's detect handler, `editor.js:129–145`) and set
   `scrimAlpha` so composite luma lands in a fixed band. A bleached Arizona fairway and a
   dark Scottish links get the same contrast budget.
2. **Every strategy mark gets a halo.** The aim ✕, optimal ring, dispersion ellipse, and
   ghost balls take a 2px dark understroke beneath their light stroke — they must survive
   any photograph. `drawBallWorld`/`drawPin` in `paint.js` already use this pattern.
3. **The reveal heatmap keeps its own physics.** `buildHeatCanvas()` in `caddie.js` bakes
   heat one pixel per tile with alpha and upscales; over a photo we deepen the scrim to
   ~0.5 inside the reveal sweep before the heat blits, so `heatColor()`'s ramp reads
   identically on turf art and on photography. The radial sweep animation is untouched.
4. **Terrain disagreement stays visible.** Where the mask says water and the photo shows
   grass (a drained pond, a stale image), the hazard outline from rule 3's
   `strokeHazards` is the tell — THE TILES ARE THE TRUTH, and the overlay never lets the
   photo pretend otherwise.

Green view (`renderGreenArt`, the yardage-book stack) stays on synthetic art in v1: no
public imagery resolves break, and the book's slope/cost pages are the product there.

## 4. Imagery sourcing — tiers, with the licensing said out loud

- **Tier 0 — user files (ships today).** The editor's `<input type="file">` path. The
  image is session state, never course data; a share is seed + patch, so redistribution —
  the entire licensing question — never arises (`editor.js:46–56` says exactly this).
  Legality of the screenshot is the user's, on their own machine. This tier is the
  product's floor and it works for every hole on Earth.
- **Tier 1 — public-domain NAIP via USGS (browser-direct).** USGS imagery services serve
  public-domain NAIP at ~0.6–1 m GSD with CORS headers, fetchable straight into the
  aligned-underlay canvas — at 1 tile ≈ 16 yds (`FT_PER_TILE = 48` in `paint.js`), that's
  ~15–24 px per tile, enough for `classifyAerialTile()`'s texture gate (`lumaStd`) to
  work. **Honesty:** NAIP is US-only, the endpoint's uptime is not ours, and CORS policy
  can change under us. Tier 1 is "Play America," feature-flagged, and the game never
  depends on it — the same posture as the leaderboard (`README.md`, "the game never
  depends on it").
- **Tier 2 — the optional imagery proxy (the rule we'd bend, priced).** A second
  zero-dependency `node:http` service in the exact shape of `server/leaderboard.js`:
  fetch, cache, and re-serve **public-domain sources only** (NAIP/USGS), adding CORS and
  an attribution header. **Price:** ~300 lines plus a second deploy (`Dockerfile` /
  `fly.toml` pattern already in repo), bandwidth on the maintainer's card (~single-digit
  $/mo at hobby scale, unbounded if it's ever hot), a cache directory, an abuse surface,
  and a second service to be woken up at night for. Opt-in via a `localStorage` URL key
  like `golfcms.leaderboard.url`; silently absent otherwise. **What the proxy does NOT
  buy, said plainly:** global coverage. Esri/Google/Bing world imagery is licensed, and
  proxying it would violate ToS — we will not build that, and no firm that says otherwise
  has read the license. Global "Play Earth" is honestly Tier 0.
- **Rejected: on-device ML detection upgrade.** A WebGPU/ONNX segmentation model would
  beat `pixelVote()` on hard photos — and costs the zero-dependency constitution, ~20 MB
  of weights against a PWA that currently ships itself, and a test story that
  `node --test` can't touch. Priced, and not worth it: detection improves instead as
  *detection v2*, pure-JS features (hue histograms, edge density) in `aerial.js`, testable
  against synthetic imagery in node exactly as the file's header promises.

## 5. Shares that reproduce

The invariant: **the mask always travels; imagery re-derives or degrades gracefully.**

- A traced hole is already a complete puzzle in a URL: seed + `g`-patch
  (`encodeGridPatch`, one hex nibble per cell). Any recipient on any device plays the
  identical certified hole on `renderCourseArt()` turf. That's the degraded mode, and it
  is a *full-fidelity game*, not an apology.
- We add an optional **geo sidecar**: `&geo=<lat,lon of tee>,<lat,lon of cup>` packed to
  ~40 base32 chars. Two anchor points fully determine the similarity transform (scale +
  rotation + translation) that `editor.js` currently asks the user to eyeball — so a
  recipient with Tier 1/2 available re-fetches the imagery and reconstructs the *exact*
  alignment; a recipient without it plays on turf art. Same URL, two presentations, one
  puzzle.
- Tier-0 photos never enter a share. The creator's own replay keeps its photo via a local
  IndexedDB stash keyed by patch hash — machine-local, like everything else in this app.

## 6. Elevation — 3DEP ambitions, ranked honestly

The engine already speaks slope (`SLOPE_N/S/E/W` in `terrain.js`, shed physics since Wave
6). USGS 3DEP 1 m DEMs are public domain, and a pure function mapping a per-tile elevation
grid to slope tiles above a grade threshold belongs in `aerial.js`'s style — node-testable
against synthetic heightfields. But: US-only, a second fetch pipeline, a second alignment
problem, and greens-scale break is below the data's noise floor. **Rank: last.** It ships
only after the daily real hole is boring us, and it's the second thing we cut (§9). The
ambition line for the keynote; not a line on the critical path.

## 7. Wave plan — sized for one maintainer, Wave 1 in days

- **Wave 1 — Come home to Caddie (days 1–3).** Teach `index.html`'s Caddie surface to
  play a `?p=` patched hole (today that route lives only in `arcade.html` — see the
  comment in `editor.js:263–269`); extract `src/ui/underlay.js`; photo mode per §3 with
  scrim + haloed marks; editor's "Play" button targets the Caddie. *Exit: trace a real
  hole from your own photo, play it in Caddie, reveal heatmap legible over the
  photograph. Zero network. Zero new deps. Screenshot in `docs/proof/`.*
- **Wave 2 — Paste coordinates (days 4–7).** Tier-1 NAIP fetch behind a flag; the
  two-anchor georeference (enter tee/cup coordinates → alignment solved, no more
  eyeballing sliders); geo sidecar in shares, with graceful turf fallback. *Exit: a
  US hole goes from coordinates to certified share in under five minutes; the same link
  opens correctly with imagery blocked.*
- **Wave 3 — Hole packs & the daily real hole (week 2).** Catalog format v2: records gain
  `kind: 'traced'`, `patch`, `geo`, `attribution` (versioned exactly as
  `exportCatalog`/`importCatalog` anticipate); `cms.html` curates traced holes with the
  same approve/reject states; strategic gate via `certifyHole()` for daily candidates; a
  static JSON pack in the repo rotates by date — no backend, the daily is a file. *Exit:
  a 9-hole "Real America" pack, every hole certified, one featured per day.*
- **Wave 4 — Detection v2 + trace ergonomics (week 3).** Pure-JS classifier features in
  `aerial.js`; live re-detect on alignment change; a "fix-clicks" counter as the quality
  metric (corrections per accepted trace — our A/B gate, in the spirit of `ab.html`).
- **Wave 5 — Priced options, client's call.** The Tier-2 proxy; 3DEP slope import. Both
  optional services in the leaderboard mold, both deletable without touching the game.

## 8. Risk register — the top three ways this dies

1. **The imagery rug-pull.** CORS or endpoint policy changes and Tier 1 goes dark;
   "Play Earth" collapses into "play your own screenshots." *Mitigation:* that collapse
   is survivable by design — Wave 1 and every share work with zero network imagery; Tier
   1/2 are flagged bonuses, never dependencies. *Residual:* the marketing story shrinks;
   the product doesn't.
2. **Tracing feels like homework.** If `detectTerrain()` drafts badly on real photos,
   correction cost kills the creator loop and no packs materialize. *Mitigation:* the
   fix-clicks metric from Wave 4 gates the daily-real-hole launch; detection stays "a
   first draft, never an authority" (`aerial.js` header) so the floor is manual painting,
   which already works. *Kill signal:* median fix-clicks > 60 per hole after detection
   v2 — we then bias holes toward Tier-1 imagery quality instead of promising the globe.
3. **Ops eat the maintainer.** Proxy bandwidth, pack curation, attribution disputes —
   death by a thousand small duties. *Mitigation:* packs are static JSON reviewed like
   PRs; the proxy is cut-first and off by default; nothing in Waves 1–4 runs server-side.
   The only always-on infrastructure this plan adds is *none*.

## 9. What we'd cut first, in order

1. **The Tier-2 proxy** — the priciest rule-bend, and Tiers 0/1 already carry the story.
2. **3DEP elevation** — keynote garnish; slopes stay hand-paintable in the editor.
3. **The daily real-hole rotation** — keep packs as shareable content, drop the ritual.
4. **Detection v2** — v1 plus a paintbrush is a shippable creator loop.
   What we will not cut: Wave 1. If the game can't play a traced hole over its own photo,
   nothing above it exists.

## 10. Why Us

Every other firm will show you a globe. We're showing you a diff: one extracted module,
one insertion into `caddie.js`'s world pass, one route taught to the Caddie surface — and
the pipeline this repo already built (`aerial.js` → `solver.js` → `patch.js`) finishes
its second act. The rules we'd bend are priced in dollars, lines, and pager-duty; the
rules we won't bend are the ones that made this codebase survivable for one person. Fund
Wave 1 on Monday, and by Thursday the reveal heatmap is breathing over real ground.
