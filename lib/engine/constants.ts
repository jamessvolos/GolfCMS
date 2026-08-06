/**
 * Every tunable number in the engine lives here.
 * These are reasonable placeholders seeded from the product spec — tune freely.
 */

import type { ClubId, FeatureKind, LandingLie, PlayableLie, ShotShape } from './types';

// ---------------------------------------------------------------------------
// Club distances
// ---------------------------------------------------------------------------

/** Driver carry (yards) ≈ this × club speed (mph). 110 mph ≈ 270y. */
export const DRIVER_CARRY_PER_MPH = 2.45;

/** Fixed gapping as fractions of driver carry, longest first. */
export const CLUB_GAPPING: { id: ClubId; label: string; fraction: number }[] = [
  { id: 'DR', label: 'Driver', fraction: 1.0 },
  { id: 'W3', label: '3 wood', fraction: 0.93 },
  { id: 'W5', label: '5 wood', fraction: 0.87 },
  { id: 'I4', label: '4 iron', fraction: 0.82 },
  { id: 'I5', label: '5 iron', fraction: 0.78 },
  { id: 'I6', label: '6 iron', fraction: 0.74 },
  { id: 'I7', label: '7 iron', fraction: 0.7 },
  { id: 'I8', label: '8 iron', fraction: 0.65 },
  { id: 'I9', label: '9 iron', fraction: 0.6 },
  { id: 'PW', label: 'Pitching wedge', fraction: 0.55 },
  { id: 'GW', label: 'Gap wedge', fraction: 0.48 },
  { id: 'SW', label: 'Sand wedge', fraction: 0.42 },
  { id: 'LW', label: 'Lob wedge', fraction: 0.35 },
];

/** Clubs excluded per lie. Sand allows wedges only; rough bans the big sticks. */
export const LIE_CLUB_CAPS: Record<PlayableLie, ClubId[]> = {
  tee: [],
  fairway: [],
  rough: ['DR', 'W3'],
  sand: ['DR', 'W3', 'W5', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9'],
  recovery: ['DR', 'W3', 'W5', 'I4', 'I5', 'I6'],
};

// ---------------------------------------------------------------------------
// Dispersion model
// ---------------------------------------------------------------------------

/** Longitudinal (distance) sigma as a fraction of shot distance. */
export const LONG_SIGMA_FRACTION = 0.055;

/**
 * Lateral sigma as a fraction of shot distance, by handicap.
 * Linear interpolation between anchors; linear extrapolation beyond,
 * clamped to [first, LATERAL_SIGMA_MAX_FRACTION].
 */
export const LATERAL_SIGMA_BY_HANDICAP: [handicap: number, fraction: number][] = [
  [0, 0.032],
  [5, 0.038],
  [10, 0.046],
  [15, 0.055],
  [20, 0.065],
];

export const LATERAL_SIGMA_MAX_FRACTION = 0.09;

/**
 * Shot-shape bias of the lateral MEAN, as a signed fraction of shot distance.
 * Positive = right of the aim line (right-handed player). The player aims at
 * their pin; the distribution is biased by their shape — intentional.
 */
export const SHAPE_BIAS_FRACTION: Record<ShotShape, number> = {
  draw: -0.008,
  straight: 0,
  fade: 0.008,
};

/** Multipliers applied to BOTH sigmas when playing from these lies. */
export const LIE_SIGMA_MULTIPLIER: Record<PlayableLie, number> = {
  tee: 1,
  fairway: 1,
  rough: 1.25,
  sand: 1.5,
  recovery: 1.4,
};

// ---------------------------------------------------------------------------
// Expected-strokes baseline (Broadie-style)
// ---------------------------------------------------------------------------

/** Distance anchors (yards) for the off-green baseline table. */
export const BASELINE_DISTANCES = [25, 50, 100, 150, 200, 250, 300, 400] as const;

/**
 * Expected strokes to hole out by lie, at the anchor distances above.
 * null = undefined in the source table (interpolate/extrapolate handles it).
 */
export const BASELINE_TABLE: Record<
  'tee' | 'fairway' | 'rough' | 'sand' | 'recovery',
  (number | null)[]
> = {
  tee: [null, null, null, 2.95, 3.15, 3.4, 3.65, 3.95],
  fairway: [2.4, 2.65, 2.8, 2.98, 3.19, 3.45, 3.7, 4.05],
  rough: [2.55, 2.85, 3.05, 3.25, 3.5, 3.8, 4.1, 4.4],
  sand: [2.85, 3.15, 3.35, 3.6, 3.9, 4.2, null, null],
  recovery: [3.4, 3.65, 3.85, 4.05, 4.3, 4.6, null, null],
};

/** Expected strokes can never drop below this off the green. */
export const BASELINE_FLOOR = 1.5;

/** Putting: [distance in feet, expected putts]. Interpolated. */
export const PUTT_TABLE: [feet: number, putts: number][] = [
  [2, 1.0],
  [4, 1.15],
  [8, 1.5],
  [20, 1.87],
  [35, 2.1],
  [55, 2.3],
];

/** Expected putts are clamped to [1, this] after interpolation/extrapolation. */
export const PUTT_MAX = 3.0;

/** Baseline multiplier = 1 + this × handicap. Applied to all baseline values. */
export const HANDICAP_MULTIPLIER_PER_STROKE = 0.011;

// ---------------------------------------------------------------------------
// Hazard cost model
// ---------------------------------------------------------------------------

/** Penalty strokes added for a ball in the water (plus the shot itself). */
export const WATER_PENALTY = 1;

/** Drop point offset back toward the ball from the water entry point, yards. */
export const WATER_DROP_OFFSET_YDS = 5;

/**
 * OB is stroke-and-distance approximated without recursion:
 * cost = 2 + baseline(originalDistanceToPin, originalLie).
 */
export const OB_EXTRA_STROKES = 2;

// ---------------------------------------------------------------------------
// Monte Carlo & optimization grid
// ---------------------------------------------------------------------------

/** Landing samples per aim-point evaluation. */
export const MC_SAMPLES = 600;

/** Deterministic default seed; callers may override. */
export const DEFAULT_SEED = 0x5eed;

/** Candidate grid spacing, yards. */
export const GRID_SPACING_YDS = 6;

/** Search radius = max-club carry × this. */
export const GRID_REACH_FACTOR = 1.15;

/** Half-angle of the search sector around the ball→pin bearing, degrees. */
export const GRID_SECTOR_HALF_ANGLE_DEG = 50;

/** Don't search beyond pin distance + this margin (yards). */
export const GRID_BEYOND_PIN_MARGIN_YDS = 40;

/**
 * Degeneracy guard: candidate aims closer to the ball than this are skipped
 * (aim direction is undefined at zero distance). Small on purpose — short
 * greenside puzzles need near-ball candidates.
 */
export const GRID_MIN_AIM_YDS = 2;

/** Floor on the search radius (yards) so tiny shots still get a grid. */
export const GRID_MIN_REACH_YDS = 24;

/**
 * Lie classification priority when polygons overlap (first match wins).
 * Anything inside no polygon is rough.
 *
 * Ordered so the natural annotation of real holes just works, smallest
 * and most specific feature first:
 *  - bunker over green: a bunker biting into a green (the Road Hole) is
 *    sand, even when the green outline encloses it;
 *  - green over water: an island green sits on top of the pond polygon;
 *  - both over fairway/recovery, which are the broad background shapes.
 * OB stays on top — it is a boundary, not a surface.
 */
export const CLASSIFY_PRIORITY: FeatureKind[] = [
  'ob',
  'bunker',
  'green',
  'water',
  'recovery',
  'fairway',
];

export const KIND_TO_LIE: Record<FeatureKind, LandingLie> = {
  ob: 'ob',
  water: 'water',
  green: 'green',
  bunker: 'sand',
  recovery: 'recovery',
  fairway: 'fairway',
};

// ---------------------------------------------------------------------------
// Scoring bands, Elo, puzzle ratings
// ---------------------------------------------------------------------------

/** sgLoss thresholds (inclusive) → band + Elo score. Order matters. */
export const SCORE_BANDS: { maxSgLoss: number; band: 'perfect' | 'good' | 'okay'; eloScore: number }[] = [
  { maxSgLoss: 0.03, band: 'perfect', eloScore: 1.0 },
  { maxSgLoss: 0.1, band: 'good', eloScore: 0.5 },
  { maxSgLoss: 0.25, band: 'okay', eloScore: 0.25 },
];

export const MISS_ELO_SCORE = 0;

export const ELO_K_PLAYER = 24;
export const ELO_K_PUZZLE = 16;
export const ELO_INITIAL_PLAYER = 1200;

/**
 * Puzzle rating seed: 1000 + 1500 × trap / (trap + 0.35).
 *
 * Was `clamp(trap / 0.5, 0, 1)` — linear to a hard ceiling at trap 0.5.
 * That was fine while the library topped out at 0.19, and became a real
 * defect once imported par 3s reached 1.19: four puzzles spanning
 * 0.88–1.19 all rated exactly 2500, so the hardest hole in the library was
 * indistinguishable from one a third easier. Elo cannot order puzzles it
 * cannot tell apart, and the queue cannot pace them.
 *
 * The replacement is strictly increasing everywhere, so no two different
 * trap sizes ever collide, and it approaches 2500 without reaching it.
 * HALF_TRAP is the trap size that earns half the span: at 0.35 the typical
 * puzzle (trap ~0.05) sits near 1190 and a severe one (0.9) near 2080,
 * which keeps resolution where most of the library actually lives.
 */
export const PUZZLE_RATING_BASE = 1000;
export const PUZZLE_RATING_SPAN = 1500;
export const PUZZLE_RATING_HALF_TRAP = 0.35;

/**
 * The trap size below which a situation has nothing to teach: aiming where
 * you were going to aim anyway is already right. Chosen from the shipped
 * library rather than taste — its median tee trap was 0.05 and four of
 * thirty puzzles sat at exactly 0.00.
 *
 * The rating curve's floor, not just a filter. A curve whose base sits at
 * trap 0 spends its first 300 points rating the difference between two
 * puzzles that both have no decision in them; anchoring the floor here
 * means rating 1000 is "exactly at the threshold of being worth asking".
 */
export const DECISION_TRAP = 0.1;

/**
 * Ratings are Monte Carlo estimates, so they carry an error bar. Two
 * standard errors is the margin a trap must clear the threshold by before a
 * situation is served — the gate is on `trap − 2·SE`, not on the point
 * estimate, because the rating curve is steepest exactly where the estimate
 * is noisiest.
 */
export const TRAP_SE_MARGIN = 2;

/**
 * Bumped whenever a change moves stored ratings. `content:audit` fails when
 * a shipped puzzle's rating was computed under a different version, so a
 * re-rating cannot be forgotten.
 */
export const RATING_VERSION = 1;

// ---------------------------------------------------------------------------
// Profile bucketing (heatmap cache key)
// ---------------------------------------------------------------------------

export const BUCKET_HANDICAP_STEP = 5;
export const BUCKET_SPEED_STEP = 10;
