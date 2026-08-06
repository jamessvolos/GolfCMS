/**
 * The card: a hole played shot by shot, against a caddie playing the same
 * dice.
 *
 * The app's whole recorded history is 18 attempts, because a puzzle is one
 * question and then it is over. A card asks nine to fourteen, and each one
 * starts from where the last shot actually finished rather than from a
 * position chosen to be interesting — which is the same argument Wave 3
 * made about generated content, applied to a session.
 *
 * The caddie is not an opponent to beat, it is a counterfactual: the same
 * ball, the same lies, the same bounces, played by someone who aims where
 * the engine says to aim. The gap between the two cards is what course
 * management is worth to this player on this hole, in strokes, which is the
 * unit they already keep score in.
 */

import { evaluateAim } from '@/lib/engine/evaluate';
import { evaluateGrid } from '@/lib/engine/optimize';
import { strokesToHoleOut } from '@/lib/engine/baseline';
import { dist } from '@/lib/engine/projection';
import { flyShot, shotDice } from './roll';
import type { Roll } from './roll';
import type {
  PlayableLie,
  PlayerProfile,
  PreparedHole,
  Pt,
  PuzzleCategory,
} from '@/lib/engine/types';

/** Beyond this many strokes on one hole, stop and write down the number. */
export const MAX_SHOTS_PER_HOLE = 8;
/** Inside this, the hole is over — putting is not a course-management question. */
export const HOLED_OUT_YDS = 12;

export interface Ask {
  /** Shot number on this hole, from 1. */
  shot: number;
  ball: Pt;
  lie: PlayableLie;
  category: PuzzleCategory;
  toPin: number;
  /** Where the engine says to aim, for the caddie and for the reveal. */
  optimal: Pt;
  optimalE: number;
  /** Where an unthinking player aims, and what it costs. */
  reference: Pt;
  trapSize: number;
}

export interface PlayedShot {
  ask: Ask;
  /** The aim the player chose, or the optimal when the caddie is playing. */
  aim: Pt;
  roll: Roll;
  /** Expected strokes of the chosen aim; sgLoss is this minus optimalE. */
  aimE: number;
}

export interface HoleCard {
  shots: PlayedShot[];
  /** Strokes taken, including penalties and the putts the model implies. */
  strokes: number;
  /** Sum of sgLoss across every aim on this hole. */
  conceded: number;
}

function categoryFor(shot: number, lie: PlayableLie, toPin: number): PuzzleCategory {
  if (shot === 1) return 'tee';
  if (lie === 'sand' || lie === 'recovery') return 'recovery';
  return toPin > 240 ? 'layup' : 'approach';
}

/**
 * Ask the engine what this position is worth and where to aim from it.
 * One grid per shot — the expensive part of a card, and the reason a card
 * is three holes rather than eighteen.
 */
export function ask(
  prepared: PreparedHole,
  ball: Pt,
  lie: PlayableLie,
  shot: number,
  profile: PlayerProfile,
  nSamples?: number,
): Ask {
  const toPin = dist(ball, prepared.pin);
  const category = categoryFor(shot, lie, toPin);
  const grid = evaluateGrid(
    prepared,
    { ball, lie, pin: prepared.pin },
    profile,
    category,
    nSamples ? { nSamples } : {},
  );
  return {
    shot,
    ball,
    lie,
    category,
    toPin,
    optimal: grid.optimal.point,
    optimalE: grid.optimal.expectedStrokes,
    reference: grid.naive.point,
    trapSize: grid.trapSize,
  };
}

/**
 * Play one hole with a fixed aim policy. `chooseAim` is the player (or the
 * caddie, which is `(a) => a.optimal`); every shot uses the card's dice for
 * its index, so two policies played on the same card share their luck
 * exactly.
 */
export function playHole(
  prepared: PreparedHole,
  start: { ball: Pt; lie: PlayableLie },
  profile: PlayerProfile,
  cardSeed: number,
  chooseAim: (ask: Ask) => Pt,
  opts: { nSamples?: number; holeIndex?: number } = {},
): HoleCard {
  const shots: PlayedShot[] = [];
  let ball = start.ball;
  let lie = start.lie;
  let strokes = 0;
  let conceded = 0;
  const holeIndex = opts.holeIndex ?? 0;

  for (let shot = 1; shot <= MAX_SHOTS_PER_HOLE; shot++) {
    const toPin = dist(ball, prepared.pin);
    if (toPin <= HOLED_OUT_YDS) break;

    const a = ask(prepared, ball, lie, shot, profile, opts.nSamples);
    const aim = chooseAim(a);
    // Both cards draw shot N of hole M from the same place in the stream.
    const z = shotDice(cardSeed, holeIndex * 100 + shot);
    const roll = flyShot(prepared, ball, lie, aim, profile, z);

    // The chosen aim's expected strokes, so sgLoss is exactly the quantity
    // the app has always scored — E[your aim] minus E[optimal aim].
    const aimE =
      aim === a.optimal
        ? a.optimalE
        : evaluateAim(prepared, { ball, lie, pin: prepared.pin }, profile, aim, {
            nSamples: opts.nSamples,
          }).expectedStrokes;

    shots.push({ ask: a, aim, roll, aimE });
    strokes += 1 + roll.penalty;
    conceded += Math.max(0, aimE - a.optimalE);

    if (roll.holed) {
      // Putting is distance-only in this model; charge the table rather
      // than pretending to read a green.
      strokes += strokesToHoleOut(dist(roll.at, prepared.pin), 'green', profile.handicap);
      break;
    }
    ball = roll.resumeAt;
    lie = roll.resumeLie;
  }

  return { shots, strokes, conceded };
}

/** The caddie's policy: aim where the engine says. */
export const caddie = (a: Ask): Pt => a.optimal;

/** The reflex policy, for measuring what course management is worth. */
export const reflex = (a: Ask): Pt => a.reference;
