# Aerial Bake-off — Judging & Verdict

**Date:** 2026-08-15 · **Judge:** Claude (acting client-side technical lead)
**Commission:** "Overlay the game dynamically over real satellite images."

Five firms filed. Every proposal was read in full and scored 1–10 on five criteria.
Precedent from the founding bake-off (`docs/bakeoff/JUDGING.md`) applies: feasibility
gates everything, and the verdict may graft the losers' best ideas onto the winner's
plan — that is how this app was built the first time.

## Criteria

1. **Legibility on photography** — Caddie is a game about reading ground; can the
   dispersion ellipse, expected-strokes cone, and reveal heatmap actually be read
   over the proposed ground?
2. **Licensing honesty** — does the imagery story survive a lawyer reading the README?
   No laundering, no ToS-violating fetches, no encumbered bytes in shares.
3. **Share-loop integrity** — a URL must fully reproduce the hole today; what does a
   recipient without the photo get, and is it ever an error state?
4. **Feasibility** — can a solo maintainer build and own it, zero dependencies,
   no build step, engine untouched or nearly so?
5. **Wow & product arc** — does this grow the product, or decorate it?

## Scorecard

| Criterion | Overlay Optics | Halftone & Turf | Georeference Guild | Thin Coat Studio | Parallax Party |
|---|---|---|---|---|---|
| Legibility on photography | 8 | **10** | 6 | 6 | 8 |
| Licensing honesty | 9 | 9 | **10** | 9 | 9 |
| Share-loop integrity | 9 | 8 | **10** | 7 | 9 |
| Feasibility | 7 | 8 | 7 | **10** | 7 |
| Wow & product arc | 8 | 7 | 8 | 5 | **9** |
| **Total** | **41** | **42** | **41** | **37** | **42** |

## Deliberation

- **Overlay Optics (41)** wrote the best *craft* document in the field. The cased-stroke
  /luma-map/two-pass-cone stack is real broadcast knowledge translated into ~30-line
  canvas techniques, the canvas-tainting argument against provider tiles is technically
  airtight, and the §6 fallback ladder ("the photo is the telecast; the patch is the
  game") is the right relationship between imagery and truth. What holds it at 41 is the
  premise Halftone & Turf attacked: on a raw photo, the picture and the physics *will*
  disagree at sub-tile scale, and their hazard-truth contours mitigate rather than
  dissolve that betrayal. 1,140 lines of finicky visual tuning is also the field's
  largest UI bet.
- **Halftone & Turf (42)** made the deepest game-design argument: the pressed ground is
  *structurally incapable* of contradicting the scoring, the reveal heatmap keeps its
  contrast budget, and wildly different photos normalize into one game. Reusing
  `paint.js`'s own finishing passes so the output "looks like Caddie and not like a
  filter app" is the most on-brand idea any firm had. Its weakness is the commission's
  letter: the player never sees the actual photograph — and Thin Coat's puncture
  ("players load aerials because they want to see *their course*") lands.
- **Georeference Guild (41)** owns two criteria outright. The share loop — a 22-char
  georeference so recipients re-derive public-domain imagery themselves, with physics
  bit-identical across NAIP vintages — is the only design where a *recipient* gets the
  photo experience without anyone sending a file. And "3DEP baked at authoring time,
  never fetched at play time" is the single smartest sentence in the field: elevation
  becomes certified mask, so determinism survives. But the rendering treatment is the
  thinnest (an alpha-composited underlay), and tile-fetch/CORS-probe/proxy plumbing is
  exactly where solo maintainers drown.
- **Thin Coat Studio (37)** is right about almost everything except the ceiling. The
  ~100-line bake-and-IndexedDB handoff is the substrate every other proposal contains
  (Overlay Optics' Wave 1 *is* this proposal); the observation that Caddie photo play is
  secretly two projects — a patch route AND an underlay through the camera/cone stack —
  is the most load-bearing feasibility fact in the folder; and the A/B question ("does
  the photo improve play or is it a viewing pleasure?") should gate everyone's Wave 3+.
  But arcade-only means the flagship strategy surface never meets the commission this
  quarter, and "one slider" is a refusal to answer criterion 1, not an answer.
- **Parallax Party (42)** metabolized the last bake-off's lesson: the globe is pitched,
  but the diff is small, every rule-bend carries a price tag in the same sentence, the
  proxy is cut-first, on-device ML is priced and refused, and the risk register names
  kill signals (median fix-clicks > 60). The product arc — trace → certify → play →
  share → *daily real hole through the existing catalog* — is the only proposal where
  the commission compounds into a second act. Its one dishonesty is optimism: "teach
  Caddie to play `?p=` holes in days 1–3" waves at what Thin Coat proved is two
  projects.

## The tie, and the tiebreak

Halftone & Turf and Parallax Party finish at 42. The founding bake-off's precedent
(feasibility gates) narrowly favors Halftone; the commission's letter decides the other
way. The client asked for the game **over real satellite images** — the photograph on
screen, the instruments above it. Halftone & Turf's pressed ground is a brilliant
*dissent* from the brief: it argues the client shouldn't want what they asked for. Good
firms file dissents; judges don't award them the commission. **Parallax Party wins the
bake-off** — it delivers the letter of the commission with the field's best product
arc, and its structure already has sockets where the other four firms' best ideas bolt
on.

## Verdict

**Winner: Parallax Party (42/50)** — with its Wave 1 rebuilt on the runner-ups' honesty,
because the judge is buying the arc, not the schedule:

1. **Wave 1 mechanics come from Thin Coat Studio.** The bake-once JPEG + IndexedDB
   handoff keyed to seed/biome/patch-digest, arcade first — shipped in days, exactly as
   scoped, while the Caddie patch route is built as the separate project it truly is.
2. **The legibility layer comes from Overlay Optics.** Cased strokes, the pre-sampled
   per-tile luma map, the two-pass cone, and the heatmap under-scrim replace Parallax's
   single adaptive scrim the moment the photo reaches Caddie. The `B` toggle
   (photo ↔ paint) ships with it.
3. **The truth clamp comes from Halftone & Turf.** Hazard-truth outlines are mandatory
   in photo mode — where picture and physics disagree, the physics is inked on top.
   The full pressed-ground renderer is banked as the *recipient-side* enhancement and
   as the answer if the A/B says raw photos hurt play.
4. **The share loop comes from Georeference Guild.** The geo codec (their fixed-width
   hex version, which also fixes scale), the vintage provenance nibble, and — when
   elevation's day comes — 3DEP baked into certified slope tiles at authoring time,
   never fetched at play time.
5. **Thin Coat's A/B gate applies to everyone.** Photo-on vs photo-off on the same
   traced holes, strokes-vs-par and preference measured in the house's `ab.html`
   idiom, before any Wave-3+ spend.

The ground becomes a slot with three implementations behind one seam
(`art = renderCourseArt(course)`): painted turf, raw photo with the broadcast stack,
and — if the data votes for it — the pressed ground. The engine never learns which one
is on screen. That is the solution: the commission's letter, the runner-up's honesty,
and the house's constitution, all at once.

## What to steal from each firm regardless

- Overlay Optics: the per-tile luma map as a *pre-sampled* Float32Array — adaptive
  contrast with zero per-frame `getImageData`.
- Halftone & Turf: `detectDetail()` — sub-tile class votes are cheap and unlock real
  bunker silhouettes for any future renderer.
- Georeference Guild: the runtime CORS probe with calm fallback, and "licensing audit:
  zero encumbered bytes, verifiable by grep."
- Thin Coat Studio: "the fallback is never an error state" as a design law, and the
  refusal list kept in writing.
- Parallax Party: kill signals in the risk register — a feature that can't name its
  own death is a liability.
