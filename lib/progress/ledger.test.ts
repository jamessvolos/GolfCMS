import { describe, expect, it } from 'vitest';
import {
  AIM_DECISIONS_PER_ROUND,
  buildLedger,
  LEDGER_MIN_ATTEMPTS,
  ledgerHeadline,
} from './ledger';

const at = (day: number) => new Date(2026, 0, day);
const entries = (losses: number[]) =>
  losses.map((sgLoss, i) => ({ sgLoss, createdAt: at(i + 1) }));

describe('buildLedger', () => {
  it('says nothing at all with no attempts', () => {
    const l = buildLedger([]);
    expect(l.n).toBe(0);
    expect(ledgerHeadline(l)).toBeNull();
  });

  it('converts expected strokes into the unit a golfer keeps score in', () => {
    const l = buildLedger(entries(Array.from({ length: 20 }, () => 0.2)));
    expect(l.meanLoss).toBeCloseTo(0.2, 9);
    expect(l.perRound).toBeCloseTo(0.2 * AIM_DECISIONS_PER_ROUND, 9);
  });

  it('marks a figure provisional rather than reporting a trend from nothing', () => {
    // The app's entire history was 18 attempts. An app that reports a
    // direction of travel from four is lying with arithmetic.
    const few = buildLedger(entries([0.4, 0.1, 0.3, 0.2]));
    expect(few.provisional).toBe(true);
    expect(few.recentPerRound).toBeNull();
    expect(ledgerHeadline(few)).toContain('too few to trust');

    const enough = buildLedger(entries(Array.from({ length: LEDGER_MIN_ATTEMPTS }, () => 0.2)));
    expect(enough.provisional).toBe(false);
  });

  it('reads improvement off the most recent third', () => {
    // Bad early, good lately: the headline must show the recent figure.
    const l = buildLedger(entries([...Array(12).fill(0.5), ...Array(6).fill(0.05)]));
    expect(l.recentPerRound).not.toBeNull();
    expect(l.recentPerRound!).toBeLessThan(l.perRound);
    expect(ledgerHeadline(l)).toContain('down from');
  });

  it('says so when it is going the other way', () => {
    const l = buildLedger(entries([...Array(12).fill(0.05), ...Array(6).fill(0.5)]));
    expect(ledgerHeadline(l)).toContain('up from');
  });

  it('does not manufacture a trend out of noise', () => {
    const l = buildLedger(entries(Array.from({ length: 30 }, (_, i) => 0.2 + (i % 2 ? 0.01 : -0.01))));
    expect(ledgerHeadline(l)).toContain('holding steady');
  });

  it('ignores negative losses, which are Monte Carlo noise not free strokes', () => {
    const l = buildLedger(entries([0.2, -0.05, 0.2, -0.05]));
    expect(l.meanLoss).toBeCloseTo(0.1, 9);
  });

  it('reads the stream in time order regardless of how it arrives', () => {
    const forward = buildLedger(entries([...Array(12).fill(0.5), ...Array(6).fill(0.05)]));
    const shuffled = buildLedger(
      [...entries([...Array(12).fill(0.5), ...Array(6).fill(0.05)])].reverse(),
    );
    expect(shuffled.recentPerRound).toBeCloseTo(forward.recentPerRound!, 9);
  });
});
