// The yardage book: tiles are the sim's truth, yards are golf's language.
// One constant converts between them everywhere, so a 14-tile max carry
// reads as a 224-yard poke and holes get honest scorecard numbers.

export const YARDS_PER_TILE = 16;

/** Tiles → whole yards. */
export function yards(tiles) {
  return Math.round(tiles * YARDS_PER_TILE);
}

/** Hole yardage for the scorecard, rounded to the traditional 5. */
export function holeYards(tiles) {
  return Math.round((tiles * YARDS_PER_TILE) / 5) * 5;
}

/** Par from hole length, using standard yardage bands. */
export function parForTiles(tiles) {
  const y = tiles * YARDS_PER_TILE;
  if (y <= 260) return 3;
  if (y <= 450) return 4;
  return 5;
}

/** What a golfer would call a shot of this carry. */
export function clubName(tiles) {
  const y = tiles * YARDS_PER_TILE;
  if (y >= 210) return 'driver';
  if (y >= 165) return 'fairway wood';
  if (y >= 110) return 'iron';
  if (y >= 55) return 'wedge';
  return 'pitch';
}

// Hole-length menu for round generation (in tiles): par 3s are one-shotters,
// par 5s stretch most of the property.
export const HOLE_LENGTHS = [
  { par: 3, min: 11, max: 15, weight: 25 },
  { par: 4, min: 20, max: 26, weight: 50 },
  { par: 5, min: 29, max: 34, weight: 25 },
];
