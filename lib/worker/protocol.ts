/**
 * Message protocol between the puzzle UI and the engine worker.
 * All geometry crossing the boundary is lon/lat; the worker owns projection.
 */

import type { ContourSet } from '@/lib/map/contours';
import type {
  EvalResult,
  HoleData,
  LonLat,
  PlayableLie,
  PlayerProfile,
  Pt,
  PuzzleCategory,
} from '@/lib/engine/types';

export interface SituationWire {
  ball: LonLat;
  pin: LonLat;
  lie: PlayableLie;
}

export type WorkerRequest =
  | { type: 'init'; id: number; hole: HoleData }
  | {
      type: 'grid';
      id: number;
      sit: SituationWire;
      profile: PlayerProfile;
      category: PuzzleCategory;
      nSamples?: number;
    }
  | { type: 'aim'; id: number; sit: SituationWire; profile: PlayerProfile; aim: LonLat };

export interface GridSummary {
  contours: ContourSet;
  /** Local-yard positions (project with the hole's imageryCenter). */
  optimal: { local: Pt; lonlat: LonLat; e: number; clubLabel: string; result: EvalResult };
  naive: { local: Pt; lonlat: LonLat; e: number };
  trapSize: number;
}

export type WorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'grid'; id: number; summary: GridSummary }
  | { type: 'aim'; id: number; result: EvalResult; aimLocal: Pt }
  | { type: 'error'; id: number; message: string };
