// Caddie round records: the ghost-replay format for the decision game.
// A record is nothing but seeds, a handicap id, and the aim targets the
// player committed — never points. verifyCaddieRound() regenerates every
// hole from the round seed and replays each decision through the same
// scoring engine the client used, so the total is recomputed, not trusted:
// a forged score would have to be a sequence of targets that actually earns
// it, which is just... playing well.

import { substream, pickWeighted, randInt } from './rng.js';
import { generateCourse } from './generate.js';
import { cellAt } from './course.js';
import { GREEN } from './terrain.js';
import { HOLE_LENGTHS } from './yards.js';
import {
  HANDICAPS, handicapById, lieParamsAt, sampleLanding, samplePuttRoll,
  puttHolesOut, restingCell,
} from './dispersion.js';
import { strokesField, scoreDecision, scorePuttDecision } from './strategy.js';

export const MAX_RECORD_HOLES = 18;
const MAX_HOLE_DECISIONS = 32; // caddie.js caps at 8 swings + 4 putt loops; 32 is generous
const COORD_LIMIT = 100; // courses are 40x24 tiles; anything wilder is garbage
const SWING_CAP = 8; // mirror caddie.js: eight full-swing decisions and the hole is abandoned
const PUTT_CAP = 4; // mirror caddie.js mercy rule: four putt decisions, then concede the tap-in

// --- hole derivation ---------------------------------------------------------
// The UI (caddie.js loadHole) and the verifier both call THESE two helpers,
// so the seed→hole mapping can never drift between client and server.

/** Hole seed `index` of a caddie round: one shared substream, drawn in order. */
export function caddieHoleSeed(roundSeed, index) {
  const rng = substream(roundSeed >>> 0, 'caddieround');
  let s = 0;
  for (let k = 0; k <= index; k++) s = Math.floor(rng() * 0xffffffff) >>> 0;
  return s;
}

/** The course a caddie hole seed generates — length band, biome and all. */
export function caddieHoleCourse(holeSeed) {
  const lenRng = substream(holeSeed, 'yardage');
  const band = pickWeighted(lenRng, HOLE_LENGTHS.map((b) => [b, b.weight]));
  const biome = lenRng() < 0.28 ? 'links' : 'classic';
  return generateCourse(holeSeed, biome, { holeDistTiles: randInt(lenRng, band.min, band.max) });
}

// --- codec -------------------------------------------------------------------

function normPoint(p, what) {
  if (typeof p !== 'object' || p === null) throw new Error(`${what} must be a point`);
  const x = Number(p.x);
  const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > COORD_LIMIT || Math.abs(y) > COORD_LIMIT) {
    throw new Error(`${what} coordinates out of range`);
  }
  return { x, y };
}

/** Validate a round record and rebuild it with only the known fields, in a
 *  fixed key order — anything else (client-claimed points included) is shed. */
export function normalizeCaddieRound(record) {
  if (typeof record !== 'object' || record === null) throw new Error('record must be an object');
  const { roundSeed, count, hcp } = record;
  if (!Number.isInteger(roundSeed) || roundSeed < 0 || roundSeed > 0xffffffff) {
    throw new Error('roundSeed must be a uint32');
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_RECORD_HOLES) {
    throw new Error(`count must be an integer in 1..${MAX_RECORD_HOLES}`);
  }
  if (!HANDICAPS.some((h) => h.id === hcp)) {
    throw new Error('hcp must be a known handicap id');
  }
  if (!Array.isArray(record.holes) || record.holes.length !== count) {
    throw new Error('holes must be an array of length count');
  }
  const holes = record.holes.map((h, i) => {
    if (typeof h !== 'object' || h === null) throw new Error(`hole ${i + 1} must be an object`);
    if (!Number.isInteger(h.holeSeed) || h.holeSeed < 0 || h.holeSeed > 0xffffffff) {
      throw new Error(`hole ${i + 1}: holeSeed must be a uint32`);
    }
    for (const k of ['decisions', 'puttDecisions']) {
      if (!Array.isArray(h[k]) || h[k].length > MAX_HOLE_DECISIONS) {
        throw new Error(`hole ${i + 1}: ${k} must be an array of at most ${MAX_HOLE_DECISIONS}`);
      }
    }
    return {
      holeSeed: h.holeSeed,
      decisions: h.decisions.map((p) => normPoint(p, `hole ${i + 1} decision`)),
      puttDecisions: h.puttDecisions.map((p) => normPoint(p, `hole ${i + 1} putt decision`)),
    };
  });
  return { roundSeed, count, hcp, holes };
}

function toBase64url(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Round record → deterministic base64url string (normalized JSON inside). */
export function encodeCaddieRound(record) {
  return toBase64url(JSON.stringify(normalizeCaddieRound(record)));
}

/** base64url string → validated round record. Throws on anything malformed. */
export function decodeCaddieRound(str) {
  if (typeof str !== 'string' || str.length === 0 || str.length > 64 * 1024) {
    throw new Error('record must be a non-empty base64url string');
  }
  let obj;
  try {
    obj = JSON.parse(fromBase64url(str));
  } catch {
    throw new Error('record does not decode');
  }
  return normalizeCaddieRound(obj);
}

// --- verification ------------------------------------------------------------

/**
 * Replay one hole's recorded targets through the live engine, mirroring the
 * caddie.js commit/advance loop exactly: swings while off the green, putt
 * decisions on it, seeded samples deciding where each ball actually finishes
 * (stroke index included, so penalties reshuffle nothing they shouldn't).
 */
function replayHole(course, V, profile, holeRec, holeIndex) {
  const fail = (msg) => {
    throw new Error(`hole ${holeIndex + 1}: ${msg}`);
  };
  let ball = { ...course.tee };
  let puttPos = null;
  let strokes = 0;
  let putting = false;
  let puttCount = 0;
  let holedOut = false;
  let di = 0;
  let pi = 0;
  const scores = [];
  for (let guard = 0; guard < 64; guard++) {
    if (holedOut) break;
    if (putting && puttCount >= PUTT_CAP) {
      strokes += 1; // mercy rule: concede the tap-in
      holedOut = true;
      break;
    }
    if (cellAt(course, ball.x, ball.y) === GREEN) {
      putting = true;
      puttPos = puttPos ?? { x: ball.x, y: ball.y };
    } else if (putting) {
      putting = false; // the putt rolled off the green: back to a real swing
      puttPos = null;
    }
    if (!putting && scores.filter((s) => !s.putt).length >= SWING_CAP) break;
    if (putting) {
      if (pi >= holeRec.puttDecisions.length) fail('record ends mid-hole (putts)');
      const target = holeRec.puttDecisions[pi++];
      const from = { x: puttPos.x, y: puttPos.y };
      const score = scorePuttDecision(course, V, from, target, profile);
      const roll = samplePuttRoll(course, from, target, strokes, profile);
      const holed = puttHolesOut(from, roll, course.hole);
      strokes += 1;
      puttCount += 1;
      score.putt = true;
      scores.push(score);
      if (holed) {
        holedOut = true;
        puttPos = { x: course.hole.x, y: course.hole.y };
        ball = { ...course.hole };
      } else {
        const rest = restingCell(course, roll.x, roll.y);
        if (rest.kind === 'rest') {
          puttPos = { x: roll.x, y: roll.y };
          ball = { x: rest.x, y: rest.y };
        } else {
          strokes += 1; // raced into a pond: penalty, replay from the same spot
        }
      }
    } else {
      if (di >= holeRec.decisions.length) fail('record ends mid-hole (swings)');
      const target = holeRec.decisions[di++];
      const from = { ...ball };
      const lie = lieParamsAt(course, from.x, from.y);
      const score = scoreDecision(course, V, from, target, profile);
      const land = sampleLanding(course, from, target, lie.sigmaScale, strokes, profile);
      const rest = restingCell(course, land.x, land.y);
      strokes += 1;
      scores.push(score);
      if (rest.kind === 'rest') ball = { x: rest.x, y: rest.y };
      else strokes += 1; // splash / OB: penalty, replay from the same spot
    }
  }
  if (di !== holeRec.decisions.length || pi !== holeRec.puttDecisions.length) {
    fail('record carries decisions the hole never used');
  }
  const points = Math.round(scores.reduce((s, x) => s + x.points, 0) / Math.max(1, scores.length));
  return { points, strokes, holed: holedOut };
}

/**
 * Verify a caddie round record by full replay. Accepts the encoded string or
 * the decoded record object. Every hole is regenerated from the ROUND seed
 * (the recorded holeSeeds must match — no cherry-picked easy holes), every
 * decision re-scored by the engine. Client-claimed points are never read.
 * @returns {{totalPoints: number, holes: Array<{points, strokes, holed}>}}
 */
export function verifyCaddieRound(record) {
  const rec = typeof record === 'string' ? decodeCaddieRound(record) : normalizeCaddieRound(record);
  const profile = handicapById(rec.hcp);
  let totalPoints = 0;
  const holes = [];
  for (let i = 0; i < rec.count; i++) {
    const expected = caddieHoleSeed(rec.roundSeed, i);
    if (rec.holes[i].holeSeed !== expected) {
      throw new Error(`hole ${i + 1}: holeSeed does not derive from roundSeed`);
    }
    const course = caddieHoleCourse(expected);
    const V = strokesField(course, 6, profile);
    const h = replayHole(course, V, profile, rec.holes[i], i);
    totalPoints += h.points;
    holes.push(h);
  }
  return { totalPoints, holes };
}
