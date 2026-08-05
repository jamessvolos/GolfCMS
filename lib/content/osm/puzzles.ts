/**
 * Derive a hole's puzzles by playing it with the engine.
 *
 * The tee puzzle is free — the ball is on the tee. Every puzzle after it
 * needs a ball position, and hand-tracing got one by eye. Here the engine
 * supplies it: run the optimizer from the previous position, and start the
 * next puzzle where its best line lands.
 *
 * That is a modelling choice worth stating. The optimal AIM is not where a
 * shot finishes — dispersion scatters around it. Using the aim as the next
 * ball position means every derived puzzle assumes the previous shot was
 * struck exactly as planned, so the sequence is "the hole as it plays for
 * someone executing well", not an expected outcome. It gives a defensible,
 * reproducible position; it does not simulate a round.
 */

import { classifyPoint, prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, SEED_PROFILE } from '@/lib/engine/profile';
import { dist } from '@/lib/engine/projection';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { holeDataFromInput } from '@/lib/server/ingestHole';
import type { IngestInput } from '@/lib/server/ingestHole';
import type { PlayableLie, PlayerProfile, PreparedHole, Pt } from '@/lib/engine/types';

type Puzzle = IngestInput['puzzles'][number];

/** Beyond this to the pin, a par 5 gets a layup before the approach. */
const LAYUP_THRESHOLD_YDS = 240;
/** A puzzle closer in than this is a chip, not a course-management decision. */
const MIN_PUZZLE_YDS = 35;
/** Fractions of the way to the optimal tried when the optimal is unplayable. */
const PULLBACK_STEPS = [1, 0.88, 0.76, 0.64, 0.52];

export interface DeriveOptions {
  profile?: PlayerProfile;
  /** Monte Carlo samples; the default is the engine's. Lower it for speed. */
  nSamples?: number;
  /**
   * Drop puzzles whose trap size falls below this — puzzles where aiming
   * at the flag is already optimal, so the game awards PERFECT for no
   * thought. 0 keeps everything, which is what the survey wants.
   */
  minTrap?: number;
}

export interface DeriveResult {
  puzzles: Puzzle[];
  notes: string[];
}

function describe(category: Puzzle['category'], yards: number, lie: Puzzle['lie']): string {
  switch (category) {
    case 'tee':
      return `Tee shot, ${yards} yards to the flag.`;
    case 'layup':
      return `Lay-up from the ${lie}, ${yards} yards to the flag.`;
    case 'recovery':
      return `Recovery from the ${lie}, ${yards} yards to the flag.`;
    default:
      return `Approach from the ${lie}, ${yards} yards to the flag.`;
  }
}

/**
 * Where the optimal line from `ball` lands, pulled back toward the ball
 * until it is somewhere a player could actually play from. Returns null
 * when nothing on the line is playable — a forced-carry hole whose optimal
 * aim is over water all the way in.
 */
function nextBall(
  prepared: PreparedHole,
  ball: Pt,
  lie: PlayableLie,
  category: Puzzle['category'],
  profile: PlayerProfile,
  nSamples: number | undefined,
  // Excluding green/water/ob leaves exactly PlayableLie, which is also the
  // schema's puzzle lie — so the caller needs no lookup table.
): { at: Pt; lie: PlayableLie } | null {
  const summary = computeGridSummary(
    prepared,
    { ball, pin: prepared.pin, lie },
    profile,
    category,
    nSamples ? { nSamples } : {},
  );
  const target = summary.optimal.local;
  for (const t of PULLBACK_STEPS) {
    const at = { x: ball.x + (target.x - ball.x) * t, y: ball.y + (target.y - ball.y) * t };
    const landed = classifyPoint(prepared, at);
    if (landed !== 'water' && landed !== 'ob' && landed !== 'green') {
      return { at, lie: landed };
    }
  }
  return null;
}

/**
 * Build the puzzle set for an assembled hole. The hole must already have
 * its polygons, pin and tee; only `puzzles` is produced here.
 */
export function derivePuzzles(
  hole: IngestInput['hole'],
  opts: DeriveOptions = {},
): DeriveResult {
  const built = buildPuzzles(hole, opts);
  const minTrap = opts.minTrap ?? 0;
  if (minTrap <= 0) return built;

  // Measure what we are about to ship. Across the shipped library every
  // puzzle scoring 0.32 or better is a par-3 tee shot; derived approaches
  // land between 0.00 and 0.19 even at the same distance and dispersion,
  // because an approach arrives through the opening the architect left
  // while a par-3 green is defended on every side. Rather than encode that
  // as a rule about categories, ask the engine per puzzle.
  const profile = opts.profile ?? bucketedProfile(SEED_PROFILE);
  const prepared = prepareHole(holeDataFromInput(hole));
  const kept: Puzzle[] = [];
  const notes = [...built.notes];

  for (const p of built.puzzles) {
    const summary = computeGridSummary(
      prepared,
      { ball: prepared.toLocal(p.ball), pin: prepared.pin, lie: p.lie },
      profile,
      p.category,
      opts.nSamples ? { nSamples: opts.nSamples } : {},
    );
    if (summary.trapSize >= minTrap) {
      kept.push(p);
    } else {
      notes.push(
        `dropped the ${p.category} puzzle — trap ${summary.trapSize.toFixed(2)} is below ` +
          `${minTrap.toFixed(2)}, so aiming at the flag is already optimal`,
      );
    }
  }

  // Ids number from 1 in play order; renumber after dropping so a hole
  // never ships with a gap in its puzzle ids.
  return {
    puzzles: kept.map((p, i) => ({ ...p, id: `${hole.id}-${p.category}-${i + 1}` })),
    notes,
  };
}

function buildPuzzles(hole: IngestInput['hole'], opts: DeriveOptions): DeriveResult {
  const profile = opts.profile ?? bucketedProfile(SEED_PROFILE);
  const prepared = prepareHole(holeDataFromInput(hole));
  const notes: string[] = [];
  const puzzles: Puzzle[] = [];

  const tee = prepared.toLocal(hole.tees[0]!);
  const holeYards = Math.round(dist(tee, prepared.pin));

  const toLonLat = (p: Pt) => prepared.toLonLat(p);
  const push = (at: Pt, lie: Puzzle['lie'], category: Puzzle['category']) => {
    const yards = Math.round(dist(at, prepared.pin));
    puzzles.push({
      id: `${hole.id}-${category}-${puzzles.length + 1}`,
      ball: toLonLat(at),
      lie,
      category,
      description: describe(category, yards, lie),
    });
  };

  // A par 3 is one shot; the tee puzzle is the whole hole.
  if (hole.par === 3 || holeYards < 260) {
    push(tee, 'tee', 'tee');
    if (hole.par !== 3) {
      notes.push(`${holeYards}y plays as a single shot; only a tee puzzle was derived`);
    }
    return { puzzles, notes };
  }

  push(tee, 'tee', 'tee');

  const drive = nextBall(prepared, tee, 'tee', 'tee', profile, opts.nSamples);
  if (!drive) {
    notes.push('the optimal tee line has no playable landing area; no approach puzzle derived');
    return { puzzles, notes };
  }

  const afterDrive = Math.round(dist(drive.at, prepared.pin));

  if (hole.par === 5 && afterDrive > LAYUP_THRESHOLD_YDS) {
    push(drive.at, drive.lie, 'layup');
    const layup = nextBall(prepared, drive.at, drive.lie, 'layup', profile, opts.nSamples);
    if (!layup) {
      notes.push('the optimal lay-up has no playable landing area; no approach puzzle derived');
      return { puzzles, notes };
    }
    const afterLayup = Math.round(dist(layup.at, prepared.pin));
    if (afterLayup >= MIN_PUZZLE_YDS) {
      push(layup.at, layup.lie, 'approach');
    } else {
      notes.push(`the lay-up leaves ${afterLayup}y — too short to be a decision, so no approach`);
    }
    return { puzzles, notes };
  }

  if (afterDrive < MIN_PUZZLE_YDS) {
    notes.push(`the optimal drive leaves ${afterDrive}y — too short to be a decision`);
    return { puzzles, notes };
  }

  push(drive.at, drive.lie, 'approach');
  return { puzzles, notes };
}
