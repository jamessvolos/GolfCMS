import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORED_HOLES, parseArt } from '../src/engine/authored.js';
import { solve, verifyLine } from '../src/engine/solver.js';
import { cellAt, WIDTH, HEIGHT } from '../src/engine/course.js';
import {
  FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE,
  SLOPE_N, SLOPE_S, SLOPE_E, SLOPE_W,
} from '../src/engine/terrain.js';

// A tiny hand-rolled hole exercising every legend character.
function sampleArt() {
  const rows = [];
  rows.push('T.,swtgi^v><' + ','.repeat(WIDTH - 12));
  rows.push('.H' + ','.repeat(WIDTH - 2));
  while (rows.length < HEIGHT) rows.push(','.repeat(WIDTH));
  return rows;
}

test('parseArt round-trips dimensions, markers, and terrain codes', () => {
  const c = parseArt(sampleArt());
  assert.equal(c.width, WIDTH);
  assert.equal(c.height, HEIGHT);
  assert.equal(c.cells.length, WIDTH * HEIGHT);
  assert.deepEqual(c.tee, { x: 0, y: 0 });
  assert.deepEqual(c.hole, { x: 1, y: 1 });
  // markers sit on their required surfaces
  assert.equal(cellAt(c, 0, 0), FAIRWAY);
  assert.equal(cellAt(c, 1, 1), GREEN);
  // every legend character maps to its terrain code
  const expected = [FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE, SLOPE_N, SLOPE_S, SLOPE_E, SLOPE_W];
  expected.forEach((t, i) => assert.equal(cellAt(c, i + 1, 0), t, `legend char ${i + 1}`));
  assert.equal(cellAt(c, WIDTH - 1, HEIGHT - 1), ROUGH);
});

test('parseArt rejects malformed art', () => {
  // wrong row count
  assert.throws(() => parseArt(sampleArt().slice(0, HEIGHT - 1)), /rows/);
  // wrong row width
  const short = sampleArt();
  short[5] = short[5].slice(0, WIDTH - 1);
  assert.throws(() => parseArt(short), /chars/);
  // missing tee
  const noTee = sampleArt();
  noTee[0] = '.' + noTee[0].slice(1);
  assert.throws(() => parseArt(noTee), /no tee/);
  // missing hole
  const noHole = sampleArt();
  noHole[1] = '..' + noHole[1].slice(2);
  assert.throws(() => parseArt(noHole), /no hole/);
  // duplicate tee
  const twoTees = sampleArt();
  twoTees[2] = 'T' + twoTees[2].slice(1);
  assert.throws(() => parseArt(twoTees), /more than one tee/);
  // unknown character
  const junk = sampleArt();
  junk[3] = '?' + junk[3].slice(1);
  assert.throws(() => parseArt(junk), /unknown terrain char/);
});

test('there are six authored holes with distinct names', () => {
  assert.equal(AUTHORED_HOLES.length, 6);
  const names = new Set(AUTHORED_HOLES.map((h) => h.name));
  assert.equal(names.size, 6);
});

for (const holeDef of AUTHORED_HOLES) {
  test(`authored hole "${holeDef.name}" parses cleanly`, () => {
    const c = parseArt(holeDef.art);
    assert.equal(c.archetype, 'authored');
    // tee on fairway, hole on green, both in bounds
    assert.equal(cellAt(c, c.tee.x, c.tee.y), FAIRWAY);
    assert.equal(cellAt(c, c.hole.x, c.hole.y), GREEN);
    // every cell is a real terrain code
    for (const t of c.cells) {
      assert.ok(Number.isInteger(t) && t >= FAIRWAY && t <= SLOPE_W, `terrain code ${t}`);
    }
  });

  test(`authored hole "${holeDef.name}" is solvable within 12 strokes`, () => {
    const c = parseArt(holeDef.art);
    const r = solve(c, c.tee);
    assert.ok(r, 'solver found a line');
    assert.ok(r.strokes >= 1 && r.strokes <= 12, `stroke count ${r.strokes}`);
    assert.ok(verifyLine(c, c.tee, r.line), 'certificate line replays to holed');
  });
}
