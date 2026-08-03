/**
 * Content shapes shared by the server, the engine callers, and the UI.
 * Hole/puzzle content itself lives in the database (seeded from
 * data/holes/*.json via the ingest pipeline).
 */

import type { PlayableLie, PuzzleCategory } from '@/lib/engine/types';

export interface PuzzleContent {
  id: string;
  holeId: string;
  ballPosition: { lon: number; lat: number };
  pinPosition: { lon: number; lat: number };
  lie: PlayableLie;
  category: PuzzleCategory;
  description: string;
}
