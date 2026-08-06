/**
 * Where the ball starts.
 *
 * The old derivation (`lib/content/osm/puzzles.ts`) ran the optimizer from
 * the tee and started the next puzzle **where its best line was aimed**.
 * That is circular: the ball is placed at the point the optimizer chose as
 * the best available outcome, which is by construction a position from
 * which the next shot is easy. Measured — the pipeline sampled the two
 * positions on a hole least likely to contain a decision, and the survey
 * then concluded the hole contained none.
 *
 * Here the ball goes where a shot actually **finished**. Play the panel
 * line with the player's own dispersion, take a sampled landing, and that
 * is the next situation. Positions produced this way are simultaneously
 *
 *   - plausible — every one is a reachable outcome of a real shot,
 *   - diverse — dispersion scatters them across lies and angles, so sand,
 *     rough and recovery starts appear at all (the shipped library has 4 of
 *     36 from anything other than tee/fairway),
 *   - uncircular — a landing point is not an aim point,
 *   - unlimited — vary the seed and the hole yields a different set forever.
 *
 * Nothing here decides whether a situation is worth serving. It proposes;
 * `screen.ts` filters cheaply and `admit.ts` certifies.
 */

import { maxCarry, selectClub } from '@/lib/engine/clubs';
import { dispersionParams, sampleLandings } from '@/lib/engine/dispersion';
import { classifyPoint } from '@/lib/engine/hole';
import { fairwayCenterAim } from '@/lib/engine/optimize';
import { dist } from '@/lib/engine/projection';
import { createNormalPairs, createRng } from '@/lib/engine/rng';
import type {
  PlayableLie,
  PlayerProfile,
  PreparedHole,
  Pt,
  PuzzleCategory,
} from '@/lib/engine/types';

/** Closer in than this is a chip, not a course-management decision. */
export const MIN_SITUATION_YDS = 40;

/** Shots per simulated pass down the hole before giving up. */
const MAX_SHOTS = 5;

/** Beyond this to the pin, an approach is really a lay-up. */
const LAYUP_THRESHOLD_YDS = 240;

export interface Situation {
  /** Local yards. */
  ball: Pt;
  lie: PlayableLie;
  category: PuzzleCategory;
  /** Yards to the pin used to generate it (the hole pin, not a sheet pin). */
  toPin: number;
  /** Which shot of the simulated pass produced it: 1 = off the tee. */
  shotIndex: number;
}

export interface DrawOptions {
  /** Simulated passes down the hole. Each is one player playing it once. */
  passes?: number;
  /**
   * Deduplication grid. Two balls in the same lie within these bands are
   * the same puzzle as far as a player is concerned.
   */
  distanceBandYds?: number;
  lateralBandYds?: number;
}

function bandKey(
  prepared: PreparedHole,
  s: Situation,
  distanceBand: number,
  lateralBand: number,
): string {
  const tee = prepared.tees[0] ?? prepared.pin;
  const axis = Math.max(1e-6, dist(tee, prepared.pin));
  const ux = (prepared.pin.x - tee.x) / axis;
  const uy = (prepared.pin.y - tee.y) / axis;
  const dx = s.ball.x - tee.x;
  const dy = s.ball.y - tee.y;
  const lateral = -dx * uy + dy * ux;
  return `${s.lie}:${Math.round(s.toPin / distanceBand)}:${Math.round(lateral / lateralBand)}`;
}

/**
 * Play the hole `passes` times with this profile and return every distinct
 * position a shot finished in.
 *
 * The aim used for each shot is the *panel* line — as far as you can down
 * the middle, or the flag once it is in range — deliberately NOT the
 * optimizer's answer. Using the optimum would reintroduce the circularity
 * this exists to remove, and would also be far more expensive: a pass costs
 * a handful of `sampleLandings` calls rather than a grid per shot.
 */
export function drawSituations(
  prepared: PreparedHole,
  profile: PlayerProfile,
  seed: number,
  opts: DrawOptions = {},
): Situation[] {
  const passes = opts.passes ?? 12;
  const distanceBand = opts.distanceBandYds ?? 20;
  const lateralBand = opts.lateralBandYds ?? 15;
  const tee = prepared.tees[0];
  if (!tee) return [];

  const seen = new Set<string>();
  const out: Situation[] = [];
  const rng = createRng(seed);

  for (let pass = 0; pass < passes; pass++) {
    let ball = { ...tee };
    let lie: PlayableLie = 'tee';

    for (let shot = 1; shot <= MAX_SHOTS; shot++) {
      const toPin = dist(ball, prepared.pin);
      if (toPin < MIN_SITUATION_YDS) break;

      const category: PuzzleCategory =
        shot === 1
          ? 'tee'
          : lie === 'sand' || lie === 'recovery'
            ? 'recovery'
            : toPin > LAYUP_THRESHOLD_YDS
              ? 'layup'
              : 'approach';

      const situation: Situation = { ball: { ...ball }, lie, category, toPin: Math.round(toPin), shotIndex: shot };
      const key = bandKey(prepared, situation, distanceBand, lateralBand);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(situation);
      }

      // Play the panel line, not the optimum. Every pass draws its own
      // normals so twelve passes are twelve different rounds rather than
      // twelve copies of one.
      const reach = maxCarry(profile, lie);
      const bearing = Math.atan2(prepared.pin.x - ball.x, prepared.pin.y - ball.y);
      const aim =
        toPin <= reach ? { ...prepared.pin } : fairwayCenterAim(prepared, ball, bearing, reach);
      const want = Math.max(1, dist(ball, aim));
      const { effectiveDistance } = selectClub(profile, lie, want);
      const effAim = {
        x: ball.x + ((aim.x - ball.x) / want) * effectiveDistance,
        y: ball.y + ((aim.y - ball.y) / want) * effectiveDistance,
      };
      const normals = createNormalPairs(Math.floor(rng() * 2 ** 31), 1);
      const landing = sampleLandings(
        ball,
        effAim,
        dispersionParams(profile, lie, effectiveDistance),
        normals,
      )[0]!;

      const landed = classifyPoint(prepared, landing);
      // A round continues from water and OB too, but a *puzzle* does not
      // start there — the player would be taking a drop, which the engine
      // does not model as a situation. End the pass instead of inventing one.
      if (landed === 'water' || landed === 'ob' || landed === 'green') break;
      ball = landing;
      lie = landed;
    }
  }

  return out;
}
