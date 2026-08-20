// Golden replays: the regression wall. These fixtures pin the exact output
// of generation + solving for known seeds. Any engine change that alters an
// already-shared hole's behavior fails here loudly — bump fixtures only with
// a deliberate GEN_VERSION change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePuzzle, verifyPuzzle } from '../src/engine/puzzle.js';

const GOLDEN = [
  { seed: 1, diff: 'standard', par: 3, start: { x: 7, y: 15 },
    line: [['driver', 0.071307, 1], ['driver', 0.174672, 1], ['iron', -0.165149, 1]] },
  { seed: 777, diff: 'rude', par: 3, start: { x: 15, y: 22 },
    line: [['driver', -0.514451, 1], ['driver', -0.390607, 3], ['iron', -0.588003, 2]] },
  { seed: 1837462913, diff: 'standard', par: 2, start: { x: 6, y: 13 },
    line: [['driver', 0, 3], ['driver', 6.021386, 3]] },
  { seed: 31337, diff: 'easy', par: 3, start: { x: 3, y: 6 },
    line: [['driver', 0.294235, 1], ['driver', 0.785398, 2], ['driver', 0, 3]] },
];

for (const g of GOLDEN) {
  test(`golden: seed ${g.seed} (${g.diff}) still plays exactly as recorded`, () => {
    const p = makePuzzle(g.seed, g.diff);
    assert.equal(p.seed, g.seed, 'no reroll drift');
    assert.equal(p.par, g.par, 'par unchanged');
    assert.deepEqual(p.start, g.start, 'ball start unchanged');
    assert.deepEqual(
      p.certificate.line.map((s) => [s.club, Number(s.angle.toFixed(6)), s.power]),
      g.line,
      'solver line unchanged'
    );
    assert.ok(verifyPuzzle(p), 'certificate still replays to holed');
  });
}
