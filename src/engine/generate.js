// Procedural course generator. A staged pipeline of seeded steps:
// archetype → spine walk → fairway buffer → hazards biased onto the
// direct line → green stamp → corridor guarantee. Every step draws from
// a named RNG substream so future features never reshuffle old seeds.

import { substream, randInt, pick, pickWeighted } from './rng.js';
import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN } from './terrain.js';
import { makeCourse, inBounds, cellAt, setCell } from './course.js';

export const GEN_VERSION = 1;

export const ARCHETYPES = ['straight', 'dogleg-left', 'dogleg-right', 'long'];

/** @param {number} seed @returns {import('./course.js').Course} */
export function generateCourse(seed) {
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
  const holeX = archetype === 'long' ? width - 2 : randInt(layout, width - 6, width - 3);
  const hole = { x: holeX, y: randInt(layout, 5, height - 6) };
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

  // Green: a disc around the hole, clearing any hazard that landed on it.
  stampDisc(course, hole.x, hole.y, 2.5, GREEN);

  // Corridor guarantee: the spine itself is always playable fairway, so a
  // route from tee to green exists on every seed by construction.
  for (const p of spine) {
    if (cellAt(course, p.x, p.y) !== GREEN) setCell(course, p.x, p.y, FAIRWAY);
  }
  setCell(course, tee.x, tee.y, FAIRWAY);

  return course;
}

function stampDisc(course, cx, cy, radius, terrain) {
  const r = Math.ceil(radius);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (Math.hypot(x - cx, y - cy) <= radius) setCell(course, x, y, terrain);
    }
  }
}
