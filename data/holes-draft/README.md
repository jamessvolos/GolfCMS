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

The reason is not the importer. It is that what makes a links hole hard —
gorse, knee-deep rough, out of bounds, a specific bunker you must not be
level with — is either unmapped in OSM (`golf=out_of_bounds` is almost
never used) or invisible to an engine with one undifferentiated "rough".
Three of eight imported holes did clear the bar and ship: `county-down-4`
(trap 0.88, the best puzzle in the library by a distance), `birkdale-12`
(0.44) and `carnoustie-17` (0.14).

Two things would unbench these: a rough severity the engine can distinguish,
or hand-added OB where the hole is actually defined by it.
