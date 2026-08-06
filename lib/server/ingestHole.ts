/**
 * The single ingestion path for hole content — used by the seed script,
 * the /api/admin/hole route, and any importer. Validates the annotation,
 * builds the hole GeoJSON, sanity-checks geometry against the engine's
 * classifier, seeds puzzle ratings from trap size, and (re)warms the
 * heatmap cache for the default bucket.
 */

import { z } from 'zod';
import { area as turfArea, intersect, polygon as turfPolygon } from '@turf/turf';
import { CLASSIFY_PRIORITY } from '@/lib/engine/constants';
import { classifyPoint, prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, profileBucket, SEED_PROFILE } from '@/lib/engine/profile';
import { dist } from '@/lib/engine/projection';
import { clearsDecisionThreshold, puzzleRatingFromTrap } from '@/lib/engine/scoring';
import { holdsSomething } from '@/lib/puzzle/legibility';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { GRID_VERSION } from './heatmap';
import { prismaHeatmapStore } from './heatmapPrisma';
import type {
  HoleData,
  HoleGeoJSON,
  HolePointFeature,
  HolePolygonFeature,
} from '@/lib/engine/types';
import { db } from './db';

const lonLat = z.object({ lon: z.number().min(-180).max(180), lat: z.number().min(-85).max(85) });
const ring = z.array(z.tuple([z.number(), z.number()])).min(3);

export const ingestSchema = z.object({
  hole: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'lowercase slug, e.g. sawgrass-17'),
    courseName: z.string().trim().min(1).max(60),
    holeNumber: z.number().int().min(1).max(18),
    par: z.number().int().min(3).max(5),
    /** Omit to auto-compute from tee → pin. */
    yardage: z.number().int().min(60).max(700).optional(),
    /** Omit to default to the tee/pin midpoint. */
    imageryCenter: lonLat.optional(),
    /** Synthetic holes paint their polygons; traced holes let imagery show. */
    groundPlan: z.boolean().optional(),
    /** "osm" carries an ODbL attribution obligation the map then honours. */
    source: z.enum(['traced', 'osm']).optional(),
    polygons: z
      .array(
        z.object({
          kind: z.enum(['fairway', 'green', 'bunker', 'water', 'ob', 'recovery']),
          name: z.string().max(40).optional(),
          ring,
          /**
           * Inner rings (islands). The engine has always honoured them —
           * classification runs point-in-polygon over every ring — but the
           * ingest path could not express one, so an OSM multipolygon with
           * an island had to lose it silently. Traced holes never set this.
           */
          holes: z.array(ring).max(12).optional(),
        }),
      )
      .min(1),
    pin: lonLat,
    tees: z.array(lonLat).min(1),
  }),
  puzzles: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{1,60}$/)
          .optional(),
        ball: lonLat,
        lie: z.enum(['tee', 'fairway', 'rough', 'sand', 'recovery']),
        category: z.enum(['tee', 'approach', 'layup', 'recovery']),
        description: z.string().trim().min(1).max(200),
        /** Defaults to the hole pin. */
        pin: lonLat.optional(),
        /**
         * Measured by the miner at full sampling. When present the ingest
         * trusts it rather than recomputing a grid per puzzle, which is
         * what keeps first boot affordable once the library is mined
         * content rather than twenty hand-traced holes. `content:audit`
         * re-derives these from geometry, so a stale figure is a build
         * failure rather than a silent lie.
         */
        stats: z
          .object({
            trapSize: z.number().min(0),
            trapSe: z.number().min(0),
            consequence: z.number().min(0),
            asymmetry: z.number().min(0),
            holds: z.enum(['decision', 'consequence']),
            rating: z.number().int().min(0).max(4000),
          })
          .optional(),
      }),
    )
    .min(1)
    // A hand-traced hole never had more than four puzzles, and the cap was
    // there to catch an authoring slip. A pin sheet legitimately produces
    // several situations from the same ball position, so the ceiling is now
    // "more than a round's worth of shots on one hole is a mistake".
    .max(16),
});

export type IngestInput = z.infer<typeof ingestSchema>;

export interface IngestResult {
  holeId: string;
  yardage: number;
  puzzles: { id: string; rating: number; trapSize: number; trapSe: number }[];
  warnings: string[];
}

/**
 * Store coordinates at 9 decimal places (~0.1mm). That is terra-draw's
 * precision contract, and geometry beyond it is silently rejected when the
 * annotation studio loads a hole — which previously meant a load-then-save
 * could delete polygons outright.
 */
const COORD_DP = 9;
const round = (v: number) => Number(v.toFixed(COORD_DP));

/** Round to the storage precision and close the ring if it is open. */
function closedRing(ring: [number, number][]): [number, number][] {
  const coords = ring.map(([lon, lat]) => [round(lon), round(lat)] as [number, number]);
  const [fx, fy] = coords[0]!;
  const [lx, ly] = coords[coords.length - 1]!;
  if (fx !== lx || fy !== ly) coords.push([fx, fy]);
  return coords;
}

function buildGeojson(hole: IngestInput['hole']): HoleGeoJSON {
  const polygonFeatures: HolePolygonFeature[] = hole.polygons.map((p) => ({
    type: 'Feature',
    properties: { kind: p.kind, ...(p.name ? { name: p.name } : {}) },
    geometry: {
      type: 'Polygon',
      // Outer ring first, then islands — the order the engine's
      // point-in-polygon test expects.
      coordinates: [closedRing(p.ring), ...(p.holes ?? []).map(closedRing)],
    },
  }));
  const pointFeatures: HolePointFeature[] = [
    {
      type: 'Feature',
      properties: { kind: 'pin' },
      geometry: { type: 'Point', coordinates: [round(hole.pin.lon), round(hole.pin.lat)] },
    },
    ...hole.tees.map(
      (t): HolePointFeature => ({
        type: 'Feature',
        properties: { kind: 'tee' },
        geometry: { type: 'Point', coordinates: [round(t.lon), round(t.lat)] },
      }),
    ),
  ];
  return { type: 'FeatureCollection', features: [...polygonFeatures, ...pointFeatures] };
}

/**
 * Detect polygons a higher-priority polygon would swallow. Classification
 * is first-match-by-priority, so a feature mostly covered by something
 * that outranks it never classifies as itself — the Road Hole's pot
 * bunker vanished inside its green exactly this way. Silent loss is the
 * defect; annotators get told.
 */
function swallowedWarnings(hole: IngestInput['hole']): string[] {
  const out: string[] = [];
  const close = (r: [number, number][]) => {
    const ring = r.map(([lon, lat]) => [lon, lat] as [number, number]);
    const [fx, fy] = ring[0]!;
    const [lx, ly] = ring[ring.length - 1]!;
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    return ring;
  };
  const closed = hole.polygons.map((p) => ({
    kind: p.kind,
    name: p.name,
    // Islands are excluded from the polygon's own area, so a green with a
    // pond in it is not reported as "covered" by that pond.
    feature: turfPolygon([close(p.ring), ...(p.holes ?? []).map(close)]),
  }));
  const rank = (k: string) => CLASSIFY_PRIORITY.indexOf(k as never);

  for (const [i, mine] of closed.entries()) {
    const myArea = turfArea(mine.feature);
    if (myArea <= 0) continue;
    let covered = 0;
    for (const [j, other] of closed.entries()) {
      if (i === j || rank(other.kind) >= rank(mine.kind)) continue;
      try {
        const hit = intersect({
          type: 'FeatureCollection',
          features: [mine.feature, other.feature],
        });
        if (hit) covered += turfArea(hit);
      } catch {
        /* degenerate overlap; malformed rings are caught by the audit */
      }
    }
    const frac = covered / myArea;
    if (frac > 0.9) {
      out.push(
        `${mine.name ?? mine.kind} polygon ${i + 1} is ${Math.round(frac * 100)}% covered by ` +
          `higher-priority polygons — it will never classify as ${mine.kind}`,
      );
    } else if (frac > 0.5) {
      out.push(
        `${mine.name ?? mine.kind} polygon ${i + 1} is ${Math.round(frac * 100)}% covered by ` +
          `higher-priority polygons`,
      );
    }
  }
  return out;
}

/**
 * The authored hole → the engine's HoleData, with the same defaults the
 * ingest path applies. Exported because the audit script, the golden
 * corpus, and the OSM importer all need to prepare a hole from an
 * un-ingested payload, and three copies of these defaults would drift.
 *
 * `yardage` is left at the caller's value (0 when omitted); ingestHole
 * measures it from the projected tee→pin distance once the projection
 * exists.
 */
export function holeDataFromInput(hole: IngestInput['hole']): HoleData {
  return {
    id: hole.id,
    courseName: hole.courseName,
    holeNumber: hole.holeNumber,
    par: hole.par,
    yardage: hole.yardage ?? 0,
    geojson: buildGeojson(hole),
    imageryCenter: hole.imageryCenter ?? {
      lon: (hole.tees[0]!.lon + hole.pin.lon) / 2,
      lat: (hole.tees[0]!.lat + hole.pin.lat) / 2,
    },
    groundPlan: hole.groundPlan ?? false,
    source: hole.source ?? 'traced',
  };
}

export async function ingestHole(input: IngestInput): Promise<IngestResult> {
  const { hole, puzzles } = input;
  const warnings: string[] = [...swallowedWarnings(hole)];

  const holeData = holeDataFromInput(hole);
  const imageryCenter = holeData.imageryCenter;
  const prepared = prepareHole(holeData);
  const teeLocal = prepared.toLocal(hole.tees[0]!);
  const yardage = hole.yardage ?? Math.round(dist(teeLocal, prepared.pin));
  holeData.yardage = yardage;

  // Geometry sanity — these are annotation errors, not warnings.
  const pinLie = classifyPoint(prepared, prepared.pin);
  if (pinLie !== 'green') {
    throw new Error(`pin classifies as "${pinLie}" — it must sit on a green polygon`);
  }
  if (yardage < 60 || yardage > 700) {
    throw new Error(`computed yardage ${yardage}y is implausible — check tee/pin placement`);
  }
  for (const [i, p] of puzzles.entries()) {
    const ballLie = classifyPoint(prepared, prepared.toLocal(p.ball));
    if (ballLie === 'water' || ballLie === 'ob') {
      throw new Error(`puzzle ${i + 1} ball classifies as "${ballLie}" — unplayable`);
    }
    if (p.lie !== 'tee' && ballLie !== p.lie) {
      warnings.push(
        `puzzle ${i + 1}: declared lie "${p.lie}" but the ball classifies as "${ballLie}"`,
      );
    }
  }

  await db.hole.upsert({
    where: { id: hole.id },
    create: {
      id: hole.id,
      courseName: hole.courseName,
      holeNumber: hole.holeNumber,
      par: hole.par,
      yardage,
      geojson: JSON.stringify(holeData.geojson),
      imageryCenter: JSON.stringify(imageryCenter),
      groundPlan: holeData.groundPlan,
      source: holeData.source,
    },
    update: {
      courseName: hole.courseName,
      holeNumber: hole.holeNumber,
      par: hole.par,
      yardage,
      geojson: JSON.stringify(holeData.geojson),
      imageryCenter: JSON.stringify(imageryCenter),
      groundPlan: holeData.groundPlan,
      source: holeData.source,
    },
  });

  // Same versioned key the reader uses, so a warm row is actually a hit.
  const seedBucket = `v${GRID_VERSION}-${profileBucket(SEED_PROFILE)}`;
  const seedProfile = bucketedProfile(SEED_PROFILE);
  const results: IngestResult['puzzles'] = [];
  const keptIds: string[] = [];

  for (const [i, p] of puzzles.entries()) {
    const id = p.id ?? `${hole.id}-${p.category}-${i + 1}`;
    keptIds.push(id);
    const pin = p.pin ?? { lon: hole.pin.lon, lat: hole.pin.lat };
    const sit = {
      ball: prepared.toLocal(p.ball),
      pin: prepared.toLocal(pin),
      lie: p.lie,
    };
    // Mined content arrives already measured. Recomputing a grid per puzzle
    // to rediscover a number the miner already published would put first
    // boot in the minutes for a library of any size — and the grid a player
    // actually needs is computed for THEIR profile bucket on first play
    // anyway, not for the seed's.
    const summary = p.stats ? null : computeGridSummary(prepared, sit, seedProfile, p.category);
    const trapSize = p.stats?.trapSize ?? summary!.trapSize;
    const trapSe = p.stats?.trapSe ?? summary!.trapSe;
    const consequence = p.stats?.consequence ?? summary!.legibility.consequence;
    const asymmetry = p.stats?.asymmetry ?? summary!.legibility.asymmetry;
    const rating = p.stats?.rating ?? puzzleRatingFromTrap(trapSize);

    const data = {
      holeId: hole.id,
      ballPosition: JSON.stringify(p.ball),
      pinPosition: JSON.stringify(pin),
      lie: p.lie,
      category: p.category,
      description: p.description,
      rating,
      trapSize,
      trapSe,
      consequence,
      asymmetry,
      holds:
        p.stats?.holds ??
        holdsSomething(trapSize, trapSe, asymmetry, clearsDecisionThreshold).because ??
        '',
    };
    await db.puzzle.upsert({ where: { id }, create: { id, ...data }, update: data });

    // Geometry may have changed: drop every cached grid for this puzzle.
    // A hand-traced hole gets a warm one straight back, because there are
    // twenty of them and a warm grid makes the first play instant. Mined
    // content does not — it is computed on demand for the player's own
    // bucket, which is the only grid that will actually be read.
    await db.heatmapCache.deleteMany({ where: { puzzleId: id } });
    // Through the store, so the warm row is written in exactly the format
    // the reader expects — contours dropped, field kept.
    if (summary) await prismaHeatmapStore.put(id, seedBucket, summary);
    results.push({ id, rating, trapSize, trapSe });
  }

  // Re-annotation with a smaller puzzle set removes the orphans (and their
  // attempts/caches — progress on deleted content is meaningless).
  const orphans = await db.puzzle.findMany({
    where: { holeId: hole.id, id: { notIn: keptIds } },
    select: { id: true },
  });
  if (orphans.length) {
    const ids = orphans.map((o) => o.id);
    await db.attempt.deleteMany({ where: { puzzleId: { in: ids } } });
    await db.heatmapCache.deleteMany({ where: { puzzleId: { in: ids } } });
    await db.puzzle.deleteMany({ where: { id: { in: ids } } });
    warnings.push(`removed ${ids.length} orphaned puzzle(s): ${ids.join(', ')}`);
  }

  return { holeId: hole.id, yardage, puzzles: results, warnings };
}
