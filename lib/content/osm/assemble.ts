/**
 * Overpass elements → one hole's IngestInput.
 *
 * Pure data shaping: no network, no database, no engine. Everything it
 * decides is reported in `notes`, because an importer that quietly drops a
 * hazard is worse than one that refuses to import — the hole still plays,
 * it just teaches the wrong line.
 */

import {
  booleanIntersects,
  booleanPointInPolygon,
  buffer,
  distance as turfDistance,
  intersect,
  lineString,
  pointOnFeature,
  polygon as turfPolygon,
} from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { IngestInput } from '@/lib/server/ingestHole';
import type { FeatureKind } from '@/lib/engine/types';
import {
  kindForTags,
  parFromYards,
  parseDistanceTag,
  parseParTag,
  waterwayHalfWidthYds,
} from './tags';
import type { OsmElement, OsmNode, OsmRelation, OsmWay, OverpassResponse } from './overpass';

export interface LonLat {
  lon: number;
  lat: number;
}

/** How far either side of the centreline a feature must reach to count. */
const CORRIDOR_YDS = 80;
/** Discard slivers — mapping noise and mis-closed fragments. */
const MIN_FEATURE_AREA_SQ_YDS = 12;

export interface AssembleOptions {
  /** Slug for the hole, e.g. `birkdale-12`. */
  id: string;
  courseName: string;
  holeNumber: number;
  /** Widen when a hole doglegs hard and the fairway sits outside the corridor. */
  corridorYds?: number;
}

export interface AssembleResult {
  input: Omit<IngestInput, 'puzzles'>;
  /** Tee→green centreline, in the source order (tee first). */
  centreline: LonLat[];
  measuredYards: number;
  notes: string[];
}

export class AssembleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssembleError';
  }
}

const ll = (p: { lat: number; lon: number }): LonLat => ({ lon: p.lon, lat: p.lat });
const pos = (p: LonLat): [number, number] => [p.lon, p.lat];

function yardsBetween(a: LonLat, b: LonLat): number {
  return turfDistance(pos(a), pos(b), { units: 'yards' });
}

/** Close an open ring; OSM areas are closed ways but fragments are not. */
function close(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const [fx, fy] = ring[0]!;
  const [lx, ly] = ring[ring.length - 1]!;
  return fx === lx && fy === ly ? ring : [...ring, [fx, fy]];
}

/** Shoelace area in square yards, via a local equirectangular scale. */
function ringAreaSqYds(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  const lat0 = (ring.reduce((s, [, y]) => s + y, 0) / ring.length) * (Math.PI / 180);
  const yPerDeg = 121740; // yards per degree of latitude
  const xPerDeg = yPerDeg * Math.cos(lat0);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1 * xPerDeg * (y2 * yPerDeg) - x2 * xPerDeg * (y1 * yPerDeg);
  }
  return Math.abs(sum) / 2;
}

/**
 * Stitch relation member fragments into closed rings.
 *
 * An OSM multipolygon's outer boundary is frequently split across several
 * ways that only join end to end. Taking each member as its own ring — the
 * obvious implementation — turns one lake into a handful of open slivers
 * that classify as nothing.
 */
function stitchRings(fragments: [number, number][][]): [number, number][][] {
  const open = fragments.filter((f) => f.length >= 2).map((f) => [...f]);
  const rings: [number, number][][] = [];
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;

  while (open.length) {
    let current = open.shift()!;
    // Already closed on its own.
    let joined = true;
    while (joined && key(current[0]!) !== key(current[current.length - 1]!)) {
      joined = false;
      for (let i = 0; i < open.length; i++) {
        const frag = open[i]!;
        const tail = key(current[current.length - 1]!);
        if (key(frag[0]!) === tail) {
          current = [...current, ...frag.slice(1)];
        } else if (key(frag[frag.length - 1]!) === tail) {
          current = [...current, ...[...frag].reverse().slice(1)];
        } else {
          continue;
        }
        open.splice(i, 1);
        joined = true;
        break;
      }
    }
    if (current.length >= 4) rings.push(close(current));
  }
  return rings;
}

interface CandidateFeature {
  kind: FeatureKind;
  name?: string;
  outer: [number, number][];
  holes: [number, number][][];
  source: string;
}

const isClosed = (pts: { lat: number; lon: number }[]) =>
  pts.length > 3 &&
  pts[0]!.lat === pts[pts.length - 1]!.lat &&
  pts[0]!.lon === pts[pts.length - 1]!.lon;

/**
 * A way's outer ring, or null when the way is not an area.
 *
 * Open ways are NOT force-closed. Joining the ends of a 217-point river
 * centreline produces a self-intersecting sliver that classifies as almost
 * nothing — a silent way to lose a hazard. Linear features are handled by
 * bufferedWaterway instead, and anything else open is skipped.
 */
function wayRing(way: OsmWay): [number, number][] | null {
  if (!way.geometry || way.geometry.length < 4) return null;
  if (!isClosed(way.geometry)) return null;
  return close(way.geometry.map((g) => [g.lon, g.lat] as [number, number]));
}

/** A waterway centreline widened into the strip of water it actually is. */
function bufferedWaterway(way: OsmWay): [number, number][] | null {
  const half = waterwayHalfWidthYds(way.tags ?? {});
  if (half === null || !way.geometry || way.geometry.length < 2) return null;
  const buffered = buffer(lineString(way.geometry.map((g) => [g.lon, g.lat])), half, {
    units: 'yards',
  });
  if (!buffered) return null;
  const geom = buffered.geometry;
  const ring =
    geom.type === 'Polygon'
      ? geom.coordinates[0]
      : // A branching or self-crossing waterway buffers to a MultiPolygon;
        // take the largest part rather than dropping the hazard entirely.
        [...geom.coordinates].sort(
          (a, b) => ringAreaSqYds(b[0] as [number, number][]) - ringAreaSqYds(a[0] as [number, number][]),
        )[0]?.[0];
  return ring ? close(ring as [number, number][]) : null;
}

function relationRings(rel: OsmRelation): { outer: [number, number][][]; inner: [number, number][][] } {
  const outerFrags: [number, number][][] = [];
  const innerFrags: [number, number][][] = [];
  for (const m of rel.members ?? []) {
    if (m.type !== 'way' || !m.geometry) continue;
    const coords = m.geometry.map((g) => [g.lon, g.lat] as [number, number]);
    // An empty role on a multipolygon member means outer by convention.
    if (m.role === 'inner') innerFrags.push(coords);
    else outerFrags.push(coords);
  }
  return { outer: stitchRings(outerFrags), inner: stitchRings(innerFrags) };
}

function toPolygon(f: CandidateFeature): Feature<Polygon> {
  return turfPolygon([f.outer, ...f.holes]);
}

/**
 * Trim a feature to the hole's corridor, splitting it if the corridor cuts
 * it into separate pieces.
 *
 * Selection alone is not enough. The Barry Burn is one `waterway=river` a
 * kilometre and a half long; it intersects Carnoustie's 18th corridor, so
 * it was kept — all 734 vertices of it, spanning 53 to 1183 yards from the
 * pin. That polygon's bounding box covers the whole map, which defeats the
 * engine's bbox pre-check and puts a 734-vertex point-in-polygon test in
 * the Monte Carlo hot loop for every sample. Clipping bounds every feature
 * to the hole it belongs to.
 */
function clipToCorridor(
  c: CandidateFeature,
  corridor: Feature<Polygon | MultiPolygon>,
): CandidateFeature[] {
  let clipped;
  try {
    clipped = intersect({ type: 'FeatureCollection', features: [toPolygon(c), corridor] });
  } catch {
    // Degenerate geometry: keep the feature whole rather than lose a hazard.
    return [c];
  }
  if (!clipped) return [];

  const parts: [number, number][][][] =
    clipped.geometry.type === 'Polygon'
      ? [clipped.geometry.coordinates as [number, number][][]]
      : (clipped.geometry.coordinates as [number, number][][][]);

  return parts
    .map((rings) => ({
      ...c,
      outer: close(rings[0]!),
      holes: rings.slice(1).map(close),
    }))
    .filter((p) => ringAreaSqYds(p.outer) >= MIN_FEATURE_AREA_SQ_YDS);
}

/**
 * Every `golf=hole` way that could be the requested hole, nearest first when
 * a point is given.
 *
 * Deliberately plural. A name search matches courses by substring anywhere
 * on Earth, and a venue like Carnoustie has three courses sharing hole
 * numbers — so "Carnoustie hole 12" really did resolve to four candidates,
 * the first of which was a course in British Columbia. Returning the first
 * match produced a confidently-labelled hole from the wrong continent.
 * Callers must decide what to do with more than one.
 */
export function findHoleWays(
  res: OverpassResponse,
  opts: { holeNumber?: number; near?: LonLat },
): OsmWay[] {
  const holes = res.elements.filter(
    (e): e is OsmWay => e.type === 'way' && e.tags?.golf === 'hole' && !!e.geometry?.length,
  );
  if (!holes.length) return [];

  let matches = holes;
  if (opts.holeNumber !== undefined) {
    const want = String(opts.holeNumber);
    const byRef = holes.filter((h) => (h.tags?.ref ?? '').trim() === want);
    // Some courses put the number only in the name: "12. Southward Ho",
    // "(12) Heather". Only consulted when no ref matches, so a course that
    // tags refs properly is never diluted by another's naming.
    const byName = holes.filter((h) =>
      new RegExp(`(^|\\D)${want}(\\D|$)`).test(h.tags?.name ?? ''),
    );
    matches = byRef.length ? byRef : byName;
  }
  if (!matches.length) return [];

  if (opts.near) {
    const near = opts.near;
    const dist = (h: OsmWay) =>
      Math.min(...h.geometry!.map((g) => yardsBetween(near, ll(g))));
    return [...matches].sort((a, b) => dist(a) - dist(b));
  }
  return matches;
}

/** A candidate's identifying detail, for an error a person can act on. */
export function describeCandidate(way: OsmWay): string {
  const g = way.geometry![0]!;
  const name = way.tags?.name ?? way.tags?.ref ?? '(unnamed)';
  const par = way.tags?.par ? `par ${way.tags.par}` : 'par unknown';
  return `way/${way.id} "${name}" (${par}) at ${g.lat.toFixed(4)},${g.lon.toFixed(4)}`;
}

/** Back-compat single-result helper; prefer findHoleWays. */
export function findHoleWay(
  res: OverpassResponse,
  opts: { holeNumber?: number; near?: LonLat },
): OsmWay | null {
  return findHoleWays(res, opts)[0] ?? null;
}

export function assembleHole(
  res: OverpassResponse,
  holeWay: OsmWay,
  opts: AssembleOptions,
): AssembleResult {
  const notes: string[] = [];
  const corridorYds = opts.corridorYds ?? CORRIDOR_YDS;

  const line = (holeWay.geometry ?? []).map(ll);
  if (line.length < 2) throw new AssembleError('the golf=hole way has no usable geometry');

  // ------------------------------------------------------------ candidates
  const candidates: CandidateFeature[] = [];
  const teeAreas: { ring: [number, number][]; name?: string }[] = [];

  for (const el of res.elements as OsmElement[]) {
    if (el.type === 'node') continue;
    const tags = el.tags ?? {};
    if (tags.golf === 'hole') continue;

    let outer: [number, number][] | null = null;
    let holes: [number, number][][] = [];
    if (el.type === 'way') {
      outer = wayRing(el) ?? bufferedWaterway(el);
    } else {
      const rings = relationRings(el);
      // A multipolygon with several outers becomes several features; only
      // the largest keeps the inners, which is right for a lake with an
      // island and harmless otherwise.
      if (rings.outer.length) {
        rings.outer.sort((a, b) => ringAreaSqYds(b) - ringAreaSqYds(a));
        outer = rings.outer[0]!;
        holes = rings.inner;
        for (const extra of rings.outer.slice(1)) {
          const kind = kindForTags(tags);
          if (kind && ringAreaSqYds(extra) >= MIN_FEATURE_AREA_SQ_YDS) {
            candidates.push({ kind, name: tags.name, outer: extra, holes: [], source: `relation/${el.id}` });
          }
        }
      }
    }
    if (!outer || outer.length < 4) continue;

    if (tags.golf === 'tee') {
      teeAreas.push({ ring: outer, name: tags.name });
      continue;
    }
    const kind = kindForTags(tags);
    if (!kind) continue;
    if (ringAreaSqYds(outer) < MIN_FEATURE_AREA_SQ_YDS) continue;
    candidates.push({ kind, name: tags.name, outer, holes, source: `${el.type}/${el.id}` });
  }

  // ---------------------------------------------------------------- greens
  const corridor = buffer(lineString(line.map(pos)), corridorYds, { units: 'yards' });
  if (!corridor) throw new AssembleError('could not build the hole corridor');

  const greens = candidates.filter(
    (c) => c.kind === 'green' && booleanIntersects(corridor, toPolygon(c)),
  );
  if (!greens.length) {
    throw new AssembleError(
      `no green mapped within ${corridorYds}y of the hole centreline — ` +
        'the course is not traced in enough detail to import',
    );
  }

  // Which end of the centreline is the green? OSM convention is tee→green
  // but it is not enforced, and a reversed way silently produces a hole
  // played backwards. Measure instead of trusting.
  const head = line[0]!;
  const tail = line[line.length - 1]!;
  const nearestGreenDist = (p: LonLat) =>
    Math.min(
      ...greens.map((g) =>
        Math.min(...g.outer.map(([lon, lat]) => yardsBetween(p, { lon, lat }))),
      ),
    );
  const reversed = nearestGreenDist(head) < nearestGreenDist(tail);
  const centreline = reversed ? [...line].reverse() : line;
  if (reversed) notes.push('centreline was mapped green→tee and has been reversed');

  const greenEnd = centreline[centreline.length - 1]!;
  const teeEnd = centreline[0]!;

  // The green for THIS hole is the one nearest the green end, not any green
  // the corridor happens to clip on a tight routing.
  const green = greens.reduce((best, g) => {
    const d = (c: CandidateFeature) =>
      Math.min(...c.outer.map(([lon, lat]) => yardsBetween(greenEnd, { lon, lat })));
    return d(g) < d(best) ? g : best;
  }, greens[0]!);

  // ------------------------------------------------------------------- pin
  const greenPoly = toPolygon(green);
  const pinNode = (res.elements.filter((e): e is OsmNode => e.type === 'node') ?? []).find(
    (n) => n.tags?.golf === 'pin' && booleanPointInPolygon([n.lon, n.lat], greenPoly),
  );
  let pin: LonLat;
  if (pinNode) {
    pin = ll(pinNode);
  } else {
    // pointOnFeature is guaranteed to land inside, unlike a centroid, which
    // for a horseshoe green sits on the collar. The pin gate in ingestHole
    // would reject that, so this is not a cosmetic choice.
    const p = pointOnFeature(greenPoly);
    pin = { lon: p.geometry.coordinates[0]!, lat: p.geometry.coordinates[1]! };
    notes.push('no golf=pin node mapped; the pin was placed at the centre of the green');
  }

  // ------------------------------------------------------------------- tee
  let tee: LonLat = teeEnd;
  const teeBoxes = teeAreas
    .map((t) => ({
      t,
      d: Math.min(...t.ring.map(([lon, lat]) => yardsBetween(teeEnd, { lon, lat }))),
    }))
    .filter((x) => x.d < 90)
    .sort((a, b) => a.d - b.d);
  if (teeBoxes.length) {
    const p = pointOnFeature(turfPolygon([teeBoxes[0]!.t.ring]));
    tee = { lon: p.geometry.coordinates[0]!, lat: p.geometry.coordinates[1]! };
  } else {
    notes.push('no golf=tee box mapped; the tee was taken from the end of the centreline');
  }

  // ------------------------------------------------------------- geometry
  const measuredYards = Math.round(yardsBetween(tee, pin));
  const tagged = parseDistanceTag(holeWay.tags?.dist);
  if (tagged) {
    // A tolerance band, not a fixed number: the tee box is a polygon and the
    // pin moves daily, so a few percent of disagreement is expected.
    const tolerance = Math.max(15, measuredYards * 0.08);
    const asStated = Math.abs(tagged.yards - measuredYards);
    // A bare `dist` is metres per the OSM wiki and yards on plenty of US
    // courses. Rather than pick, test the metres hypothesis against the
    // geometry — the only unit-free measurement available. A metres value
    // read as yards is always ~8.6% short, which on a mid-length hole is
    // well inside any fixed threshold worth setting.
    const asMetres = Math.abs(tagged.yards * 1.09361 - measuredYards);
    if (tagged.unit === 'unknown' && asMetres < asStated - 5) {
      notes.push(
        `OSM dist=${holeWay.tags!.dist} matches ${measuredYards}y only when read as metres; ` +
          'the tag is probably metres and was ignored in favour of the geometry',
      );
    } else if (asStated > tolerance) {
      notes.push(
        `OSM dist says ${Math.round(tagged.yards)}y, the geometry measures ${measuredYards}y`,
      );
    }
  }

  const par = parseParTag(holeWay.tags?.par) ?? parFromYards(measuredYards);
  if (!parseParTag(holeWay.tags?.par)) {
    notes.push(`no par tagged; inferred par ${par} from ${measuredYards}y`);
  }

  // Keep only what plays on this hole. Without the corridor test an import
  // picks up the neighbouring hole's bunkers, and the engine will happily
  // route the optimal line across them.
  const kept: CandidateFeature[] = [];
  let dropped = 0;
  let foreignGreens = 0;
  for (const c of candidates) {
    if (c === green) {
      kept.push(c);
      continue;
    }
    if (!booleanIntersects(corridor, toPolygon(c))) {
      dropped++;
      continue;
    }
    // A hole has exactly one green. On a links routing where holes run
    // parallel forty yards apart, the corridor catches the neighbours' —
    // and a foreign green is not a feature of this hole, it is a putting
    // surface the engine would treat as this hole's target. Carnoustie's
    // 12th came back with seven. They classify as rough, like any other
    // closely-mown ground the mapper did not call fairway.
    if (c.kind === 'green') {
      foreignGreens++;
      continue;
    }
    kept.push(...clipToCorridor(c, corridor));
  }
  if (dropped) notes.push(`${dropped} mapped feature(s) fell outside the ${corridorYds}y corridor`);
  if (foreignGreens) {
    notes.push(`${foreignGreens} green(s) belonging to other holes were discarded`);
  }

  // Deduplicate the common double-tagging (a pond as both way and relation)
  // by dropping any feature of the same kind whose outer ring is contained
  // in another's — cheap containment via vertex sampling.
  const deduped = kept.filter((c, i) =>
    !kept.some((other, j) => {
      if (i === j || other.kind !== c.kind) return false;
      if (ringAreaSqYds(other.outer) <= ringAreaSqYds(c.outer)) return false;
      const poly = toPolygon(other);
      return c.outer.every((p) => booleanPointInPolygon(p, poly));
    }),
  );
  if (deduped.length !== kept.length) {
    notes.push(`${kept.length - deduped.length} duplicate feature(s) merged`);
  }

  const withHoles = deduped.filter((c) => c.holes.length).length;
  if (withHoles) notes.push(`${withHoles} feature(s) carry islands`);

  return {
    input: {
      hole: {
        id: opts.id,
        courseName: opts.courseName,
        holeNumber: opts.holeNumber,
        par,
        polygons: deduped.map((c) => ({
          kind: c.kind,
          ...(c.name ? { name: c.name.slice(0, 40) } : {}),
          ring: c.outer,
          ...(c.holes.length ? { holes: c.holes } : {}),
        })),
        pin,
        tees: [tee],
      },
    },
    centreline,
    measuredYards,
    notes,
  };
}
