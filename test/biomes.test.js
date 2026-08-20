import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCourse, BIOMES } from '../src/engine/generate.js';
import { makePuzzle, verifyPuzzle } from '../src/engine/puzzle.js';
import { resolveShot } from '../src/engine/shots.js';
import { makeCourse, setCell, cellAt } from '../src/engine/course.js';
import {
  FAIRWAY, GREEN, WATER, ICE, SLOPE_E, SLOPE_W, SLOPE_S, slopeDir,
} from '../src/engine/terrain.js';
import { encodeShareCode, decodeShareCode } from '../src/engine/catalog.js';

function range() {
  const c = makeCourse(1, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.hole = { x: 39, y: 23 };
  c.tee = { x: 2, y: 12 };
  return c;
}

test('ice carries a rolling putt until non-ice terrain', () => {
  const c = range();
  for (let x = 7; x <= 12; x++) setCell(c, x, 12, ICE);
  // putter power 1 = 2 tiles: ends on ice at x=7, then slides across to x=13
  const r = resolveShot(c, { x: 5, y: 12 }, { club: 'putter', angle: 0, power: 1 }, 0);
  assert.deepEqual(r.ball, { x: 13, y: 12 });
});

test('airborne landing on ice slides along the flight direction', () => {
  const c = range();
  // a wide ice sheet so the shot lands on ice at any scatter offset
  for (let y = 10; y <= 14; y++) for (let x = 10; x <= 14; x++) setCell(c, x, y, ICE);
  // iron power 2 = 8 tiles from x=3 → lands inside the sheet, then slides
  // east along the flight direction until the first non-ice column (x=15)
  const r = resolveShot(c, { x: 3, y: 12 }, { club: 'iron', angle: 0, power: 2 }, 0);
  assert.equal(r.ball.x, 15);
  assert.ok(r.ball.y >= 10 && r.ball.y <= 14);
});

test('slope chain sheds the ball downhill tile by tile', () => {
  const c = range();
  setCell(c, 8, 12, SLOPE_E);
  setCell(c, 9, 12, SLOPE_E);
  setCell(c, 10, 12, SLOPE_S);
  // putter power 3 = 5 tiles: from x=3 ends at x=8 on a slope-east chain,
  // slides E to 9, E to 10, then S to (10,13) which is flat fairway.
  const r = resolveShot(c, { x: 3, y: 12 }, { club: 'putter', angle: 0, power: 3 }, 0);
  assert.deepEqual(r.ball, { x: 10, y: 13 });
});

test('sliding into water is the usual penalty return', () => {
  const c = range();
  setCell(c, 8, 12, SLOPE_E);
  setCell(c, 9, 12, WATER);
  const r = resolveShot(c, { x: 3, y: 12 }, { club: 'putter', angle: 0, power: 3 }, 0);
  assert.equal(r.event, 'water');
  assert.deepEqual(r.ball, { x: 3, y: 12 });
  assert.equal(r.penalty, 1);
});

test('opposing slopes trap the ball deterministically instead of looping forever', () => {
  const c = range();
  setCell(c, 8, 12, SLOPE_E);
  setCell(c, 9, 12, SLOPE_W);
  const r = resolveShot(c, { x: 3, y: 12 }, { club: 'putter', angle: 0, power: 3 }, 0);
  assert.ok(slopeDir(cellAt(c, r.ball.x, r.ball.y)), 'rests on one of the opposing slopes');
  const again = resolveShot(c, { x: 3, y: 12 }, { club: 'putter', angle: 0, power: 3 }, 0);
  assert.deepEqual(r.ball, again.ball, 'deterministic rest position');
});

test('classic courses are byte-identical with biomes in the codebase', () => {
  // The load-bearing promise: adding biomes must not move a single tile on
  // already-shared classic seeds. (Golden fixtures also enforce this.)
  const a = generateCourse(1837462913);
  const b = generateCourse(1837462913, 'classic');
  assert.deepEqual(a.cells, b.cells);
});

test('winter and alpine courses actually contain their terrain and stay solvable', () => {
  let iceSeen = 0;
  let slopeSeen = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const w = makePuzzle(seed, 'standard', 'winter');
    assert.ok(verifyPuzzle(w), `winter seed ${seed} certificate replays`);
    if (w.course.cells.includes(ICE)) iceSeen++;
    const alp = makePuzzle(seed, 'standard', 'alpine');
    assert.ok(verifyPuzzle(alp), `alpine seed ${seed} certificate replays`);
    if (alp.course.cells.some((t) => slopeDir(t))) slopeSeen++;
  }
  assert.ok(iceSeen >= 12, `${iceSeen}/15 winter courses have ice`);
  assert.ok(slopeSeen >= 12, `${slopeSeen}/15 alpine courses have slopes`);
});

test('biome overlays never touch the green, tee, or hole surroundings', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const biome of ['winter', 'alpine']) {
      const c = generateCourse(seed, biome);
      assert.equal(cellAt(c, c.tee.x, c.tee.y), FAIRWAY, `${biome} ${seed}: tee clear`);
      assert.equal(cellAt(c, c.hole.x, c.hole.y), GREEN, `${biome} ${seed}: hole clear`);
    }
  }
});

test('share codes carry biomes; classic codes keep the original format', () => {
  const classic = encodeShareCode(424242, 'standard');
  assert.match(classic, /^GLF-[0-9A-Z]{4}-[0-9A-Z]{4}-S$/);
  assert.deepEqual(decodeShareCode(classic), { seed: 424242, difficulty: 'standard', biome: 'classic' });
  for (const biome of BIOMES) {
    const code = encodeShareCode(99, 'rude', biome);
    assert.deepEqual(decodeShareCode(code), { seed: 99, difficulty: 'rude', biome });
  }
  // biome letter is check-digit protected
  const winter = encodeShareCode(99, 'rude', 'winter');
  assert.throws(() => decodeShareCode(winter.replace(/-W$/, '-A')));
});
