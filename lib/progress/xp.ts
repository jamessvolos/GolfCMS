/**
 * XP, levels, and streaks. Progression rewards the decision, not the
 * outcome: XP comes from the band you earned, with a small bonus for
 * beating a puzzle rated above you, so grinding easy puzzles plateaus.
 */

import type { ScoreBandResult } from '@/lib/engine/types';

export type Band = ScoreBandResult['band'];

/** XP awarded per band. */
export const XP_BY_BAND: Record<Band, number> = {
  perfect: 100,
  good: 60,
  okay: 25,
  miss: 10,
};

/**
 * Bonus for solving above your rating: +1 XP per 10 rating points the
 * puzzle exceeds the player, capped. Only for Good or better — you don't
 * get credit for missing a hard puzzle.
 */
export const UPSET_BONUS_MAX = 50;
export const UPSET_BONUS_PER_POINT = 0.1;

/** Levels every 500 XP; level 1 starts at 0. */
export const XP_PER_LEVEL = 500;

export function xpForAttempt(
  band: Band,
  playerRating: number,
  puzzleRating: number,
): number {
  const base = XP_BY_BAND[band];
  if (band === 'miss' || band === 'okay') return base;
  const gap = puzzleRating - playerRating;
  if (gap <= 0) return base;
  return base + Math.min(UPSET_BONUS_MAX, Math.round(gap * UPSET_BONUS_PER_POINT));
}

export interface LevelInfo {
  level: number;
  /** XP earned inside the current level. */
  intoLevel: number;
  /** XP needed to finish the current level. */
  levelSpan: number;
  /** 0..1 progress through the current level. */
  progress: number;
  xpToNext: number;
}

export function levelInfo(xp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(xp));
  const level = Math.floor(safeXp / XP_PER_LEVEL) + 1;
  const intoLevel = safeXp % XP_PER_LEVEL;
  return {
    level,
    intoLevel,
    levelSpan: XP_PER_LEVEL,
    progress: intoLevel / XP_PER_LEVEL,
    xpToNext: XP_PER_LEVEL - intoLevel,
  };
}

/** Local calendar day as YYYY-MM-DD, the unit a daily streak counts in. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface StreakUpdate {
  streak: number;
  lastPlayedDay: string;
  /** True when this attempt extended the streak (first play of a new day). */
  extended: boolean;
}

/**
 * Daily streak: same day is a no-op, the next day extends, any longer gap
 * resets to 1. Playing at 23:59 and again at 00:01 counts as two days —
 * that is the honest reading of "daily", and it favours the player.
 */
export function advanceStreak(
  current: { streak: number; lastPlayedDay: string | null },
  now: Date,
): StreakUpdate {
  const today = dayKey(now);
  if (current.lastPlayedDay === today) {
    return { streak: Math.max(1, current.streak), lastPlayedDay: today, extended: false };
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const wasYesterday = current.lastPlayedDay === dayKey(yesterday);
  return {
    streak: wasYesterday ? current.streak + 1 : 1,
    lastPlayedDay: today,
    extended: true,
  };
}

/**
 * A streak's tally marks: groups of five, the fifth struck through the
 * previous four. Returns the group sizes so the view can draw them.
 */
export function tallyGroups(streak: number): number[] {
  const n = Math.max(0, Math.floor(streak));
  const groups: number[] = [];
  let left = n;
  while (left >= 5) {
    groups.push(5);
    left -= 5;
  }
  if (left > 0) groups.push(left);
  return groups;
}
