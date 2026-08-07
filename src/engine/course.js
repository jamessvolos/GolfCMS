// Course model: a rectangular tile grid plus tee, hole, and metadata.
// A course is fully determined by (generatorVersion, seed) — nothing here
// is ever hand-edited; regenerate rather than mutate.

import { ROUGH } from './terrain.js';

export const WIDTH = 40;
export const HEIGHT = 24;

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {{
 *   width: number, height: number,
 *   cells: number[],            // row-major terrain codes
 *   tee: Point, hole: Point,
 *   seed: number, archetype: string, genVersion: number
 * }} Course
 */

export function makeCourse(seed, archetype, genVersion) {
  return {
    width: WIDTH,
    height: HEIGHT,
    cells: new Array(WIDTH * HEIGHT).fill(ROUGH),
    tee: { x: 0, y: 0 },
    hole: { x: 0, y: 0 },
    seed,
    archetype,
    genVersion,
  };
}

export function inBounds(course, x, y) {
  return x >= 0 && x < course.width && y >= 0 && y < course.height;
}

export function cellAt(course, x, y) {
  return course.cells[y * course.width + x];
}

export function setCell(course, x, y, terrain) {
  if (inBounds(course, x, y)) course.cells[y * course.width + x] = terrain;
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
