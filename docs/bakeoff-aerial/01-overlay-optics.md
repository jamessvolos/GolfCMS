# Overlay Optics — Bake-Off Proposal: The Game on the Photo

**Submission:** 01 | **Firm:** Overlay Optics | **Date:** 2026-08-15 | **Contact:** tracer@overlayoptics.tv

---

## 1. Who We Are

Overlay Optics is a broadcast-graphics engineering firm. We put shot tracers over live
fairways, strike zones over center-field cameras, and world-record lines over swimming
pools — graphics that have to stay legible on top of photography we do not control, at
30fps, with a director yelling. We have never once been allowed to "restyle" the picture.
The picture is sacred; our job is to make instruments read *on* it.

Our philosophy in one sentence: **the photo is the ground — play the game directly on
the raw satellite image, and render every instrument as a broadcast-quality overlay
that earns its legibility instead of asking the imagery to change.**

## 2. Vision Statement

Caddie already has the hard part: `src/engine/strategy.js` computes an expected-strokes
field, `src/engine/dispersion.js` computes a real shot pattern, and `src/ui/caddie.js`
draws both as instruments — cone, ellipse, heatmap, caddie ring. Today those instruments
sit on `renderCourseArt()`'s painted turf (`src/ui/paint.js`). Under our plan they sit on
the actual hole: the aerial photo the creator aligned in `editor.html` becomes the ground
of the play surface, verité, untouched — no color grade, no cartoon pass, no "stylized
satellite." What changes is the instruments, which graduate to broadcast spec: scrims,
casings, and contrast-adaptive strokes, so the dispersion ellipse reads over a white
bunker exactly as well as it reads over dark canopy.

The tiles remain the physics truth. The 40×24 grid is still what the engine scores —
the photo is presentation, exactly as `editor.js` line 52 already declares: *"THE TILES
ARE STILL THE TRUTH. The engine scores the mask, not the photo."* We are not proposing a
new game. We are proposing the telecast of the existing one.

## 3. How the Photo Enters the Play Surface

The pipeline already exists in halves; we connect them.

**The editor half is done.** `src/ui/editor.js` owns the underlay: a user-local file,
cover-fit factor `k`, and the user transform `uZoom`/`uRot`/`uPan`, all applied in one
place — `drawUnderlayTo(c)`. `Detect terrain` renders the aligned photo to an offscreen
canvas, samples 36 pixels per 24px tile, and hands them to
`detectTerrain()` in `src/engine/aerial.js` (HSV votes, texture split, modal smoothing).
Certify runs the real solver; Share emits `arcade.html#/hole/<seed>/standard/<biome>?p=<patch>`
via `challengeUrl()`, with full traces using `encodeGridPatch()` from `src/engine/patch.js`
(`g` + one nibble per cell — 961 characters for the whole board).

**What's missing is the handoff.** The aligned photo dies when the editor tab closes.
We persist it as a *photo session* — deliberately not course data:

```js
// src/ui/photostore.js (new, ~90 lines) — IndexedDB, same-origin, zero deps
// key: `${seed}:${biome}` — the same identity the share URL carries
{
  blob,                      // the image file, downscaled to ≤2048px on ingest
  align: { k, uZoom, uRot, uPan },   // editor.js's exact numbers, verbatim
  hash,                      // first 8 hex of SHA-256(file bytes), for re-attach checks
  savedAt,
}
```

The editor writes this record on Certify. The play surface (`arcade.html` today,
Caddie in Wave 3) reads it while booting a `?p=` hole in `src/ui/main.js`, and if a
record exists for this seed+biome, the ground is the photo. Alignment state flows as
data, not as a re-projection: play-side, we replay `drawUnderlayTo`'s transform verbatim
into an offscreen canvas, so the photo lands on the grid *exactly* where the creator
traced it — same translate, same rotate, same `k * uZoom`. One transform, two surfaces,
zero drift.

**The bake.** The photo composites once per hole into an offscreen ground canvas — a
drop-in sibling of `renderCourseArt()`:

```js
// src/ui/photoart.js (new) — the verité ground + the legibility base coat
export function renderPhotoGround(course, session) {
  const off = document.createElement('canvas');
  off.width = course.width * TILE;    // 960
  off.height = course.height * TILE;  // 576
  const ctx = off.getContext('2d');
  ctx.fillStyle = '#22301f';                       // letterbox where photo doesn't cover
  ctx.fillRect(0, 0, off.width, off.height);
  drawAligned(ctx, session);                       // editor.js's drawUnderlayTo, verbatim
  // the ONLY thing we lay on the raw image globally: a 10% edge vignette so the
  // HUD corners hold, same shape renderCourseArt already bakes. No grade. No LUT.
  paintEdgeVignette(ctx, off.width, off.height, 0.10);
  // per-tile luminance map, sampled once here so overlays can adapt per-frame free
  const luma = sampleTileLuma(ctx, course);        // Float32Array(960), one mean per tile
  return { canvas: off, luma };
}
```

And in `src/ui/caddie.js` / `src/ui/main.js`, the swap is one seam — the same seam the
art pass already uses (`loadHole()` does `art = renderCourseArt(course)`; `drawBase()`
does `ctx.drawImage(art, 0, 0)` inside `beginWorld()`):

```js
const session = await photoSessionFor(seed, biome);   // null for everyone else
ground = session ? renderPhotoGround(course, session) : { canvas: renderCourseArt(course), luma: null };
art = ground.canvas;   // drawBase() is untouched; the camera seam never knows
```

Because `drawBase()` draws the ground through the existing camera transform, pan, zoom,
rotate-for-portrait, the approach framing, and the peek all work on photography for free.

## 4. The Overlay Stack — Legibility on Photography, Layer by Layer

Painted turf is a controlled studio background: `paint.js`'s `INK` palette guarantees
the yellow ellipse never meets yellow ground. A photo guarantees nothing — white sand,
blown-out cart paths, near-black conifer shadow, sometimes within one dispersion
pattern. Broadcast has solved this for decades. The toolkit, applied to each instrument:

- **Layer 0 — the photo.** Raw. The vignette above is the only global mark.
- **Layer 1 — hazard truth scrims.** Water and OB *as the engine scores them* get a
  2px stroked contour (reusing `terrainLoops` via `terrainPath()` from `paint.js`) in
  cyan-white over a dark casing, plus a 12% blue multiply scrim inside. This is not
  restyling — it is the instrument that says "the physics calls this water," and on a
  murky pond photo that declaration is the difference between a game and a guess. Off
  by default outside aim phase; always subordinate to the picture.
- **Layer 2 — the expected-strokes cone.** `drawCone()` already composites
  `renderCostImage()` in `soft-light` at `CONE_ALPHA`, clipped to `coneBeamPath()`.
  Soft-light bends luminance around the *photo's own* midtones, so on imagery it
  half-vanishes over bright ground. Fix: two-pass — `multiply` for expensive ground,
  `screen` for cheap ground, both clipped to the same beam, alpha driven by the tile
  luma map so the pass that fights the local brightness gets the gain. Reads as
  weather on any exposure.
- **Layer 3 — the dispersion ellipse and aim line.** Every stroke becomes a *cased
  stroke* — the tracer trick, and `caddie.js` already does it for text
  (`strokeText` dark under `fillText` white in `drawAim()`): a 3.5px dark casing
  (`rgba(10,14,10,0.75)`) under the 1.5px instrument color. Casing alpha scales with
  local tile luma: over dark canopy the casing fades (the bright core carries), over
  sand the casing does the work. The ellipse fills drop from 0.30 to 0.16 alpha over
  photography and gain a 1px casing rim.
- **Layer 4 — outcome dots.** The 48 pattern dots keep their `DOT` outcome colors but
  each gets a 1px contrast rim chosen per-dot from the luma under it (dark rim on
  bright ground, light rim on dark). Water dots keep their larger radius; on photos
  they also pulse the Layer-1 water contour they land inside.
- **Layer 5 — the reveal heatmap.** `buildHeatCanvas()` bakes green→red at alpha 82
  and upscales bilinearly. Over photography, hue-on-hue dies (green heat on green
  turf). We keep the exact ramp but composite it over a 22% neutral-dark under-scrim
  clipped to the swept extent — the sweep already clips a circle in `drawReveal()`, so
  the scrim rides the same clip. The verdict field reads like a telestrator wipe: the
  photo dims a step, the judgment paints on top, `soft-light` nowhere in sight.
- **Layer 6 — caddie ring, your ✕, ball, pin.** Already screen-space with shadows
  (`drawPin`'s cast shadow, `drawBall`'s blot). They inherit casings and are done.
- **Layer 7 — DOM.** Stamp, chips, vignette alarm: untouched. They already sit on a
  scrimmed glass layer and never touch the canvas.

One dial governs Layers 1–5: `overlayGain` (0.75–1.25, persisted), because a snowy
Michigan muni and a Scottsdale target course need different clothes. And `B` toggles
photo ground ↔ painted ground instantly — both grounds are one `drawImage` swap.

## 5. Imagery Sourcing & Licensing — Honestly

Three sources, in descending order of honesty:

1. **User-local files (ship this).** The current stance — `editor.js` lines 54–56:
   *"THE IMAGE NEVER LEAVES THE MACHINE."* A screenshot, a drone photo, a purchased
   ortho. We extend the same stance to play: the photo lives in the player's IndexedDB,
   is never encoded into a share, never uploaded. Whatever rights the user has to view
   their file, we neither enlarge nor launder them.
2. **Public-domain NAIP (document this).** USDA NAIP orthoimagery is US-government
   public domain, 60cm–1m GSD — genuinely good enough to read bunkers. But it is
   US-only, and no CORS-friendly free endpoint exists that we would bet the product on.
   So: a documented recipe (`docs/bakeoff-aerial/naip.md`, Wave 5) — find your course on
   USGS EarthExplorer, export a JPEG, load it as a local file. No fetch code, no keys,
   no rot.
3. **Provider tiles (decline this).** Google/Mapbox/Bing satellite ToS prohibit
   caching, extraction, and use outside their SDKs; Esri wants attribution and imposes
   limits. And there is a technical veto stacked on the legal one: a cross-origin image
   without CORS **taints the canvas**, which kills `getImageData` — the exact call
   `editor.js`'s Detect handler and our `sampleTileLuma()` depend on. Provider tiles
   would break Detect *and* the adaptive-contrast system while violating ToS. We
   decline both halves of that deal, and we put the refusal in writing here so nobody
   relitigates it in a feature request.

House constraint check: zero dependencies (IndexedDB and SHA-256 via `crypto.subtle`
are platform), no build step, static site, imagery never ships with shared content.
All honored; none bent.

## 6. The Share Loop — When the Recipient Doesn't Have the Photo

The share URL stays what it is: `#/hole/<seed>/standard/<biome>?p=g…` — seed plus
full-grid patch, decoded by `main.js` (`params.get('p')` → `decodePatch` →
`applyPatch`, tee and cup immutable). We append one small param:

`&a=<zoom>.<rot>.<panx>.<pany>.<hash8>` — the alignment record plus the photo's
8-hex content hash. ~30 characters. Not imagery; *instructions for* imagery.

The recipient's ladder, best to worst, every rung playable:

1. **Has the photo session** (they made it, or re-attached before): photo ground.
2. **Has the file** (creator sent it alongside — group chat, drive folder): a quiet
   banner — *"Traced from a photo. Have it? Drop it in."* Drop → hash check against
   `hash8` (mismatch warns, doesn't block) → alignment snaps from `&a=` → photo ground.
   Zero manual aligning for the recipient, ever.
3. **Has nothing:** the hole renders on `renderCourseArt()` exactly as today. Because
   the tiles are the physics, the puzzle, the par, the solver certificate, the SG math,
   and the ghost race are *bit-identical* with or without the photo. The photo is the
   telecast; the patch is the game.

This is the licensing stance made structural: the share loop cannot leak imagery
because imagery has no encoding in the share format.

## 7. Performance on a 960×576 Canvas

The frame loop's shape doesn't change — that is the whole performance argument.

- **Ground:** one `drawImage` of a pre-baked 960×576 canvas per frame, photo or paint.
  Identical cost to today's `ctx.drawImage(art, 0, 0)`.
- **Bake cost:** once per hole, off the hot path in `loadHole()`'s existing
  `setTimeout` — decode + one transform draw + one 960×576 `getImageData` for the luma
  map (~2.2MB, freed after sampling). Ingest downscales photos to ≤2048px so mobile
  never decodes a 12,000px ortho.
- **Adaptive contrast:** casings read the *pre-sampled* per-tile luma
  (`Float32Array(960)`), never `getImageData` at frame time. Per-frame cost: 48 array
  lookups for dots, a handful for strokes.
- **Cone/heat:** unchanged mechanics — same 40×24 cost image, same bilinear upscale;
  the two-pass cone is one extra clipped `drawImage`. The heat under-scrim is one
  `fillRect` inside an existing clip.
- **Green camera:** the photo at `GREEN_SUB`-equivalent zoom would need a 4× bake
  (3840×2304 ≈ 35MB RGBA — mobile poison). We don't. We crop-bake only the green
  window at 2× (the same geometry `renderGreenBook` returns as `geo`), and keep the
  hand-drawn green book *on top* by default — a yardage book on the telecast is more
  honest than a blurry photo blowup, and it reuses the entire cached layer stack.
- **Budget:** `caddie.js` already records `lastFrameMs`; Wave 2's exit criterion pins
  aim-phase frames ≤4ms on a 2020 laptop, photo ground vs paint ground, measured not
  vibed.

## 8. Roadmap — Five Waves (solo-maintainer sized)

**Wave 1 — The handoff (~310 lines).** `photostore.js` (~90); ingest-downscale +
hash (~40); editor writes the session on Certify (~30); `photoart.js` ground bake +
luma map (~110); `main.js` boot seam for `?p=` holes (~40). *Exit: a hole traced in
the editor plays in the arcade on its own photo after a full browser restart.*

**Wave 2 — The overlay stack (~340 lines).** Cased strokes + luma-adaptive casings
(~90); two-pass cone (~60); heat under-scrim (~25); dot rims (~30); hazard-truth
contours reusing `terrainPath` (~80); `overlayGain` + `B` toggle (~55). *Exit:
screenshot grid of 6 instruments × 4 hostile grounds (sand, canopy, water glare,
snow), every instrument legible in every cell.*

**Wave 3 — Caddie on photography (~220 lines).** A `#/traced/<seed>/<biome>?p=&a=`
route on the Caddie surface: single-hole round via the `loadHole()` machinery with a
patched course instead of `caddieHoleCourse(seed)` (~120); reveal/cone/ellipse tuning
pass on photo ground (~60); green-window crop bake behind the green book (~40).
*Exit: full aim→commit→reveal→putt loop, SG verdicts and all, on a real traced hole.*

**Wave 4 — The share loop (~190 lines).** `&a=` codec + hash8 (~50); recipient
drop-in banner + re-attach flow with alignment snap (~110); mismatch warning (~30).
*Exit: recipient with the file gets the photo ground in two gestures; recipient
without it never sees an error.*

**Wave 5 — Sourcing docs + QA (~80 lines + docs).** NAIP recipe doc; a
`test/photoart.test.js` for the alignment codec and luma sampler (pure functions,
node-testable); memory audit on a mid-tier Android. *Exit: a stranger with a US
course and no help traces and shares a real hole by following one doc.*

Total: ~1,140 lines against a ~5,400-line UI. One new concept (the photo session),
zero new dependencies, zero engine changes — `src/engine/` is untouched in all five
waves, so the 126-test suite and the golden replays never wobble.

## 9. Risks Register

- **Hostile photography** (snow, dusk captures, heavy shadow) defeats the stack.
  *Mitigation:* `overlayGain` dial; hazard-truth contours carry the game even when
  the picture is mud; `B` toggle is always one key away. Worst case is today's game.
- **IndexedDB eviction / private mode** loses the session between editor and play.
  *Mitigation:* the ladder in §6 — rung 3 is a fully playable fallback; the banner
  invites re-attach. Never an error state.
- **Green zoom exposes photo resolution.** *Mitigation:* designed out in §7 — the
  green book stays hand-drawn; the photo appears there only as a 2× crop underlay.
- **Alignment drift between surfaces** (editor canvas vs play canvas rounding).
  *Mitigation:* one shared transform function, exported from one module, unit-tested
  round-trip through the `&a=` codec; both canvases are the same 960×576.
- **Detect quality varies by photo** and disappointment lands on our doorstep.
  *Mitigation:* out of scope by contract — `aerial.js` is a first-draft classifier by
  design ("decisively wrong, one click to fix"); our waves never touch it.
- **Scope creep toward GIS** — web-mercator, GeoTIFF parsing, tile servers.
  *Mitigation:* declined in §5 with reasons; the photo is a picture, not a map.
- **Solo maintainer bus-factor on broadcast arcana.** *Mitigation:* every technique in
  §4 is ~30 lines of canvas code with a comment naming the trick; no shaders, no deps.

## 10. What We'd Cut First

In order, and we'd still stand behind the product after each cut:

1. **The green-window photo crop** (Wave 3 tail) — the green book already wins there.
2. **Alignment-in-URL** (`&a=`) — recipients re-align by hand like creators do today;
   the hash-check banner survives.
3. **Hazard-truth contours** — the two-pass cone and cased ellipse carry legibility.
4. **The Caddie route** — arcade-only photo play still delivers the commission's core.

What we would never cut: the bake-once ground seam, the cased strokes, and the §6
fallback ladder. Those three *are* the proposal — the photo as ground, instruments
that read on it, and a share loop that never holds the game hostage to a file.

---

*Overlay Optics — the picture is sacred; the instruments earn their place on it.*
