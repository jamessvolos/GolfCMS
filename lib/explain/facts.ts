/**
 * Engine numbers → the flat fact table rules read from. Nothing else in
 * lib/explain touches the engine, so every guard can be exercised against
 * a fixture.
 */

import { dist } from '@/lib/engine/projection';
import type { EvalResult, Pt } from '@/lib/engine/types';
import { floorsFor } from './format';
import type { AimFacts, ExplainInput, Facts, Probe } from './types';

function aimFacts(result: EvalResult): AimFacts {
  const s = result.outcomeStats;
  const hits = s.featureHits ?? [];
  const shareById = new Map<number, number>();
  for (const h of hits) shareById.set(h.id, h.fraction);
  const b = s.lieBreakdown;
  const penalShare = (b.water ?? 0) + (b.ob ?? 0);
  const onGreen = s.onGreen;
  return {
    e: result.expectedStrokes,
    clubLabel: s.club.label,
    clamped: s.clamped,
    aimDistance: s.aimDistance,
    penalShare,
    greenShare: onGreen?.fraction ?? b.green ?? 0,
    greenFeet: onGreen && onGreen.fraction > 0 ? onGreen.meanDistanceToPin * 3 : null,
    inPlayShare: s.inPlay?.fraction ?? 1 - penalShare,
    hits,
    shareById,
  };
}

/** Shot-frame offset of `to` relative to `from`, about the ball→pin axis. */
export function shotFrameOffset(
  ball: Pt,
  pin: Pt,
  from: Pt,
  to: Pt,
): { lat: number; long: number } {
  const dx = pin.x - ball.x;
  const dy = pin.y - ball.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const rx = to.x - from.x;
  const ry = to.y - from.y;
  return { lat: rx * uy - ry * ux, long: rx * ux + ry * uy };
}

export function buildFacts(input: ExplainInput, probes: Probe[], correction: Probe | null): Facts {
  const { grid, playerEval, sit, playerAim } = input;
  const player = aimFacts(playerEval);
  const optimal = grid ? aimFacts(grid.optimal.result) : null;
  const pin =
    grid?.pinAim
      ? aimFacts(grid.pinAim.result)
      : grid && isSamePoint(grid.naive.local, sit.pin)
        ? aimFacts(grid.naive.result)
        : null;

  return {
    band: input.band,
    sgLoss: input.sgLoss,
    category: input.category,
    lie: input.lie,
    nSamples: playerEval.outcomeStats.nSamples,
    floors: floorsFor(playerEval.outcomeStats.nSamples),
    player,
    optimal,
    pin,
    holeDistance: grid?.brief.holeDistance ?? dist(sit.ball, sit.pin),
    playerAimDistance: playerEval.outcomeStats.aimDistance,
    maxCarry: grid?.brief.maxCarry ?? playerEval.outcomeStats.aimDistance,
    sigmaLat: grid?.brief.sigmaLat ?? 0,
    // Measured from the EFFECTIVE aim: when the requested aim is past max
    // carry the ball never goes there, so an offset from it is fiction.
    toOptimal: grid
      ? shotFrameOffset(
          sit.ball,
          sit.pin,
          playerEval.outcomeStats.effAim ?? playerAim,
          grid.optimal.local,
        )
      : null,
    corridor: grid?.brief.corridor ?? null,
    probes,
    correction,
  };
}

function isSamePoint(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}
