// Game state: one serializable object. Undo, replays, and share links all
// fall out of keeping the entire state in {seed, start, strokes, history}.

import { generateCourse } from './generate.js';
import { resolveShot } from './shots.js';

/**
 * @typedef {{
 *   course: import('./course.js').Course,
 *   start: {x: number, y: number},
 *   ball: {x: number, y: number},
 *   strokes: number,
 *   holed: boolean,
 *   history: Array<{shot: {club: string, angle: number, power: number}, ball: {x: number, y: number}, event: string}>
 * }} Game
 */

/** @param {number} seed @param {{x:number,y:number}} [ballStart] @returns {Game} */
export function createGame(seed, ballStart) {
  const course = generateCourse(seed);
  const start = ballStart ? { ...ballStart } : { ...course.tee };
  return {
    course,
    start,
    ball: { ...start },
    strokes: 0,
    holed: false,
    history: [],
  };
}

/** Apply a shot, returning a new game state. */
export function applyShot(game, shot) {
  if (game.holed) return game;
  const result = resolveShot(game.course, game.ball, shot, game.strokes);
  return {
    ...game,
    ball: { ...result.ball },
    strokes: game.strokes + 1 + result.penalty,
    holed: result.holed,
    history: [...game.history, { shot, ball: { ...result.ball }, event: result.event }],
  };
}

/** Rewind one shot by replaying the rest of history from the start. */
export function undoShot(game) {
  if (game.history.length === 0) return game;
  let g = createGame(game.course.seed, game.start);
  for (const entry of game.history.slice(0, -1)) g = applyShot(g, entry.shot);
  return g;
}
