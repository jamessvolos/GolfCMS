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
import { puzzleRatingFromTrap } from '@/lib/engine/scoring';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
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
    polygons: z
      .array(
        z.object({
          kind: z.enum(['fairway', 'green', 'bunker', 'water', 'ob', 'recovery']),
          name: z.string().max(40).optional(),
          ring,
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
      }),
    )
    .min(1)
    .max(4),
});

export type IngestInput = z.infer<typeof ingestSchema>;

export interface IngestResult {
  holeId: string;
  yardage: number;
  puzzles: { id: string; rating: number; trapSize: number }[];
  warnings: string[];
}

function buildGeojson(hole: IngestInput['hole']): HoleGeoJSON {
  const polygonFeatures: HolePolygonFeature[] = hole.polygons.map((p) => {
    const coords = p.ring.map(([lon, lat]) => [lon, lat] as [number, number]);
    const [fx, fy] = coords[0]!;
    const [lx, ly] = coords[coords.length - 1]!;
    if (fx !== lx || fy !== ly) coords.push([fx, fy]);
    return {
      type: 'Feature',
      properties: { kind: p.kind, ...(p.name ? { name: p.name } : {}) },
      geometry: { type: 'Polygon', coordinates: [coords] },
    };
  });
  const pointFeatures: HolePointFeature[] = [
    {
      type: 'Feature',
      properties: { kind: 'pin' },
      geometry: { type: 'Point', coordinates: [hole.pin.lon, hole.pin.lat] },
    },
    ...hole.tees.map(
      (t): HolePointFeature => ({
        type: 'Feature',
        properties: { kind: 'tee' },
        geometry: { type: 'Point', coordinates: [t.lon, t.lat] },
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
  const closed = hole.polygons.map((p) => {
    const ring = p.ring.map(([lon, lat]) => [lon, lat] as [number, number]);
    const [fx, fy] = ring[0]!;
    const [lx, ly] = ring[ring.length - 1]!;
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    return { kind: p.kind, name: p.name, feature: turfPolygon([ring]) };
  });
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

export async function ingestHole(input: IngestInput): Promise<IngestResult> {
  const { hole, puzzles } = input;
  const warnings: string[] = [...swallowedWarnings(hole)];

  const imageryCenter = hole.imageryCenter ?? {
    lon: (hole.tees[0]!.lon + hole.pin.lon) / 2,
    lat: (hole.tees[0]!.lat + hole.pin.lat) / 2,
  };
  const holeData: HoleData = {
    id: hole.id,
    courseName: hole.courseName,
    holeNumber: hole.holeNumber,
    par: hole.par,
    yardage: hole.yardage ?? 0,
    geojson: buildGeojson(hole),
    imageryCenter,
    groundPlan: hole.groundPlan ?? false,
  };
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
    },
    update: {
      courseName: hole.courseName,
      holeNumber: hole.holeNumber,
      par: hole.par,
      yardage,
      geojson: JSON.stringify(holeData.geojson),
      imageryCenter: JSON.stringify(imageryCenter),
      groundPlan: holeData.groundPlan,
    },
  });

  const seedBucket = profileBucket(SEED_PROFILE);
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
    const summary = computeGridSummary(prepared, sit, seedProfile, p.category);
    const rating = puzzleRatingFromTrap(summary.trapSize);

    const data = {
      holeId: hole.id,
      ballPosition: JSON.stringify(p.ball),
      pinPosition: JSON.stringify(pin),
      lie: p.lie,
      category: p.category,
      description: p.description,
      rating,
      trapSize: summary.trapSize,
    };
    await db.puzzle.upsert({ where: { id }, create: { id, ...data }, update: data });

    // Geometry may have changed: replace every cached grid for this puzzle
    // with a fresh one for the default bucket.
    await db.heatmapCache.deleteMany({ where: { puzzleId: id } });
    await db.heatmapCache.create({
      data: {
        puzzleId: id,
        profileBucket: seedBucket,
        grid: JSON.stringify(summary),
        optimalAim: JSON.stringify(summary.optimal.lonlat),
        optimalE: summary.optimal.e,
      },
    });
    results.push({ id, rating, trapSize: summary.trapSize });
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
