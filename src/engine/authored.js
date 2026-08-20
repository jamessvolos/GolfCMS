// Hand-authored holes, drawn as ASCII string art. These are the human
// baseline for the blind A/B gate (ab.html): if players can't tell the
// generator's output from these, the generator passes.
//
// Legend: '.'=fairway ','=rough 's'=sand 'w'=water 't'=trees 'g'=green
// 'i'=ice '^'=slope-n 'v'=slope-s '>'=slope-e '<'=slope-w
// 'T'=tee (on fairway) 'H'=hole (on green). Exactly one T and one H.

import {
  FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE,
  SLOPE_N, SLOPE_S, SLOPE_E, SLOPE_W,
} from './terrain.js';
import { makeCourse, setCell, WIDTH, HEIGHT } from './course.js';

const LEGEND = {
  '.': FAIRWAY,
  ',': ROUGH,
  s: SAND,
  w: WATER,
  t: TREES,
  g: GREEN,
  i: ICE,
  '^': SLOPE_N,
  v: SLOPE_S,
  '>': SLOPE_E,
  '<': SLOPE_W,
};

/**
 * Parse ASCII art into a playable course. Strict: the art must be exactly
 * HEIGHT rows of WIDTH characters, every character in the legend, with
 * exactly one tee 'T' and one hole 'H'.
 * @param {string[]} art
 * @returns {import('./course.js').Course}
 */
export function parseArt(art) {
  if (!Array.isArray(art) || art.length !== HEIGHT) {
    throw new Error(`art must be ${HEIGHT} rows, got ${art?.length}`);
  }
  const course = makeCourse(0, 'authored', 1);
  let tee = null;
  let hole = null;
  for (let y = 0; y < HEIGHT; y++) {
    const row = art[y];
    if (typeof row !== 'string' || row.length !== WIDTH) {
      throw new Error(`row ${y} must be ${WIDTH} chars, got ${row?.length}`);
    }
    for (let x = 0; x < WIDTH; x++) {
      const ch = row[x];
      if (ch === 'T') {
        if (tee) throw new Error('more than one tee');
        tee = { x, y };
        setCell(course, x, y, FAIRWAY);
      } else if (ch === 'H') {
        if (hole) throw new Error('more than one hole');
        hole = { x, y };
        setCell(course, x, y, GREEN);
      } else if (ch in LEGEND) {
        setCell(course, x, y, LEGEND[ch]);
      } else {
        throw new Error(`unknown terrain char '${ch}' at ${x},${y}`);
      }
    }
  }
  if (!tee) throw new Error('art has no tee (T)');
  if (!hole) throw new Error('art has no hole (H)');
  course.tee = tee;
  course.hole = hole;
  return course;
}

/** @type {Array<{name: string, art: string[]}>} */
export const AUTHORED_HOLES = [
  {
    // A par-3 finish over open water: lay up short, then commit. The lake
    // gives no bail-out — the only dry land past x=27 is the green itself.
    name: 'Isla Verde',
    art: [
      ',,,,ttttt,,,,ttttt,,,,,ttt,,,,,,,,,,,,,,',
      ',,,,ttttt,,,,ttttt,,,,ttttt,,,,,,,,,,,,,',
      ',,,,ttttt,,,,,ttt,,,,,,ttt,,,,,,,,,,,,,,',
      ',,,,,ttt,,,,,,,,,,,,,,,,t,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,www,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,wwwwwwwww,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,wwwwwwwwwww,',
      ',,,,,,,,,,,sss,,,,,,,,,,,,,wwwwwwwwwwwww',
      ',,,,,,,,,,,sss,,,,,,,,,,,,wwwwwwwwwwwwww',
      ',,,,,,,,,,.,,,,,,,,,,,,,,,wwwwwwwwwwwwww',
      ',,,,,,.........,,,,,,,,,..wwwwswgggwwwww',
      ',,,......................wwwwwwgggggwwww',
      ',,.......................wwwwwwggHggwwww',
      ',..T.....................wwwwwwgggggwwww',
      ',,......,,,,,,............wwwwwwgggwswww',
      ',,,.,,,,,,,,,,,,,,..,,,,,,wwwwwwwwwwwwww',
      ',,,,,,,,,,,,,,,,,,sss,,,,,wwwwwwwwwwwww,',
      ',,,,,,,,,,,,,,,,,,sss,,,,,,wwwwwwwwwwww,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,wwwwwwwwwww,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,wwwwwwwww,,',
      ',,,,,,ttt,,,,,,,,,,,,,,,,,,,,,,,www,,,,,',
      ',,,,,ttttt,,,,,,ttt,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,ttttt,,,,,ttttt,,,,,,,,,,,,,,,,,,,,',
      ',,,,,ttttt,,,,,ttttt,,,,,,,,,,,,,,,,,,,,',
    ],
  },
  {
    // Two full-height tree walls, each pierced by one gate. Irons must
    // thread the gaps; only a brave high ball carries the timber direct.
    name: 'Twin Gates',
    art: [
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,t........,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,..........,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,............,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,..............,tt,,,,,,,,,,,,',
      ',,,,,,,,,,...............,tt,,,,,,,,,,,,',
      ',,,...........t,,,s,,.....tt,,,,,,,,,,,,',
      ',,...........tt,,sss,,s....t,,sss,,,,,,,',
      ',..T........,tt,,,s,,sss...t,,sss,,,,,,,',
      ',,.........,,tt,,,,,,,s.....,,,,,,,,,,,,',
      ',,,.......,,,tt,,,,,,,,,...........g,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,..........ggg,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,........ggHgg,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,........ggg,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,t........g,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
      ',,,,,,,,,,,,,tt,,,,,,,,,,,tt,,,,,,,,,,,,',
    ],
  },
  {
    // A diagonal lake bites the whole lower-right; the fairway curls along
    // its shore. Cut as much of the corner as your nerve allows.
    name: 'The Cape',
    art: [
      ',,,,,ttt,,,,,,ttt,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,ttttt,,,,ttttt,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,ttttt,,,,,ttt,,,,,,,,,,,,,,,,,,g,,,,',
      ',,,,ttttt,,,,,,t,,,,,,,,,,,,,,,,,.ggg,,,',
      ',,,,,ttt,,,,,,,,,,,,,,,,,,,,,,,..ggHgg,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,.....ggg,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,.......g,www',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,........,wwwww',
      ',t,,,,,,,,,,,,,,,,,,,,,,.........,wwwwww',
      'ttt,,,,,,,,,,,,,,,,,,,.........,wwwwwwww',
      'tttt,,,,,,,,,,,,,,,,.........,,wwwwwwwww',
      'ttt,,,,,,,,,,,,,,,.........,,wwwwwwwwwww',
      ',t,,,,,,,,,,,,,,.......sss,,wwwwwwwwwwww',
      ',,,,,,,,,,,,,,.........sss,wwwwwwwwwwwww',
      ',,,,,,,,,,,,,........,,,,wwwwwwwwwwwwwww',
      ',,,,,,,,,,,........,,,,,wwwwwwwwwwwwwwww',
      ',,,,,,,,,,.......,,,,,wwwwwwwwwwwwwwwwww',
      ',,,,,,,.........,,,,,wwwwwwwwwwwwwwwwwww',
      ',,,,.........sss,,,wwwwwwwwwwwwwwwwwwwww',
      ',,,..........sss,,wwwwwwwwwwwwwwwwwwwwww',
      ',,..T......,,,,,wwwwwwwwwwwwwwwwwwwwwwww',
      ',,,.....,,,,,,,wwwwwwwwwwwwwwwwwwwwwwwww',
      ',,,,.,,,,,,,,wwwwwwwwwwwwwwwwwwwwwwwwwww',
      ',,,,,,,,,,,,wwwwwwwwwwwwwwwwwwwwwwwwwwww',
    ],
  },
  {
    // A sunken green ringed by slopes that all shed inward: anything close
    // funnels to the putting surface, the classic punchbowl reward.
    name: 'Punchbowl',
    art: [
      ',,,,,,,,,,,,,,ttttt,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,ttttt,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,ttttt,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,ttt,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,sss,,,,,,,,,,,,,,,,,,,,vvvvv,,,tt',
      ',,,,,,,sss,,,,,,,,,,,,,,,,,,,vvvvvvv,,tt',
      ',,,.,,,,,,,,,,,,,,,..,,,,,,,>>vvvvv<<,tt',
      ',,......,,,,,,,............>>>>ggg<<<<tt',
      ',..T.......................>>>ggggg<<<tt',
      ',,.........................>>>ggHgg<<<tt',
      ',,,........................>>>ggggg<<<tt',
      ',,,,,,,.........,,,,,,,,,..>>>>ggg<<<<tt',
      ',,,,,,,,,,,.,,,,,,,,,,,,,,,,>>^^^^^<<,tt',
      ',,,,,,,,,,,,,,,,,,,,,sss,,,,,^^^^^^^,,tt',
      ',,,,,,,,,,,,,,,,,,,,,sss,,,,,,^^^^^,,,tt',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,tt',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,t,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,ttt,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,ttttt,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,ttt,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
    ],
  },
  {
    // Winter hole: a frozen lake split by a hard-ice causeway. Skid a putt
    // across the bridge and let the ice carry it, or fly the water whole.
    name: 'Glacier Crossing',
    art: [
      ',,,,,t,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,ttt,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,ttttt,,,,,,,,wwwwwwwwwww,,,,,,,,,,,,,',
      ',,,,ttt,,,,,,,,wwwwwwwwwwww,,,iii,,,,,,,',
      ',,,,,t,,,,,,,,,,wwwwwwwwwwww,,iii,,,,,,,',
      ',,,,,,,iii,,,,,,wwwwwwwwwww,,,iii,,,,,,,',
      ',,,,,,,iii,,,,,wwwwwwwwwwww,,,,,,,,,,,,,',
      ',,,,,,,iii,,,,,,wwwwwwwwwww,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,wwwwwwwwwwww,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,wwwwwwwwwwww,,,,,,,,,,,,,',
      ',,,...........,,wwwwwwwwwww,.....,g,,,,,',
      ',,.............iiiiiiiiiiiii.....ggg,,,,',
      ',..T...........iiiiiiiiiiiii....ggHgg,,,',
      ',,.............iiiiiiiiiiiii.....ggg,,,,',
      ',,,...........,,wwwwwwwwwww,.....,g,,,,,',
      ',,,,,,,,,,,,,,,wwwwwwwwwwww,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,wwwwwwwwwwww,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,wwwwwwwwwww,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,wwwwwwwwwwww,,iii,,,,,,,,',
      ',,,,,,,,,t,,,,,,wwwwwwwwwww,,iii,,t,,,,,',
      ',,,,,,,,ttt,,,,,wwwwwwwwwwww,iii,ttt,,,,',
      ',,,,,,,ttttt,,,wwwwwwwwwwww,,,,,ttttt,,,',
      ',,,,,,,,ttt,,,,,,,,,,,,,,,,,,,,,,ttt,,,,',
      ',,,,,,,,,t,,,,,,,,,,,,,,,,,,,,,,,,t,,,,,',
    ],
  },
  {
    // Links ground: one huge treeless fairway strewn with one-tile pot
    // bunkers, two cut right into the green's shoulders. Pick a lane.
    name: 'Pot Luck',
    art: [
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,...,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,........,,,,,,,,,,,...,,,,,,,,,,,',
      ',,,,,...........,,,,,,,,,.s....s,,,,,,,,',
      ',,..............,.,,s,.,...........,,,,,',
      ',......s.......,,,.,.........s....s.g,,,',
      '................,.......s..........gsg,,',
      '...T......s....s..s...............ggHgg,',
      '.........,,,..........s....s..s....gsg,,',
      ',.......,,,,,..............,,.......g,,,',
      ',,...,,,,,,,,s,..........,,,,,,,.s.,,,,,',
      ',,,,,,,,,,,,,,,,.s.....,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,...,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
      ',,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,',
    ],
  },
];
