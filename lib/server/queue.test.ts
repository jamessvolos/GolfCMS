import { describe, expect, it } from 'vitest';
import { pickNext, QUEUE_BAND } from './queue';
import type { QueueCandidate } from './queue';

const c = (
  id: string,
  rating: number,
  attempts = 0,
  lastPlayedAt: number | null = null,
  serves = true,
): QueueCandidate => ({ id, rating, attempts, lastPlayedAt, serves });

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

describe('pickNext and situations with no decision in them', () => {
  it('never serves a decisionless puzzle while a real one is available', () => {
    // The flat one sits exactly on the player's rating and is unseen; on
    // rating proximity alone it wins every time. It must still lose.
    const pool = [
      c('flat', 1200, 0, null, false),
      c('real', 1560, 0, null, true),
    ];
    expect(pickNext(pool, 1200)?.puzzleId).toBe('real');
  });

  it('falls back rather than serving nothing', () => {
    // Measured on the shipped library: 32 of 36 puzzles do not clear the
    // gate. Until the miner lands, refusing to serve them would leave a
    // player who has exhausted the four with an empty app.
    const pool = [c('flat-a', 1000, 0, null, false), c('flat-b', 1180, 0, null, false)];
    expect(pickNext(pool, 1200)?.puzzleId).toBe('flat-b');
  });

  it('reviews a played decision before serving an unseen non-decision', () => {
    const pool = [
      c('seen-real', 1200, 3, 1000, true),
      c('unseen-flat', 1200, 0, null, false),
    ];
    const pick = pickNext(pool, 1200);
    expect(pick?.puzzleId).toBe('seen-real');
    expect(pick?.repeat).toBe(true);
  });
});

describe('pickNext at library scale', () => {
  /** A mined library: hundreds of situations spread across the rating range. */
  function library(n: number): QueueCandidate[] {
    return Array.from({ length: n }, (_, i) =>
      c(`p${String(i).padStart(4, '0')}`, 1000 + ((i * 37) % 1100), 0, null, i % 5 !== 0),
    );
  }

  it('serves a full session of distinct puzzles without repeating', () => {
    // The measurement the whole content programme exists to move. With 36
    // puzzles the ±150 band exhausted in one sitting; 18 attempts were ever
    // recorded against the shipped library.
    const pool = library(600);
    const seen: string[] = [];
    for (let i = 0; i < 200; i++) {
      const pick = pickNext(pool, 1200, { excludeIds: seen });
      expect(pick).not.toBeNull();
      expect(pick!.repeat).toBe(false);
      seen.push(pick!.puzzleId);
    }
    expect(new Set(seen).size).toBe(200);
  });

  it('never serves a situation with nothing in it while real ones remain', () => {
    const pool = library(600);
    const flat = new Set(pool.filter((p) => !p.serves).map((p) => p.id));
    const seen: string[] = [];
    for (let i = 0; i < 150; i++) {
      const pick = pickNext(pool, 1500, { excludeIds: seen })!;
      expect(flat.has(pick.puzzleId)).toBe(false);
      seen.push(pick.puzzleId);
    }
  });

  it('stays inside the rating band while the band has content', () => {
    const pool = library(600);
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const pick = pickNext(pool, 1400, { excludeIds: seen })!;
      expect(pick.band).toBe(QUEUE_BAND);
      seen.push(pick.puzzleId);
    }
  });

  it('widens rather than failing when a band is genuinely empty', () => {
    const pool = [c('lonely', 2400, 0, null, true)];
    const pick = pickNext(pool, 1000);
    expect(pick?.puzzleId).toBe('lonely');
    expect(pick!.band).toBeGreaterThan(QUEUE_BAND);
  });
});
