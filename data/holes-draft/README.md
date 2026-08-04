# Draft holes — not seeded

Holes here are annotated but not trusted enough to ship. `npm run db:seed`
only reads `data/holes/`, so nothing in this folder reaches players.

## riviera-10 — needs a ground survey

Riviera's 10th is a great puzzle hole (drivable par 4, tiny angled green
behind bunkers) and the reason it was chosen. Three problems make its
geometry guesswork rather than a trace:

- **The tee is misplaced.** `(-118.497944, 34.047829)` sits on rough beside
  a cart-path fork, and the tee→pin line runs through two tree stands. No
  fairway tracing fixes a tee aimed through trees.
- **The fairway had to be traced ~40y left of the tee→pin line** to follow
  the mown, tree-free corridor that actually exists — self-consistent, but
  it means the hole does not read as drivable down its own line.
- **The green edge is not resolvable in this imagery.** Esri's native
  resolution here is ~0.25 m/px and there is no tone or texture break
  between putting surface, collar and approach; luminance banding, false
  colour, Sobel edges and high-pass all failed to find one. The current
  green was sized from published dimensions (~2,500 ft², ~10y deep) and
  placed inside the bunker ring — right in size, angle and position, but
  not a trace.

To ship it: re-survey the teeing ground from a source that resolves tee
pads, re-derive the corridor from the corrected tee, and confirm the green
outline against better imagery or a course map.

The earlier 13.6-acre fairway and 986 m² green were far worse — those made
the tee puzzle rate 2500 (the maximum) purely as an artifact of the naive
aim landing 169y offline. This file already has the repaired geometry.

## OSM imports benched for having no decision in them

`birkdale-6`, `birkdale-18`, `carnoustie-12`, `carnoustie-18`,
`county-down-9`. All five imported cleanly — correct geometry, correct
length, hazards present, the Barry Burn included on both Carnoustie holes.
They are benched because the engine says there is nothing to learn on them:
every puzzle came out at a trap size of 0.00–0.01, meaning aiming straight
at the flag is already optimal. A puzzle whose naive answer is the right
answer awards PERFECT for no thought.

For comparison, the shipped library's median trap is 0.05 and its best
traced hole reaches 0.19.

Three of eight imported holes did clear the bar and ship: `county-down-4`
(trap 0.88, the best puzzle in the library by a distance), `birkdale-12`
(0.44) and `carnoustie-17` (0.14).

### Why — the leading hypothesis, not yet tested

It is NOT that the engine cannot express severe ground. It has two penal
tiers below fairway: `rough` (sigma ×1.25, 2.55 strokes at the short end)
and `recovery` (×1.40, 3.40) — nearly a full stroke apart. All five benched
holes except `carnoustie-18` carry recovery polygons, so the gorse is
arriving.

The likelier cause is the **80-yard import corridor**. Everything outside it
is discarded, and unclassified ground is rough by definition — so a shot
100 yards offline into actual gorse is scored as ordinary rough, a stroke
cheaper than the ground it is really in. That flattens the penalty field
exactly where a links hole's decision lives, and these holes have broad
fairways (`county-down-9` imported eight fairway polygons, `carnoustie-18`
eight) which flattens it further.

Cheap test before doing anything else: re-import these five at a 150y
corridor and see whether trap size recovers. If it does, the corridor
constant is the bug and every future import improves with it. If it does
not, the diagnosis moves to the engine's penalty model or to the missing
out-of-bounds — `golf=out_of_bounds` exists in OSM and is almost never
used.
