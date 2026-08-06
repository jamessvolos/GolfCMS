/**
 * The pin sheet: one green, many puzzles.
 *
 * `evaluate.ts` values a landing point by `strokesToHoleOut(pinDist, lie)`.
 * It is blind to where the *ball* is — that is the constraint the engine
 * README documents and Wave 1 worked around rather than removed. But it is
 * fully sensitive to where the *pin* is, because `pinDist` is its input.
 * That asymmetry is the one genuine loophole in the model, and it is where
 * the content comes from: the same hole with the flag moved is a different
 * decision, computed by machinery that already exists, from geometry
 * already committed, with no new content and no new physics.
 *
 * It is also how golf actually works. A course does not become easy because
 * you played it yesterday; the pin sheet changes and so does every approach.
 *
 * Pins are drawn deterministically from `(holeId, seed)`, so a puzzle id
 * reproduces byte-for-byte across processes and a mined library can be
 * regenerated rather than stored.
 */

import { classifyPoint } from '@/lib/engine/hole';
import { createRng } from '@/lib/engine/rng';
import { dist } from '@/lib/engine/projection';
import type { PreparedHole, Pt } from '@/lib/engine/types';

/**
 * A pin closer than this to the edge of the green is not a pin, it is a
 * mistake — greenkeepers leave a collar, and a flag cut on it makes the
 * optimal aim degenerate (any miss is off the green, so the model just says
 * "aim at the middle" with no information in it).
 */
export const PIN_COLLAR_YDS = 4;

/** Rays used to test clearance from the collar, in the local frame. */
const CLEARANCE_RAYS = 8;

/** Give up rather than emit a pin that fails clearance. */
const MAX_DRAWS_PER_PIN = 400;

export type PinZone =
  | 'front-left' | 'front' | 'front-right'
  | 'left' | 'middle' | 'right'
  | 'back-left' | 'back' | 'back-right';

export interface Pin {
  /** Local yards. */
  at: Pt;
  /** Named from the player's point of view, standing on the tee. */
  zone: PinZone;
  /** Yards from the nearest point of the collar, floor of PIN_COLLAR_YDS. */
  clearance: number;
}

/**
 * Every point within `PIN_COLLAR_YDS` in eight directions is still green.
 * Cheap, and it is the property that actually matters — a flag with room
 * around it — rather than a true distance-to-boundary computation.
 */
function clearsCollar(prepared: PreparedHole, at: Pt, collar: number): boolean {
  for (let i = 0; i < CLEARANCE_RAYS; i++) {
    const a = (2 * Math.PI * i) / CLEARANCE_RAYS;
    const probe = { x: at.x + collar * Math.cos(a), y: at.y + collar * Math.sin(a) };
    if (classifyPoint(prepared, probe) !== 'green') return false;
  }
  return true;
}

/**
 * Name the position the way a pin sheet does: front/middle/back along the
 * line the player is playing down, left/right across it. The reference
 * direction is tee → green centre, so "back-right" means what it means to
 * someone standing on the tee, not what it means on a north-up map.
 */
export function pinZone(green: { centre: Pt; along: Pt; across: Pt; depth: number; width: number }, at: Pt): PinZone {
  const dx = at.x - green.centre.x;
  const dy = at.y - green.centre.y;
  const long = dx * green.along.x + dy * green.along.y;
  const lat = dx * green.across.x + dy * green.across.y;
  // A third of the span either side is "middle"; the greens in the shipped
  // library run 20-40y deep, so this is 7-13y bands rather than hairlines.
  const depthBand = green.depth / 6;
  const widthBand = green.width / 6;
  const front = long < -depthBand ? 'front' : long > depthBand ? 'back' : '';
  const side = lat < -widthBand ? 'left' : lat > widthBand ? 'right' : '';
  if (front && side) return `${front}-${side}` as PinZone;
  if (front) return front as PinZone;
  if (side) return side as PinZone;
  return 'middle';
}

interface GreenFrame {
  polygon: PreparedHole['polygons'][number];
  centre: Pt;
  along: Pt;
  across: Pt;
  depth: number;
  width: number;
}

/**
 * The green, and the frame the player sees it in. Returns null when a hole
 * has no green polygon — which the content audit already refuses, but the
 * miner will meet on badly mapped OSM courses and must survive.
 */
export function greenFrame(prepared: PreparedHole): GreenFrame | null {
  const polygon = prepared.polygons.find((p) => p.kind === 'green');
  if (!polygon) return null;
  const ring = polygon.rings[0];
  if (!ring || ring.length < 3) return null;

  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p.x;
    sy += p.y;
  }
  const centre = { x: sx / ring.length, y: sy / ring.length };

  // Playing direction: from the tee toward the green. A hole with no tee
  // falls back to the hole's stored pin, which is always downrange of it.
  const from = prepared.tees[0] ?? prepared.pin;
  const d = Math.max(1e-6, dist(from, centre));
  const along = { x: (centre.x - from.x) / d, y: (centre.y - from.y) / d };
  const across = { x: along.y, y: -along.x };

  let minLong = Infinity;
  let maxLong = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of ring) {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    const l = dx * along.x + dy * along.y;
    const t = dx * across.x + dy * across.y;
    minLong = Math.min(minLong, l);
    maxLong = Math.max(maxLong, l);
    minLat = Math.min(minLat, t);
    maxLat = Math.max(maxLat, t);
  }
  return {
    polygon,
    centre,
    along,
    across,
    depth: maxLong - minLong,
    width: maxLat - minLat,
  };
}

export interface PinSheetOptions {
  /** How many pins to draw. Fewer are returned if the green is small. */
  count?: number;
  collarYds?: number;
}

/**
 * Draw a reproducible set of pin positions for one green.
 *
 * Rejection sampling inside the green's bounding box in the player's frame,
 * keeping only points that classify as green and clear the collar on eight
 * rays. Draws are spread across zones rather than uniform: a sheet of six
 * pins that all land in the middle is six copies of the same puzzle.
 */
export function pinSheet(
  prepared: PreparedHole,
  seed: number,
  opts: PinSheetOptions = {},
): Pin[] {
  const green = greenFrame(prepared);
  if (!green) return [];
  const collar = opts.collarYds ?? PIN_COLLAR_YDS;
  const count = opts.count ?? 6;

  const ring = green.polygon.rings[0]!;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const rng = createRng(seed);
  const pins: Pin[] = [];
  const zonesUsed = new Set<PinZone>();

  // Two passes: the first insists on an unused zone so the sheet spreads,
  // the second fills whatever is left when the green is too small to offer
  // nine distinct ones.
  for (const insistOnNewZone of [true, false]) {
    for (let attempt = 0; attempt < MAX_DRAWS_PER_PIN && pins.length < count; attempt++) {
      const at = {
        x: minX + rng() * (maxX - minX),
        y: minY + rng() * (maxY - minY),
      };
      if (classifyPoint(prepared, at) !== 'green') continue;
      if (!clearsCollar(prepared, at, collar)) continue;
      const zone = pinZone(green, at);
      if (insistOnNewZone && zonesUsed.has(zone)) continue;
      // Two flags six yards apart are one flag; the player cannot tell the
      // difference and the engine barely can.
      if (pins.some((p) => dist(p.at, at) < collar * 1.5)) continue;
      zonesUsed.add(zone);
      pins.push({ at, zone, clearance: collar });
    }
  }
  return pins;
}
