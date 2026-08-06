/**
 * Admission: the only place a generated situation becomes servable content.
 *
 * Everything upstream proposes. This measures at full sampling and decides,
 * and every refusal carries a machine-readable reason so the miner's funnel
 * can be read rather than guessed at — a generator whose rejections are
 * anonymous is a generator nobody can debug.
 */

import { maxCarry } from '@/lib/engine/clubs';
import { DECISION_TRAP } from '@/lib/engine/constants';
import { dist } from '@/lib/engine/projection';
import { clearsDecisionThreshold, puzzleRatingFromTrap } from '@/lib/engine/scoring';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { holdsSomething } from '@/lib/puzzle/legibility';
import type { PlayerProfile, PreparedHole, Pt } from '@/lib/engine/types';
import type { Situation } from './situations';

export type RejectionReason =
  | 'no-decision'
  | 'unreachable-flag-artifact'
  | 'corridor-degenerate'
  | 'too-close';

export interface AdmittedSituation {
  situation: Situation;
  pin: Pt;
  pinZone: string;
  trapSize: number;
  trapSe: number;
  consequence: number;
  asymmetry: number;
  holds: 'decision' | 'consequence';
  rating: number;
}

export interface Rejection {
  situation: Situation;
  reason: RejectionReason;
  trapSize: number;
  asymmetry: number;
}

export type Verdict =
  | { admitted: AdmittedSituation; rejected?: undefined }
  | { admitted?: undefined; rejected: Rejection };

/**
 * A corridor this narrow is not a decision, it is a lottery: the optimal
 * aim beats the obvious one, but only if you hit a target thinner than your
 * own dispersion, so a player who finds it did not read anything.
 */
export const MIN_CORRIDOR_YDS = 4;

/**
 * ...and one this wide means the lattice never found an edge, which on a
 * generated situation usually means the search sector, not the golf hole,
 * is what bounded it.
 */
export const MAX_CORRIDOR_YDS = 60;

/**
 * Full-sampling verdict on one (situation, pin).
 *
 * The `unreachable-flag-artifact` check is Wave 1's guard restated for
 * generated content, and it is the reason Nine Points lost the account: a
 * generator that searches for high trap sizes will find whatever the
 * yardstick rewards, and "aim at a flag 453 yards away" measured 1.841
 * against the flag line versus 0.026 against a reachable one. Admitting
 * those would mass-produce a wrong lesson at the top of the rating range.
 */
export function admit(
  prepared: PreparedHole,
  situation: Situation,
  pin: Pt,
  pinZone: string,
  profile: PlayerProfile,
  opts: { nSamples?: number } = {},
): Verdict {
  const toPin = dist(situation.ball, pin);
  if (toPin < 40) {
    return { rejected: { situation, reason: 'too-close', trapSize: 0, asymmetry: 0 } };
  }

  const summary = computeGridSummary(
    prepared,
    { ball: situation.ball, pin, lie: situation.lie },
    profile,
    situation.category,
    opts.nSamples ? { nSamples: opts.nSamples } : {},
  );

  const held = holdsSomething(
    summary.trapSize,
    summary.trapSe,
    summary.legibility.asymmetry,
    clearsDecisionThreshold,
  );
  if (!held.ships || !held.because) {
    return {
      rejected: {
        situation,
        reason: 'no-decision',
        trapSize: summary.trapSize,
        asymmetry: summary.legibility.asymmetry,
      },
    };
  }

  // The reference aim is the flag only when the flag is reachable. If it is
  // not, and the trap is large, the trap is describing the cost of a shot
  // nobody was going to play.
  if (toPin > maxCarry(profile, situation.lie) && summary.trapSize > 0.25) {
    const referenceIsPin =
      Math.abs(summary.naive.local.x - pin.x) < 1e-6 &&
      Math.abs(summary.naive.local.y - pin.y) < 1e-6;
    if (referenceIsPin) {
      return {
        rejected: {
          situation,
          reason: 'unreachable-flag-artifact',
          trapSize: summary.trapSize,
          asymmetry: summary.legibility.asymmetry,
        },
      };
    }
  }

  const c = summary.brief.corridor['0.03'];
  const width = c.left + c.right;
  if (width < MIN_CORRIDOR_YDS || width > MAX_CORRIDOR_YDS) {
    return {
      rejected: {
        situation,
        reason: 'corridor-degenerate',
        trapSize: summary.trapSize,
        asymmetry: summary.legibility.asymmetry,
      },
    };
  }

  return {
    admitted: {
      situation,
      pin,
      pinZone,
      trapSize: summary.trapSize,
      trapSe: summary.trapSe,
      consequence: summary.legibility.consequence,
      asymmetry: summary.legibility.asymmetry,
      holds: held.because,
      rating: puzzleRatingFromTrap(summary.trapSize),
    },
  };
}

/** For the funnel report — every reason, so none is silently dropped. */
export const REJECTION_REASONS: RejectionReason[] = [
  'no-decision',
  'unreachable-flag-artifact',
  'corridor-degenerate',
  'too-close',
];

export { DECISION_TRAP };
