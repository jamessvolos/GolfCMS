import { describe, expect, it } from 'vitest';
import { pickNext, QUEUE_BAND } from './queue';
import type { QueueCandidate } from './queue';

const c = (
  id: string,
  rating: number,
  attempts = 0,
  lastPlayedAt: number | null = null,
): QueueCandidate => ({ id, rating, attempts, lastPlayedAt });

describe('pickNext', () => {
  it('returns null with no candidates', () => {
    expect(pickNext([], 1200)).toBeNull();
  });

  it('serves the unseen puzzle closest to the player rating', () => {
    const pool = [c('far', 1000), c('near', 1180), c('mid', 1300)];
    const pick = pickNext(pool, 1200);
    expect(pick?.puzzleId).toBe('near');
    expect(pick?.band).toBe(QUEUE_BAND);
    expect(pick?.repeat).toBe(false);
  });

  it('stays inside the ±150 band when something unseen is in it', () => {
    // 1340 is in band (140 away); 1210 is closer but already played.
    const pool = [c('played', 1210, 3, 5), c('inband', 1340)];
    expect(pickNext(pool, 1200)?.puzzleId).toBe('inband');
  });

  it('widens the band when nothing unseen is within ±150', () => {
    const pool = [c('played', 1200, 1, 10), c('far', 1600)];
    const pick = pickNext(pool, 1200);
    expect(pick?.puzzleId).toBe('far');
    expect(pick?.band).toBeGreaterThan(QUEUE_BAND);
    expect(pick?.repeat).toBe(false);
  });

  it('falls back to the least-recently-played puzzle when all are seen', () => {
    const pool = [c('recent', 1200, 2, 900), c('stale', 1250, 1, 100)];
    const pick = pickNext(pool, 1200);
    expect(pick?.puzzleId).toBe('stale');
    expect(pick?.repeat).toBe(true);
  });

  it('honours the exclude list so the current puzzle is never re-served', () => {
    const pool = [c('a', 1200), c('b', 1210)];
    expect(pickNext(pool, 1200, { excludeIds: ['a'] })?.puzzleId).toBe('b');
    expect(pickNext(pool, 1200, { excludeIds: ['a', 'b'] })).toBeNull();
  });

  it('is deterministic when ratings tie', () => {
    const pool = [c('zeta', 1200), c('alpha', 1200)];
    expect(pickNext(pool, 1200)?.puzzleId).toBe('alpha');
    expect(pickNext(pool, 1200)?.puzzleId).toBe('alpha');
  });

  it('tracks a rising player rating up the library', () => {
    const pool = [c('easy', 1050), c('mid', 1300), c('hard', 1600)];
    expect(pickNext(pool, 1000)?.puzzleId).toBe('easy');
    expect(pickNext(pool, 1320)?.puzzleId).toBe('mid');
    expect(pickNext(pool, 1550)?.puzzleId).toBe('hard');
  });
});
