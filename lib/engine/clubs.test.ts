import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from './types';
import { allowedClubs, clubTable, selectClub } from './clubs';
import { DRIVER_CARRY_PER_MPH } from './constants';

const P: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'draw' };
const DRIVER = DRIVER_CARRY_PER_MPH * 110; // 269.5

describe('clubTable', () => {
  it('derives driver carry from club speed', () => {
    const clubs = clubTable(P);
    expect(clubs[0]?.id).toBe('DR');
    expect(clubs[0]?.carry).toBeCloseTo(DRIVER, 6);
  });

  it('applies fixed gapping fractions of driver carry', () => {
    const clubs = clubTable(P);
    const seven = clubs.find((c) => c.id === 'I7');
    const lob = clubs.find((c) => c.id === 'LW');
    expect(seven?.carry).toBeCloseTo(0.7 * DRIVER, 6);
    expect(lob?.carry).toBeCloseTo(0.35 * DRIVER, 6);
  });

  it('is sorted longest first and has 13 clubs', () => {
    const clubs = clubTable(P);
    expect(clubs).toHaveLength(13);
    for (let i = 1; i < clubs.length; i++) {
      expect(clubs[i]!.carry).toBeLessThan(clubs[i - 1]!.carry);
    }
  });
});

describe('allowedClubs', () => {
  it('bans driver and 3 wood from the rough', () => {
    const ids = allowedClubs(P, 'rough').map((c) => c.id);
    expect(ids).not.toContain('DR');
    expect(ids).not.toContain('W3');
    expect(ids).toContain('W5');
  });

  it('allows wedges only from sand', () => {
    const ids = allowedClubs(P, 'sand').map((c) => c.id);
    expect(ids).toEqual(['PW', 'GW', 'SW', 'LW']);
  });

  it('allows the full bag from the tee and fairway', () => {
    expect(allowedClubs(P, 'tee')).toHaveLength(13);
    expect(allowedClubs(P, 'fairway')).toHaveLength(13);
  });
});

describe('selectClub', () => {
  it('picks the smallest club whose carry reaches the target', () => {
    // PW carry = 148.225 < 150, 9i carry = 161.7 >= 150
    const sel = selectClub(P, 'fairway', 150);
    expect(sel.club.id).toBe('I9');
    expect(sel.effectiveDistance).toBe(150);
    expect(sel.clamped).toBe(false);
  });

  it('picks a club whose carry exactly equals the distance', () => {
    const pw = clubTable(P).find((c) => c.id === 'PW')!;
    const sel = selectClub(P, 'fairway', pw.carry);
    expect(sel.club.id).toBe('PW');
  });

  it('clamps to driver when the aim is beyond max club', () => {
    const sel = selectClub(P, 'fairway', 320);
    expect(sel.club.id).toBe('DR');
    expect(sel.effectiveDistance).toBeCloseTo(DRIVER, 6);
    expect(sel.clamped).toBe(true);
  });

  it('clamps to 5 wood from the rough', () => {
    const sel = selectClub(P, 'rough', 260);
    expect(sel.club.id).toBe('W5');
    expect(sel.effectiveDistance).toBeCloseTo(0.87 * DRIVER, 6);
    expect(sel.clamped).toBe(true);
  });

  it('clamps to pitching wedge from sand', () => {
    const sel = selectClub(P, 'sand', 200);
    expect(sel.club.id).toBe('PW');
    expect(sel.effectiveDistance).toBeCloseTo(0.55 * DRIVER, 6);
    expect(sel.clamped).toBe(true);
  });

  it('uses a partial wedge below lob wedge carry', () => {
    const sel = selectClub(P, 'fairway', 60);
    expect(sel.club.id).toBe('WEDGE_PARTIAL');
    expect(sel.club.carry).toBe(60);
    expect(sel.effectiveDistance).toBe(60);
    expect(sel.clamped).toBe(false);
  });

  it('uses a partial wedge for short sand shots', () => {
    const sel = selectClub(P, 'sand', 20);
    expect(sel.club.id).toBe('WEDGE_PARTIAL');
    expect(sel.effectiveDistance).toBe(20);
  });
});
