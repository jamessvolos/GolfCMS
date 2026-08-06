/**
 * The Ledger: what your course management costs you, in the unit you keep
 * score in.
 *
 * Elo is the right instrument for pacing a queue and the wrong one for
 * telling a golfer whether they are improving. Nobody has ever walked off
 * a course thinking about their rating. They think in strokes.
 *
 * Every attempt already stores `sgLoss` — expected strokes given up against
 * the optimal aim — so this needs no new capture and no migration. Multiply
 * the mean by the aim decisions in a round and you have the headline:
 *
 *     "Your reads are costing you 4.6 shots a round."
 *
 * The honesty constraint is the multiplier. A round is not 36 aim
 * decisions — putts are not aim decisions and this model does not read
 * greens — so the count is the shots a player actually chooses a line for,
 * which is roughly one per shot to the green.
 */

/**
 * Aim decisions in a typical round: a tee shot and an approach on each of
 * 18 holes, minus the ones where the green is already in range from the tee,
 * plus the recoveries. Rounded to a number that is defensible rather than
 * precise, and stated as such wherever it is shown.
 */
export const AIM_DECISIONS_PER_ROUND = 30;

export interface LedgerEntry {
  sgLoss: number;
  createdAt: Date;
}

export interface Ledger {
  /** Attempts the figure is built from. */
  n: number;
  /** Mean strokes given up per aim decision. */
  meanLoss: number;
  /** The headline: strokes conceded across a round of aim decisions. */
  perRound: number;
  /** The same figure over the most recent third, for a direction of travel. */
  recentPerRound: number | null;
  /** How many attempts the recent figure rests on. */
  recentN: number;
  /**
   * True when there is not yet enough evidence to state a trend. Shown
   * rather than hidden — an app that reports a trend from four attempts is
   * lying with arithmetic.
   */
  provisional: boolean;
}

/** Below this the mean is noise and the trend is meaningless. */
export const LEDGER_MIN_ATTEMPTS = 12;

export function buildLedger(entries: LedgerEntry[]): Ledger {
  const n = entries.length;
  if (n === 0) {
    return { n: 0, meanLoss: 0, perRound: 0, recentPerRound: null, recentN: 0, provisional: true };
  }
  const sorted = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const mean = (xs: LedgerEntry[]) =>
    xs.reduce((s, e) => s + Math.max(0, e.sgLoss), 0) / Math.max(1, xs.length);

  const meanLoss = mean(sorted);
  const recentSlice = sorted.slice(Math.floor((sorted.length * 2) / 3));
  const enough = n >= LEDGER_MIN_ATTEMPTS;

  return {
    n,
    meanLoss,
    perRound: meanLoss * AIM_DECISIONS_PER_ROUND,
    recentPerRound: enough ? mean(recentSlice) * AIM_DECISIONS_PER_ROUND : null,
    recentN: recentSlice.length,
    provisional: !enough,
  };
}

/** One sentence, or null when there is not enough to say anything true. */
export function ledgerHeadline(ledger: Ledger): string | null {
  if (ledger.n === 0) return null;
  const strokes = ledger.perRound.toFixed(1);
  if (ledger.provisional) {
    return `About ${strokes} shots a round so far — ${ledger.n} decision${ledger.n === 1 ? '' : 's'} in, too few to trust.`;
  }
  if (ledger.recentPerRound === null) return `Your reads are costing you ${strokes} shots a round.`;
  const delta = ledger.perRound - ledger.recentPerRound;
  if (Math.abs(delta) < 0.3) {
    return `Your reads are costing you ${strokes} shots a round, and holding steady.`;
  }
  return delta > 0
    ? `Your reads are costing you ${ledger.recentPerRound.toFixed(1)} shots a round, down from ${strokes}.`
    : `Your reads are costing you ${ledger.recentPerRound.toFixed(1)} shots a round, up from ${strokes}.`;
}
