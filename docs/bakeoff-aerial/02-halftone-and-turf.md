# HALFTONE & TURF — Aerial Bake-off Proposal: The Pressed-Ground Layer

**Date:** 2026-08-15 · **Commission:** "Overlay the game dynamically over real satellite images."

## 1. Who We Are

HALFTONE & TURF is a stylization-pipeline studio. We build the renderers that
turn raw geodata into map tiles, and raw photographs into posters — machines
that take something true and make it *legible*. Our house rule, and our whole
answer to this commission, in one sentence:

**DON'T PLAY ON THE PHOTO — PLAY ON WHAT THE PHOTO BECOMES.**

The satellite image is not the game surface. It is an *input* to the game
surface. We press the aligned photo and the detected tile mask together
through a palette-mapping, edge-preserving quantization pipeline, and out
comes a ground layer painted in Caddie's own art language — the flat poster
fields the reveal heatmap needs, the real hole's bunker lobes and shoreline
curves the current blob art can't know about. The photo contributes organic
detail; the mask contributes truth and color. And because what renders is a
derived stylization built locally, the imagery still never leaves the machine.

## 2. Why This Beats Raw-Photo Play (the argument against Firm 1)

Caddie is a game about *reading ground*. That sentence decides the whole
bake-off, and it decides it against playing on the raw photo:

1. **The photo will contradict the physics, and the player will notice at the
   worst moment.** Tiles are truth (`README.md`: 40×24, the engine scores the
   mask, `src/engine/patch.js` guards tee and cup). A raw aerial shows a
   bunker lip eight feet from where the traced SAND tile starts. The player
   aims off the photo; `src/engine/dispersion.js` answers off the tiles; the
   reveal bills them a stroke for trusting their eyes. That is not immersion,
   it is betrayal. Our pipeline re-draws the ground *from the mask*, letting
   the photo modulate detail only **within** each tile's terrain class — the
   picture is structurally incapable of disagreeing with the scoring.
2. **The reveal heatmap dies on a photograph.** `src/ui/caddie.js` composites
   an expected-strokes heatmap, an optimal ring, a dispersion band, and an
   aim ✕ over the ground. Over `paint.js`'s flat poster fields those overlays
   own the contrast budget. Over a raw aerial — continuous texture, tree
   shadows, cart paths, sun glare — they turn to mud. Quantized fields are
   not a style preference here; they are what makes the strategy surface
   readable.
3. **Photos don't agree with each other.** A winter NAIP capture, a hazy
   summer drone shot, and a low-sun screenshot are three unrelated color
   spaces. Rough vs. fairway can differ by less HSV than two photos of the
   same fairway differ from each other (`src/engine/aerial.js` splits them on
   a hue threshold at 88° for exactly this reason). Stylization normalizes
   every hole into one palette — `paint.js`'s `INK` — so a shared course and
   a generated course read as the same game.
4. **What the photo IS good for, we keep.** Sub-tile bunker silhouettes,
   shoreline curvature, tree-line texture — real geometry below the 24px tile
   grid that `renderCourseArt()`'s blob contours genuinely cannot invent.
   Firm 1 gets this by showing the photo and accepting points 1–3. We get it
   by extracting it and re-inking it.

## 3. The Pipeline: Inputs, Passes, Output

One new file, `src/ui/stylize.js`, sibling to `src/ui/paint.js`. Zero
dependencies, no build step, canvas 2D only — every pass is `ImageData`
arithmetic or compositing tricks `paint.js` already uses.

### 3.1 Inputs

- **The aligned photo**, rendered once by the editor's existing
  `drawUnderlayTo()` (`src/ui/editor.js`) into an offscreen canvas — the same
  canvas the Detect button already reads pixels from.
- **The tile mask** — `course.cells` after Detect + human correction +
  certification. Truth, per the house rule in `aerial.js`'s header.
- **The detail grid** — a new engine export (§3.2): per-tile *sub-tile* class
  votes at 4×4 resolution, i.e. a 160×96 class field for the 40×24 board.

### 3.2 Pass A — sub-tile detection (engine, pure, testable)

`src/engine/aerial.js` already computes everything needed per pixel
(`pixelVote`, `rgbToHsv`); it just throws the spatial arrangement away when
`classifyAerialTile()` reduces a tile to one vote. We add one exported
function beside it — same style, node-testable against synthetic imagery
like the existing classifier:

```js
// src/engine/aerial.js — addition. SUB=4: each tile yields a 4×4 grid of
// coarse classes ('water'|'sand'|'veg'|'scrub'), preserving WHERE in the
// tile the hazard sits. Pure over samples, like classifyAerialTile.
export const DETAIL_SUB = 4;
export function detectDetail({ width, height, cellSamples }) {
  // cellSamples(cx, cy) → RGB triples for sub-cell (cx, cy),
  // cx < width*DETAIL_SUB, cy < height*DETAIL_SUB (UI reads its underlay
  // canvas exactly as editor.js's tileSamples does, at quarter-tile step)
  const w = width * DETAIL_SUB, h = height * DETAIL_SUB;
  const out = new Uint8Array(w * h); // 0 scrub, 1 veg, 2 sand, 3 water
  const CODE = { scrub: 0, veg: 1, sand: 2, water: 3 };
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const votes = { water: 0, sand: 0, veg: 0, scrub: 0 };
      for (const [r, g, b] of cellSamples(cx, cy)) votes[pixelVote(r, g, b)]++;
      let best = 'scrub', n = -1;
      for (const k in votes) if (votes[k] > n) { n = votes[k]; best = k; }
      out[cy * w + cx] = CODE[best];
    }
  }
  return out; // caller smooths with the same 3×3 modal logic as smoothCells
}
```

(`pixelVote` becomes exported; nothing else in the file moves. ~60 lines
plus ~80 lines of tests mirroring the synthetic-imagery tests the classifier
already has.)

### 3.3 Pass B — the palette press (per-pixel, once per hole)

For every pixel of the output: look up its tile's terrain class in
`course.cells`; take the photo's luma at that pixel; quantize the luma to 3–4
bands; map the band into a ramp around that terrain's `INK` color from
`paint.js` (e.g. fairway pixels land on `#6aa956 / #71b45e / #7cc067`).
Terrain drives hue — the game's palette, exactly — the photo drives value.
Result: a posterized ground where every mowing pattern, drainage stain, and
worn walk-path from the real hole survives as banding *inside* the correct
game color. A small 3×3 box pre-blur before quantization kills sensor noise
while the band edges stay crisp — cheap edge-preserving quantization in two
`ImageData` loops, no bilateral filter theatrics.

### 3.4 Pass C — sub-tile hazard contours, clamped to truth

March the Pass-A detail grid for `sand` and `water` regions (reusing the
marching-loop approach of `src/ui/contours.js`) and fill the organic
silhouettes — but **clipped to the truth path grown half a tile**:
`terrainPath(course, isSand)` ∩ photo silhouette. A real bunker lobe that
pokes into a FAIRWAY tile renders only its first half-tile of fringe; beyond
that the fairway color wins, because the fairway *scores*. Then the existing
physics edge is stroked on top exactly as `renderCourseArt()` strokes bunker
lips today — the player always sees one unambiguous line where sand starts
costing them.

### 3.5 Pass D — house finishing

Reuse `paint.js` exports verbatim: `paintMaterial()` + `valueNoiseTile()` for
turf nap, the angled `stripes()` pass, the canopy shadow/body/highlight
layering for TREES tiles (real canopy texture from Pass B sits underneath),
and the closing vignette. This is why the output looks like Caddie and not
like a filter app: the last 30% of the frame is literally the same code.

### 3.6 Output and composite hook

`renderPhotoArt(course, photoCanvas, detail)` returns an offscreen canvas of
`course.width * TILE × course.height * TILE` — the same contract as
`renderCourseArt(course)`. The composite hook in `src/ui/caddie.js` is one
line where the art is built (currently `art = renderCourseArt(course)`,
~line 662):

```js
art = coursePhotoArt(course) ?? renderCourseArt(course);
```

Everything downstream — camera, heatmap, green book, ghosts — is untouched,
because the stylized layer is *the same kind of object* the painter already
hands over.

## 4. Imagery Sourcing & Licensing

We press the licensing point hard, because our architecture makes it nearly
vanish:

- **The app never fetches imagery.** No tile servers, no API keys, no CORS,
  no CSP exceptions — file input only, exactly like today's `editor.html`
  underlay. The static site stays static; zero dependencies stays zero.
- **What ships is a derived stylization that ALSO never ships.** The photo is
  session state; the pressed canvas is local state; the shared URL is seed +
  `encodeGridPatch()` cells (`src/engine/patch.js`) — a 961-character fact
  sheet about ground. Redistribution of imagery, the entire licensing
  question, structurally cannot arise. This is the editor's existing promise
  (`editor.js` §"THE IMAGE NEVER LEAVES THE MACHINE") extended to play.
- **Recommended sources, in order:** USGS/USDA **NAIP** orthoimagery (public
  domain, ~0.6 m/px, covers every US course), state/municipal open
  orthoimagery portals, **OpenAerialMap** (CC-BY), and the user's own drone
  captures. Documentation steers users there.
- **What we refuse to launder:** we do not build or document a Google/Bing
  screenshot workflow. Even though nothing persists or transmits, their ToS
  prohibit derivative offline use, and a solo maintainer does not need that
  letter. The honest line: "use imagery you're licensed to view offline;
  public-domain NAIP makes that trivial."

## 5. The Share Loop: What Degrades, What Doesn't

Recipient opens `?p=g…` without the photo:

- **Doesn't degrade:** the hole. Physics, par, certification, the caddie's
  optimal line, SG scoring, ghosts, the daily/gauntlet rituals — all derive
  from seed + cells (`src/ui/main.js` already rebuilds patched courses).
  `renderCourseArt()` paints the mask in the same palette. Both players see
  the same colors meaning the same things in the same places.
- **Degrades:** sub-tile silhouette fidelity and photo-derived banding. The
  recipient's bunker is `contours.js`'s organic blob instead of the real
  lobe; turf texture is `valueNoiseTile()` instead of real mowing history.
- **The degradation is invisible as degradation** because both renderers
  share Pass D and the palette — the recipient sees a normal Caddie hole,
  not a broken photo hole. There is no "missing texture" state to explain.
- **Stretch (explicitly not promised):** a compact detail sidecar — per
  hazard tile, a 16-bit occupancy of its 4×4 detail cells, hex-packed into an
  optional `&d=` param (~4 chars per hazard tile, typically < 300 chars) —
  would let recipients reconstruct real silhouettes with zero imagery. We
  list it to show the format has room, and we'd cut it first (§9).

## 6. Performance

- **Build cost, once per hole:** the output canvas is 960×576 = 553k pixels.
  Pass B is two linear `ImageData` loops (~10–20 ms on a 2019 laptop); Pass A
  runs on a 160×96 grid (trivial); Pass C marches a 160×96 field (the
  existing `contours.js` marches 40×24 with grow offsets — same order of
  work); Pass D is `renderCourseArt()`'s own passes minus base fills. Budget:
  **< 150 ms one-time**, on the same "built once per hole into an offscreen
  canvas so the pretty version is free at frame time" contract `paint.js`
  states in its header. We instrument it like `renderGreenArt()` returns `ms`.
- **Frame cost: zero delta.** One `drawImage` of one offscreen canvas —
  identical to today.
- **Memory:** one extra 960×576 canvas (~2.2 MB) plus a transient photo
  canvas released after pressing. The green-camera detail rebuild at
  `GREEN_SUB` is deferred (§9) precisely because 4× oversampled photo art is
  the only genuinely expensive canvas in sight.

## 7. Wave Plan (solo maintainer, rough lines)

| Wave | Deliverable | New lines |
|---|---|---|
| 1 | `detectDetail()` + exported `pixelVote` in `src/engine/aerial.js`; modal smoothing on the detail grid; node tests against synthetic imagery | ~60 engine + ~80 tests |
| 2 | `src/ui/stylize.js`: Pass B palette press + quantization; editor preview toggle ("Pressed" button beside Detect) rendering it in place of the flat trace | ~180 + ~40 in `editor.js` |
| 3 | Hand-off to play: pressed canvas cached in IndexedDB keyed by hash(seed, patch); `coursePhotoArt()` lookup + the one-line hook in `caddie.js`; fallback path is the existing painter | ~90 |
| 4 | Pass C sub-tile hazard contours clamped to truth, physics-edge stroke on top; Pass D reuse of `paintMaterial`/`stripes`/canopy/vignette | ~140 |
| 5 | Polish: per-class histogram normalization for badly-lit photos, `ms` instrumentation, docs page on sourcing (§4), golden screenshot in `docs/proof/` | ~80 + docs |

Total: **~550 lines of code**, one new UI file, one engine addition, no new
pages, no dependency, no build step. Each wave ships alone and the game is
never worse than today mid-stream — Wave 3's fallback *is* the current game.

## 8. Risks

- **Ugly input photos** (haze, winter dormancy, hard shadows) produce muddy
  banding. Mitigation: per-terrain-class luma histogram normalization (Wave
  5) — we stretch each class's photo values to its band range, so even a
  brown January fairway presses green with real texture.
- **Cache eviction / device switch** silently drops the pressed layer.
  Mitigation: the fallback is the shipped painter; degradation is the
  already-good default, never a blank. Cache key includes the patch hash so
  a re-edited hole can't wear a stale photo.
- **The clamp reads as a lie in reverse** — a player sees a pressed bunker
  fringe end abruptly at a tile boundary. Mitigation: the fringe fades over
  the half-tile grace zone rather than hard-clipping, and the stroked
  physics edge (§3.4) is always the loudest line. The editor preview (Wave
  2) lets the author see and repaint any tile where truth and photo argue.
- **Scope creep toward a photo editor** (exposure sliders, masks, brushes).
  We refuse: one normalization pass, zero user-facing knobs beyond the
  existing align controls. The correction tool for a bad press is the
  terrain brush that already exists.
- **Mobile canvas memory** if the green-camera detail layer is ever pressed
  at `GREEN_SUB`. Mitigation: it's deferred, and if built, pressed only for
  the green bbox like `renderGreenArt()` already scopes itself.

## 9. What We'd Cut First

1. **The `&d=` detail sidecar** (§5) — a nice-to-have codec; the share loop
   is whole without it.
2. **Green-camera photo detail at `GREEN_SUB`** — the putting surface
   already has the best art in the game (`renderGreenArt()`); photo texture
   adds least exactly where the current painter is strongest.
3. **IndexedDB persistence** (Wave 3 shrinks to a same-session hand-off via
   an in-memory module export; replaying tomorrow re-presses from the photo
   you re-open, or falls back).
4. **Never cut:** the truth clamp (§3.4) and the fallback painter path. The
   first is the game's integrity; the second is the solo maintainer's sleep.

*— HALFTONE & TURF, August 2026. The photograph is the negative; the game is
the print.*
