// Shot resolution: club + aim angle + power notch, resolved against terrain.
// Deterministic by construction — scatter comes from a seeded substream keyed
// by stroke number, so the same shot on the same seed always lands the same way.

import { substream, randInt } from './rng.js';
import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, isRestable } from './terrain.js';
import { inBounds, cellAt } from './course.js';

/**
 * @typedef {{
 *   name: string,
 *   ranges: [number, number, number],  // range in tiles per power notch 1..3
 *   scatter: number,                   // max perpendicular deviation in tiles
 *   flight: 'high' | 'low' | 'ground'  // high clears trees; low is blocked; ground rolls
 * }} Club
 */

/** @type {Record<string, Club>} */
export const CLUBS = {
  driver: { name: 'driver', ranges: [10, 12, 14], scatter: 2, flight: 'high' },
  iron: { name: 'iron', ranges: [6, 8, 9], scatter: 1, flight: 'low' },
  wedge: { name: 'wedge', ranges: [2, 3, 4], scatter: 1, flight: 'high' },
  putter: { name: 'putter', ranges: [2, 3, 5], scatter: 0, flight: 'ground' },
};

/** Clubs allowed and effective range from a given lie. */
export function lieRules(lieTerrain) {
  if (lieTerrain === SAND) {
    return { allowed: ['wedge', 'putter'], rangeScale: 0.5 };
  }
  if (lieTerrain === ROUGH) {
    return { allowed: ['driver', 'iron', 'wedge', 'putter'], rangeScale: 0.75 };
  }
  return { allowed: ['driver', 'iron', 'wedge', 'putter'], rangeScale: 1 };
}

/**
 * Resolve one shot. Pure: returns a result, never mutates inputs.
 * @param {import('./course.js').Course} course
 * @param {{x: number, y: number}} ball
 * @param {{club: string, angle: number, power: number}} shot  power is 1..3
 * @param {number} strokeIndex  0-based stroke number, keys the scatter stream
 * @returns {{ball: {x: number, y: number}, penalty: number, holed: boolean, event: string}}
 */
export function resolveShot(course, ball, shot, strokeIndex) {
  const club = CLUBS[shot.club];
  if (!club) throw new Error(`unknown club: ${shot.club}`);
  const power = Math.min(3, Math.max(1, shot.power | 0));

  const lie = cellAt(course, ball.x, ball.y);
  const rules = lieRules(lie);
  if (!rules.allowed.includes(club.name)) {
    throw new Error(`${club.name} not allowed from ${lie === SAND ? 'sand' : 'this lie'}`);
  }

  const range = Math.max(1, Math.round(club.ranges[power - 1] * rules.rangeScale));
  const dx = Math.cos(shot.angle);
  const dy = Math.sin(shot.angle);

  if (club.flight === 'ground') {
    return rollBall(course, ball, dx, dy, range);
  }
  return flyBall(course, ball, dx, dy, range, club, strokeIndex);
}

/** Putter: travel tile by tile; terrain en route matters; hole swallows the ball. */
function rollBall(course, ball, dx, dy, range) {
  let pos = { x: ball.x, y: ball.y };
  for (let step = 1; step <= range; step++) {
    const next = { x: Math.round(ball.x + dx * step), y: Math.round(ball.y + dy * step) };
    if (next.x === pos.x && next.y === pos.y) continue;
    if (!inBounds(course, next.x, next.y)) break;
    const t = cellAt(course, next.x, next.y);
    if (t === TREES) break;
    if (t === WATER) return { ball, penalty: 1, holed: false, event: 'water' };
    pos = next;
    if (pos.x === course.hole.x && pos.y === course.hole.y) {
      return { ball: pos, penalty: 0, holed: true, event: 'holed' };
    }
    if (t === ROUGH || t === SAND) break; // thick stuff kills the roll
  }
  return { ball: pos, penalty: 0, holed: false, event: 'rolled' };
}

/** Driver/iron/wedge: airborne to a landing tile, then a short roll. */
function flyBall(course, ball, dx, dy, range, club, strokeIndex) {
  // Deterministic scatter, perpendicular to the aim line.
  const rng = substream(course.seed, `scatter:${strokeIndex}`);
  const s = club.scatter === 0 ? 0 : randInt(rng, -club.scatter, club.scatter);
  let land = {
    x: Math.round(ball.x + dx * range - dy * s),
    y: Math.round(ball.y + dy * range + dx * s),
  };

  // Low flight is blocked by trees along the arc; the ball drops in front.
  if (club.flight === 'low') {
    const blocked = firstTreeOnPath(course, ball, land);
    if (blocked) land = blocked;
  }

  // Off the property: stroke-and-distance style — replay from the old lie.
  if (!inBounds(course, land.x, land.y)) {
    return { ball, penalty: 1, holed: false, event: 'out-of-bounds' };
  }

  let t = cellAt(course, land.x, land.y);
  if (t === WATER) return { ball, penalty: 1, holed: false, event: 'water' };
  if (t === TREES) {
    // Landing in canopy: drop back along the flight line to the last open tile.
    const open = lastRestableBefore(course, ball, land);
    if (!open) return { ball, penalty: 0, holed: false, event: 'trees' };
    land = open;
    t = cellAt(course, land.x, land.y);
  }

  if (land.x === course.hole.x && land.y === course.hole.y) {
    return { ball: land, penalty: 0, holed: true, event: 'holed' };
  }

  // Roll-out: wedges stop dead; otherwise fairway and green release forward.
  let roll = 0;
  if (club.name !== 'wedge' && (t === FAIRWAY || t === GREEN)) roll = 1;
  let pos = land;
  for (let r = 1; r <= roll; r++) {
    const next = { x: Math.round(land.x + dx * r), y: Math.round(land.y + dy * r) };
    if (!inBounds(course, next.x, next.y)) break;
    const nt = cellAt(course, next.x, next.y);
    if (!isRestable(nt) || nt === WATER) break;
    pos = next;
    if (pos.x === course.hole.x && pos.y === course.hole.y) {
      return { ball: pos, penalty: 0, holed: true, event: 'holed' };
    }
  }
  return { ball: pos, penalty: 0, holed: false, event: 'landed' };
}

function* pathTiles(from, to) {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 1; i <= steps; i++) {
    yield {
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
    };
  }
}

function firstTreeOnPath(course, from, to) {
  let prev = from;
  for (const p of pathTiles(from, to)) {
    if (inBounds(course, p.x, p.y) && cellAt(course, p.x, p.y) === TREES) {
      return prev.x === from.x && prev.y === from.y ? { ...from } : prev;
    }
    prev = p;
  }
  return null;
}

function lastRestableBefore(course, from, to) {
  let best = null;
  for (const p of pathTiles(from, to)) {
    if (p.x === to.x && p.y === to.y) break;
    if (inBounds(course, p.x, p.y) && isRestable(cellAt(course, p.x, p.y))) best = p;
  }
  return best;
}
