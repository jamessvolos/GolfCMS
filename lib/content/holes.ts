/**
 * Committed hole/puzzle content, zod-validated at load. Milestone 2 ships
 * one hole; the annotate admin (Milestone 4) and a real DB replace this.
 */

import { z } from 'zod';
import capeBundle from '@/data/holes/cape-01.json';
import type { HoleData, PlayableLie, PuzzleCategory } from '@/lib/engine/types';

const lonLat = z.object({ lon: z.number(), lat: z.number() });

const polygonFeature = z.object({
  type: z.literal('Feature'),
  properties: z.object({
    kind: z.enum(['fairway', 'green', 'bunker', 'water', 'ob', 'recovery']),
    name: z.string().optional(),
  }),
  geometry: z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  }),
});

const pointFeature = z.object({
  type: z.literal('Feature'),
  properties: z.object({ kind: z.enum(['pin', 'tee']), name: z.string().optional() }),
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
});

const holeSchema = z.object({
  id: z.string(),
  courseName: z.string(),
  holeNumber: z.number(),
  par: z.number(),
  yardage: z.number(),
  geojson: z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(z.union([polygonFeature, pointFeature])),
  }),
  imageryCenter: lonLat,
});

const puzzleSchema = z.object({
  id: z.string(),
  holeId: z.string(),
  ballPosition: lonLat,
  lie: z.enum(['tee', 'fairway', 'rough', 'sand', 'recovery']),
  pinPosition: lonLat,
  category: z.enum(['tee', 'approach', 'layup', 'recovery']),
  description: z.string(),
});

const bundleSchema = z.object({ hole: holeSchema, puzzles: z.array(puzzleSchema) });

export type PuzzleContent = {
  id: string;
  holeId: string;
  ballPosition: { lon: number; lat: number };
  pinPosition: { lon: number; lat: number };
  lie: PlayableLie;
  category: PuzzleCategory;
  description: string;
};

const parsed = bundleSchema.parse(capeBundle);

export function getHole(): HoleData {
  return parsed.hole as HoleData;
}

export function listPuzzles(): PuzzleContent[] {
  return parsed.puzzles;
}

export function getPuzzle(id: string): PuzzleContent | undefined {
  return parsed.puzzles.find((p) => p.id === id);
}
