/**
 * The caddie's note — types.
 *
 * Structure is the teaching: every note is THE READ (what your line did)
 * then THE MOVE (what to do about it), in that order, every time. The
 * silhouette is identical on the first puzzle and the two-hundredth, so
 * the eye learns where the instruction lives before it reads a word.
 */

import type { Situation } from '@/lib/engine/evaluate';
import type { GridSummary } from '@/lib/puzzle/gridSummary';
import type {
  EvalResult,
  FeatureHit,
  PlayableLie,
  PlayerProfile,
  PreparedHole,
  Pt,
  PuzzleCategory,
} from '@/lib/engine/types';

export type Band = 'perfect' | 'good' | 'okay' | 'miss';
export type Slot = 'read' | 'move';

/**
 * A number that has been through format.ts. Templates accept only these,
 * so a raw number in a sentence is a compile error rather than a review
 * comment.
 */
export type Formatted = string & { readonly __formatted: unique symbol };

/** A rendered sentence, split so numerals can carry the mono treatment. */
export interface Token {
  text: string;
  /** Numerals render in IBM Plex Mono, optically corrected. */
  mono?: boolean;
  /** The one load-bearing quantity, underlined in flag red. */
  key?: boolean;
}

export interface Claim {
  ruleId: string;
  slot: Slot;
  /** Family, used to keep two claims from saying the same kind of thing. */
  tag: string;
  tokens: Token[];
  /** Plain text, for tests, screen readers, and the golden corpus. */
  text: string;
  /** Strokes this claim accounts for — the materiality sort key. */
  stake: number;
}

export interface ExplainInput {
  category: PuzzleCategory;
  lie: PlayableLie;
  band: Band;
  sgLoss: number;
  prepared: PreparedHole;
  sit: Situation;
  /** Already bucketed — the same profile the cached grid was computed with. */
  profile: PlayerProfile;
  playerAim: Pt;
  playerEval: EvalResult;
  /** Null on the degraded path, where only the backstop can fire. */
  grid: GridSummary | null;
  /** Probe evaluator; omit and the probe-dependent rules stand down. */
  evaluate?: (aim: Pt) => EvalResult;
  /** Rule ids of this profile's last few notes, newest first. */
  history?: string[][];
}

export interface Note {
  read: Claim[];
  move: Claim | null;
  ruleIds: string[];
  /** Screen-reader preamble, e.g. "Miss. 0.19 strokes lost." */
  srPrefix: string;
  /** The single map mark, or null. */
  mark: { at: Pt; delta: number; glyph: 'spot-height' } | null;
}

/** A candidate aim the ladder actually evaluated — never a guess. */
export interface Probe {
  aim: Pt;
  /** Signed lateral offset from the player's aim, yards (+ = right). */
  lat: number;
  /** Signed longitudinal offset, yards (+ = further). */
  long: number;
  result: EvalResult;
  e: number;
}

/**
 * The flat fact table. Rules read only from here, never from the engine
 * directly, so a rule's guard can be checked against a fixture.
 */
export interface Facts {
  band: Band;
  sgLoss: number;
  category: PuzzleCategory;
  lie: PlayableLie;
  nSamples: number;

  /** Scaled by sqrt(600/n) so the floors track the sample count. */
  floors: {
    anchor: number;
    print: number;
    ceiling: number;
    delta: number;
    strokes: number;
    yards: number;
  };

  player: AimFacts;
  optimal: AimFacts | null;
  /** The pin as an aim, when it differs from the optimal and naive. */
  pin: AimFacts | null;

  holeDistance: number;
  /** Distance from ball to the player's (clamped) aim. */
  playerAimDistance: number;
  maxCarry: number;
  sigmaLat: number;
  /** Optimal relative to the PLAYER's aim in the shot frame. */
  toOptimal: { lat: number; long: number } | null;
  corridor: GridSummary['brief']['corridor'] | null;

  probes: Probe[];
  /** The chosen correction: the smallest offset that reaches Good or better. */
  correction: Probe | null;
}

export interface AimFacts {
  e: number;
  clubLabel: string;
  clamped: boolean;
  aimDistance: number;
  /** Fraction finishing in water or OB. */
  penalShare: number;
  greenShare: number;
  /** Distance in feet from the flag for the samples that found the green. */
  greenFeet: number | null;
  inPlayShare: number;
  hits: FeatureHit[];
  /** Share by feature id, for deltas against another aim. */
  shareById: Map<number, number>;
}
