// The Real Nine, held to the same standard as every generated hole: each
// pack entry must rebuild from its seed + patch, survive the real solver,
// carry a sane par and a valid georeference. A pack hole that fails here
// has no business being anyone's daily.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateCourse } from '../src/engine/generate.js';
import { solve } from '../src/engine/solver.js';
import { decodePatch, applyPatch } from '../src/engine/patch.js';
import { decodeGeoRef } from '../src/engine/georef.js';
import { parForTiles } from '../src/engine/yards.js';
import { GREEN, WATER } from '../src/engine/terrain.js';
import { cellAt } from '../src/engine/course.js';

const pack = JSON.parse(readFileSync(new URL('../packs/real-9.json', import.meta.url)));

test('the pack is nine named tribute holes', () => {
  assert.equal(pack.version, 1);
  assert.equal(pack.holes.length, 9);
  for (const h of pack.holes) {
    assert.ok(h.name.length > 2, 'named');
    assert.match(h.tribute, /^after /, 'a tribute, and says so');
    assert.ok(['classic', 'winter', 'alpine', 'links'].includes(h.biome));
  }
});

for (const h of pack.holes) {
  test(`${h.name}: rebuilds, certifies, and knows where it is`, () => {
    const course = applyPatch(
      generateCourse(h.seed >>> 0, h.biome, { holeDistTiles: h.dist }), decodePatch(h.patch));
    // par honesty: distance par matches the label, solver agrees within one
    const L = Math.hypot(course.hole.x - course.tee.x, course.hole.y - course.tee.y);
    assert.equal(parForTiles(L), h.par, 'distance par matches');
    const solved = solve(course, course.tee);
    assert.ok(solved, 'the solver can play it');
    // the solver is a superhuman optimizer: its count runs under golfer par,
    // but a 1-stroke hole is broken and past par+1 means the ground is a maze
    assert.ok(solved.strokes >= 2 && solved.strokes <= h.par + 1,
      `solver ${solved.strokes} vs par ${h.par}`);
    assert.equal(solved.strokes, h.solverPar, 'stored solver par is honest');
    // the cup sits on a green
    assert.equal(cellAt(course, course.hole.x, course.hole.y), GREEN);
    // the tee is playable, not in a hazard
    assert.notEqual(cellAt(course, course.tee.x, course.tee.y), WATER);
    // the georeference decodes and points at plausible Earth
    const geo = decodeGeoRef(h.geo);
    assert.ok(Math.abs(geo.lat) > 5, 'not on the null island');
    assert.ok(geo.tileM > 3 && geo.tileM < 40, `tile scale ${geo.tileM} m is golf-sized`);
  });
}
