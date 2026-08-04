/**
 * OpenStreetMap tags → the engine's six FeatureKinds.
 *
 * This file is the whole editorial judgement of the importer. Everything
 * else is plumbing. A wrong entry here does not crash anything — it ships a
 * hole that teaches the wrong lesson, which is the defect class this
 * project has been bitten by twice already (a bunker drawn over a swimming
 * pool, a fairway covering 13.6 acres). So: map only what OSM states
 * explicitly, and leave everything else as rough, which is what the engine
 * assumes for unclassified ground anyway.
 */

import type { FeatureKind } from '@/lib/engine/types';

export type OsmTags = Record<string, string>;

/**
 * Ranked because a single way can carry several of these — a pond inside a
 * course is commonly `golf=water_hazard` *and* `natural=water`, and a strip
 * of trees can be `golf=rough` *and* `natural=wood`. First match wins, so
 * the more specific golf tagging beats the generic landcover tagging.
 */
const RULES: { kind: FeatureKind; key: string; values: string[] }[] = [
  // Explicit golf tagging — always preferred.
  { kind: 'green', key: 'golf', values: ['green'] },
  { kind: 'bunker', key: 'golf', values: ['bunker', 'sand_trap'] },
  { kind: 'water', key: 'golf', values: ['water_hazard', 'lateral_water_hazard'] },
  { kind: 'ob', key: 'golf', values: ['out_of_bounds'] },
  { kind: 'fairway', key: 'golf', values: ['fairway'] },

  // Generic landcover, used when the golf schema is silent.
  { kind: 'water', key: 'natural', values: ['water'] },
  { kind: 'water', key: 'landuse', values: ['reservoir', 'basin'] },
  // Areas (riverbank, dock) and centrelines alike — a centreline is widened
  // into its strip by waterwayHalfWidthYds before it becomes a polygon.
  { kind: 'water', key: 'waterway', values: ['riverbank', 'dock', 'river', 'stream', 'ditch', 'drain', 'canal'] },
  { kind: 'recovery', key: 'natural', values: ['wood', 'scrub', 'heath', 'wetland'] },
  { kind: 'recovery', key: 'landuse', values: ['forest'] },
];

/**
 * Tags whose presence disqualifies a way outright, whatever else it says.
 * A clubhouse roof tagged `natural=water` (it happens — mapped rooftop
 * ponds, mis-tagged car parks) should not become a hazard.
 */
const EXCLUDE: { key: string; values?: string[] }[] = [
  { key: 'building' },
  { key: 'amenity' },
  { key: 'highway' },
  { key: 'barrier' },
  { key: 'golf', values: ['cartpath', 'path', 'driving_range', 'practice', 'clubhouse'] },
  { key: 'leisure', values: ['pitch', 'swimming_pool'] },
  // A burn in a culvert runs under the hole, not across it. The Barry Burn
  // at Carnoustie is mapped in three pieces, one of them culverted.
  { key: 'tunnel' },
  { key: 'covered', values: ['yes'] },
];

export function isExcluded(tags: OsmTags): boolean {
  return EXCLUDE.some((e) =>
    e.values ? e.values.includes(tags[e.key] ?? '') : tags[e.key] !== undefined,
  );
}

/**
 * The kind this way should classify as, or null to leave it as rough.
 *
 * `golf=rough` and `golf=tee` deliberately return null: rough is the
 * engine's default for unclassified ground, and a tee box is a start
 * position rather than a lie the ball can land in.
 */
export function kindForTags(tags: OsmTags): FeatureKind | null {
  if (isExcluded(tags)) return null;
  for (const rule of RULES) {
    if (rule.values.includes(tags[rule.key] ?? '')) return rule.kind;
  }
  return null;
}

/** The Overpass filter that fetches everything the rules above can use. */
export const FEATURE_FILTER = [
  '["golf"]',
  '["natural"~"^(water|wood|scrub|heath|wetland)$"]',
  '["landuse"~"^(reservoir|basin|forest)$"]',
  '["waterway"~"^(river|stream|ditch|drain|canal)$"]',
] as const;

/**
 * Half-widths in yards for a waterway mapped as a centreline rather than an
 * area — which is how most of them are mapped.
 *
 * This matters more than it looks. Carnoustie's 18th is defined by the Barry
 * Burn crossing in front of the green, and the burn is `waterway=river` on a
 * LINE. Without this the hole imported with no water on it at all: every
 * sentence the engine generated about that hole would have been true of a
 * hole that does not exist.
 */
const WATERWAY_HALF_WIDTH_YDS: Record<string, number> = {
  river: 4,
  canal: 4,
  stream: 1.5,
  ditch: 1,
  drain: 1,
};

/**
 * Half-width to buffer a waterway centreline by, or null if this is not a
 * linear waterway. Prefers the mapped `width` (metres, per the OSM wiki).
 */
export function waterwayHalfWidthYds(tags: OsmTags): number | null {
  const kind = tags.waterway;
  if (!kind || !(kind in WATERWAY_HALF_WIDTH_YDS)) return null;
  const mapped = Number(tags.width);
  if (Number.isFinite(mapped) && mapped > 0 && mapped < 200) {
    return (mapped * 1.09361) / 2;
  }
  return WATERWAY_HALF_WIDTH_YDS[kind]!;
}

/**
 * OSM records hole length in `dist`, which the wiki defines as metres but
 * which US courses frequently populate in yards. A 6,900-yard course reads
 * as 6,900 "metres" — 7,545 yards — and every derived par is wrong.
 *
 * We do not trust the unit. We trust the geometry: the tee→green centreline
 * is measured in the engine's own projection, and `dist` is used only to
 * sanity-check it. This function exists to make that decision explicit
 * rather than implicit in its absence.
 */
export function parseDistanceTag(raw: string | undefined): { yards: number; unit: 'yd' | 'm' | 'unknown' } | null {
  if (!raw) return null;
  const m = /^\s*([\d.]+)\s*(yd|yds|yards?|m|metres?|meters?)?\s*$/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? '').toLowerCase();
  if (unit.startsWith('y')) return { yards: n, unit: 'yd' };
  if (unit.startsWith('m')) return { yards: n * 1.09361, unit: 'm' };
  return { yards: n, unit: 'unknown' };
}

/** Par from the tag when it is plausible, else null — never guessed here. */
export function parseParTag(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 3 && n <= 5 ? n : null;
}

/** Par inferred from measured length when OSM does not state one. */
export function parFromYards(yards: number): number {
  if (yards < 260) return 3;
  if (yards < 471) return 4;
  return 5;
}
