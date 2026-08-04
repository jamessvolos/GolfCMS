/**
 * The only module allowed to emit digits.
 *
 * The governing split: numbers we CHOOSE are exact, numbers we MEASURE
 * are rounded to their honest precision. A recommended offset is a probe
 * we actually evaluated, so "12 yards" is literally the aim that produced
 * that percentage. A measured distance rounds — "aim 18 yards right" at
 * driver range is a fiction; "20 yards" is an instruction.
 */

import type { Formatted } from './types';

const brand = (s: string) => s as Formatted;

/** Base floors at n = 600; scaled by sqrt(600/n) for other sample counts. */
export const BASE_FLOORS = {
  anchor: 0.08,
  print: 0.05,
  ceiling: 0.95,
  delta: 0.05,
  strokes: 0.03,
  yards: 3,
} as const;

export interface Floors {
  anchor: number;
  print: number;
  ceiling: number;
  delta: number;
  strokes: number;
  yards: number;
}

export function floorsFor(nSamples: number): Floors {
  const k = Math.sqrt(600 / Math.max(1, nSamples));
  return {
    anchor: BASE_FLOORS.anchor * k,
    print: BASE_FLOORS.print * k,
    ceiling: 1 - (1 - BASE_FLOORS.ceiling) * k,
    delta: BASE_FLOORS.delta * k,
    strokes: BASE_FLOORS.strokes,
    yards: BASE_FLOORS.yards,
  };
}

/**
 * A share as an integer percentage. Above the ceiling it refuses a bare
 * number — 600 samples never justifies "100%".
 */
export function pct(fraction: number, floors: Floors = floorsFor(600)): Formatted {
  if (fraction >= floors.ceiling) return brand('more than 95%');
  return brand(`${Math.round(fraction * 100)}%`);
}

/**
 * Largest-remainder rounding, so a set of shares printed together sums to
 * exactly 100 — independent rounding can produce 101, and that is the one
 * arithmetic error a reader catches unaided.
 */
export function pctSet(fractions: number[]): Formatted[] {
  const scaled = fractions.map((f) => f * 100);
  const floors = scaled.map(Math.floor);
  let remainder = 100 - floors.reduce((s, v) => s + v, 0);
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] = out[i]! + 1;
    remainder -= 1;
  }
  return out.map((v) => brand(`${v}%`));
}

/** Strokes: 2dp, leading zero, never a minus — the verb carries direction. */
export function strokes(v: number): Formatted {
  return brand(Math.abs(v).toFixed(2));
}

/** A chosen offset: exact, because it is the probe we evaluated. */
export function yardsExact(v: number): Formatted {
  return brand(`${Math.round(Math.abs(v))} yards`);
}

/** A measured distance: rounded to its honest precision. */
export function yardsMeasured(v: number): Formatted {
  const a = Math.abs(v);
  const r = a < 30 ? Math.round(a) : a <= 100 ? Math.round(a / 5) * 5 : Math.round(a / 10) * 10;
  return brand(`${r} yards`);
}

/**
 * Feet, from on-green distances only. Never asserted past 60 — the putt
 * table's last anchor is 55ft and beyond it the model extrapolates.
 */
export function feet(yards: number): Formatted | null {
  const ft = yards * 3;
  if (ft > 60) return null;
  const r = ft < 10 ? Math.round(ft) : Math.round(ft / 5) * 5;
  return brand(`${r} feet`);
}

/** "a 7 iron" / "an 8 iron" / "a partial wedge". */
export function club(label: string): Formatted {
  const l = label.toLowerCase();
  const article = /^[aeiou8]/.test(l) ? 'an' : 'a';
  return brand(`${article} ${l}`);
}

/** Plural of a club for pattern talk: "your 7 irons", "your drivers". */
export function clubPlural(label: string): Formatted {
  const l = label.toLowerCase();
  return brand(l.endsWith('s') ? l : `${l}s`);
}

export type Dir = 'left' | 'right' | 'short' | 'long';

export function lateralDir(lat: number): Dir {
  return lat >= 0 ? 'right' : 'left';
}

export function opposite(dir: Dir): Dir {
  return dir === 'left' ? 'right' : dir === 'right' ? 'left' : dir === 'short' ? 'long' : 'short';
}

/** Words that may never appear in a template. Asserted by test. */
export const BANNED_LEXICON = [
  'great',
  'nice',
  'well done',
  'unlucky',
  'obviously',
  'simply',
  'just ',
  'remember',
  'you should have',
  'might',
  'could',
  'tends to',
  'chance',
  'risk of',
  '!',
];
