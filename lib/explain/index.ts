/**
 * explain() — the caddie's note.
 *
 * Selection, in order:
 *  1. Admissibility — run every guard, drop anything under its floor. The
 *     floors are the hedge; there are no hedging adverbs in this system.
 *  2. Materiality — sort by stake in strokes, so the sentence that survives
 *     is the one accounting for the most of the player's loss.
 *  3. Novelty — a rule the player has seen in 3 of their last 8 notes is
 *     demoted, which promotes the two transferable maxims and trades a fact
 *     about this pond for a rule about ponds.
 *  4. Diversity + budget — one claim per tag, capped by band. The note grows
 *     with the size of the mistake; Perfect gets the shortest note of the
 *     four. When you were right, the caddie says less.
 *  5. Verification — every claim must restate itself from the facts or it
 *     is dropped and the next-ranked claim takes the slot.
 */

import { bandStamp } from '@/lib/design/tokens';
import { buildFacts } from './facts';
import { strokes } from './format';
import { chooseCorrection, runProbes } from './probes';
import { RULES } from './rules';
import type { RuleContext } from './rules';
import type { Band, Claim, ExplainInput, Note, Probe } from './types';

/** READ budget by band — the note's height tracks the size of the mistake. */
const READ_BUDGET: Record<Band, number> = { perfect: 1, good: 1, okay: 2, miss: 2 };

export function explain(input: ExplainInput): Note {
  let probes: Probe[] = [];
  let correction: Probe | null = null;

  if (input.evaluate && input.grid) {
    // Probe around the EFFECTIVE aim: when the requested aim is past max
    // carry the ball never goes there, and probing from an unreachable
    // point rejects the whole ladder.
    const origin = input.playerEval.outcomeStats.effAim ?? input.playerAim;
    probes = runProbes({
      ball: input.sit.ball,
      pin: input.sit.pin,
      playerAim: origin,
      maxCarry: input.grid.brief.maxCarry,
      evaluate: input.evaluate,
    });
    correction = chooseCorrection(
      probes,
      input.playerEval.expectedStrokes,
      input.grid.optimal.e,
    );
  }

  const facts = buildFacts(input, probes, correction);
  const ctx: RuleContext = {
    facts,
    labels: { ball: input.sit.ball, pin: input.sit.pin },
  };

  const history = input.history ?? [];
  const seenCount = (id: string) => history.filter((h) => h.includes(id)).length;
  const inLast = (id: string) => (history[0] ?? []).includes(id);

  const scored = RULES.filter((r) => {
    try {
      return r.guard(ctx);
    } catch {
      return false;
    }
  }).map((r) => {
    let stake = 0;
    try {
      stake = r.stake(ctx);
    } catch {
      stake = 0;
    }
    // Novelty: repetition demotes, which is how the maxims get their turn.
    if (seenCount(r.id) >= 3) stake *= 0.35;
    else if (inLast(r.id)) stake *= 0.6;
    return { rule: r, stake };
  });

  const emit = (entry: (typeof scored)[number]): Claim | null => {
    try {
      const claim = entry.rule.claim(ctx);
      if (!claim) return null;
      const withStake = { ...claim, stake: entry.stake };
      return entry.rule.verify(ctx, withStake) ? withStake : null;
    } catch {
      return null;
    }
  };

  // READ
  const readCandidates = scored
    .filter((s) => s.rule.slot === 'read')
    .sort(
      (a, b) =>
        b.stake - a.stake ||
        a.rule.id.localeCompare(b.rule.id),
    );
  const read: Claim[] = [];
  const usedTags = new Set<string>();
  const budget = READ_BUDGET[input.band];
  for (const cand of readCandidates) {
    if (read.length >= budget) break;
    if (usedTags.has(cand.rule.tag)) continue;
    // The backstop only fires if nothing better did.
    if (cand.rule.id === 'fallback-strokes' && read.length > 0) continue;
    const claim = emit(cand);
    if (!claim) continue;
    read.push(claim);
    usedTags.add(cand.rule.tag);
  }
  if (read.length === 0) {
    const fallback = scored.find((s) => s.rule.id === 'fallback-strokes');
    const claim = fallback ? emit(fallback) : null;
    if (claim) read.push(claim);
  }

  // MOVE — first passing guard in registry order wins.
  let move: Claim | null = null;
  for (const cand of scored.filter((s) => s.rule.slot === 'move')) {
    const claim = emit(cand);
    if (claim) {
      move = claim;
      break;
    }
  }

  const ruleIds = [...read.map((c) => c.ruleId), ...(move ? [move.ruleId] : [])];
  const mark =
    correction && move
      ? { at: correction.aim, delta: facts.player.e - correction.e, glyph: 'spot-height' as const }
      : null;

  return {
    read,
    move,
    ruleIds,
    srPrefix: `${bandStamp.labels[input.band]}. ${strokes(Math.max(0, input.sgLoss))} strokes lost.`,
    mark,
  };
}

export type { ExplainInput, Note, Claim, Token, Facts } from './types';
export { buildFacts } from './facts';
export { runProbes, chooseCorrection } from './probes';
export { RULES } from './rules';
