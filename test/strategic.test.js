// Release D — the strategic generator.
//
// Two things are being defended here. The first is the SEAM: `strategic.js`
// owns the ground out to `GREEN_KEEPOUT` tiles from the cup and `greens.js`
// owns everything inside it, and the only way to know that stays true is to
// diff the tiles and check where they moved. The second is that the fork is
// REAL GROUND — that both arms of the decision are places you can actually hit
// a ball to, reachable in one swing and not quietly buried in the hazard the
// same function just laid down.

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateCourse } from '../src/engine/generate.js';
import {
  TEMPLATES, GREEN_KEEPOUT, LZ_MIN_HOLE, LZ_SHAPE, applyStrategicPlan,
} from '../src/engine/strategic.js';
import { GREEN_ARCHETYPES } from '../src/engine/greens.js';
import { cellAt, inBounds } from '../src/engine/course.js';
import { FAIRWAY, GREEN, SAND, WATER, ROUGH, isRestable } from '../src/engine/terrain.js';
import { MAX_CARRY } from '../src/engine/dispersion.js';

const SEEDS = [];
for (let i = 0; i < 120; i++) SEEDS.push((77000 + i * 7919) >>> 0);

/** A par-4-ish hole, strategic and classic, from the same seed. */
function pair(seed, len = 24, opts = {}) {
  const base = { holeDistTiles: len, ...opts };
  return {
    classic: generateCourse(seed, 'classic', base),
    strategic: generateCourse(seed, 'classic', { ...base, strategic: true }),
  };
}

test('strategic routing is opt-in: without the flag nothing changes', () => {
  for (const seed of SEEDS.slice(0, 25)) {
    const a = generateCourse(seed, 'classic', { holeDistTiles: 24 });
    const b = generateCourse(seed, 'classic', { holeDistTiles: 24, strategic: false });
    assert.deepEqual([...a.cells], [...b.cells]);
    assert.equal(a.strategy, undefined, 'a non-strategic course carries no plan');
  }
});

test('the same seed builds the same strategic hole every time', () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const a = generateCourse(seed, 'classic', { holeDistTiles: 26, strategic: true });
    const b = generateCourse(seed, 'classic', { holeDistTiles: 26, strategic: true });
    assert.deepEqual([...a.cells], [...b.cells]);
    assert.deepEqual(a.strategy, b.strategy);
  }
});

test('THE SEAM: strategic never writes a tile inside the green complex', () => {
  // Isolate strategic exactly by holding the green fixed (legacyGreen) on both
  // sides, so every differing tile is one this module wrote and no other.
  let checked = 0;
  for (const seed of SEEDS.slice(0, 40)) {
    for (const len of [20, 24, 30]) {
      const base = { holeDistTiles: len, legacyGreen: true };
      const a = generateCourse(seed, 'classic', base);
      const b = generateCourse(seed, 'classic', { ...base, strategic: true });
      for (let y = 0; y < a.height; y++) {
        for (let x = 0; x < a.width; x++) {
          const i = y * a.width + x;
          if (a.cells[i] === b.cells[i]) continue;
          const d = Math.hypot(x - a.hole.x, y - a.hole.y);
          assert.ok(d > GREEN_KEEPOUT,
            `seed ${seed} len ${len}: tile ${x},${y} moved ${d.toFixed(1)} tiles from the cup`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 500, `expected the plan to move real ground, moved ${checked} tiles`);
});

test('the green itself is never overwritten, and the tee is never buried', () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const { classic, strategic } = pair(seed, 26, { legacyGreen: true });
    assert.equal(cellAt(strategic, strategic.tee.x, strategic.tee.y), FAIRWAY);
    for (let i = 0; i < classic.cells.length; i++) {
      if (classic.cells[i] === GREEN) assert.equal(strategic.cells[i], GREEN);
    }
  }
});

test('par 4s and 5s get a landing zone; one-shotters do not', () => {
  for (const seed of SEEDS.slice(0, 30)) {
    const short = generateCourse(seed, 'classic', { holeDistTiles: 13, strategic: true });
    assert.equal(short.strategy.targets, null, 'a par 3 has no driver-range fork to build');
    assert.equal(short.strategy.carryBand, null);

    const long = generateCourse(seed, 'classic', { holeDistTiles: 26, strategic: true });
    assert.ok(long.strategy.targets, 'a par 4 has both arms of the fork');
    assert.ok(long.strategy.carryBand);
  }
});

test('LZ_MIN_HOLE is the boundary, and it is respected exactly', () => {
  const seed = SEEDS[3];
  const under = generateCourse(seed, 'classic', { holeDistTiles: LZ_MIN_HOLE - 1, strategic: true });
  const over = generateCourse(seed, 'classic', { holeDistTiles: LZ_MIN_HOLE + 3, strategic: true });
  assert.equal(under.strategy.targets, null);
  assert.ok(over.strategy.targets);
});

test('BOTH ARMS ARE REAL: each target is restable ground, in bounds', () => {
  let n = 0;
  for (const seed of SEEDS.slice(0, 50)) {
    for (const len of [21, 24, 28, 32]) {
      const c = generateCourse(seed, 'classic', { holeDistTiles: len, strategic: true });
      const t = c.strategy.targets;
      if (!t) continue;
      for (const [name, p] of Object.entries(t)) {
        assert.ok(inBounds(c, p.x, p.y), `seed ${seed}: ${name} target off the board`);
        const cell = cellAt(c, p.x, p.y);
        assert.ok(isRestable(cell), `seed ${seed} len ${len}: ${name} target is not restable`);
        assert.notEqual(cell, WATER, `seed ${seed}: ${name} target is in the water`);
        assert.notEqual(cell, SAND, `seed ${seed}: ${name} target is in the sand`);
        n++;
      }
    }
  }
  assert.ok(n > 200);
});

test('BOTH ARMS ARE REACHABLE: neither aim point is beyond a full swing', () => {
  for (const seed of SEEDS.slice(0, 50)) {
    for (const len of [21, 24, 28, 32]) {
      const c = generateCourse(seed, 'classic', { holeDistTiles: len, strategic: true });
      const t = c.strategy.targets;
      if (!t) continue;
      for (const [name, p] of Object.entries(t)) {
        const d = Math.hypot(p.x - c.tee.x, p.y - c.tee.y);
        // The bug this test exists for: the first draft placed the aggressive
        // target at `lzDist` ALONG the line and five tiles off it, which is
        // sixteen tiles of carry against a fifteen-tile driver. `evaluateAim`
        // prices that at Infinity, so the aggressive line did not exist and the
        // fork could not form. Aim points live on arcs of constant carry now.
        assert.ok(d <= MAX_CARRY,
          `seed ${seed} len ${len}: ${name} target needs ${d.toFixed(1)} tiles, driver goes ${MAX_CARRY}`);
      }
    }
  }
});

test('the carry is a real carry: the band lies between the lay-up and the shelf', () => {
  let banded = 0;
  for (const seed of SEEDS.slice(0, 50)) {
    const c = generateCourse(seed, 'classic', { holeDistTiles: 27, strategic: true });
    const s = c.strategy;
    if (!s.carryBand) continue;
    assert.ok(s.carryBand.far > s.carryBand.near, 'the band has depth');
    assert.ok(s.targets.bail.carry < s.carryBand.near,
      `seed ${seed}: the lay-up (${s.targets.bail.carry}) is not short of the band (${s.carryBand.near})`);
    assert.ok(s.targets.aggressive.carry > s.carryBand.far - 0.9,
      `seed ${seed}: the carry target (${s.targets.aggressive.carry}) does not clear the band (${s.carryBand.far})`);
    banded++;
  }
  assert.ok(banded > 30);
});

test('the band actually spans the line of play — there is no free way round', () => {
  let checked = 0;
  for (const seed of SEEDS.slice(0, 40)) {
    const c = generateCourse(seed, 'classic', { holeDistTiles: 28, strategic: true });
    const s = c.strategy;
    if (!s.carryBand) continue;
    const d = Math.hypot(c.hole.x - c.tee.x, c.hole.y - c.tee.y);
    const ax = (c.hole.x - c.tee.x) / d;
    const ay = (c.hole.y - c.tee.y) / d;
    const mid = (s.carryBand.near + s.carryBand.far) / 2;
    const x = Math.round(c.tee.x + ax * mid);
    const y = Math.round(c.tee.y + ay * mid);
    const cell = cellAt(c, x, y);
    assert.ok(cell === SAND || cell === WATER,
      `seed ${seed}: the line of play at ${mid} tiles is ${cell}, not hazard`);
    checked++;
  }
  assert.ok(checked > 25);
});

test('shelfSide is the flank away from the tuck, always', () => {
  for (const seed of SEEDS) {
    const c = generateCourse(seed, 'classic', { holeDistTiles: 25, strategic: true });
    assert.equal(c.strategy.shelfSide, -c.strategy.tuckSide);
    assert.equal(c.strategy.sideName, c.strategy.shelfSide > 0 ? 'right' : 'left');
  }
});

test('the cup is tucked on the side the plan asked for', () => {
  // A preference, not a guarantee — a green that cannot certify with the cup on
  // the requested flank is allowed to reroll freely. So this asserts a strong
  // majority, which is what a preference honoured means.
  let honoured = 0;
  let total = 0;
  for (const seed of SEEDS) {
    const c = generateCourse(seed, 'classic', { holeDistTiles: 25, strategic: true });
    const s = c.strategy;
    const g = c.green;
    const dx = c.hole.x - g.center.x;
    const dy = c.hole.y - g.center.y;
    if (Math.hypot(dx, dy) < 0.5) continue; // a centred cup has no side
    const side = Math.sign(dx * s.perp.x + dy * s.perp.y);
    total++;
    if (side === s.tuckSide) honoured++;
  }
  assert.ok(total > 60, `expected off-centre cups to measure, got ${total}`);
  assert.ok(honoured / total > 0.75,
    `cup tucked on the requested flank only ${((honoured / total) * 100).toFixed(0)}% of the time`);
});

test('every template appears, and none dominates', () => {
  const counts = Object.fromEntries(TEMPLATES.map((t) => [t, 0]));
  const lens = [13, 15, 21, 24, 27, 31];
  let n = 0;
  for (const seed of SEEDS) {
    for (const len of lens) {
      const c = generateCourse(seed, 'classic', { holeDistTiles: len, strategic: true });
      counts[c.strategy.template]++;
      n++;
    }
  }
  for (const t of TEMPLATES) {
    assert.ok(counts[t] > 0, `template ${t} never appeared in ${n} holes`);
  }
  assert.ok(counts.none / n < 0.62, `plain holes are ${((counts.none / n) * 100).toFixed(0)}% of the field`);
  assert.ok(counts.none / n > 0.20, 'a course of nothing but famous holes is a theme park');
});

test('a template gets the green it asked for, most of the time', () => {
  // Same contract as the tuck: `prefer` is a weight, and a hillside that cannot
  // hold a Redan is not made to.
  const asks = { redan: 'long-narrow', punchbowl: 'punchbowl', short: 'crowned', cape: 'kidney' };
  let asked = 0;
  let got = 0;
  for (const seed of SEEDS) {
    for (const len of [13, 15, 22, 26, 31]) {
      const c = generateCourse(seed, 'classic', { holeDistTiles: len, strategic: true });
      const want = asks[c.strategy.template];
      if (!want) continue;
      asked++;
      if (c.green.archetype === want) got++;
    }
  }
  assert.ok(asked > 80, `expected templates with a green preference, got ${asked}`);
  const base = 1 / GREEN_ARCHETYPES.length;
  assert.ok(got / asked > base * 2.5,
    `preference honoured ${((got / asked) * 100).toFixed(0)}%, barely above the ${(base * 100).toFixed(0)}% a coin would give`);
});

test('the ground the widener mows lands on the BAIL side', () => {
  // Measured as the diff — tiles that were rough on the classic hole and are
  // fairway on the strategic one — because that is exactly what this stage
  // does. Two earlier versions of this test measured total fairway and then
  // fairway-by-side across the whole hole, and both read as noise: the classic
  // layout's own shape (a spine that wanders a tile per step, tree clumps, the
  // hazard blobs) swamps the signal in either. Diff the ground that MOVED.
  let win = 0;
  const ratios = [];
  for (const seed of SEEDS.slice(0, 40)) {
    const { classic, strategic } = pair(seed, 26, { legacyGreen: true });
    const s = strategic.strategy;
    let bail = 0;
    let shelf = 0;
    for (let y = 0; y < classic.height; y++) {
      for (let x = 0; x < classic.width; x++) {
        const i = y * classic.width + x;
        if (classic.cells[i] !== ROUGH || strategic.cells[i] !== FAIRWAY) continue;
        const off = (x - strategic.tee.x) * s.perp.x + (y - strategic.tee.y) * s.perp.y;
        if (Math.sign(off) === s.shelfSide) shelf++;
        else bail++;
      }
    }
    ratios.push(bail / Math.max(1, shelf));
    if (bail > shelf) win++;
    assert.ok(s.width.wide > s.width.tight, 'the bail-out side must be the generous one');
  }
  assert.ok(win >= 33, `only ${win}/40 holes mowed more ground on the bail side`);
  ratios.sort((a, b) => a - b);
  assert.ok(ratios[20] > 2.5, `median bail:shelf ratio only ${ratios[20].toFixed(2)}`);
});

test('LZ_SHAPE is the tuning surface, and it is what the generator reads', () => {
  // Not a vanity assertion: the geometry was tuned by sweeping this table
  // against certify.js, and a literal that crept back into the function would
  // silently detune the release.
  const seed = SEEDS[7];
  const before = generateCourse(seed, 'classic', { holeDistTiles: 28, strategic: true });
  const saved = LZ_SHAPE.farMargin;
  LZ_SHAPE.farMargin = [4.5, 0.2];
  const after = generateCourse(seed, 'classic', { holeDistTiles: 28, strategic: true });
  LZ_SHAPE.farMargin = saved;
  assert.ok(after.strategy.carryBand.near < before.strategy.carryBand.near - 1.5,
    'moving farMargin must move the band');
  const again = generateCourse(seed, 'classic', { holeDistTiles: 28, strategic: true });
  assert.deepEqual(again.strategy.carryBand, before.strategy.carryBand, 'and restoring it must restore the hole');
});

test('applyStrategicPlan is pure in its inputs: no spine, no crash', () => {
  const c = generateCourse(SEEDS[1], 'classic', { holeDistTiles: 24, legacyGreen: true });
  const plan = applyStrategicPlan(c, c.seed, {});
  assert.ok(plan.template);
  assert.ok(Array.isArray(plan.notes) && plan.notes.length > 0);
  assert.equal(cellAt(c, c.tee.x, c.tee.y), FAIRWAY);
});

test('a strategic hole still has ordinary ground on it', () => {
  // The failure this catches: an early draft buried the whole landing zone, and
  // `patternStats` reported 100% of the pattern in trouble. A hole with no
  // grass is not a hard hole, it is a broken one.
  for (const seed of SEEDS.slice(0, 40)) {
    const c = generateCourse(seed, 'classic', { holeDistTiles: 26, strategic: true });
    let fairway = 0;
    let hazard = 0;
    for (const t of c.cells) {
      if (t === FAIRWAY) fairway++;
      else if (t === SAND || t === WATER) hazard++;
    }
    const playable = fairway + c.cells.reduce((n, t) => n + (t === ROUGH ? 1 : 0), 0);
    assert.ok(hazard < playable, `seed ${seed}: ${hazard} hazard tiles against ${playable} playable`);
    assert.ok(fairway > 60, `seed ${seed}: only ${fairway} fairway tiles left`);
  }
});
