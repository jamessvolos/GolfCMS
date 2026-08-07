// Ghost replay codec: a shot list packed into a short URL-safe hex string.
// 6 hex chars per shot — club (2 bits), power (2 bits), angle (16 bits).
// No backend anywhere: the URL *is* the ghost.

import { resolveShot, CLUBS } from './shots.js';

const CLUB_ORDER = ['driver', 'iron', 'wedge', 'putter'];
const TAU = Math.PI * 2;
const ANGLE_STEPS = 65536;

/**
 * Snap an angle onto the encodable 16-bit lattice. The UI aims with this,
 * so every shot a player actually takes encodes and decodes bit-exactly —
 * a ghost is guaranteed to reproduce the sharer's round, not approximate it.
 */
export function quantizeAngle(angle) {
  const norm = ((angle % TAU) + TAU) % TAU;
  const q = Math.min(ANGLE_STEPS - 1, Math.round((norm / TAU) * ANGLE_STEPS));
  return (q / ANGLE_STEPS) * TAU;
}

/** @param {Array<{club: string, angle: number, power: number}>} shots */
export function encodeReplay(shots) {
  let out = '';
  for (const s of shots) {
    const ci = CLUB_ORDER.indexOf(s.club);
    if (ci < 0) throw new Error(`unknown club: ${s.club}`);
    const power = Math.min(3, Math.max(1, s.power | 0));
    const norm = ((s.angle % TAU) + TAU) % TAU;
    const angleQ = Math.min(ANGLE_STEPS - 1, Math.round((norm / TAU) * ANGLE_STEPS));
    const value = (ci << 22) | ((power - 1) << 20) | angleQ;
    out += value.toString(16).padStart(6, '0');
  }
  return out;
}

/** @returns {Array<{club: string, angle: number, power: number}>} */
export function decodeReplay(str) {
  if (!/^([0-9a-f]{6})*$/i.test(str)) throw new Error('malformed replay string');
  const shots = [];
  for (let i = 0; i < str.length; i += 6) {
    const value = parseInt(str.slice(i, i + 6), 16);
    const ci = (value >> 22) & 3;
    const power = ((value >> 20) & 3) + 1;
    const angleQ = value & 0xffff;
    shots.push({
      club: CLUB_ORDER[ci],
      angle: (angleQ / ANGLE_STEPS) * TAU,
      power,
    });
  }
  return shots;
}

/**
 * Replay shots through the real engine from a start position, producing the
 * ghost's position after each stroke. Stops early (defensively) if a decoded
 * shot is illegal from its lie — the ghost simply ends there.
 * @returns {{positions: Array<{x:number,y:number}>, holed: boolean, strokes: number}}
 */
export function ghostPath(course, start, shots) {
  const positions = [{ ...start }];
  let pos = { ...start };
  let cost = 0;
  let holed = false;
  for (const shot of shots) {
    let r;
    try {
      r = resolveShot(course, pos, shot, cost);
    } catch {
      break;
    }
    cost += 1 + r.penalty;
    pos = r.ball;
    positions.push({ ...pos });
    if (r.holed) {
      holed = true;
      break;
    }
  }
  return { positions, holed, strokes: cost };
}
