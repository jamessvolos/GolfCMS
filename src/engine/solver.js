// The robot golfer. Plays the real engine over a discretized shot lattice
// (club x bearing x power) with Dijkstra, so its winning line is literally a
// replayable shot list — solvability proof and computed par in one pass.

import { resolveShot, lieRules } from './shots.js';
import { cellAt } from './course.js';

const BEARINGS = 24; // evenly spaced aim angles, plus the exact line to the hole

/**
 * @param {import('./course.js').Course} course
 * @param {{x: number, y: number}} start
 * @param {number} [maxStrokes]
 * @returns {{strokes: number, line: Array<{club: string, angle: number, power: number}>} | null}
 */
export function solve(course, start, maxStrokes = 12) {
  // Buckets by stroke cost: cost-ordered expansion without a priority queue.
  // Scatter depends on the stroke index, so edges are expanded at the exact
  // cost they would occur at in a real game — lines found here replay exactly.
  const buckets = Array.from({ length: maxStrokes + 1 }, () => []);
  buckets[0].push({ pos: start, line: [] });
  const best = new Map([[key(start), 0]]);

  for (let cost = 0; cost < maxStrokes; cost++) {
    for (const state of buckets[cost]) {
      if ((best.get(key(state.pos)) ?? Infinity) < cost) continue;
      const lie = cellAt(course, state.pos.x, state.pos.y);
      const rules = lieRules(lie);
      for (const clubName of rules.allowed) {
        for (const angle of anglesFor(state.pos, course.hole)) {
          for (let power = 1; power <= 3; power++) {
            const shot = { club: clubName, angle, power };
            let r;
            try {
              r = resolveShot(course, state.pos, shot, cost);
            } catch {
              continue;
            }
            const nextCost = cost + 1 + r.penalty;
            if (r.holed) {
              return { strokes: nextCost, line: [...state.line, shot] };
            }
            if (nextCost >= maxStrokes) continue;
            const k = key(r.ball);
            if ((best.get(k) ?? Infinity) <= nextCost) continue;
            best.set(k, nextCost);
            buckets[nextCost].push({ pos: r.ball, line: [...state.line, shot] });
          }
        }
      }
    }
  }
  return null;
}

function key(p) {
  return p.x * 100 + p.y;
}

function anglesFor(pos, hole) {
  const angles = [Math.atan2(hole.y - pos.y, hole.x - pos.x)];
  for (let i = 0; i < BEARINGS; i++) {
    angles.push((i / BEARINGS) * Math.PI * 2);
  }
  return angles;
}

/** Replay a solver line through the real engine; true if it holes out. */
export function verifyLine(course, start, line) {
  let pos = { ...start };
  let cost = 0;
  for (const shot of line) {
    let r;
    try {
      r = resolveShot(course, pos, shot, cost);
    } catch {
      return false;
    }
    cost += 1 + r.penalty;
    pos = r.ball;
    if (r.holed) return true;
  }
  return false;
}
