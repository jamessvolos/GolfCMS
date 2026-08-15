# GolfCMS Aerial Bake-Off Proposal — Georeference Guild

**Firm:** Georeference Guild · Geospatial Data Engineering
**Contact:** bids@georeferenceguild.org · Proposal 03 · 2026-08-15
**Philosophy in one sentence:** THE IMAGE IS NOT THE ASSET — THE COORDINATES ARE.

---

## 1. Who We Are

Georeference Guild builds geospatial pipelines: USGS/NAIP ingestion tooling, OpenStreetMap
conflation services, county-parcel georectification for three state GIS offices. We live in the
world where imagery is re-flown every two years, endpoints move, and licensing lawyers read your
README. The lesson we bring to this commission: **pixels are perishable and encumbered; coordinates
are forever and free.** GolfCMS already believes a version of this — `README.md` says "the photo
never leaves your machine: a shared trace is a full-grid patch in the URL, never imagery." We are
here to finish that sentence: the share should also say *where on Earth* the hole is, and let every
recipient's client fetch the same public-domain imagery itself.

## 2. Vision Statement

The commission is "overlay the game dynamically over real satellite images." Four other firms will
pitch you overlay tricks. We will pitch you a **georeference**: a lat/lon anchor, a rotation, a
tile scale, and the certified tile mask you already ship. That is the whole asset. The imagery is
US NAIP aerial photography (public domain, USDA), fetched by each client from public endpoints or
loaded from a local file; the elevation, later, is USGS 3DEP (public domain). The moat is not a
renderer — it is a growing, certified catalog of REAL holes in `src/engine/catalog.js` whose
licensing story survives scrutiny because nothing encumbered is ever redistributed: NAIP is public
domain, 3DEP is public domain, and a georeference is just numbers.

Everything the house holds sacred survives intact: tiles remain physics truth (`src/engine/aerial.js`
already says "THE TILES ARE THE TRUTH"), URL shares still fully reproduce holes with zero network,
imagery still never ships inside shared content, and the engine stays deterministic because the
engine never touches a pixel at play time.

## 3. The Georeferenced Share Format

Today `src/ui/editor.js#challengeUrl()` emits `arcade.html#/hole/<seed>/standard/<biome>?p=g…`,
where the `g` patch from `src/engine/patch.js#encodeGridPatch()` is 961 chars for the full 40×24
grid. We add one query parameter, `geo`, packed in the same house dialect — fixed-width hex,
versioned, decode-hostile to malformed input:

```
geo = 'a' + lat(7 hex) + lon(7 hex) + rot(3 hex) + tileSize(3 hex) + vintage(1 hex)   — 22 chars
```

- **lat/lon of the grid center:** `round((lat+90)·1e5)` / `round((lon+180)·1e5)`. 1e-5° is ~1.1 m —
  a tile is ~7–9 m (`aerial.js` sizes tiles at "≈ 8–10 yds"), so anchor error is under ⅐ of a tile.
- **rot:** grid bearing in tenth-degrees (0–3599), the same rotation the editor's underlay already
  tracks as `uRot`.
- **tileSize:** tile edge in decimeters (0–409.5 m), fixing real-world scale.
- **vintage:** NAIP flight year minus 2010 (0–15) — provenance display only, never physics.

**Byte budget:** seed+route (~45) + full-grid patch (961) + geo (22) ≈ **1,030 characters** — under
every practical URL ceiling (2,048 conservative; Chrome/Firefox allow far more) and barely 7% over
today's traced-hole share. A hole with no georeference simply omits `geo` and nothing changes:
`src/ui/main.js` line 92 reads `params.get('p')` today and will read `params.get('geo')` the same
way — absent means the game you already ship.

New pure module, tested in node like everything else:

```js
// src/engine/georef.js — a hole's place on Earth, packed the way patch.js
// packs terrain: fixed-width hex, versioned, pure functions, no I/O.
const hex = (n, w) => n.toString(16).padStart(w, '0');

export function encodeGeoRef({ lat, lon, rotDeg, tileM, vintage = 2020 }) {
  const la = Math.round((lat + 90) * 1e5);            // 0..18e6 → 7 hex
  const lo = Math.round((lon + 180) * 1e5);           // 0..36e6 → 7 hex
  const ro = Math.round((((rotDeg % 360) + 360) % 360) * 10);
  const tm = Math.round(tileM * 10);                  // decimeters
  if (la < 0 || la > 18e6 || lo < 0 || lo > 36e6 || tm <= 0 || tm > 4095) {
    throw new Error('georef out of range');
  }
  return 'a' + hex(la, 7) + hex(lo, 7) + hex(ro, 3) + hex(tm, 3) +
    hex(Math.min(15, Math.max(0, vintage - 2010)), 1);
}

export function decodeGeoRef(str) {
  const m = /^a([0-9a-f]{7})([0-9a-f]{7})([0-9a-f]{3})([0-9a-f]{3})([0-9a-f])$/i.exec(str);
  if (!m) throw new Error('malformed georef');
  return {
    lat: parseInt(m[1], 16) / 1e5 - 90, lon: parseInt(m[2], 16) / 1e5 - 180,
    rotDeg: parseInt(m[3], 16) / 10, tileM: parseInt(m[4], 16) / 10,
    vintage: 2010 + parseInt(m[5], 16),
  };
}

/** Lat/lon of a tile center: local tangent-plane offsets from the anchor,
 *  rotated by the grid bearing. Over a 400 m hole the flat-earth error is
 *  centimeters — three orders below tile size. */
export function tileLatLon(geo, course, x, y) {
  const dx = (x + 0.5 - course.width / 2) * geo.tileM;
  const dy = (y + 0.5 - course.height / 2) * geo.tileM;
  const th = (geo.rotDeg * Math.PI) / 180;
  const east = dx * Math.cos(th) - dy * Math.sin(th);
  const south = dx * Math.sin(th) + dy * Math.cos(th);
  const mPerDegLat = 111320;
  return {
    lat: geo.lat - south / mPerDegLat,
    lon: geo.lon + east / (mPerDegLat * Math.cos((geo.lat * Math.PI) / 180)),
  };
}
```

The editor mints `geo` at trace time: the author drops two pins on a map link (or types lat/lon of
tee and cup, which fixes anchor, rotation, and scale simultaneously — two points fully determine a
similarity transform). No map SDK; a text field and `tileLatLon` in reverse.

## 4. Imagery Acquisition, Ranked by Honesty

**Path 1 — user-local file (works today, keeps working forever).** `editor.js` already loads a
local image as the underlay. We extend the same affordance to the play surfaces: a shared hole with
`geo` shows "load an aerial of this hole" with a deep link to the coordinates (USGS EarthExplorer /
any map the player likes), and a two-click align — click the real tee, click the real cup; the geo
box supplies the rest. Zero network calls from our code, zero CORS, works offline, works outside
the US. This is the floor and it is honest: every other path degrades to it.

**Path 2 — public-domain endpoints, with the CORS reality stated plainly.** The USGS National Map
serves NAIP-derived imagery from `basemap.nationalmap.gov` (`USGSImageryOnly` tiled service), which
sends `Access-Control-Allow-Origin: *` as of this writing and is public domain within CONUS. That
"as of this writing" is doing real work: federal tile endpoints have been reorganized before, carry
no SLA, and rate-limit. So the client **probes at runtime** — one HEAD-equivalent tile fetch; on
failure it falls back to Path 1's prompt rather than a broken page. The endpoint URL lives in one
constant, overridable via `localStorage['golfcms.aerial.url']`, exactly the opt-in pattern
`README.md` documents for `golfcms.leaderboard.url`. We name what we will NOT do: Esri World
Imagery and Google tiles are not public domain and never enter the codebase, however good they look
in a demo.

**Path 3 — optional zero-dep proxy, modeled line-for-line on `server/leaderboard.js`.** A
~150-line `server/tiles.js` (node:http + global fetch, no packages): whitelisted upstream hosts
only, permissive CORS like `createServer()` in the leaderboard sets, an on-disk tile cache using
the same atomic `writeFileSync`+`renameSync` pattern as `saveBoards()`. It exists for two reasons —
endpoint churn insurance and politeness caching — and the game never depends on it, only offers to
use it. Same deploy story: `Dockerfile`, `fly.toml`.

## 5. Rendering: Fetched Imagery Under the Game

`src/ui/caddie.js#drawBase()` (line 735) already composites a cached course-art canvas with
`ctx.drawImage(art, 0, 0)`. The aerial underlay is one more cached canvas below it, built once per
hole by a small `src/ui/underlay.js`: convert the geo box's corners to Web Mercator tile
coordinates at the zoom whose ground resolution best matches `tileM`, fetch the covering tiles with
`crossorigin` images, and draw them rotated by `-rotDeg` into an offscreen canvas sized
`course.width*TILE × course.height*TILE`. Then, in `drawBase()`:

```js
if (aerialArt) {
  ctx.drawImage(aerialArt, 0, 0);
  ctx.globalAlpha = 0.55;      // terrain becomes the tracing layer, as in editor.js
}
ctx.drawImage(art, 0, 0);
ctx.globalAlpha = 1;
```

Every overlay the game already draws — the aim ellipse, the reveal heatmap
(`reveal.heatCanvas`), the optimal ring, ghosts — renders above unchanged, because they already
composite over `art`. The engine never reads the aerial canvas: `strokesField`, `resolveShot`, and
the solver in `src/engine/solver.js` see only `course.cells`. The photo is presentation; the mask
is physics. Same treatment in `src/ui/main.js` for the arcade surface, behind one shared module.

## 6. Reproducibility: Re-flown Pixels, Identical Physics

NAIP re-flies every state on a 2–3 year cycle. A recipient in 2028 opening a 2026 share will fetch
imagery where a bunker was redone and a tree came down. This is precisely why the certified tile
mask travels **in the URL** and the imagery does not:

- The `g` patch is the authoritative ground. `applyPatch()` in `src/engine/patch.js` rebuilds the
  exact cells; the solver's certificate re-derives par from them (`main.js` line 94's "par
  recomputed" path). Two players on different NAIP vintages play bit-identical holes — different
  wallpaper, same physics — the same guarantee the golden-replay fixtures in `test/golden.test.js`
  already pin for seeds.
- The `vintage` nibble makes drift visible instead of confusing: when fetched imagery is newer than
  the trace, the HUD shows "traced on NAIP 2022 · imagery may be newer," a provenance badge, never
  a gameplay difference.
- If imagery cannot be fetched at all, the hole plays exactly as every hole plays today. The
  aerial is an enhancement layer with a defined value when absent: nothing.

## 7. Elevation: 3DEP, a Later Wave, Baked Not Fetched

USGS 3DEP offers public-domain 1 m DEMs and a point-query service. The trap is fetching elevation
at play time — that would make physics depend on a network response and break determinism. So
elevation is an **authoring-time** tool: Wave 5 adds "Detect slope" beside "Detect terrain" in the
editor, sampling 3DEP over the geo box, computing per-tile gradient, and drafting `SLOPE_N/S/E/W`
tiles (`src/engine/terrain.js` values 7–10, already engine-native since the alpine biome) wherever
grade exceeds a threshold. The author corrects the draft, certifies with the real solver, and the
slopes ship inside the same `g` patch. Elevation becomes certified mask, not live data — the only
form of it this architecture should ever accept.

## 8. The Real-Course Catalog: the CMS Story

This is where the commission compounds. `src/engine/catalog.js` stores `(seed, difficulty)` tuples;
a real hole is `(seed, patch, geo)` plus curation state. Catalog v2 (the `importCatalog()` version
gate exists for exactly this) adds three optional fields — `patch`, `geo`, `courseName` — with v1
files importing unchanged. `cms.html` grows a "real holes" filter and renders provenance on the
card: course name, NAIP vintage, county. The A/B instinct of `ab.html` extends naturally: shuffle
traced-real holes against generated ones and measure whether real ground actually plays more
interesting — `certifySweep()` in `src/engine/certify.js` is already the instrument, and running M1
(the fork metric) over famous par-4s and 5s is a marketing artifact no competitor can fake:
*"Riviera 10 certifies with a 0.31-stroke ridge between its two lines."* The catalog of certified
real holes — each one solver-passed, strategically measured, and legally unencumbered — is the
asset that appreciates while overlay tricks depreciate.

## 9. Feature Roadmap — Five Waves (solo-maintainer sized)

### Wave 1 — The Georeference Codec (week 1–2)
`src/engine/georef.js` (encode/decode/tileLatLon, ~80 LOC, node-tested round-trips + range fuzz);
editor mints `geo` from a tee/cup lat-lon pair; `challengeUrl()` appends it; play surfaces parse
and display "real hole near 34.05°N 118.50°W" with no imagery yet.
*Exit: a geo share round-trips through the URL and survives malformed-input fuzzing.*

### Wave 2 — Local-File Aerial on Play Surfaces (week 3–4)
`src/ui/underlay.js` shared by caddie and arcade; two-click tee/cup align against the geo box;
trace-alpha compositing in `drawBase()`.
*Exit: a shared real hole, plus any screenshot of it, plays over the photo with all overlays intact.*

### Wave 3 — Public Tile Fetch (week 5–7)
Web Mercator tile math, USGS endpoint constant with runtime CORS probe, graceful fallback chain
(tiles → local file → plain tiles), service-worker cache exclusion for tile requests.
*Exit: a US hole renders its own NAIP imagery on first open with zero configuration; a blocked
network degrades to Wave 2 with a visible, calm prompt.*

### Wave 4 — Catalog v2 + Optional Proxy (week 8–10)
Real-hole records with patch/geo/courseName; provenance badges; `server/tiles.js` proxy with
whitelist and disk cache, opt-in via localStorage.
*Exit: the CMS lists ten certified real holes importable/exportable as v2 JSON; v1 files still import.*

### Wave 5 — 3DEP Slope Drafting (week 11–13)
"Detect slope" in the editor; gradient → slope-tile quantization (pure, tested against synthetic
DEMs like `aerial.js` is tested against synthetic imagery); certified slopes ship in the patch.
*Exit: a traced hole with real elevation certifies and replays identically offline.*

## 10. Risks (and our mitigations)

1. **Endpoint churn.** Federal tile services move. *Mitigation:* one overridable constant, runtime
   probe, fallback chain, optional proxy — four layers before a user sees a failure.
2. **NAIP is US-only.** Non-US courses have no public-domain aerial path. *Mitigation:* Path 1 is
   universal; we say "US catalog first" out loud rather than smuggling in encumbered tiles.
3. **Alignment UX.** A misaligned trace poisons the catalog. *Mitigation:* two-point align is
   deterministic; the certify gate already rejects unplayable results; CMS review catches the rest.
4. **URL length in hostile chat clients.** ~1 KB is safe almost everywhere, but some clients
   truncate. *Mitigation:* the existing `GLF-` code path (`encodeShareCode`) can carry catalog
   holes; the URL is the peer-to-peer path, the code the fallback.
5. **Tile cache bloat.** The PWA service worker must never cache imagery. *Mitigation:* explicit
   exclusion in `sw.js`; memory-only underlay canvas.
6. **Scope gravity toward becoming a GIS app.** *Mitigation:* the engine never imports georef; the
   codec is one file; anything requiring a projection library is out of scope by charter.

## 11. What We Would Cut First

In order: the **proxy** (Wave 4's second half — Paths 1 and 2 cover the honest majority), then
**3DEP slopes** (real holes play well flat; elevation is polish), then **public tile fetch**
itself if the CORS weather turns — because Wave 1 + Wave 2 alone already deliver the commission's
soul: a URL that says *this is a real hole, here is exactly where, here is its certified ground*,
and a client that lets anyone see the game on the real earth with one local image. The codec and
the local path are never cut. The coordinates are the asset; everything above them is fetch.

## 12. How We Measure Success

- **Share integrity:** 100% of geo shares reproduce identical physics with imagery on, off, or
  re-flown — enforced by extending the golden-replay suite with georeferenced fixtures.
- **Fetch honesty:** tile-probe failure degrades to a playable hole in under one second, measured
  in the headless-Chromium checks the repo already runs.
- **Catalog growth:** certified real holes in the CMS, each passing `certifyHole()` — the count is
  the moat, and it only goes up.
- **Licensing audit:** zero encumbered bytes in the repo or in any share, verifiable by grep.

---

*Georeference Guild — because the pixels will be re-flown, but the coordinates were always right.*
