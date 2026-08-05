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

### Why — tested, and it was not the corridor

It is NOT that the engine cannot express severe ground. It has two penal
tiers below fairway: `rough` (sigma ×1.25, 2.55 strokes at the short end)
and `recovery` (×1.40, 3.40) — nearly a full stroke apart. All five benched
holes except `carnoustie-18` carry recovery polygons, so the gorse is
arriving.

The corridor was the leading suspect and it was wrong. Sweeping 80/120/160/
220 yards across all eight holes moved five of them not at all
(`birkdale-6` 0.01 → 0.01 → 0.01 → 0.01). The two that did jump were
artefacts: at 220y Carnoustie's 17th put its "optimal" line 79 yards left
of the tee→pin axis, on the neighbouring hole's fairway, and Carnoustie's
12th imported 88 polygons for one hole. Widening does not add penalty
field, it adds someone else's golf course.

The real answer is that these holes genuinely have no decision in them for
a mid-handicap player. Surveying all 18 holes at both courses
(`--survey`) found 9 of 36 carrying a decision, and 8 of those 9 were par
3s. The hand-traced library agrees — its par 4 tee shots run 0.01–0.17,
median about 0.03. On a 480-yard par 4 you hit driver at the widest part
of the fairway; that is what the naive aim already does.

So these five stay benched, and the lesson is about selection rather than
extraction: survey a course, import its par 3s and its short strategic
holes, and do not expect a famous long hole to be a good puzzle.

That thread about approaches is now closed, and the guess in it was wrong.
Offsetting the approach ball by ±1.5σ in every direction — including into
rough — left the trap at 0.00–0.01, so the ideal position was not the
cause. Measuring the whole library against distance showed the real shape:
every puzzle scoring 0.32 or better is a par-3 tee shot, and approaches
score 0.00–0.19 even at matched distance and dispersion. The importer now
measures each derived puzzle and refuses to ship one below 0.10, so these
five holes are refused outright rather than imported and benched.
