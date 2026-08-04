/**
 * Naming a hazard. Total by construction: four levels, explicit
 * precedence, always returns something a player recognises.
 *
 * Position comes from the HIT LOCUS — the mean of the samples that
 * actually finished in that polygon — never the polygon centroid. A lake
 * running the length of a hole has a centroid nowhere near where your
 * ball went in.
 */

import type { FeatureHit, Pt } from '@/lib/engine/types';

const KIND_NOUN: Record<string, string> = {
  water: 'the water',
  ob: 'out of bounds',
  bunker: 'the sand',
  recovery: 'the trees',
  fairway: 'the fairway',
  green: 'the green',
};

const KIND_PLURAL: Record<string, string> = {
  water: 'the water',
  ob: 'out of bounds',
  bunker: 'the bunkers',
  recovery: 'the trees',
  fairway: 'the fairway',
  green: 'the green',
};

/**
 * Directional words already carried by the sentence's own geometry — an
 * authored name like "front-right bunker" would double up with the
 * position we compute, so they are stripped and re-derived.
 */
const DIRECTIONAL = /\b(front|back|left|right|near|far|short|long|greenside|fairway|upper|lower|north|south|east|west)\b[- ]?/gi;

/** True when a name reads as a proper noun worth keeping verbatim. */
function isProperName(name: string): boolean {
  const stripped = name.replace(DIRECTIONAL, '').trim();
  if (stripped.length < 3) return false;
  // "Road bunker", "the lake" → keep "Road bunker"; "left greenside" → drop.
  return /[A-Z]/.test(name.replace(/^(the|a)\s+/i, '')) || stripped.split(/\s+/).length > 1;
}

export interface LabelContext {
  /** Ball position, local yards. */
  ball: Pt;
  /** Pin position, local yards. */
  pin: Pt;
}

/**
 * Position of a hit locus relative to the ball→pin line, as a phrase.
 * Returns null when the locus is too close to the line to call.
 */
function positionPhrase(locus: Pt, ctx: LabelContext): string | null {
  const dx = ctx.pin.x - ctx.ball.x;
  const dy = ctx.pin.y - ctx.ball.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const rx = locus.x - ctx.ball.x;
  const ry = locus.y - ctx.ball.y;
  const lat = rx * uy - ry * ux;
  const along = rx * ux + ry * uy;

  const side = Math.abs(lat) < 8 ? null : lat > 0 ? 'right' : 'left';
  const depth = along > d + 8 ? 'long' : along < d - 25 ? 'short' : null;

  if (side && depth) return `${depth} ${side}`;
  if (side) return `${side}`;
  if (depth) return depth;
  return null;
}

/**
 * Name one hazard. Precedence:
 *  1. A proper authored name ("Road bunker", "lake") — verbatim.
 *  2. Kind + computed position ("the sand short right").
 *  3. Bare kind ("the water").
 *  4. "trouble" — unreachable in practice, present so the function is total.
 */
export function labelFeature(hit: FeatureHit, ctx: LabelContext): string {
  if (hit.name && isProperName(hit.name)) {
    const n = hit.name.trim();
    return /^(the|out)\b/i.test(n) ? n : `the ${n.toLowerCase()}`;
  }
  const noun = KIND_NOUN[hit.kind];
  if (!noun) return 'trouble';
  const pos = positionPhrase(hit.locus, ctx);
  if (hit.kind === 'ob') return noun;
  return pos ? `${noun} ${pos}` : noun;
}

/** Plural form for an aggregate claim over several same-kind features. */
export function labelKindPlural(kind: string): string {
  return KIND_PLURAL[kind] ?? 'trouble';
}

export function lieNoun(lie: string): string {
  switch (lie) {
    case 'sand':
      return 'sand';
    case 'rough':
      return 'the rough';
    case 'recovery':
      return 'the trees';
    case 'tee':
      return 'the tee';
    default:
      return 'the fairway';
  }
}
