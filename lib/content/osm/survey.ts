/**
 * Score every hole a course has mapped, so content is chosen by whether it
 * contains a decision rather than by whether the hole is famous.
 *
 * The evidence for needing this: eight holes imported from three
 * championship links produced two excellent puzzles and six flat ones, and
 * the split was not about geometry quality. Both good ones were par 3s
 * (trap 0.88 and 0.44); every long par 4 and par 5 tee shot came in at
 * 0.00–0.14. The shipped hand-traced library says the same thing — its par
 * 4 tee shots run 0.01–0.17 with a median near 0.03.
 *
 * That is not a defect. For a mid-handicap player a 486-yard par 4 has no
 * course-management decision: the naive aim IS the optimal aim, and the
 * game would award PERFECT for no thought. Surveying first turns a whole
 * course into a ranked list and makes that visible before anyone spends a
 * grid computation on it.
 */

import { assembleHole, describeCandidate, findHoleWays } from './assemble';
import { derivePuzzles } from './puzzles';
import type { OverpassResponse, OsmWay } from './overpass';
import { bucketedProfile, SEED_PROFILE } from '@/lib/engine/profile';
import { prepareHole } from '@/lib/engine/hole';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { holeDataFromInput } from '@/lib/server/ingestHole';
import type { PlayerProfile } from '@/lib/engine/types';

export interface SurveyRow {
  holeNumber: number;
  par: number;
  yards: number;
  /** Best trap size across the hole's derived puzzles. */
  bestTrap: number;
  /** Per-puzzle traps, in play order. */
  traps: { category: string; trap: number }[];
  polygons: number;
  notes: string[];
  /** Set when the hole could not be assembled at all. */
  error?: string;
  /** Populated when several ways share this hole number. */
  ambiguous?: string[];
}

export interface SurveyOptions {
  profile?: PlayerProfile;
  /** Survey runs many grids; the default trades precision for throughput. */
  nSamples?: number;
  corridorYds?: number;
  /** Restrict to these hole numbers. */
  holes?: number[];
  /** Called after each hole so a CLI can stream progress. */
  onRow?: (row: SurveyRow) => void;
}

/** Reduced sampling: a survey ranks holes, it does not rate them. */
export const SURVEY_SAMPLES = 200;

/**
 * The trap size below which a puzzle has nothing to teach. Chosen from the
 * shipped library rather than taste: its median tee trap is 0.05 and four
 * of its thirty puzzles sit at exactly 0.00.
 */
export const DECISION_THRESHOLD = 0.10;

export function surveyCourse(
  res: OverpassResponse,
  courseName: string,
  opts: SurveyOptions = {},
): SurveyRow[] {
  const profile = opts.profile ?? bucketedProfile(SEED_PROFILE);
  const nSamples = opts.nSamples ?? SURVEY_SAMPLES;
  const wanted = opts.holes ?? Array.from({ length: 18 }, (_, i) => i + 1);
  const rows: SurveyRow[] = [];

  for (const holeNumber of wanted) {
    const candidates = findHoleWays(res, { holeNumber });
    const base: SurveyRow = {
      holeNumber,
      par: 0,
      yards: 0,
      bestTrap: 0,
      traps: [],
      polygons: 0,
      notes: [],
    };

    if (!candidates.length) {
      const row = { ...base, error: 'not mapped' };
      rows.push(row);
      opts.onRow?.(row);
      continue;
    }
    if (candidates.length > 1) {
      // Surveying cannot disambiguate for you, but it can show you what
      // needs disambiguating — which is the useful half.
      const row = {
        ...base,
        error: `${candidates.length} candidates`,
        ambiguous: candidates.map((c: OsmWay) => describeCandidate(c)),
      };
      rows.push(row);
      opts.onRow?.(row);
      continue;
    }

    try {
      const { input, measuredYards, notes } = assembleHole(res, candidates[0]!, {
        id: `survey-${holeNumber}`,
        courseName,
        holeNumber,
        ...(opts.corridorYds ? { corridorYds: opts.corridorYds } : {}),
      });
      const derived = derivePuzzles(input.hole, { nSamples });
      const prepared = prepareHole(holeDataFromInput(input.hole));

      const traps = derived.puzzles.map((p) => {
        const summary = computeGridSummary(
          prepared,
          {
            ball: prepared.toLocal(p.ball),
            pin: prepared.pin,
            lie: p.lie,
          },
          profile,
          p.category,
          { nSamples },
        );
        return { category: p.category, trap: summary.trapSize };
      });

      const row: SurveyRow = {
        holeNumber,
        par: input.hole.par,
        yards: measuredYards,
        bestTrap: traps.reduce((m, t) => Math.max(m, t.trap), 0),
        traps,
        polygons: input.hole.polygons.length,
        notes: [...notes, ...derived.notes],
      };
      rows.push(row);
      opts.onRow?.(row);
    } catch (err) {
      const row = { ...base, error: (err as Error).message.split('\n')[0]! };
      rows.push(row);
      opts.onRow?.(row);
    }
  }

  return rows;
}
