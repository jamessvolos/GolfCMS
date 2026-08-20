// The aerial classifier's thresholds, pinned against synthetic imagery: each
// terrain gets a color distribution with realistic jitter, drawn from a
// seeded RNG so a threshold tweak that breaks a class fails loudly here —
// not silently in someone's traced hole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rgbToHsv, classifyAerialTile, smoothCells, detectTerrain,
} from '../src/engine/aerial.js';
import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN } from '../src/engine/terrain.js';
import { encodeGridPatch, decodePatch, applyPatch } from '../src/engine/patch.js';
import { mulberry32 } from '../src/engine/rng.js';

const rng = mulberry32(20260815);
const jitter = (base, spread) => Math.max(0, Math.min(255,
  Math.round(base + (rng() * 2 - 1) * spread)));

/** n samples around an RGB base color, ±spread per channel. */
const cloud = (n, [r, g, b], spread) =>
  Array.from({ length: n }, () => [jitter(r, spread), jitter(g, spread), jitter(b, spread)]);

/** Canopy: a dark/darker speckle mix — high variance is the signature. */
const canopy = (n) => Array.from({ length: n }, () =>
  rng() < 0.5
    ? [jitter(40, 18), jitter(70, 18), jitter(35, 18)]
    : [jitter(22, 12), jitter(45, 12), jitter(24, 12)]);

test('rgbToHsv hits the corners', () => {
  assert.deepEqual(rgbToHsv(255, 0, 0).h, 0);
  assert.equal(Math.round(rgbToHsv(0, 255, 0).h), 120);
  assert.equal(Math.round(rgbToHsv(0, 0, 255).h), 240);
  assert.equal(rgbToHsv(0, 0, 0).v, 0);
  assert.equal(rgbToHsv(255, 255, 255).s, 0);
});

test('each terrain class is recovered from its color cloud', () => {
  assert.equal(classifyAerialTile(cloud(36, [90, 160, 70], 12)), FAIRWAY, 'fairway');
  assert.equal(classifyAerialTile(cloud(36, [112, 122, 62], 14)), ROUGH, 'rough');
  assert.equal(classifyAerialTile(cloud(36, [205, 180, 130], 14)), SAND, 'sand');
  assert.equal(classifyAerialTile(cloud(36, [50, 90, 150], 14)), WATER, 'water');
  assert.equal(classifyAerialTile(canopy(36)), TREES, 'trees');
  assert.equal(
    classifyAerialTile(cloud(36, [95, 185, 75], 5), { nearPin: true }), GREEN,
    'putting green near the pin');
});

test('a bright uniform green far from the cup is NOT a putting green', () => {
  const t = classifyAerialTile(cloud(36, [95, 185, 75], 5), { nearPin: false });
  assert.notEqual(t, TREES);
  assert.notEqual(t, WATER); // sanity: it's grass of some kind
});

test('hazards claim mixed tiles below majority', () => {
  const mixed = [...cloud(14, [50, 90, 150], 10), ...cloud(22, [90, 160, 70], 10)];
  assert.equal(classifyAerialTile(mixed), WATER, 'pond edge still plays as water');
});

test('empty or missing samples fail closed to rough', () => {
  assert.equal(classifyAerialTile([]), ROUGH);
  assert.equal(classifyAerialTile(null), ROUGH);
});

test('smoothCells kills salt-and-pepper but keeps regions', () => {
  const W = 5, H = 5;
  const cells = new Array(W * H).fill(FAIRWAY);
  cells[2 * W + 2] = WATER; // one lonely pond pixel in the fairway
  const out = smoothCells(cells, W, H);
  assert.equal(out[2 * W + 2], FAIRWAY, 'single-tile noise removed');
  const half = cells.map((_, i) => (i % W < 2 ? SAND : FAIRWAY));
  const out2 = smoothCells(half, W, H);
  assert.equal(out2[0], SAND, 'coherent region survives smoothing');
  assert.equal(out2[W - 1], FAIRWAY);
});

test('detectTerrain recovers a synthetic hole layout', () => {
  // a toy 12×8 hole: rough frame, fairway ribbon, pond, bunker, green at the cup
  const W = 12, H = 8;
  const hole = { x: 10, y: 4 };
  const plan = (x, y) => {
    if (Math.hypot(x - hole.x, y - hole.y) <= 1.5) return GREEN;
    if (x >= 2 && x <= 10 && y >= 3 && y <= 5) return FAIRWAY;
    if (x >= 4 && x <= 5 && y <= 1) return WATER;
    if (x === 8 && y === 6) return SAND; // a pot bunker: margin smoothing keeps it
    return ROUGH;
  };
  const COLOR = {
    [GREEN]: [95, 185, 75], [FAIRWAY]: [90, 160, 70], [ROUGH]: [112, 122, 62],
    [WATER]: [50, 90, 150], [SAND]: [205, 180, 130],
  };
  const SPREAD = { [GREEN]: 5, [FAIRWAY]: 12, [ROUGH]: 14, [WATER]: 12, [SAND]: 12 };
  const t = (x, y) => plan(x, y);
  const cells = detectTerrain({
    width: W, height: H, hole,
    tileSamples: (x, y) => cloud(36, COLOR[t(x, y)], SPREAD[t(x, y)]),
  });
  let agree = 0, total = 0, wetRight = 0, wetPlanned = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const want = plan(x, y);
      const got = cells[y * W + x];
      total++;
      if (want === got) agree++;
      if (want === WATER) { wetPlanned++; if (got === WATER) wetRight++; }
    }
  }
  assert.ok(agree / total >= 0.85, `layout recovery ${(agree / total * 100).toFixed(0)}% < 85%`);
  assert.ok(wetRight / wetPlanned >= 0.75, 'the pond must survive detection');
  assert.equal(cells[hole.y * W + hole.x], GREEN, 'the cup sits on green');
});

test('grid patch: encode → decode → apply round-trips a full board', () => {
  const W = 6, H = 4;
  const painted = Array.from({ length: W * H }, (_, i) => i % 6); // every terrain 0..5
  const str = encodeGridPatch(painted);
  assert.match(str, /^g[0-9a-f]{24}$/);
  const base = {
    width: W, height: H, cells: new Array(W * H).fill(ROUGH),
    tee: { x: 0, y: 0 }, hole: { x: 5, y: 3 },
  };
  const rebuilt = applyPatch(base, decodePatch(str));
  for (let i = 0; i < W * H; i++) {
    const teeI = base.tee.y * W + base.tee.x;
    const holeI = base.hole.y * W + base.hole.x;
    if (i === teeI || i === holeI) continue; // anchors are immutable, by design
    assert.equal(rebuilt.cells[i], painted[i]);
  }
  assert.throws(() => encodeGridPatch([]), /bad grid size/);
  assert.throws(() => decodePatch('gzz'), /malformed grid/);
  assert.throws(() => decodePatch('gf'), /unknown terrain/); // 15 doesn't exist
});
