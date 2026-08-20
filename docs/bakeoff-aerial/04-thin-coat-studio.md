# Thin Coat Studio — Aerial Bake-off Proposal for GolfCMS/Caddie

**Firm:** Thin Coat Studio · **Date:** 2026-08-15
**Philosophy:** The editor already did the hard part — carry its underlay into play and ship this week.

## 0. Who We Are

Thin Coat Studio ships the 20% that delivers 80% and refuses the rest, in writing.
The house's own bake-off history is our credentials: `docs/bakeoff/JUDGING.md` scored
feasibility as "the only criterion that gates all others," and the firm that promised
one week of vanilla JavaScript beat four firms that promised platforms
(`docs/bakeoff/05-scratch-and-par.md`, 42/50). We are that firm's temperament with a
narrower brief. We do not bring a stack. We bring a diff.

## 1. The Insight: This Feature Is 80% Built

Read `src/ui/editor.js` before reading any proposal in this folder, ours included.
The commission says "overlay the game dynamically over real satellite images," and the
editor already does almost exactly that, today, shipped:

- A local satellite/drone photo loads as an underlay (`#underlay` file input, line 78).
- The user aligns it — `uZoom`, `uRot`, `uPan` state, cover-fit factor `k` — so the
  real tee and cup sit on the anchors (lines 57–61).
- `drawUnderlayTo(c)` (line 68) paints the aligned photo onto **any** 2d context with
  that transform. It is already context-agnostic: the editor calls it once for the
  visible canvas and once for an offscreen canvas feeding `detectTerrain()`
  (`src/engine/aerial.js`) during Detect.
- The tile trace draws over the photo at `traceAlpha` (0.45 default), with tee and cup
  punching through at full alpha "because they are the two facts a trace is anchored
  to" (editor.js lines 163–201). The legibility problem is *solved and shipped* — in
  the editor.
- The result certifies with the real solver and shares as seed + patch
  (`encodeGridPatch` in `src/engine/patch.js` — "the escape hatch for traced holes").

The only thing missing is that when you click **Play**, `challengeUrl()` (editor.js
line 263) opens `arcade.html#/hole/<seed>/standard/<biome>?p=<patch>` — and the photo
stays behind. The traced hole plays as flat tiles. Every other firm in this folder
will propose a new rendering pipeline. We propose carrying one image across one page
boundary. That is the whole feature: **Play on photo**.

## 2. The Handoff Mechanism (the exact one)

**Bake the aligned photo once at world resolution, park it in IndexedDB keyed to the
exact hole, and have the arcade draw it under the tiles it already draws.**

Baking is the load-bearing decision. The editor already knows how to flatten
photo + transform into canvas pixels — the Detect handler does it (editor.js lines
128–134: offscreen canvas, `drawUnderlayTo(octx)`). We reuse that verbatim: render the
aligned photo to a 960×576 offscreen canvas (course 40×24 × `TILE` 24 — the same world
pixels `src/ui/render.js` draws), encode to a JPEG blob (~150–300 KB), and store it.
The play surface then needs **zero transform code**: `drawImage(img, 0, 0)`. No
replicated pan/zoom/rotate math to drift out of sync, no multi-megabyte original in
storage. The raw transform numbers ride along in the record purely as provenance for
a future "re-edit this trace" button.

Why IndexedDB and not alternatives: `sessionStorage` caps near 5 MB and does not
reliably cross a `window.open` boundary with a large payload; an object URL dies with
the editor tab. IndexedDB is local-only (imagery never leaves the machine — the
editor's own comment block, lines 52–56, is our spec), survives the tab handoff, and
costs ~40 lines of dependency-free code. If IndexedDB is unavailable, the hole plays
exactly as today — tile-only. The photo is a luxury with a graceful zero.

### Code sketch against the real files

**New: `src/ui/photo.js` (~40 lines)** — the entire storage story:

```js
// Session-local photo handoff: editor bakes, arcade reads. Never shared,
// never uploaded, never in a URL. One record, overwritten on each handoff.
const DB = 'golfcms.photo', STORE = 'play';
function open() { /* indexedDB.open + onupgradeneeded createObjectStore: ~10 lines */ }
export async function savePlayPhoto({ holeKey, blob, transform }) { /* put, ~8 lines */ }
export async function loadPlayPhoto(holeKey) { /* get; null unless keys match, ~10 lines */ }
export async function clearPlayPhoto() { /* ~5 lines */ }
```

**`src/ui/editor.js` (~20 lines added)** — in the Play/Share flow, if an underlay is
loaded and the hole is certified:

```js
async function bakePlayPhoto() {
  const off = document.createElement('canvas');
  off.width = canvas.width; off.height = canvas.height;
  drawUnderlayTo(off.getContext('2d'));            // existing fn, unchanged
  const blob = await new Promise((r) => off.toBlob(r, 'image/jpeg', 0.85));
  await savePlayPhoto({
    holeKey: `${base.seed}/${base.biome}/${hashPatch()}`, // seed+biome+patch digest
    blob, transform: { k: underlay.k, uZoom, uRot, uPan }, // provenance only
  });
}
// challengeUrl() grows one flag: ...?p=<patch>&photo=1
```

**`src/ui/main.js` (~20 lines added)** — in `loadFromHash()`'s existing creator-mode
branch (lines 93–113), after `startPuzzle(...)`:

```js
if (params.get('photo')) {
  loadPlayPhoto(`${seed}/${biome}/${hashPatch(patchStr)}`).then((rec) => {
    if (!rec) return;                    // stale or absent: play tile-only
    const img = new Image();
    img.onload = () => { photo = { img, alpha: 0.45 }; refresh(); };
    img.src = URL.createObjectURL(rec.blob);
  });
}
// refresh() and stepAnim() pass { ghost, photo } into draw() instead of { ghost }
```

**`src/ui/render.js` (~12 lines added)** — `draw()` gains an underlay pass, mirroring
the editor's own alpha discipline:

```js
if (opts.photo) {
  ctx.drawImage(opts.photo.img, 0, 0);   // baked at world px: no transform
  ctx.globalAlpha = opts.photo.alpha;    // tiles become the trace
}
// ...existing tile loop unchanged...
ctx.globalAlpha = 1;                     // preview, aim line, trail, ghost, flag,
                                         // ball, wind sock: full alpha, exactly
                                         // like tee/cup in the editor
```

**`arcade.html` (~8 lines)** — one range input, hidden unless a photo is live.

**Total: ~100 lines of code, ~120 with the slider and its styling.** Nothing in
`src/engine/` changes. The 126-test suite and the golden replays are untouched by
construction — this is paint under paint, the sim never sees it.

## 3. Which Surface Ships First: the Arcade — and Honestly, Only the Arcade

The arcade (`arcade.html` → `src/ui/main.js`) first, for a reason stronger than
"it's easier": **it is the only surface that can play a traced hole at all.** The
editor's `challengeUrl()` already targets `arcade.html` explicitly — its own comment
says the `#/hole` route "lives in the ARCADE" (editor.js lines 266–268) — and
`main.js` already decodes the patch, re-solves for par, and plays it.

The Caddie surface (`src/ui/caddie.js`) derives every hole procedurally from
`caddieHoleSeed(round.seed, round.holeIndex)` → `caddieHoleCourse(seed)` (line 655).
There is no route that accepts a patch, so there is no traced hole to put a photo
under. "Photo underlay in Caddie" is secretly two features: (a) custom-hole routing
into a surface whose scoring, leaderboard verification (`caddierec.js` replays the
same derivation), and round structure all assume seed-derived holes, and (b) an
underlay pass through a genuinely sophisticated renderer — cached offscreen art
(`renderCourseArt`), a camera with zoom, ease, and portrait rotation
(`drawBase()`, lines 735–763), a green-book layer stack, and an expected-strokes
cone that deliberately bends the art's luminance via `soft-light` blending
(`drawCone()`, lines 765–800) and would need re-tuning over photographic ground.
Anyone who tells you that's a weekend is selling you the weekend after, too.

## 4. The Legibility Minimum

One control: a **trace alpha slider**, identical in spirit to the editor's existing
`#traceAlpha` (editor.js line 94), default 0.45, range full-photo to full-tiles.
The alpha discipline copies the editor's shipped answer: ground tiles fade, everything
the player reasons with — landing preview band, aim line, shot trail, ghost, flag,
ball, wind sock — stays at full alpha, exactly as tee and cup punch through in the
editor's `draw()`.

**We refuse to build, this quarter:** scrim gradients, per-terrain alpha, edge
outlining, photo color-grading, brightness/contrast controls, "readability AI," and
any toggle beyond the one slider. Every one of those is a response to a legibility
problem we have not yet observed a player having. The slider *is* the instrument for
observing it.

## 5. What the Other Firms Will Promise That You Should Not Buy This Quarter

Steelmanned first, because these are good ideas — later.

- **Photorealism overlays** (blend modes, shadow-matched tiles, terrain edges traced
  as vector masks over the photo). *Steelman:* the screenshot would be gorgeous, and
  gorgeous screenshots market a game. *Puncture:* `render.js` is 181 lines and its
  header is a design creed — "the grid is honest: what you see is exactly what the
  sim plays." A photoreal blend whispers that the photo's bunker edge is the bunker
  edge. It isn't; the tile is (the editor says it plainly: "THE TILES ARE STILL THE
  TRUTH. The engine scores the mask, not the photo"). Photorealism here is a
  beautiful way to make an honest game lie. Also: weeks, per biome, forever.

- **Stylization pipelines** (repaint the photo to match the art — palette transfer,
  posterization, "watercolor the satellite"). *Steelman:* it would resolve the
  photo-vs-tiles aesthetic clash in one move. *Puncture:* it's an image-processing
  research project bolted to a zero-dependency repo. Every filter is per-photo tuning
  the solo maintainer owns forever, and the output is a *worse* photo — players load
  aerials because they want to see *their course*, not our impression of it.

- **Georeferenced fetching** (type an address, pull tiles from a satellite API, auto
  scale from latitude). *Steelman:* it removes the align step, and the align step is
  real friction. *Puncture:* it imports the exact problems this repo's architecture
  exists to refuse — an API key, a rate limit, a tile provider's ToS on redistribution
  and caching, network dependence in a PWA that works offline "after one visit"
  (README, `AUTHOR_NOTE.md` Y2Q4), and a licensing question the editor currently
  answers in one line: "THE IMAGE NEVER LEAVES THE MACHINE." The user browsing a maps
  site and taking a capture they're entitled to keeps the license *their* problem —
  fetching makes it *yours*.

- **Grand product visions** ("Real Courses mode," photo-hole catalogs, community
  course packs, a photo-sharing backend). *Steelman:* real courses are plausibly the
  product's endgame; the README already brags about "real holes from aerial photos."
  *Puncture:* every version of this either ships imagery to other machines — a new
  share semantic, a moderation surface, a hosting bill, a copyright exposure — or it
  is quietly just our feature with a roadmap slide stapled on. Shares today are
  seed + patch in a URL (`src/engine/patch.js`), tamper-safe and lawyer-free. Do not
  trade that for a content platform run by one person.

## 6. The Upgrade Path: Thin Coat as Substrate

Nothing above is *rejected* — it's *sequenced*, and every one of them layers onto
this diff rather than replacing it:

1. **Caddie underlay later:** `renderCourseArt(course)` builds one offscreen canvas
   per hole in world pixels. When Caddie grows a custom-hole route, the photo
   composites into that one build site — the baked blob is already in world pixels,
   `photo.js` already serves it, the camera transforms it for free because it
   transforms `art` today.
2. **Stylization later** is a filter applied at bake time in `bakePlayPhoto()` — one
   function, already the single choke point every photo passes through.
3. **Photorealism experiments later** are alternate `draw()` passes behind the same
   `opts.photo` — the plumbing doesn't change, only the paint.
4. **Any fetching future** still terminates in "an image and an alignment" — which is
   precisely the record `savePlayPhoto()` stores. The handoff is the API.

The thin coat is not the small version of the feature. It is the part every big
version contains.

## 7. Plan: Days, Not Weeks

- **Day 1:** `src/ui/photo.js` (IndexedDB store), `bakePlayPhoto()` in the editor,
  `&photo=1` on `challengeUrl()`, key = seed/biome/patch digest.
- **Day 2:** arcade side — load in `loadFromHash()`, underlay pass in `render.js`,
  alpha slider in `arcade.html`. First end-to-end photo round played.
- **Day 3:** hardening and proof — stale-key and no-IndexedDB fallbacks verified,
  a `node --test` unit on the holeKey match logic, `npm test` green (engine untouched,
  golden replays untouched), headless-Chromium screenshot for `docs/proof/` per house
  custom, and this document updated with the receipt.
- **Day 4:** buffer. If it's empty, we spend it playing traced holes and writing down
  what the slider taught us.

## 8. Risks

1. **The real one: does a photo under play actually improve play?** It might be pure
   sentiment — or worse, the photo's texture might fight the landing-preview band and
   cost strokes. We do not argue this; we measure it, in the house's own idiom.
   `ab.html` already runs blind A/B as an exit criterion (README: the generator gate).
   We'd run the same culture at the feature: same traced hole, photo-on vs photo-off
   across sessions, compare strokes-vs-par and undo counts from the existing local
   round log, plus a one-question preference. If photo-on plays worse and still gets
   chosen, that's a finding too — it means this is a *viewing* pleasure, and the
   slider default should rest nearer the tiles. ~100 lines is the correct maximum bet
   to place before that data exists.
2. **Alpha readability on hostile photos** (snow, dense canopy, low sun). Mitigation:
   the slider is the mitigation; the player who loaded the photo tunes it in two
   seconds. We add nothing until a real photo defeats the slider.
3. **Stale or mismatched photo under the wrong hole.** Mitigation: the holeKey binds
   blob to seed + biome + patch digest; any mismatch loads nothing. Tile-only is
   always the fallback, never an error.
4. **Storage quirks** (private windows, `file://` IndexedDB behavior across
   browsers). Mitigation: every failure path degrades to today's behavior; the
   feature can only add, never subtract.
5. **Scope gravity toward Section 5.** Mitigation: this document. The refusals are
   in writing, and the A/B result — not the prettiest demo in the folder — decides
   what earns a second coat.

## 9. What We'd Cut First

In order, if even four days proves optimistic:

1. **The alpha slider** — ship the editor's proven 0.45 constant; the slider is Day-2
   polish on a Day-1 idea.
2. **The transform provenance record** — the baked blob alone ships the experience;
   re-edit round-tripping can wait.
3. **The `photo=1` flag and button copy** — auto-carry the photo whenever Play is
   pressed with an underlay loaded; fewer choices, same feature.

What we would not cut: the holeKey match, the tile-only fallback, and the rule that
`src/engine/` and share URLs do not change. Those aren't scope; they're the floor.

**The pitch in one line:** the editor already aligned the photo and solved the
legibility problem — we move one baked image across one page boundary, in about 100
lines, and your players are hitting real fairways by Friday.
