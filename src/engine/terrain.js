// Terrain vocabulary. Values are stable — they appear in serialized courses
// and share codes, so never renumber, only append.

export const FAIRWAY = 0;
export const ROUGH = 1;
export const SAND = 2;
export const WATER = 3;
export const TREES = 4;
export const GREEN = 5;

export const TERRAIN_NAMES = ['fairway', 'rough', 'sand', 'water', 'trees', 'green'];

/** Terrain a ball can come to rest on. */
export function isRestable(t) {
  return t !== WATER && t !== TREES;
}
