/**
 * Core types for the SG Trainer strokes-gained engine.
 * Pure TypeScript — no framework dependencies.
 *
 * Two coordinate systems:
 *  - GeoJSON positions in lon/lat (storage, map layer)
 *  - Local planar coordinates in YARDS around a projection origin
 *    (all engine math). x = east, y = north.
 */

export type ShotShape = 'draw' | 'straight' | 'fade';

/** Lies a ball can be played from. */
export type PlayableLie = 'tee' | 'fairway' | 'rough' | 'sand' | 'recovery';

/** All lie classifications a landing sample can resolve to. */
export type LandingLie = PlayableLie | 'green' | 'water' | 'ob';

/** Polygon feature kinds recognized in hole GeoJSON. */
export type FeatureKind =
  | 'fairway'
  | 'green'
  | 'bunker'
  | 'water'
  | 'ob'
  | 'recovery';

export type PuzzleCategory = 'tee' | 'approach' | 'layup' | 'recovery';

export interface PlayerProfile {
  handicap: number;
  clubSpeedMph: number;
  shotShape: ShotShape;
}

export type ClubId =
  | 'DR'
  | 'W3'
  | 'W5'
  | 'I4'
  | 'I5'
  | 'I6'
  | 'I7'
  | 'I8'
  | 'I9'
  | 'PW'
  | 'GW'
  | 'SW'
  | 'LW'
  | 'WEDGE_PARTIAL';

export interface Club {
  id: ClubId;
  label: string;
  /** Carry distance in yards for this player. */
  carry: number;
}

/** Point in local planar coordinates, yards. x = east, y = north. */
export interface Pt {
  x: number;
  y: number;
}

export interface LonLat {
  lon: number;
  lat: number;
}

// ---------------------------------------------------------------------------
// Hole geometry
// ---------------------------------------------------------------------------

export type Ring = [number, number][]; // closed or open; treated as closed

export interface HolePolygonFeature {
  type: 'Feature';
  properties: { kind: FeatureKind; name?: string };
  geometry: {
    type: 'Polygon';
    /** First ring is the outer boundary; subsequent rings are holes. */
    coordinates: Ring[];
  };
}

export interface HolePointFeature {
  type: 'Feature';
  properties: { kind: 'pin' | 'tee'; name?: string };
  geometry: { type: 'Point'; coordinates: [number, number] };
}

export interface HoleGeoJSON {
  type: 'FeatureCollection';
  features: (HolePolygonFeature | HolePointFeature)[];
}

export interface HoleData {
  id: string;
  courseName: string;
  holeNumber: number;
  par: number;
  yardage: number;
  geojson: HoleGeoJSON;
  /** Center used for the local projection (and later, initial imagery view). */
  imageryCenter: LonLat;
  /**
   * Paint the vector ground plan over imagery. True for synthetic fixture
   * holes whose polygons ARE the ground; false (default) for holes traced
   * over real imagery, where the imagery carries the ground and the
   * annotations stay invisible. The engine ignores this — it's a render hint.
   */
  groundPlan?: boolean;
}

export interface PuzzleData {
  id: string;
  holeId: string;
  ballPosition: LonLat;
  lie: PlayableLie;
  pinPosition: LonLat;
  category: PuzzleCategory;
}

// ---------------------------------------------------------------------------
// Prepared (projected) hole — everything in local yards
// ---------------------------------------------------------------------------

export interface ProjectedPolygon {
  kind: FeatureKind;
  /** Outer ring followed by hole rings, projected to local yards. */
  rings: Pt[][];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Planar GeoJSON geometry (local yards) for turf point-in-polygon. */
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

export interface PreparedHole {
  hole: HoleData;
  polygons: ProjectedPolygon[];
  pin: Pt;
  tees: Pt[];
  toLocal: (p: LonLat) => Pt;
  toLonLat: (p: Pt) => LonLat;
}

// ---------------------------------------------------------------------------
// Evaluation results
// ---------------------------------------------------------------------------

/** Fraction of Monte Carlo samples that finished in each lie. Sums to 1. */
export type LieBreakdown = Partial<Record<LandingLie, number>>;

export interface OutcomeStats {
  /** Landing-lie percentages (0..1). */
  lieBreakdown: LieBreakdown;
  /** Mean distance from landing point to pin, yards (all samples). */
  meanDistanceToPin: number;
  /** Club auto-selected for the aim. */
  club: Club;
  /** Distance from ball to the (possibly clamped) aim actually used, yards. */
  aimDistance: number;
  /** True when the requested aim was beyond max club and was clamped. */
  clamped: boolean;
  nSamples: number;
}

export interface EvalResult {
  expectedStrokes: number;
  outcomeStats: OutcomeStats;
}

// ---------------------------------------------------------------------------
// Optimization grid
// ---------------------------------------------------------------------------

export interface EvalGridCell {
  /** Aim point in local yards. */
  point: Pt;
  /** Expected strokes, or null when the cell is outside the search sector. */
  expectedStrokes: number | null;
}

export interface EvalGrid {
  /** Grid origin (cell [0,0] center) in local yards. */
  origin: Pt;
  cellSize: number;
  /** Number of columns (x) and rows (y). */
  width: number;
  height: number;
  /**
   * Row-major values, length width*height. NaN = outside search sector.
   * values[row * width + col] is the cell centered at
   * (origin.x + col*cellSize, origin.y + row*cellSize).
   * JSON caveat: serialization turns NaN into null — consumers rehydrating
   * a cached grid (HeatmapCache) must map null back to NaN.
   */
  values: number[];
  /**
   * Argmin over the lattice PLUS the pin and naive aims as explicit
   * candidates, so optimal.expectedStrokes ≤ naive.expectedStrokes always
   * (trapSize ≥ 0) and short puzzles aren't hostage to cell quantization.
   * Aims beyond max carry are reported at their clamped effective point.
   */
  optimal: { point: Pt; expectedStrokes: number; result: EvalResult };
  naive: { point: Pt; expectedStrokes: number; result: EvalResult };
  /** E[naive] − E[optimal]; non-negative by construction. */
  trapSize: number;
}

export interface ScoreBandResult {
  band: 'perfect' | 'good' | 'okay' | 'miss';
  /** Elo score for the band (1, 0.5, 0.25, 0). */
  eloScore: number;
}
