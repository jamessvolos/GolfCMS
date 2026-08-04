# Importing holes from OpenStreetMap

Hand-tracing a hole in `/admin/annotate` takes 20–40 minutes and is the only
way to get a hole a mapper never drew. Where a course *is* mapped, the
importer does the same job in seconds: greens, bunkers, water and trees come
from OSM, and the engine plays the hole to decide where each puzzle's ball
sits.

```bash
npm run content:import -- --course "Royal Birkdale" --hole 12
npm run content:import -- --course "Royal Birkdale" --hole 12 --commit
```

Or `/admin/import` in the app, which previews first and writes only when you
say so.

## What it actually does

1. **Fetch.** One Overpass query for the course area (or a radius around a
   point), asking for every golf feature plus the `golf=hole` centrelines
   and `golf=pin` nodes. `out geom` inlines coordinates, so assembly needs
   no second round trip.
2. **Locate the hole — or refuse.** Match `golf=hole` by its `ref` tag,
   falling back to a number inside `name`. If more than one way matches,
   the importer refuses and lists the candidates rather than picking. A
   name search spans the planet and multi-course venues reuse hole
   numbers: "Carnoustie hole 12" returns four ways, one of them in British
   Columbia. Pass a point (`--near`) to choose between them.
3. **Orient it.** OSM convention is tee→green but nothing enforces it, and a
   reversed way silently produces a hole played backwards. The importer
   measures which end is nearer a green and reverses when needed.
4. **Assemble.** Ways become rings; multipolygon relations get their
   fragments stitched into closed rings and keep their islands; waterway
   centrelines are widened into the strip of water they are. Everything is
   then *clipped* to a corridor around the centreline — not merely selected
   by it. The Barry Burn is a single kilometre-and-a-half `waterway=river`,
   and keeping it whole gave Carnoustie's 18th a 734-vertex polygon whose
   bounding box covered the map, defeating the engine's bbox pre-check on
   every Monte Carlo sample.
5. **Place the pin and tee.** A `golf=pin` node inside the green if there is
   one; otherwise a point guaranteed to be *inside* the green — not the
   centroid, which on a horseshoe green sits on the collar and would fail
   the pin gate.
6. **Derive puzzles with the engine.** See below.
7. **Ingest.** Through `ingestHole`, the same path a traced hole takes: zod
   validation, the swallowed-polygon warnings, the pin-on-green and
   ball-not-in-water gates, trap-size ratings, cache warming.

Every decision it made is listed in `notes` — reversals, inferred par,
dropped features, distrusted tags. Read them. The importer is allowed to be
wrong; it is not allowed to be quiet.

## How puzzle positions are chosen

The tee puzzle is free. Each puzzle after it starts where the optimizer's
best line from the previous position lands, pulled back toward the ball
until it reaches playable ground.

That is a modelling choice, and it is worth being clear about: **the optimal
aim is not where a shot finishes.** Dispersion scatters around it. Using the
aim as the next ball position means the sequence describes the hole as it
plays for someone executing well — a defensible, reproducible position, not
an expected outcome, and not a simulated round.

Par 3s get a tee puzzle and nothing else. Par 5s get a lay-up when more than
240 yards remain after the drive. Anything leaving under 35 yards is a chip,
not a course-management decision, and is dropped with a note.

## Tag mapping

`lib/content/osm/tags.ts` is the whole editorial judgement; everything else
is plumbing. Explicit golf tagging always beats generic landcover, because a
pond on a course is commonly both `golf=water_hazard` and `natural=water`.

| OSM | Kind |
| --- | --- |
| `golf=green` | green |
| `golf=bunker`, `golf=sand_trap` | bunker |
| `golf=water_hazard`, `golf=lateral_water_hazard` | water |
| `golf=out_of_bounds` | ob |
| `golf=fairway` | fairway |
| `natural=water`, `landuse=reservoir\|basin` | water |
| `waterway=riverbank\|dock` (areas) | water |
| `waterway=river\|stream\|ditch\|drain\|canal` (centrelines, buffered) | water |
| `natural=wood\|scrub\|heath\|wetland`, `landuse=forest` | recovery |

`golf=rough` and `golf=tee` map to nothing on purpose: rough is what the
engine assumes for unmapped ground, and a tee box is a start position rather
than a lie. Anything tagged `building`, `amenity`, `highway`, `barrier`,
`leisure=pitch|swimming_pool`, or as a cart path / driving range / practice
area is rejected outright — that rule is why a mapped rooftop pond does not
become a water hazard. So is anything in a `tunnel` or `covered`: a burn in
a culvert runs under the hole, not across it, and the Barry Burn is mapped
in three pieces with one of them culverted.

Only the hole's own green is kept. A links routing puts the neighbours'
greens well inside the corridor — Carnoustie's 12th came back with seven —
and a foreign green is not a feature of this hole, it is a putting surface
the engine would treat as the target. They classify as rough.

### The `dist` tag is not trusted

The OSM wiki defines `dist` as metres; plenty of US courses populate it in
yards. Rather than pick, the importer measures the tee→pin distance from
geometry and uses `dist` only as a check — and when a bare number matches
the geometry far better read as metres, it says so and ignores the tag. A
metres value read as yards is always ~8.6% short, which on a 400-yard hole
is 34 yards: inside any fixed tolerance worth setting, which is why the test
is a hypothesis rather than a threshold.

## Limits, stated plainly

- **Coverage is uneven.** Many courses have an outline and nothing else.
  Without mapped greens the importer refuses rather than guessing.
- **No elevation, no green contour, no wind.** Same as a traced hole — the
  engine is planimetric.
- **Out of bounds is rarely mapped.** `golf=out_of_bounds` exists and is
  almost never used, so most imported holes have no OB at all and the
  engine treats the surrounds as rough. On a hole where OB is the defining
  hazard, trace it by hand.
- **Rough is not distinguished from fairway-height surrounds** beyond what
  the mapper drew.
- **One tee.** The importer takes the tee box nearest the centreline's tee
  end. Multiple tee boxes are not modelled.
- **A clean import is not automatically a good puzzle.** Of eight holes
  imported from three championship links, five had a trap size of
  0.00–0.01 — geometrically correct, and with nothing to learn, because
  aiming at the flag was already optimal. What makes those holes hard is
  gorse, deep rough and out of bounds, which OSM largely does not map and
  the engine's single undifferentiated "rough" could not express anyway.
  The other three shipped, one of them the best puzzle in the library.
  See `data/holes-draft/README.md`.
- **Import is not a substitute for looking.** Preview, read the notes, and
  play the hole once before trusting it. `--out` writes a draft to
  `data/holes-draft/` for review instead of committing.

## Network

Overpass is rate-limited and the public instance is often busy. Set
`OVERPASS_URL` to a mirror (for example
`https://overpass.kumi.systems/api/interpreter`) or to your own instance;
requests to a local or private-range endpoint deliberately bypass any egress
proxy.

Where Overpass is unreachable, run the query elsewhere and import the saved
payload:

```bash
npm run content:import -- --course "Royal Birkdale" --hole 12 --query   # prints Overpass QL
# run that somewhere with network access, save the JSON, then:
npm run content:import -- --file birkdale.json --hole 12 --name "Royal Birkdale" --commit
```

`--save <path>` does both at once when the network does work.

## Attribution

OpenStreetMap data is ODbL, so imported holes owe a credit. Every hole
carries its provenance (`Hole.source`, `"traced"` or `"osm"`), and the
puzzle map adds “Hole data © OpenStreetMap contributors (ODbL)” beside
Esri's imagery credit — on imported holes only.

That credit is `customAttribution` on the AttributionControl rather than an
`attribution` on the GeoJSON source, because MapLibre only surfaces a
source's attribution while a visible layer uses it, and a hole traced over
imagery renders no ground-plan fills at all. On the source it looked correct
in `map.getStyle()` and displayed nothing.
