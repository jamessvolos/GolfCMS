/**
 * Milestone 2 progress persistence: a single local player rating in
 * localStorage. Real profiles land in Milestone 3, Elo/XP/streaks in
 * Milestone 5 — this is deliberately the smallest thing that lets the
 * reveal show a live Elo delta.
 */

import { ELO_INITIAL_PLAYER } from '@/lib/engine/constants';

const KEY = 'sg-trainer.rating';

export function getRating(): number {
  if (typeof window === 'undefined') return ELO_INITIAL_PLAYER;
  const raw = window.localStorage.getItem(KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : ELO_INITIAL_PLAYER;
}

export function setRating(rating: number): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, String(Math.round(rating)));
}
