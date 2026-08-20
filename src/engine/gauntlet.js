// The weekly gauntlet: five certified holes per ISO week, escalating from a
// gentle classic opener to a rude links closer in the wind. Everyone in the
// world gets the same gauntlet all week.

import { makePuzzle } from './puzzle.js';

export const GAUNTLET_LADDER = [
  { difficulty: 'easy', biome: 'classic' },
  { difficulty: 'standard', biome: 'classic' },
  { difficulty: 'standard', biome: 'winter' },
  { difficulty: 'rude', biome: 'alpine' },
  { difficulty: 'rude', biome: 'links' },
];

/** ISO-8601 week label, e.g. 2026-W32. */
export function weekKey(date = null) {
  const d = date ? new Date(date + 'T00:00:00Z') : new Date();
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  day.setUTCDate(day.getUTCDate() + 4 - dow); // shift to the week's Thursday
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Deterministic 32-bit seed from the week label. */
export function gauntletSeed(week) {
  let h = 0x811c9dc5;
  for (let i = 0; i < week.length; i++) {
    h = Math.imul(h ^ week.charCodeAt(i), 16777619) >>> 0;
  }
  return h;
}

/**
 * @param {string | null} [date] ISO date inside the wanted week (default: today)
 * @returns {{week: string, seed: number, holes: import('./puzzle.js').Puzzle[], totalPar: number, label: string}}
 */
export function makeGauntlet(date = null) {
  const week = weekKey(date);
  const base = gauntletSeed(week);
  const holes = GAUNTLET_LADDER.map((rung, i) =>
    makePuzzle((base + i * 7919) >>> 0, rung.difficulty, rung.biome)
  );
  return {
    week,
    seed: base,
    holes,
    totalPar: holes.reduce((s, h) => s + h.par, 0),
    label: `Gauntlet ${week}`,
  };
}
