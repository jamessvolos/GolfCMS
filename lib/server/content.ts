/**
 * DB-backed content and profile access. JSON-typed columns are stored as
 * TEXT (SQLite has no Json type through the adapter); this module owns all
 * (de)serialization and zod validation so the rest of the app sees typed
 * objects.
 */

import { z } from 'zod';
import { db } from './db';
import type { PuzzleContent } from '@/lib/content/holes';
import type { HoleData, PlayerProfile } from '@/lib/engine/types';

const shotShape = z.enum(['draw', 'straight', 'fade']);
const lie = z.enum(['tee', 'fairway', 'rough', 'sand', 'recovery']);
const category = z.enum(['tee', 'approach', 'layup', 'recovery']);
const lonLat = z.object({ lon: z.number(), lat: z.number() });

export interface ProfileRecord extends PlayerProfile {
  id: string;
  name: string;
  elo: number;
  xp: number;
  streak: number;
}

const PROFILE_ID = 'local';

/** The single local v1 profile; created with seed defaults on first read. */
export async function getProfile(): Promise<ProfileRecord> {
  const row = await db.profile.upsert({
    where: { id: PROFILE_ID },
    create: { id: PROFILE_ID },
    update: {},
  });
  return {
    id: row.id,
    name: row.name,
    handicap: row.handicap,
    clubSpeedMph: row.clubSpeed,
    shotShape: shotShape.parse(row.shotShape),
    elo: row.elo,
    xp: row.xp,
    streak: row.streak,
  };
}

export const profileInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  handicap: z.coerce.number().min(-5).max(36),
  clubSpeed: z.coerce.number().int().min(60).max(135),
  shotShape,
});

export async function updateProfile(input: z.infer<typeof profileInputSchema>): Promise<void> {
  await db.profile.upsert({
    where: { id: PROFILE_ID },
    create: { id: PROFILE_ID, ...input },
    update: input,
  });
}

export interface PuzzleRecord extends PuzzleContent {
  rating: number;
  trapSize: number;
}

function parsePuzzleRow(row: {
  id: string;
  holeId: string;
  ballPosition: string;
  lie: string;
  pinPosition: string;
  category: string;
  description: string;
  rating: number;
  trapSize: number;
}): PuzzleRecord {
  return {
    id: row.id,
    holeId: row.holeId,
    ballPosition: lonLat.parse(JSON.parse(row.ballPosition)),
    pinPosition: lonLat.parse(JSON.parse(row.pinPosition)),
    lie: lie.parse(row.lie),
    category: category.parse(row.category),
    description: row.description,
    rating: row.rating,
    trapSize: row.trapSize,
  };
}

function parseHoleRow(row: {
  id: string;
  courseName: string;
  holeNumber: number;
  par: number;
  yardage: number;
  geojson: string;
  imageryCenter: string;
}): HoleData {
  return {
    id: row.id,
    courseName: row.courseName,
    holeNumber: row.holeNumber,
    par: row.par,
    yardage: row.yardage,
    geojson: JSON.parse(row.geojson),
    imageryCenter: lonLat.parse(JSON.parse(row.imageryCenter)),
  };
}

export async function listPuzzles(): Promise<{ puzzle: PuzzleRecord; hole: HoleData }[]> {
  const rows = await db.puzzle.findMany({ include: { hole: true }, orderBy: { id: 'asc' } });
  return rows.map((r) => ({ puzzle: parsePuzzleRow(r), hole: parseHoleRow(r.hole) }));
}

export async function getPuzzleWithHole(
  id: string,
): Promise<{ puzzle: PuzzleRecord; hole: HoleData } | null> {
  const row = await db.puzzle.findUnique({ where: { id }, include: { hole: true } });
  if (!row) return null;
  return { puzzle: parsePuzzleRow(row), hole: parseHoleRow(row.hole) };
}
