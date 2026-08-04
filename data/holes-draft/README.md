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
