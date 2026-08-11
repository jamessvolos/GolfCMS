// Green architecture. These tests pin the four promises release C makes:
// the shapes are real and varied, the surface under them is real (a tier is
// feet, not a label), every green is certified before it ships, and nothing
// outside the green complex moved on any already-shared seed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GREEN_ARCHETYPES, HAZARD_ROLES, SIZE_CLASSES, MIN_GREEN_TILES, MAX_GREEN_TILES,
  PIN_MAX_GRADE, GREEN_MAX_GRADE, COMPLEX_R, pinFor, greenCellsOf, applyGreenComplex,
} from '../src/engine/greens.js';
import { generateCourse } from '../src/engine/generate.js';
import { makePuzzle } from '../src/engine/puzzle.js';
import { caddieHoleSeed, caddieHoleCourse } from '../src/engine/caddierec.js';
import { cellAt, inBounds } from '../src/engine/course.js';
import { FAIRWAY, ROUGH, SAND, WATER, GREEN, isRestable } from '../src/engine/terrain.js';
import { gradientAt, heightAt, FT_PER_TILE } from '../src/engine/relief.js';
import {
  samplePuttRoll, puttHolesOut, restingCell, DEFAULT_PROFILE, CUP_R,
} from '../src/engine/dispersion.js';

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const k = (x, y) => y * 1000 + x;

/** A point in the green's own frame: u along its axis, v across it. */
function localOf(green, x, y) {
  const dx = x - green.center.x;
  const dy = y - green.center.y;
  const c = Math.cos(green.theta);
  const s = Math.sin(green.theta);
  return { u: dx * c + dy * s, v: -dx * s + dy * c };
}

/** How far the green's own tiles reach from its centre along a bearing. */
function edgeAlong(course, theta) {
  const g = course.green;
  let last = 0.5;
  for (let d = 0.5; d <= 9; d += 0.25) {
    const x = Math.round(g.center.x + Math.cos(theta) * d);
    const y = Math.round(g.center.y + Math.sin(theta) * d);
    if (!inBounds(course, x, y)) break;
    if (cellAt(course, x, y) === GREEN) last = d;
  }
  return last;
}

/** The tiles THIS release turned into sand or water — measured against the
 *  pre-release-C course, so a layout blob near the green is never mistaken for
 *  a green-complex hazard. */
function hazardTilesAdded(course, legacy) {
  const out = [];
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      const i = y * course.width + x;
      const t = course.cells[i];
      if ((t === SAND || t === WATER) && legacy.cells[i] !== t) out.push({ x, y, t });
    }
  }
  return out;
}

function gradeAt(course, x, y) {
  const g = gradientAt(course.relief, x, y);
  return Math.hypot(g.dx, g.dy) / FT_PER_TILE;
}

function flood(course, from, ok, nb = N8) {
  const seen = new Set([k(from.x, from.y)]);
  const stack = [from];
  while (stack.length) {
    const p = stack.pop();
    for (const [dx, dy] of nb) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(course, x, y) || seen.has(k(x, y)) || !ok(x, y)) continue;
      seen.add(k(x, y));
      stack.push({ x, y });
    }
  }
  return seen;
}

/** FNV-1a over a cells array — the same one-number fingerprint relief.test uses. */
function layoutHash(cells) {
  let x = 2166136261 >>> 0;
  for (const c of cells) {
    x ^= c;
    x = Math.imul(x, 16777619) >>> 0;
  }
  return x;
}

// --- determinism -------------------------------------------------------------

test('the same seed grows the same green, to the last tile and the last foot', () => {
  for (const seed of [1, 42, 424242, 1837462913]) {
    const a = generateCourse(seed);
    const b = generateCourse(seed);
    assert.deepEqual(a.green, b.green, `seed ${seed}: identical plan`);
    assert.deepEqual(a.cells, b.cells, `seed ${seed}: identical tiles`);
    assert.deepEqual(Array.from(a.relief.ft), Array.from(b.relief.ft), `seed ${seed}: identical field`);
    assert.deepEqual(a.pin, b.pin, `seed ${seed}: identical pin`);
  }
  // and a different seed is a different green
  const one = generateCourse(9001);
  const two = generateCourse(9002);
  assert.notDeepEqual(one.green.cells, two.green.cells);
});

test('applying a complex twice from the same inputs is idempotent in its outputs', () => {
  const a = generateCourse(31337, 'classic', { legacyGreen: true });
  const b = generateCourse(31337, 'classic', { legacyGreen: true });
  const pa = applyGreenComplex(a, 31337);
  const pb = applyGreenComplex(b, 31337);
  assert.deepEqual(pa.cells, pb.cells);
  assert.deepEqual(a.cells, b.cells);
});

// --- variety -----------------------------------------------------------------

test('every archetype and every size class shows up, and the disc is gone', () => {
  const arch = new Map();
  const sizes = new Map();
  const areas = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const g = generateCourse(seed).green;
    arch.set(g.archetype, (arch.get(g.archetype) ?? 0) + 1);
    sizes.set(g.sizeClass, (sizes.get(g.sizeClass) ?? 0) + 1);
    areas.add(g.areaTiles);
  }
  for (const a of GREEN_ARCHETYPES) {
    assert.ok((arch.get(a) ?? 0) >= 5, `${a} appears (${arch.get(a) ?? 0}/400)`);
  }
  for (const s of SIZE_CLASSES) assert.ok((sizes.get(s) ?? 0) >= 5, `${s} greens appear`);
  // the old world was ONE area, on every hole, forever
  assert.ok(areas.size >= 15, `green areas actually vary (${areas.size} distinct)`);
  const round = arch.get('round') ?? 0;
  assert.ok(round < 200, `no single shape dominates (round ${round}/400)`);
});

test('hole length steers green size the way a golf course does', () => {
  let shortSmall = 0;
  let shortN = 0;
  let longLarge = 0;
  let longN = 0;
  for (let r = 0; r < 40; r++) {
    for (let i = 0; i < 9; i++) {
      const c = caddieHoleCourse(caddieHoleSeed(4242 + r, i));
      const tiles = Math.hypot(c.hole.x - c.tee.x, c.hole.y - c.tee.y);
      if (tiles < 15) { shortN++; if (c.green.sizeClass === 'small') shortSmall++; }
      if (tiles >= 25) { longN++; if (c.green.sizeClass === 'large') longLarge++; }
    }
  }
  assert.ok(shortN > 20 && longN > 20, 'the caddie deck has short and long holes');
  assert.ok(shortSmall / shortN > 0.3, `short holes get small greens (${shortSmall}/${shortN})`);
  assert.ok(longLarge / longN > 0.3, `long holes get big greens (${longLarge}/${longN})`);
});

test('a long-narrow green really is long and narrow, and set to the line of play', () => {
  let found = 0;
  let skewed = 0;
  for (let seed = 1; seed <= 400 && found < 40; seed++) {
    const c = generateCourse(seed);
    if (c.green.archetype !== 'long-narrow') continue;
    found++;
    assert.ok(c.green.a / c.green.b > 1.8, `seed ${seed}: aspect ${(c.green.a / c.green.b).toFixed(2)}`);
    const ap = Math.atan2(c.hole.y - c.tee.y, c.hole.x - c.tee.x);
    let d = (c.green.theta - ap) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 0.5) skewed++;
  }
  assert.ok(found >= 10, `long-narrow greens exist (${found})`);
  assert.ok(skewed >= 3, `some of them are set diagonally to the approach (${skewed}/${found})`);
});

// --- area bounds and shape sanity -------------------------------------------

test('no green is degenerate: area in bounds, one surface, cup on it, tee off it', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const c = generateCourse(seed);
    const g = c.green;
    const cells = greenCellsOf(c);
    assert.equal(cells.length, g.areaTiles, `seed ${seed}: the plan counts what the tiles say`);
    assert.ok(g.areaTiles >= MIN_GREEN_TILES, `seed ${seed}: ${g.areaTiles} >= ${MIN_GREEN_TILES}`);
    assert.ok(g.areaTiles <= MAX_GREEN_TILES, `seed ${seed}: ${g.areaTiles} <= ${MAX_GREEN_TILES}`);
    assert.equal(cellAt(c, c.hole.x, c.hole.y), GREEN, `seed ${seed}: cup on the green`);
    assert.equal(cellAt(c, c.tee.x, c.tee.y), FAIRWAY, `seed ${seed}: tee untouched`);
    // one putting surface, four-connected
    const surface = flood(c, c.hole, (x, y) => cellAt(c, x, y) === GREEN, N4);
    assert.equal(surface.size, g.areaTiles, `seed ${seed}: the green is one surface`);
  }
});

// --- certification -----------------------------------------------------------

test('every generated green certifies, and the certificate is honest', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const c = generateCourse(seed);
    const cert = c.green.certified;
    assert.ok(cert.ok, `seed ${seed}: certified (${cert.reasons.join('; ')})`);
    assert.equal(cert.area, c.green.areaTiles);
    assert.ok(cert.pinZones >= 1, `seed ${seed}: at least one legal pin zone`);
  }
});

test('a green is puttable: nothing on the surface is steeper than a ball will hold', () => {
  let steepest = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const c = generateCourse(seed);
    for (const p of greenCellsOf(c)) {
      const grade = gradeAt(c, p.x, p.y);
      steepest = Math.max(steepest, grade);
      assert.ok(grade <= GREEN_MAX_GRADE + 1e-6,
        `seed ${seed}: ${(grade * 100).toFixed(1)}% at ${p.x},${p.y}`);
    }
  }
  assert.ok(steepest > 0.05, `and some greens are genuinely severe (${(steepest * 100).toFixed(1)}%)`);
});

test('a ball on the green can hole out — through the real putt model', () => {
  // The engine's own roll and capture, from the far corner of each green.
  for (let seed = 1; seed <= 40; seed++) {
    const c = generateCourse(seed);
    const cells = greenCellsOf(c);
    let far = cells[0];
    let fd = -1;
    for (const p of cells) {
      const d = Math.hypot(p.x - c.hole.x, p.y - c.hole.y);
      if (d > fd) { fd = d; far = p; }
    }
    let ball = { x: far.x, y: far.y };
    let holed = false;
    for (let putt = 0; putt < 8 && !holed; putt++) {
      const roll = samplePuttRoll(c, ball, c.hole, putt, DEFAULT_PROFILE);
      if (puttHolesOut(ball, roll, c.hole)) { holed = true; break; }
      const rest = restingCell(c, roll.x, roll.y);
      assert.equal(rest.kind, 'rest', `seed ${seed}: a putt at the cup does not find water`);
      ball = { x: roll.x, y: roll.y };
      // the engine will not drop a ball already sitting in the cup's own radius;
      // that is a tap-in, and the game concedes it
      if (Math.hypot(ball.x - c.hole.x, ball.y - c.hole.y) <= CUP_R) { holed = true; break; }
    }
    assert.ok(holed, `seed ${seed}: holed out from ${fd.toFixed(1)} tiles across the green`);
  }
});

test('the pin is legal: a tile inside the edge, on ground a cup can be cut in', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = generateCourse(seed);
    const set = new Set(greenCellsOf(c).map((p) => k(p.x, p.y)));
    for (const [dx, dy] of N8) {
      assert.ok(set.has(k(c.pin.x + dx, c.pin.y + dy)),
        `seed ${seed}: the pin is a full tile inside the green edge`);
    }
    assert.ok(gradeAt(c, c.pin.x, c.pin.y) <= PIN_MAX_GRADE + 1e-6,
      `seed ${seed}: pin grade ${(gradeAt(c, c.pin.x, c.pin.y) * 100).toFixed(1)}%`);
    // and every published zone is legal by the same rule
    for (const z of c.green.pinZones) {
      for (const [dx, dy] of N8) {
        assert.ok(set.has(k(z.x + dx, z.y + dy)), `seed ${seed}: zone ${z.id} is interior`);
      }
      assert.ok(gradeAt(c, z.x, z.y) <= PIN_MAX_GRADE + 1e-6, `seed ${seed}: zone ${z.id} is flat enough`);
    }
  }
});

test('there is always a ground route in, and a green is never fully encircled', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = generateCourse(seed);
    // unhazarded ground leads out of the complex, on the side the shot comes from
    const run = flood(c, c.hole, (x, y) => {
      const t = cellAt(c, x, y);
      return t === GREEN || t === FAIRWAY || t === ROUGH;
    });
    let approachEscape = false;
    for (const key of run) {
      const x = key % 1000;
      const y = Math.floor(key / 1000);
      if (Math.hypot(x - c.hole.x, y - c.hole.y) < COMPLEX_R) continue;
      const th = Math.atan2(y - c.green.center.y, x - c.green.center.x);
      let d = (th - c.green.entrance.theta) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < Math.PI / 2) { approachEscape = true; break; }
    }
    assert.ok(approachEscape, `seed ${seed}: a ground route in from the approach side`);
    assert.ok(c.green.certified.openArc >= 3,
      `seed ${seed}: ${c.green.certified.openArc}/${c.green.certified.surroundTiles} of the surround is open`);
    assert.ok(c.green.certified.mownReach >= 4, `seed ${seed}: a mown run-up exists`);
  }
});

test('an island green still has a neck — the moat never closes', () => {
  let islands = 0;
  for (let seed = 1; seed <= 500 && islands < 25; seed++) {
    const c = generateCourse(seed);
    if (c.green.archetype !== 'island') continue;
    islands++;
    assert.ok(c.green.hazards.some((h) => h.role === 'moat' && h.kind === 'water'),
      `seed ${seed}: the island has water round it`);
    const run = flood(c, c.hole, (x, y) => {
      const t = cellAt(c, x, y);
      return t === GREEN || t === FAIRWAY || t === ROUGH;
    });
    let out = 0;
    for (const key of run) {
      if (Math.hypot((key % 1000) - c.hole.x, Math.floor(key / 1000) - c.hole.y) > COMPLEX_R) out++;
    }
    assert.ok(out > 0, `seed ${seed}: the island is reachable on the ground`);
  }
  assert.ok(islands >= 10, `island greens exist (${islands})`);
});

// --- hazards by role ---------------------------------------------------------

test('greenside hazards are placed by role, and every role gets used', () => {
  const roles = new Map();
  let hazarded = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const g = generateCourse(seed).green;
    if (g.hazards.length) hazarded++;
    for (const h of g.hazards) {
      assert.ok(HAZARD_ROLES.includes(h.role), `${h.role} is a known role`);
      assert.ok(h.tiles > 0, `${h.role} actually covers ground`);
      roles.set(h.role, (roles.get(h.role) ?? 0) + 1);
    }
  }
  assert.ok(hazarded >= 390, `nearly every green has a hazard plan (${hazarded}/400)`);
  for (const r of HAZARD_ROLES) assert.ok((roles.get(r) ?? 0) >= 3, `role ${r} is used (${roles.get(r) ?? 0})`);
});

test('the entrance stays clear: no bunker or pond this release digs blocks the way in', () => {
  let inspected = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const c = generateCourse(seed);
    const legacy = generateCourse(seed, 'classic', { legacyGreen: true });
    const g = c.green;
    for (const h of hazardTilesAdded(c, legacy)) {
      inspected++;
      let d = (Math.atan2(h.y - g.center.y, h.x - g.center.x) - g.entrance.theta) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > g.entrance.halfWidth) continue; // outside the reserved wedge
      const r = Math.hypot(h.x - g.center.x, h.y - g.center.y);
      assert.ok(r >= edgeAlong(c, Math.atan2(h.y - g.center.y, h.x - g.center.x)) + 4.5,
        `seed ${seed}: a ${h.t === SAND ? 'bunker' : 'pond'} sits in the entrance at ${h.x},${h.y}`);
    }
  }
  assert.ok(inspected > 1500, `the release really does dig hazards (${inspected} tiles)`);
});

test('a false front is a real rejection slope, falling away from the green', () => {
  let checked = 0;
  for (let seed = 1; seed <= 400 && checked < 25; seed++) {
    const c = generateCourse(seed);
    const ff = c.green.hazards.find((h) => h.role === 'false-front');
    if (!ff) continue;
    checked++;
    // Walk the line a running approach actually takes — out from the green's own
    // edge, back down the entrance bearing — on three parallel rays, and skip a
    // ray that runs into a pre-existing lake or bunker (the false front shapes
    // mown ground, not water). The apron has to fall AWAY from the green.
    const g = c.green;
    const th = g.entrance.theta;
    const drops = [];
    for (const off of [-1, 0, 1]) {
      const ox = -Math.sin(th) * off;
      const oy = Math.cos(th) * off;
      const cx = g.center.x + ox;
      const cy = g.center.y + oy;
      let edge = 0;
      for (let d = 0.5; d <= 9; d += 0.25) {
        const x = Math.round(cx + Math.cos(th) * d);
        const y = Math.round(cy + Math.sin(th) * d);
        if (inBounds(c, x, y) && cellAt(c, x, y) === GREEN) edge = d;
      }
      if (!edge) continue;
      const sample = (d) => {
        const x = cx + Math.cos(th) * d;
        const y = cy + Math.sin(th) * d;
        const t = cellAt(c, Math.round(x), Math.round(y));
        return t === FAIRWAY || t === ROUGH ? heightAt(c.relief, x, y) : null;
      };
      const near = sample(edge + 0.5);
      const farOut = sample(edge + 2.5);
      if (near === null || farOut === null) continue;
      drops.push(near - farOut);
    }
    if (drops.length < 2) { checked--; continue; }
    drops.sort((p, q) => p - q);
    const drop = drops[Math.floor(drops.length / 2)];
    assert.ok(drop > 0.5, `seed ${seed}: the front apron falls away (${drop.toFixed(2)} ft over 2 tiles)`);
  }
  assert.ok(checked >= 10, `false fronts exist (${checked})`);
});

// --- the surface is real -----------------------------------------------------

test('a tier is REAL: two shelves, feet apart, in the engine height field', () => {
  let tiered = 0;
  let biggest = 0;
  for (let seed = 1; seed <= 400 && tiered < 40; seed++) {
    const c = generateCourse(seed);
    if (c.green.archetype !== 'tiered') continue;
    tiered++;
    const t = c.green.tiers;
    assert.equal(t.length, 2, `seed ${seed}: two shelves`);
    assert.ok(t.every((s) => s.tiles >= 2), `seed ${seed}: both shelves are real ground`);
    const step = Math.abs(t[1].meanFt - t[0].meanFt);
    assert.ok(Math.abs(step - c.green.tierStepFt) < 0.01, `seed ${seed}: the reported step is the measured one`);
    assert.ok(step >= 1.2, `seed ${seed}: the shelf is worth climbing (${step.toFixed(2)} ft)`);
    biggest = Math.max(biggest, step);
    // and the shelves show up as separate pin zones
    const shelves = new Set(c.green.pinZones.map((z) => z.id.split(':')[1]).filter(Boolean));
    assert.ok(shelves.size >= 1, `seed ${seed}: shelf pin zones exist`);
  }
  assert.ok(tiered >= 15, `tiered greens exist (${tiered})`);
  assert.ok(biggest >= 2, `and some shelves are a proper step (${biggest.toFixed(1)} ft)`);
});

test('a punchbowl gathers and a turtleback sheds — measured, not asserted', () => {
  let bowls = 0;
  let crowns = 0;
  for (let seed = 1; seed <= 400 && (bowls < 20 || crowns < 20); seed++) {
    const c = generateCourse(seed);
    const g = c.green;
    if (g.archetype !== 'punchbowl' && g.archetype !== 'crowned') continue;
    const cells = greenCellsOf(c);
    let inner = 0;
    let ni = 0;
    let outer = 0;
    let no = 0;
    for (const p of cells) {
      const { u, v } = localOf(g, p.x, p.y);
      const d = Math.hypot(u / g.a, v / g.b); // the shape's OWN radius, not a circle's
      const h = heightAt(c.relief, p.x, p.y);
      if (d < 0.4) { inner += h; ni++; } else if (d > 0.75) { outer += h; no++; }
    }
    if (!ni || !no) continue;
    const rise = outer / no - inner / ni; // rim above middle
    if (g.archetype === 'punchbowl') {
      bowls++;
      assert.ok(rise > 0.4, `seed ${seed}: the bowl gathers (rim ${rise.toFixed(2)} ft above the middle)`);
    } else {
      crowns++;
      assert.ok(rise < -0.4, `seed ${seed}: the turtleback sheds (middle ${(-rise).toFixed(2)} ft proud)`);
    }
  }
  assert.ok(bowls >= 10 && crowns >= 10, `bowls ${bowls}, crowns ${crowns}`);
});

// --- pins --------------------------------------------------------------------

test('pin zones are named the way a caddie names them, and the rota is deterministic', () => {
  const names = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const c = generateCourse(seed);
    assert.ok(c.pin.name.length > 0, `seed ${seed}: the pin has a name`);
    for (const z of c.green.pinZones) names.add(z.name);
    // day 0 is the cup the hole was built with
    assert.deepEqual(pinFor(c, 0), c.pin, `seed ${seed}: day 0 is the cup`);
    // and later days are deterministic, legal, and on the green
    for (const day of [1, 3, 7]) {
      const a = pinFor(c, day);
      const b = pinFor(c, day);
      assert.deepEqual(a, b, `seed ${seed}: day ${day} is deterministic`);
      assert.equal(cellAt(c, a.x, a.y), GREEN, `seed ${seed}: day ${day} pin is on the green`);
      assert.ok(gradeAt(c, a.x, a.y) <= PIN_MAX_GRADE + 1e-6, `seed ${seed}: day ${day} pin is legal`);
    }
  }
  assert.ok(names.has('back-right shelf') || names.has('back-right bowl')
    || names.has('back-right') || names.has('back-right crown'),
  `the vocabulary reads like a yardage book: ${[...names].slice(0, 12).join(', ')}`);
  assert.ok(names.size >= 12, `pin vocabulary is rich (${names.size} distinct names)`);
});

test('a green with more than one zone can actually move its pin', () => {
  let moved = 0;
  let multi = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const c = generateCourse(seed);
    if (c.green.pinZones.length < 2) continue;
    multi++;
    const days = new Set();
    for (let d = 1; d <= 12; d++) {
      const p = pinFor(c, d);
      days.add(`${p.x},${p.y}`);
    }
    if (days.size > 1) moved++;
  }
  assert.ok(multi > 100, `most greens have several hole locations (${multi}/200)`);
  assert.ok(moved / multi > 0.9, `and the rota really moves the cup (${moved}/${multi})`);
});

// --- THE regression contract -------------------------------------------------

// Captured from THIS release, for relief.test.js's own seed/biome matrix. Format:
//   [seed, biome, cellsHash, tilesMoved, archetype, areaTiles]
// `tilesMoved` is how many cells differ from the pre-release-C course — every
// one of them inside the green complex, which the test below proves tile by tile.
const GREEN_LAYOUTS = [
  [1, 'classic', 3018114516, 37, 'boomerang', 42],
  [1, 'winter', 2680283271, 37, 'boomerang', 42],
  [1, 'alpine', 568286534, 37, 'boomerang', 42],
  [1, 'links', 639923065, 37, 'boomerang', 42],
  [777, 'classic', 2863068795, 17, 'crowned', 13],
  [777, 'winter', 2503298224, 17, 'crowned', 13],
  [777, 'alpine', 3549360227, 17, 'crowned', 13],
  [777, 'links', 4068186968, 17, 'crowned', 13],
  [31337, 'classic', 2994130005, 33, 'crowned', 20],
  [31337, 'winter', 1975678573, 33, 'crowned', 20],
  [31337, 'alpine', 2844966756, 27, 'crowned', 20],
  [31337, 'links', 1624415380, 33, 'crowned', 20],
  [424242, 'classic', 4228055657, 25, 'punchbowl', 33],
  [424242, 'winter', 4027538700, 25, 'punchbowl', 33],
  [424242, 'alpine', 2167898759, 25, 'punchbowl', 33],
  [424242, 'links', 737471115, 25, 'punchbowl', 33],
  [1837462913, 'classic', 2363440734, 49, 'kidney', 39],
  [1837462913, 'winter', 2765822455, 49, 'kidney', 39],
  [1837462913, 'alpine', 2307929898, 48, 'kidney', 39],
  [1837462913, 'links', 720479207, 50, 'kidney', 39],
];

test('green architecture moves the GREEN COMPLEX and nothing else', () => {
  // The load-bearing promise of release C. Greens draw from their own named
  // substreams after every layout draw, so the fairway, the trees and the
  // hazard blobs of an already-shared seed cannot have moved — and the tiles
  // that DID move are all inside the complex, which is what a new green is.
  for (const [seed, biome, hash, moved, archetype, area] of GREEN_LAYOUTS) {
    const legacy = generateCourse(seed, biome, { legacyGreen: true });
    const c = generateCourse(seed, biome);
    assert.equal(layoutHash(c.cells), hash, `seed ${seed} ${biome}: tile layout pinned`);
    assert.equal(c.green.archetype, archetype, `seed ${seed} ${biome}: archetype pinned`);
    assert.equal(c.green.areaTiles, area, `seed ${seed} ${biome}: green area pinned`);
    assert.deepEqual(c.tee, legacy.tee, `seed ${seed} ${biome}: tee unmoved`);
    assert.deepEqual(c.hole, legacy.hole, `seed ${seed} ${biome}: cup unmoved`);
    assert.equal(c.archetype, legacy.archetype);
    assert.deepEqual(c.wind, legacy.wind);
    let diff = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = y * c.width + x;
        if (legacy.cells[i] === c.cells[i]) continue;
        diff++;
        assert.ok(Math.hypot(x - c.hole.x, y - c.hole.y) <= COMPLEX_R,
          `seed ${seed} ${biome}: tile ${x},${y} moved OUTSIDE the green complex`);
      }
    }
    assert.equal(diff, moved, `seed ${seed} ${biome}: exactly ${moved} tiles move`);
  }
});

test('the height field outside the complex is release B\'s, foot for foot', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const legacy = generateCourse(seed, 'classic', { legacyGreen: true });
    const c = generateCourse(seed);
    let far = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = y * c.width + x;
        if (Math.abs(legacy.relief.ft[i] - c.relief.ft[i]) < 1e-6) continue;
        far = Math.max(far, Math.hypot(x - c.hole.x, y - c.hole.y));
      }
    }
    assert.ok(far <= COMPLEX_R + 4,
      `seed ${seed}: the complex reshaped ground ${far.toFixed(1)} tiles from the cup`);
    assert.equal(heightAt(c.relief, c.tee.x, c.tee.y), heightAt(legacy.relief, c.tee.x, c.tee.y),
      `seed ${seed}: the tee datum is untouched`);
    assert.ok(c.relief.reliefFt >= 3 && c.relief.reliefFt <= 45,
      `seed ${seed}: ${c.relief.reliefFt.toFixed(1)} ft is still a golf property`);
  }
});

test('THE ARCADE IS UNTOUCHED: certified puzzles still play the classic disc', () => {
  for (const seed of [1, 777, 31337, 1837462913]) {
    const p = makePuzzle(seed, 'standard');
    const legacy = generateCourse(p.seed, 'classic', { legacyGreen: true });
    assert.deepEqual(p.course.cells, legacy.cells, `seed ${seed}: arcade course byte-identical`);
    assert.equal(p.course.green, undefined, `seed ${seed}: no green plan on an arcade hole`);
    // and it really is the 2.5-tile disc, tile for tile
    for (let y = 0; y < p.course.height; y++) {
      for (let x = 0; x < p.course.width; x++) {
        const onDisc = Math.hypot(x - p.course.hole.x, y - p.course.hole.y) <= 2.5;
        if (onDisc) assert.equal(cellAt(p.course, x, y), GREEN, `seed ${seed}: disc at ${x},${y}`);
      }
    }
  }
});

// --- the caddie deck ---------------------------------------------------------

test('every hole of a caddie round certifies, and no two are the same green', () => {
  const shapes = new Set();
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 9; i++) {
      const c = caddieHoleCourse(caddieHoleSeed(20260811 + round, i));
      assert.ok(c.green.certified.ok,
        `round ${round} hole ${i}: certified (${c.green.certified.reasons.join('; ')})`);
      assert.ok(isRestable(cellAt(c, c.hole.x, c.hole.y)));
      shapes.add(`${c.green.archetype}/${c.green.areaTiles}`);
    }
  }
  assert.ok(shapes.size > 60, `a season of caddie holes is not one green (${shapes.size} distinct)`);
});
