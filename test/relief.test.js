// The height field. These tests pin the three promises release B makes:
// the field is a deterministic function of the seed, it is a plausible piece of
// golf property rather than noise, and it changes NOTHING about a course that
// does not carry one — including, byte for byte, the tile layout of every
// already-shared classic seed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRelief, reliefFromHeights, heightAt, gradientAt, fallLineAt, playsLike, pullAt,
  holeRiseFeet, FT_PER_TILE, FT_PER_PULL, GREEN_FORMS, LANDFORMS,
} from '../src/engine/relief.js';
import { generateCourse } from '../src/engine/generate.js';
import { makeCourse, setCell, cellAt } from '../src/engine/course.js';
import { FAIRWAY, GREEN, SLOPE_N, SLOPE_S, SLOPE_E, SLOPE_W } from '../src/engine/terrain.js';
import {
  puttBreakDrift, courseBreaks, courseHasSlopes, shotShape, groundKick,
  lieParams, lieParamsAt, patternPoints, sampleLanding, shotPlaysLike,
} from '../src/engine/dispersion.js';

/** A featureless practice ground: fairway everywhere, a green at the far end. */
function bare(seed = 7) {
  const c = makeCourse(seed, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.tee = { x: 3, y: 12 };
  c.hole = { x: 30, y: 12 };
  for (let y = 9; y <= 15; y++) for (let x = 27; x <= 33; x++) setCell(c, x, y, GREEN);
  return c;
}

/** The same ground with a height field bolted on. */
function relieved(seed = 7) {
  const c = bare(seed);
  c.relief = buildRelief(c, seed);
  return c;
}

// --- determinism -------------------------------------------------------------

test('same seed, same field — to the last float', () => {
  const c = bare(20240);
  const a = buildRelief(c, 20240);
  const b = buildRelief(c, 20240);
  assert.deepEqual(Array.from(a.ft), Array.from(b.ft));
  assert.equal(a.landform, b.landform);
  assert.equal(a.greenForm, b.greenForm);
  assert.equal(a.reliefFt, b.reliefFt);
  // and a different seed is a different piece of land
  const other = buildRelief(c, 20241);
  assert.notDeepEqual(Array.from(a.ft), Array.from(other.ft));
});

test('generated courses carry a relief, and regenerating reproduces it', () => {
  const a = generateCourse(1837462913);
  const b = generateCourse(1837462913);
  assert.ok(a.relief, 'the generator attaches a height field');
  assert.deepEqual(Array.from(a.relief.ft), Array.from(b.relief.ft));
  assert.ok(LANDFORMS.includes(a.relief.landform), `known landform: ${a.relief.landform}`);
  assert.ok(GREEN_FORMS.includes(a.relief.greenForm), `known green form: ${a.relief.greenForm}`);
});

// --- THE regression contract -------------------------------------------------

/** FNV-1a over a cells array — a one-number fingerprint of a tile layout. */
function layoutHash(cells) {
  let x = 2166136261 >>> 0;
  for (const c of cells) {
    x ^= c;
    x = Math.imul(x, 16777619) >>> 0;
  }
  return x;
}

// Fingerprints captured from the PRE-RELIEF generator (the commit before this
// one), for the golden seeds, the share-code seed, every biome, and the caddie
// length-override path. Format:
//   [seed, biome, cellsHash, teeX, teeY, holeX, holeY, archetype, windX, windY]
const CLASSIC_LAYOUTS = [
  [1, 'classic', 2606713212, 2, 14, 35, 17, 'straight', 0, 0],
  [1, 'winter', 3314074941, 2, 14, 35, 17, 'straight', 0, 0],
  [1, 'alpine', 3925434270, 2, 14, 35, 17, 'straight', 0, 0],
  [1, 'links', 1415554400, 2, 14, 35, 17, 'straight', 1, -1],
  [777, 'classic', 272814489, 2, 15, 38, 9, 'long', 0, 0],
  [777, 'winter', 35281630, 2, 15, 38, 9, 'long', 0, 0],
  [777, 'alpine', 1491380657, 2, 15, 38, 9, 'long', 0, 0],
  [777, 'links', 928378335, 2, 15, 38, 9, 'long', 2, 0],
  [31337, 'classic', 1427964170, 3, 6, 36, 16, 'dogleg-right', 0, 0],
  [31337, 'winter', 2925909778, 3, 6, 36, 16, 'dogleg-right', 0, 0],
  [31337, 'alpine', 566725575, 3, 6, 36, 16, 'dogleg-right', 0, 0],
  [31337, 'links', 4215939287, 3, 6, 36, 16, 'dogleg-right', -2, 0],
  [424242, 'classic', 1270004782, 3, 13, 35, 13, 'dogleg-left', 0, 0],
  [424242, 'winter', 4173161351, 3, 13, 35, 13, 'dogleg-left', 0, 0],
  [424242, 'alpine', 9972416, 3, 13, 35, 13, 'dogleg-left', 0, 0],
  [424242, 'links', 3941538012, 3, 13, 35, 13, 'dogleg-left', 1, 1],
  [1837462913, 'classic', 2824497749, 3, 16, 35, 11, 'straight', 0, 0],
  [1837462913, 'winter', 2455984532, 3, 16, 35, 11, 'straight', 0, 0],
  [1837462913, 'alpine', 3774646668, 3, 16, 35, 11, 'straight', 0, 0],
  [1837462913, 'links', 1756332155, 3, 16, 35, 11, 'straight', 0, 2],
];
const OVERRIDE_LAYOUTS = [
  [424242, 13, 2150050719, 3, 13, 16, 13, 'dogleg-left'],
  [99, 13, 1861640182, 3, 17, 16, 12, 'long'],
];

test('classic seeds keep a byte-identical TILE layout with relief in the codebase', () => {
  // The load-bearing promise of release B, exactly as biomes made it before:
  // adding a whole new engine dimension must not move a single tile on an
  // already-shared seed. Relief draws from its OWN named substream and only
  // ever READS the finished layout, so the cells array cannot have moved — and
  // these fingerprints, taken from the pre-relief generator, prove it did not.
  //
  // Release C added green architecture on the same terms — its own substreams,
  // after every layout draw — but a SHAPED green is by definition different
  // tiles from a 2.5-tile disc, so the arcade's own courses (`legacyGreen`, the
  // path puzzle.js and the creator take) are what these fingerprints pin. The
  // shaped-green path is pinned tile-for-tile in greens.test.js, which proves
  // the only cells that ever move are the green complex's own.
  for (const [seed, biome, hash, tx, ty, hx, hy, archetype, wx, wy] of CLASSIC_LAYOUTS) {
    const c = generateCourse(seed, biome, { legacyGreen: true });
    assert.equal(layoutHash(c.cells), hash, `seed ${seed} ${biome}: tile layout byte-identical`);
    assert.deepEqual(c.tee, { x: tx, y: ty }, `seed ${seed} ${biome}: tee`);
    assert.deepEqual(c.hole, { x: hx, y: hy }, `seed ${seed} ${biome}: hole`);
    assert.equal(c.archetype, archetype, `seed ${seed} ${biome}: archetype`);
    assert.deepEqual(c.wind, { x: wx, y: wy }, `seed ${seed} ${biome}: wind`);
    // relief is purely ADDITIVE: strip it and what is left is the classic course
    const layoutOnly = { ...c };
    delete layoutOnly.relief;
    assert.deepEqual(Object.keys(layoutOnly).sort(),
      ['archetype', 'biome', 'cells', 'genVersion', 'height', 'hole', 'seed', 'tee', 'width', 'wind'],
      'relief is the only new field on a course');
  }
  // the caddie's own length-override path is pinned too
  for (const [seed, holeDistTiles, hash, tx, ty, hx, hy, archetype] of OVERRIDE_LAYOUTS) {
    const c = generateCourse(seed, 'classic', { holeDistTiles, legacyGreen: true });
    assert.equal(layoutHash(c.cells), hash, `seed ${seed} @${holeDistTiles}: tile layout byte-identical`);
    assert.deepEqual(c.tee, { x: tx, y: ty });
    assert.deepEqual(c.hole, { x: hx, y: hy });
    assert.equal(c.archetype, archetype);
  }
});

test('a course with no relief takes every pre-relief code path exactly', () => {
  const c = bare();
  assert.equal(c.relief, undefined);
  // lie params: the terrain's own numbers, unwidened
  for (const p of [{ x: 5, y: 12 }, { x: 20, y: 8 }]) {
    assert.deepEqual(lieParamsAt(c, p.x, p.y), lieParams(cellAt(c, p.x, p.y)));
  }
  // no shot shape at all — and null is the identity inside patternPoints
  assert.equal(shotShape(c, { x: 5, y: 12 }, { x: 15, y: 12 }), null);
  assert.deepEqual(
    patternPoints({ x: 5, y: 12 }, { x: 15, y: 12 }, 1),
    patternPoints({ x: 5, y: 12 }, { x: 15, y: 12 }, 1, undefined, undefined, null)
  );
  // no kick — the additive identity
  assert.deepEqual(groundKick(c, { x: 5, y: 12 }, { x: 15, y: 12 }, { x: 15, y: 12 }), { x: 0, y: 0 });
  // no break, no plays-like adjustment
  assert.deepEqual(puttBreakDrift(c, { x: 29, y: 12 }, { x: 30, y: 12 }), { x: 0, y: 0, cross: 0 });
  assert.equal(courseBreaks(c), false);
  const pl = shotPlaysLike(c, { x: 5, y: 12 }, { x: 15, y: 12 });
  assert.equal(pl.riseFt, 0);
  assert.equal(pl.deltaYards, 0);
  assert.equal(pl.playsYards, pl.carryYards);
  // sampled landings are unchanged by the mere existence of the module: the
  // golden below is the pre-relief engine's own answer for this seeded draw
  assert.deepEqual(sampleLanding(c, { x: 5, y: 12 }, { x: 15, y: 12 }, 1, 0), { x: 15, y: 11 });
});

// --- sampling ----------------------------------------------------------------

test('heightAt is bilinear and continuous; gradientAt agrees with it', () => {
  const r = relieved(99).relief;
  // continuity: a hair of movement moves the height by a hair
  let worst = 0;
  for (let x = 2; x < 36; x += 0.37) {
    for (let y = 2; y < 20; y += 0.41) {
      worst = Math.max(worst, Math.abs(heightAt(r, x, y) - heightAt(r, x + 1e-4, y)));
      worst = Math.max(worst, Math.abs(heightAt(r, x, y) - heightAt(r, x, y + 1e-4)));
    }
  }
  assert.ok(worst < 1e-3, `continuous field, worst jump ${worst}`);
  // bilinear: the midpoint of a cell edge is the mean of its ends
  const mid = heightAt(r, 10.5, 8);
  assert.ok(Math.abs(mid - (heightAt(r, 10, 8) + heightAt(r, 11, 8)) / 2) < 1e-4);
  // the gradient really is the derivative of the height
  for (const [x, y] of [[9, 7], [18.5, 13.25], [25, 5]]) {
    const g = gradientAt(r, x, y);
    const fd = (heightAt(r, x + 0.25, y) - heightAt(r, x - 0.25, y)) / 0.5;
    assert.ok(Math.abs(g.dx - fd) < 0.35, `dx agrees with a finite difference: ${g.dx} vs ${fd}`);
  }
  // outside the grid the edge value is held rather than NaN
  assert.equal(heightAt(r, -5, -5), heightAt(r, 0, 0));
  assert.ok(Number.isFinite(heightAt(r, 500, 500)));
  // and the fall line points DOWN the gradient
  const fl = fallLineAt(r, 15, 11);
  const g = gradientAt(r, 15, 11);
  if (fl.ftPerTile > 1e-6) {
    assert.ok(fl.x * g.dx + fl.y * g.dy < 0, 'the fall line runs downhill');
    assert.ok(Math.abs(Math.hypot(fl.x, fl.y) - 1) < 1e-6, 'fall line is a unit vector');
  }
});

test('amplitudes are a golf property, not a mountain range', () => {
  let flattest = Infinity;
  let steepest = 0;
  let worstFairwayGrade = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const c = generateCourse(seed);
    const r = c.relief;
    assert.ok(Number.isFinite(r.reliefFt), `seed ${seed}: finite relief`);
    assert.ok(r.reliefFt >= 3 && r.reliefFt <= 45,
      `seed ${seed}: ${r.reliefFt.toFixed(1)} ft of total relief is plausible for a golf hole`);
    flattest = Math.min(flattest, r.reliefFt);
    steepest = Math.max(steepest, r.reliefFt);
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (cellAt(c, x, y) !== FAIRWAY) continue;
        const g = gradientAt(r, x, y);
        worstFairwayGrade = Math.max(worstFairwayGrade, Math.hypot(g.dx, g.dy) / FT_PER_TILE);
      }
    }
  }
  assert.ok(flattest < 10, `some holes are nearly flat, flattest ${flattest.toFixed(1)} ft`);
  assert.ok(steepest > 20, `some holes are dramatic, steepest ${steepest.toFixed(1)} ft`);
  // the corridor guarantee, in three dimensions: no cliff across mown ground.
  // The tile-to-tile limit is 8.5%; a diagonal fall line can read up to √2×.
  assert.ok(worstFairwayGrade < 0.15,
    `no wall across a landing zone: worst fairway grade ${(worstFairwayGrade * 100).toFixed(1)}%`);
});

test('the green sits on a landform, and every archetype gets used', () => {
  const forms = new Set();
  let shapedGreens = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const c = generateCourse(seed);
    forms.add(c.relief.greenForm);
    // the putting surface actually has shape: some real grade somewhere on it
    let peak = 0;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (cellAt(c, x, y) !== GREEN) continue;
        const g = gradientAt(c.relief, x, y);
        peak = Math.max(peak, Math.hypot(g.dx, g.dy) / FT_PER_TILE);
      }
    }
    if (peak > 0.01) shapedGreens++;
    assert.ok(peak < 0.20, `seed ${seed}: a green is still puttable, ${(peak * 100).toFixed(1)}%`);
  }
  assert.deepEqual([...forms].sort(), [...GREEN_FORMS].sort(), 'all four green forms appear');
  assert.ok(shapedGreens > 100, `${shapedGreens}/120 greens have a real slope on them`);
});

// --- plays-like --------------------------------------------------------------

test('uphill plays longer, downhill shorter, about a yard per foot', () => {
  const c = bare(3);
  // a hand-made ramp: 20 ft of climb over 10 tiles, dead flat across
  const r = reliefFromHeights(c.width, c.height, (x) => x * 2);
  const from = { x: 5, y: 12 };
  const up = { x: 15, y: 12 }; // +20 ft
  const down = { x: 5, y: 12 };
  const upPlays = playsLike(r, from, up);
  assert.ok(Math.abs(upPlays.riseFt - 20) < 1e-6, `20 ft of rise, got ${upPlays.riseFt}`);
  assert.ok(Math.abs(upPlays.deltaYards - 20) < 0.01, `~1 yd per ft: ${upPlays.deltaYards}`);
  assert.ok(upPlays.playsTiles > upPlays.carryTiles, 'uphill plays LONGER');
  assert.ok(Math.abs(upPlays.playsYards - (upPlays.carryYards + 20)) < 0.01);
  // downhill is the mirror image
  const downPlays = playsLike(r, up, down);
  assert.ok(Math.abs(downPlays.riseFt + 20) < 1e-6);
  assert.ok(downPlays.deltaYards < 0, 'downhill plays SHORTER');
  assert.ok(downPlays.playsTiles < downPlays.carryTiles);
  assert.ok(Math.abs(downPlays.deltaYards + upPlays.deltaYards) < 1e-6, 'and it is exactly the mirror');
  // the rule fades out on short shots: nobody adds a club to a chip
  const chip = playsLike(r, { x: 10, y: 12 }, { x: 11, y: 12 });
  assert.ok(chip.deltaYards > 0 && chip.deltaYards < chip.riseFt,
    `a 16-yd pitch takes only part of the rule: ${chip.deltaYards} < ${chip.riseFt}`);
  // and a null field is the identity
  const none = playsLike(null, from, up);
  assert.equal(none.deltaYards, 0);
  assert.equal(none.playsTiles, none.carryTiles);
});

test('the plays-like number is exposed for the HUD, and reads in whole yards', () => {
  const c = bare(3);
  c.relief = reliefFromHeights(c.width, c.height, (x) => x * 1.3);
  const pl = shotPlaysLike(c, { x: 5, y: 12 }, { x: 15, y: 12 });
  assert.equal(pl.carryYards, 160);
  assert.equal(pl.deltaYards, 13);
  assert.equal(pl.playsYards, 173, '"160 yds — plays 173"');
  assert.ok(Number.isInteger(pl.playsYards));
  // an uphill shot disperses like the longer shot it really is
  const up = patternPoints({ x: 5, y: 12 }, { x: 15, y: 12 }, 1, undefined, undefined,
    shotShape(c, { x: 5, y: 12 }, { x: 15, y: 12 }));
  const flat = patternPoints({ x: 5, y: 12 }, { x: 15, y: 12 }, 1);
  const spread = (pts) => Math.max(...pts.map((p) => Math.hypot(p.x - 15, p.y - 12)));
  assert.ok(spread(up) > spread(flat), 'the uphill pattern is the wider one');
});

test('hole rise is reported from the tee datum', () => {
  const c = generateCourse(4242);
  assert.equal(heightAt(c.relief, c.tee.x, c.tee.y), 0, 'the tee is the datum');
  assert.ok(Math.abs(holeRiseFeet(c) - heightAt(c.relief, c.hole.x, c.hole.y)) < 1e-9);
  assert.equal(holeRiseFeet(bare()), 0, 'no relief, no rise');
});

// --- roll-out ----------------------------------------------------------------

test('the landing kick follows the fall line: downslope releases, upslope kills', () => {
  const c = bare(5);
  // ground falling to the EAST at 10% — the direction of play
  c.relief = reliefFromHeights(c.width, c.height, (x) => -x * 0.1 * FT_PER_TILE);
  const from = { x: 5, y: 12 };
  const downhill = { x: 15, y: 12 }; // playing east, down the slope
  const uphill = { x: 5, y: 12 };
  const kDown = groundKick(c, from, downhill, downhill);
  assert.ok(kDown.x > 0.1, `a downslope landing releases forward, got ${kDown.x}`);
  assert.ok(Math.abs(kDown.y) < 1e-9, 'a pure east fall line kicks purely east');
  // playing back up the same hill, the kick opposes the shot
  const kUp = groundKick(c, { x: 15, y: 12 }, uphill, uphill);
  const ux = (uphill.x - 15) / Math.abs(uphill.x - 15);
  assert.ok(kUp.x * ux < 0, 'an upslope landing kills the run instead of adding to it');
  // the sampled ball and the pattern feel the same kick — the same function
  const land = sampleLanding(c, from, downhill, 1, 0);
  const flatC = bare(5);
  const flatLand = sampleLanding(flatC, from, downhill, 1, 0);
  assert.ok(land.x >= flatLand.x, 'the real ball runs out downslope too');
  // and the kick is bounded: even a wall does not launch the ball into orbit
  const wall = { ...c, relief: reliefFromHeights(c.width, c.height, (x) => -x * 40) };
  const huge = groundKick(wall, from, downhill, downhill);
  assert.ok(Math.hypot(huge.x, huge.y) <= 0.9 + 1e-9, 'the kick is capped');
});

// --- lie ---------------------------------------------------------------------

test('sloping lies widen the pattern and bias the miss the way a golfer misses', () => {
  const c = bare(6);
  // ground falling to the SOUTH (+y): playing EAST, that is the ball BELOW the
  // feet, which pushes — a miss to the right of the line, i.e. +y in screen
  // coordinates for an eastward shot.
  c.relief = reliefFromHeights(c.width, c.height, (x, y) => -y * 0.08 * FT_PER_TILE);
  const from = { x: 5, y: 12 };
  const target = { x: 17, y: 12 };
  const shot = shotShape(c, from, target);
  assert.ok(shot.crossPct > 7, `the ground falls to the right of the line: ${shot.crossPct}%`);
  assert.ok(shot.bias > 0, 'ball below the feet PUSHES');
  const pts = patternPoints(from, target, 1, undefined, undefined, shot);
  const meanY = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  assert.ok(meanY > target.y + 0.05, `the pattern mean sits right of the line, at y=${meanY}`);

  // mirror the hill and the miss mirrors: ball ABOVE the feet PULLS
  const mirrored = { ...c, relief: reliefFromHeights(c.width, c.height, (x, y) => y * 0.08 * FT_PER_TILE) };
  const pulled = shotShape(mirrored, from, target);
  assert.ok(pulled.bias < 0, 'ball above the feet PULLS');
  assert.ok(Math.abs(pulled.bias + shot.bias) < 1e-9, 'mirror lie, mirror miss');
  const pullPts = patternPoints(from, target, 1, undefined, undefined, pulled);
  assert.ok(pullPts.reduce((s, p) => s + p.y, 0) / pullPts.length < target.y - 0.05);

  // and the sidehill lie itself widens the pattern
  const lie = lieParamsAt(c, from.x, from.y);
  assert.ok(lie.sigmaScale > lieParams(FAIRWAY).sigmaScale,
    `a sidehill stance scatters more: ${lie.sigmaScale}`);
  assert.ok(lie.sigmaScale <= 1.45 + 1e-9, 'but the widening is capped');
  assert.ok(lie.gradePct > 7);
});

// --- putt break: the legacy bridge ------------------------------------------

test('SLOPE_* tiles write into the field: the fall line points where the tile did', () => {
  for (const [tile, dir] of [[SLOPE_N, { x: 0, y: -1 }], [SLOPE_S, { x: 0, y: 1 }],
    [SLOPE_E, { x: 1, y: 0 }], [SLOPE_W, { x: -1, y: 0 }]]) {
    const c = bare(11);
    for (let y = 11; y <= 13; y++) for (let x = 17; x <= 19; x++) setCell(c, x, y, tile);
    // build with the macro landforms suppressed by taking the field of the
    // slope tiles alone — the bridge is what is under test here
    const flat = { width: c.width, height: c.height, ft: new Float32Array(c.width * c.height) };
    const withTiles = buildRelief(c, 11);
    for (let i = 0; i < flat.ft.length; i++) flat.ft[i] = withTiles.ft[i];
    const fl = fallLineAt(withTiles, 18, 12);
    assert.ok(fl.x * dir.x + fl.y * dir.y > 0.5,
      `${tile}: the field falls the way the tile fell, got (${fl.x.toFixed(2)}, ${fl.y.toFixed(2)})`);
    // and at roughly the grade the tile model priced it at (7%)
    const pull = pullAt(withTiles, 18, 12);
    assert.ok(Math.hypot(pull.x, pull.y) > 0.4,
      `${tile}: worth real pull, got ${Math.hypot(pull.x, pull.y).toFixed(2)}`);
    assert.ok(Math.abs(FT_PER_PULL - 3.36) < 1e-9, 'one pull is 3.36 ft of rise per tile of run');
  }
});

test('the continuous break agrees in DIRECTION with the tile model it replaces', () => {
  // the same course, read both ways: with a height field (continuous) and
  // without one (four tile codes). The magnitudes may differ — a smooth field
  // is not a step function — but a putt must never break the other way.
  let agreed = 0;
  let tested = 0;
  for (const tile of [SLOPE_N, SLOPE_S, SLOPE_E, SLOPE_W]) {
    const tiles = bare(11);
    for (let y = 10; y <= 14; y++) for (let x = 16; x <= 20; x++) setCell(tiles, x, y, tile);
    assert.equal(courseHasSlopes(tiles), true);
    const withField = { ...tiles, relief: buildRelief(tiles, 11, { stream: 'relief-test-flat' }) };
    // suppress the macro landform so ONLY the bridge is speaking
    const bridgeOnly = buildRelief(tiles, 11);
    const bare2 = buildRelief(bare(11), 11);
    for (let i = 0; i < bridgeOnly.ft.length; i++) bridgeOnly.ft[i] -= bare2.ft[i];
    withField.relief = bridgeOnly;
    for (const [fx, fy, tx, ty] of [[13, 12, 23, 12], [18, 8, 18, 16], [14, 9, 22, 15]]) {
      const a = puttBreakDrift(tiles, { x: fx, y: fy }, { x: tx, y: ty }).cross;
      const b = puttBreakDrift(withField, { x: fx, y: fy }, { x: tx, y: ty }).cross;
      if (Math.abs(a) < 1e-6) continue;
      tested++;
      if (Math.sign(a) === Math.sign(b)) agreed++;
      assert.equal(Math.sign(a), Math.sign(b),
        `tile ${tile} putt (${fx},${fy})→(${tx},${ty}): tiles ${a.toFixed(4)} vs field ${b.toFixed(4)}`);
    }
  }
  assert.ok(tested >= 6, `enough breaking lines under test: ${tested}`);
  assert.equal(agreed, tested);
});

test('a course with relief breaks continuously; without one it reads tiles', () => {
  const c = relieved(31337);
  assert.equal(courseBreaks(c), true);
  assert.equal(courseHasSlopes(c), false, 'no slope tile anywhere — and it still breaks');
  const from = { x: 29, y: 12 };
  const d = puttBreakDrift(c, from, c.hole);
  assert.ok(Number.isFinite(d.cross));
  assert.ok(Math.abs(d.x * (c.hole.x - from.x) + d.y * (c.hole.y - from.y)) < 1e-9,
    'break stays purely lateral to the roll — pull along the line is pace');
  // deterministic: the same roll reads the same break every time
  assert.deepEqual(puttBreakDrift(c, from, c.hole), puttBreakDrift(c, from, c.hole));
  // and the drift is continuous in the finish point
  const a = puttBreakDrift(c, from, { x: 30, y: 12 }).cross;
  const b = puttBreakDrift(c, from, { x: 30.001, y: 12 }).cross;
  assert.ok(Math.abs(a - b) < 1e-3, `continuous read: ${a} vs ${b}`);
});

test('break follows the cross slope of the field, and mirrors when the field does', () => {
  const c = bare(8);
  // ground falling NORTH (−y): an eastward putt must drift −y
  c.relief = reliefFromHeights(c.width, c.height, (x, y) => y * 0.05 * FT_PER_TILE);
  const n = puttBreakDrift(c, { x: 27, y: 12 }, { x: 31, y: 12 });
  assert.ok(n.y < -0.01, `drifts −y down a north-falling green, got ${n.y}`);
  assert.ok(Math.abs(n.x) < 1e-9);
  // mirror the field, mirror the break
  const mirror = reliefFromHeights(c.width, c.height, (x, y) => -y * 0.05 * FT_PER_TILE);
  const s = puttBreakDrift({ ...c, relief: mirror }, { x: 27, y: 12 }, { x: 31, y: 12 });
  assert.ok(Math.abs(s.y + n.y) < 1e-9, 'mirror slopes, mirror break');
  // a putt straight DOWN the fall line is pure pace: no lateral break at all
  const along = puttBreakDrift(c, { x: 30, y: 8 }, { x: 30, y: 14 });
  assert.ok(Math.abs(along.cross) < 1e-12, 'downhill putts do not break');
});
