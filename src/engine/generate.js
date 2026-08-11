// Procedural course generator. A staged pipeline of seeded steps:
// archetype → spine walk → fairway buffer → hazards biased onto the
// direct line → green stamp → corridor guarantee. Every step draws from
// a named RNG substream so future features never reshuffle old seeds.

import { substream, randInt, pick, pickWeighted } from './rng.js';
import {
  FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE,
  SLOPE_N, SLOPE_S, SLOPE_E, SLOPE_W,
} from './terrain.js';
import { makeCourse, inBounds, cellAt, setCell, dist } from './course.js';
import { buildRelief } from './relief.js';
import { applyGreenComplex } from './greens.js';

export const GEN_VERSION = 1;

export const ARCHETYPES = ['straight', 'dogleg-left', 'dogleg-right', 'long'];

// Biomes layer extra terrain over the classic pipeline via their own RNG
// substreams, so a classic course is byte-identical whether or not biomes
// exist in the codebase — already-shared seeds are sacred.
export const BIOMES = ['classic', 'winter', 'alpine', 'links'];

/**
 * @param {number} seed
 * @param {string} [biome]
 * @param {{holeDistTiles?: number, legacyGreen?: boolean}} [opts]
 *   `holeDistTiles` is the hole-length override (used by Caddie's par-3/4/5
 *   holes); omitting it reproduces the classic full-span routing byte-for-byte —
 *   draws happen in the same stream order. `legacyGreen` keeps the pre-release-C
 *   2.5-tile disc instead of a shaped green complex: the arcade's certified
 *   puzzles ask for it so already-shared holes play exactly as recorded.
 * @returns {import('./course.js').Course}
 */
export function generateCourse(seed, biome = 'classic', opts = null) {
  const layout = substream(seed, 'layout');
  const hazards = substream(seed, 'hazards');

  const archetype = pickWeighted(layout, [
    ['straight', 25],
    ['dogleg-left', 20],
    ['dogleg-right', 20],
    ['long', 35],
  ]);

  const course = makeCourse(seed, archetype, GEN_VERSION);
  const { width, height } = course;

  // Tee on the left edge band, hole on the right edge band.
  const tee = { x: randInt(layout, 1, 3), y: randInt(layout, 6, height - 7) };
  let holeX = archetype === 'long' ? width - 2 : randInt(layout, width - 6, width - 3);
  if (opts?.holeDistTiles) {
    holeX = Math.max(8, Math.min(width - 2, tee.x + Math.round(opts.holeDistTiles)));
  }
  const hole = { x: holeX, y: randInt(layout, 5, height - 6) };
  if (opts?.holeDistTiles) {
    // keep short holes short: bound the vertical offset so a par 3 doesn't
    // secretly play like a par 4 on the diagonal
    const half = Math.max(3, Math.round(opts.holeDistTiles * 0.35));
    hole.y = Math.max(5, Math.min(height - 6, Math.max(tee.y - half, Math.min(tee.y + half, hole.y))));
  }
  course.tee = tee;
  course.hole = hole;

  // Control points: doglegs bend 30–60% of the way along, off the direct line.
  const controls = [tee];
  if (archetype === 'dogleg-left' || archetype === 'dogleg-right') {
    const t = 0.35 + layout() * 0.3;
    const bendX = Math.round(tee.x + (hole.x - tee.x) * t);
    const offset = randInt(layout, 4, 7) * (archetype === 'dogleg-left' ? -1 : 1);
    const bendY = Math.min(height - 3, Math.max(2, Math.round(tee.y + (hole.y - tee.y) * t) + offset));
    controls.push({ x: bendX, y: bendY });
  }
  controls.push(hole);

  // Spine: jittered interpolation between control points, one point per column step.
  const spine = [];
  for (let i = 0; i < controls.length - 1; i++) {
    const a = controls[i];
    const b = controls[i + 1];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const jitter = s > 0 && s < steps ? randInt(layout, -1, 1) : 0;
      spine.push({
        x: Math.round(a.x + (b.x - a.x) * t),
        y: Math.min(height - 2, Math.max(1, Math.round(a.y + (b.y - a.y) * t) + jitter)),
      });
    }
  }

  // Fairway: a buffer around the spine, width modulated per segment.
  for (const p of spine) {
    stampDisc(course, p.x, p.y, randInt(layout, 1, 2) + 0.5, FAIRWAY);
  }

  // Tree clusters: clump-growth in rough only — they frame the hole and
  // punish wild lines, but never spawn on the fairway corridor.
  const clumps = randInt(hazards, 6, 10);
  for (let c = 0; c < clumps; c++) {
    let x = randInt(hazards, 0, width - 1);
    let y = randInt(hazards, 0, height - 1);
    for (let g = randInt(hazards, 3, 8); g > 0; g--) {
      if (inBounds(course, x, y) && cellAt(course, x, y) === ROUGH) setCell(course, x, y, TREES);
      x += randInt(hazards, -1, 1);
      y += randInt(hazards, -1, 1);
    }
  }

  // Sand and water: biased toward the direct tee→hole line so hazards
  // threaten the obvious route instead of decorating the margins.
  const blobs = randInt(hazards, 3, 5);
  for (let b = 0; b < blobs; b++) {
    const t = 0.25 + hazards() * 0.55;
    const cx = Math.round(tee.x + (hole.x - tee.x) * t + randInt(hazards, -3, 3));
    const cy = Math.round(tee.y + (hole.y - tee.y) * t + randInt(hazards, -4, 4));
    const kind = pick(hazards, [SAND, SAND, WATER]);
    stampDisc(course, cx, cy, kind === WATER ? randInt(hazards, 2, 3) : randInt(hazards, 1, 2), kind);
  }

  // Green: a disc around the hole, clearing any hazard that landed on it. Green
  // architecture (below) replaces this footprint with a real shape — but the
  // disc is stamped FIRST regardless, so the corridor guarantee and the height
  // field are conditioned against exactly the ground they always were.
  stampDisc(course, hole.x, hole.y, 2.5, GREEN);

  // Corridor guarantee: the spine itself is always playable fairway, so a
  // route from tee to green exists on every seed by construction.
  for (const p of spine) {
    if (cellAt(course, p.x, p.y) !== GREEN) setCell(course, p.x, p.y, FAIRWAY);
  }
  setCell(course, tee.x, tee.y, FAIRWAY);

  course.biome = biome;
  if (biome === 'winter') addIce(course);
  else if (biome === 'alpine') addSlopes(course);
  else if (biome === 'links') makeLinks(course);

  // The land: relief draws from its OWN named substream and only ever reads the
  // finished tile layout, so the height field of every classic seed is
  // byte-identical to release B's — the regression contract, pinned in
  // relief.test.js.
  course.relief = buildRelief(course, seed);

  // The green complex, LAST: its own named substreams, drawn after every layout
  // draw above, reading the finished layout and the finished land. It replaces
  // the disc's footprint with a real shaped green, its hazards by role, and its
  // pin — so the fairway, trees and hazard blobs of an existing seed cannot move,
  // only the ground of the complex itself. `legacyGreen` keeps the disc: the
  // arcade's certified puzzles (puzzle.js) take that path, which is why
  // golden.test.js stays byte-identical.
  if (!opts?.legacyGreen) applyGreenComplex(course, seed, { spine });

  return course;
}

/**
 * Links: open, windy, treeless ground. Most trees become rough, pot bunkers
 * dot the margins, and a constant wind bends every airborne shot — the
 * ground game (putter runs) is the sheltered answer.
 */
function makeLinks(course) {
  const rng = substream(course.seed, 'links');
  for (let i = 0; i < course.cells.length; i++) {
    if (course.cells[i] === TREES && rng() < 0.85) course.cells[i] = ROUGH;
  }
  const pots = randInt(rng, 3, 6);
  for (let i = 0; i < pots; i++) {
    overlayDisc(course, randInt(rng, 4, course.width - 5), randInt(rng, 2, course.height - 3), 1, () => SAND);
  }
  const windRng = substream(course.seed, 'wind');
  const dirs = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
  ];
  const dir = pick(windRng, dirs);
  const strength = randInt(windRng, 1, 2);
  course.wind = { x: dir.x * strength, y: dir.y * strength };
}

/** Winter: frozen patches on the playing surfaces. Ice keeps the ball moving. */
function addIce(course) {
  const rng = substream(course.seed, 'ice');
  const patches = randInt(rng, 4, 7);
  for (let i = 0; i < patches; i++) {
    const cx = randInt(rng, 4, course.width - 5);
    const cy = randInt(rng, 2, course.height - 3);
    const radius = randInt(rng, 1, 2) + 0.5;
    overlayDisc(course, cx, cy, radius, () => ICE);
  }
}

/** Alpine: directional slope strips that shed the ball downhill. */
function addSlopes(course) {
  const rng = substream(course.seed, 'slopes');
  const strips = randInt(rng, 5, 9);
  for (let i = 0; i < strips; i++) {
    const cx = randInt(rng, 4, course.width - 5);
    const cy = randInt(rng, 2, course.height - 3);
    const slope = pick(rng, [SLOPE_N, SLOPE_S, SLOPE_E, SLOPE_W]);
    const radius = randInt(rng, 1, 2);
    overlayDisc(course, cx, cy, radius + 0.5, () => slope);
  }
}

/** Stamp over fairway/rough only — hazards, green, tee and hole are immune. */
function overlayDisc(course, cx, cy, radius, terrainFor) {
  const r = Math.ceil(radius);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (Math.hypot(x - cx, y - cy) > radius || !inBounds(course, x, y)) continue;
      const t = cellAt(course, x, y);
      if (t !== FAIRWAY && t !== ROUGH) continue;
      if (x === course.tee.x && y === course.tee.y) continue;
      if (dist({ x, y }, course.hole) <= 3) continue;
      setCell(course, x, y, terrainFor());
    }
  }
}

function stampDisc(course, cx, cy, radius, terrain) {
  const r = Math.ceil(radius);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (Math.hypot(x - cx, y - cy) <= radius) setCell(course, x, y, terrain);
    }
  }
}
