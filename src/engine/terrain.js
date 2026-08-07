// Terrain vocabulary. Values are stable — they appear in serialized courses
// and share codes, so never renumber, only append.

export const FAIRWAY = 0;
export const ROUGH = 1;
export const SAND = 2;
export const WATER = 3;
export const TREES = 4;
export const GREEN = 5;
export const ICE = 6;
export const SLOPE_N = 7;
export const SLOPE_S = 8;
export const SLOPE_E = 9;
export const SLOPE_W = 10;

export const TERRAIN_NAMES = [
  'fairway', 'rough', 'sand', 'water', 'trees', 'green',
  'ice', 'slope-n', 'slope-s', 'slope-e', 'slope-w',
];

const SLOPE_DIRS = {
  [SLOPE_N]: { x: 0, y: -1 },
  [SLOPE_S]: { x: 0, y: 1 },
  [SLOPE_E]: { x: 1, y: 0 },
  [SLOPE_W]: { x: -1, y: 0 },
};

/** The downhill direction of a slope tile, or null for flat terrain. */
export function slopeDir(t) {
  return SLOPE_DIRS[t] ?? null;
}

/** Terrain a ball can come to rest on. */
export function isRestable(t) {
  return t !== WATER && t !== TREES;
}
