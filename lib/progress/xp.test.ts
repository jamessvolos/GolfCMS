import { describe, expect, it } from 'vitest';
import {
  advanceStreak,
  dayKey,
  levelInfo,
  tallyGroups,
  xpForAttempt,
  XP_PER_LEVEL,
} from './xp';

describe('xpForAttempt', () => {
  it('awards the band base when the puzzle is at or below the player', () => {
    expect(xpForAttempt('perfect', 1400, 1200)).toBe(100);
    expect(xpForAttempt('good', 1400, 1400)).toBe(60);
    expect(xpForAttempt('okay', 1200, 1200)).toBe(25);
    expect(xpForAttempt('miss', 1200, 1200)).toBe(10);
  });

  it('adds an upset bonus for beating a puzzle above your rating', () => {
    expect(xpForAttempt('perfect', 1200, 1400)).toBe(120); // +200/10
    expect(xpForAttempt('good', 1200, 1300)).toBe(70);
  });

  it('caps the upset bonus', () => {
    expect(xpForAttempt('perfect', 1000, 2500)).toBe(150); // +50 cap
  });

  it('gives no upset bonus for okay or miss', () => {
    expect(xpForAttempt('okay', 1000, 2500)).toBe(25);
    expect(xpForAttempt('miss', 1000, 2500)).toBe(10);
  });
});

describe('levelInfo', () => {
  it('starts at level 1 with zero xp', () => {
    const l = levelInfo(0);
    expect(l.level).toBe(1);
    expect(l.intoLevel).toBe(0);
    expect(l.progress).toBe(0);
    expect(l.xpToNext).toBe(XP_PER_LEVEL);
  });

  it('advances a level every 500 xp', () => {
    expect(levelInfo(499).level).toBe(1);
    expect(levelInfo(500).level).toBe(2);
    expect(levelInfo(1250).level).toBe(3);
    expect(levelInfo(1250).intoLevel).toBe(250);
    expect(levelInfo(1250).progress).toBeCloseTo(0.5, 9);
  });

  it('clamps nonsense input', () => {
    expect(levelInfo(-100).level).toBe(1);
    expect(levelInfo(10.7).intoLevel).toBe(10);
  });
});

describe('advanceStreak', () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00`);

  it('starts a streak on the first play', () => {
    const r = advanceStreak({ streak: 0, lastPlayedDay: null }, at('2026-08-03'));
    expect(r).toEqual({ streak: 1, lastPlayedDay: '2026-08-03', extended: true });
  });

  it('is a no-op for a second play the same day', () => {
    const r = advanceStreak({ streak: 4, lastPlayedDay: '2026-08-03' }, at('2026-08-03'));
    expect(r.streak).toBe(4);
    expect(r.extended).toBe(false);
  });

  it('extends on consecutive days', () => {
    const r = advanceStreak({ streak: 4, lastPlayedDay: '2026-08-02' }, at('2026-08-03'));
    expect(r.streak).toBe(5);
    expect(r.extended).toBe(true);
  });

  it('extends across a month boundary', () => {
    const r = advanceStreak({ streak: 9, lastPlayedDay: '2026-07-31' }, at('2026-08-01'));
    expect(r.streak).toBe(10);
  });

  it('resets after a gap', () => {
    const r = advanceStreak({ streak: 20, lastPlayedDay: '2026-07-30' }, at('2026-08-03'));
    expect(r.streak).toBe(1);
    expect(r.extended).toBe(true);
  });

  it('repairs a zero streak on a same-day replay', () => {
    const r = advanceStreak({ streak: 0, lastPlayedDay: '2026-08-03' }, at('2026-08-03'));
    expect(r.streak).toBe(1);
  });
});

describe('dayKey', () => {
  it('zero-pads month and day', () => {
    expect(dayKey(new Date('2026-01-05T08:00:00'))).toBe('2026-01-05');
  });
});

describe('tallyGroups', () => {
  it('groups marks in fives', () => {
    expect(tallyGroups(0)).toEqual([]);
    expect(tallyGroups(3)).toEqual([3]);
    expect(tallyGroups(5)).toEqual([5]);
    expect(tallyGroups(7)).toEqual([5, 2]);
    expect(tallyGroups(12)).toEqual([5, 5, 2]);
  });
});
