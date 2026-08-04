/**
 * The rule registry.
 *
 * Every rule declares a guard against real fact-table fields, a stake in
 * STROKES (one scalar, comparable across families, so "many true things"
 * resolves to "the one that accounts for most of the loss"), a claim, and
 * a verify() that independently restates the assertion from the facts. A
 * claim that cannot verify itself does not ship.
 *
 * Deliberately absent, with reasons:
 *  - No shape-bias rule. SHAPE_BIAS_FRACTION is 0.008, so a draw moves the
 *    ball ~2y at driver range — a seventh of one lateral sigma. A guard
 *    tight enough to be true could never fire.
 *  - No trapSize guard anywhere. doral-18-tee-1 has trapSize 0.008 and 93%
 *    water at the flag: trapSize compares the NAIVE line to the optimal,
 *    so "the flag was the aim" gated on it would print to a player who
 *    just drowned a drive.
 */

import { LIE_SIGMA_MULTIPLIER } from '@/lib/engine/constants';
import type { FeatureHit } from '@/lib/engine/types';
import {
  club,
  clubPlural,
  feet,
  lateralDir,
  pct,
  strokes,
  yardsExact,
  yardsMeasured,
} from './format';
import type { Dir } from './format';
import { labelFeature, labelKindPlural, lieNoun } from './labels';
import type { LabelContext } from './labels';
import type { Claim, Facts, Slot, Token } from './types';

export interface RuleContext {
  facts: Facts;
  labels: LabelContext;
}

export interface Rule {
  id: string;
  slot: Slot;
  tag: string;
  guard: (c: RuleContext) => boolean;
  stake: (c: RuleContext) => number;
  claim: (c: RuleContext) => Claim | null;
  /** Independent restatement; a claim that fails is dropped. */
  verify: (c: RuleContext, claim: Claim) => boolean;
}

/** Ordering weights only — never printed. */
const MARGINAL_COST: Record<string, number> = {
  water: 1.0,
  ob: 1.1,
  recovery: 0.7,
  bunker: 0.45,
  green: 0.4,
  fairway: 0.3,
};

const t = (text: string): Token => ({ text });
const m = (text: string): Token => ({ text, mono: true });
const key = (text: string): Token => ({ text, mono: true, key: true });

function build(
  id: string,
  slot: Slot,
  tag: string,
  stake: number,
  tokens: Token[],
): Claim {
  return { ruleId: id, slot, tag, tokens, text: tokens.map((x) => x.text).join(''), stake };
}

/** The penal features the player found that the optimal line does not. */
function penalDrivers(c: RuleContext, kinds: string[], minShare: number, minDelta: number) {
  const { facts } = c;
  return facts.player.hits
    .filter((h) => kinds.includes(h.kind))
    .filter((h) => h.fraction >= minShare)
    .filter((h) => {
      const opt = facts.optimal?.shareById.get(h.id) ?? 0;
      return h.fraction - opt >= minDelta;
    })
    .sort((a, b) => b.fraction - a.fraction);
}

function deltaShare(c: RuleContext, h: FeatureHit): number {
  return h.fraction - (c.facts.optimal?.shareById.get(h.id) ?? 0);
}

/** "That line" / "Aiming there" — READ never opens with "You". */
const AIM_PHRASE = 'That line puts';

export const RULES: Rule[] = [
  // ---------------------------------------------------------------- READ
  {
    id: 'club-clamp',
    slot: 'read',
    tag: 'club',
    guard: ({ facts }) =>
      facts.player.clamped && facts.holeDistance - facts.playerAimDistance >= 15,
    stake: () => 1.0,
    claim: ({ facts }) => {
      // Names the club gap only. The hazard is penal-share's job — saying
      // both produces the same percentage twice in one note.
      const gap = facts.holeDistance - facts.playerAimDistance;
      return build('club-clamp', 'read', 'club', 1.0, [
        t('The flag is '),
        m(String(yardsMeasured(facts.holeDistance))),
        t(' away and your '),
        t(facts.player.clubLabel.toLowerCase()),
        t(' carries '),
        key(String(yardsMeasured(facts.playerAimDistance))),
        t(' — that line comes up '),
        m(String(yardsMeasured(gap))),
        t(' short however well you strike it.'),
      ]);
    },
    verify: ({ facts }) => facts.player.clamped,
  },

  {
    id: 'penal-share',
    slot: 'read',
    tag: 'penal',
    guard: (c) =>
      c.facts.optimal !== null &&
      penalDrivers(c, ['water', 'ob'], c.facts.floors.anchor, c.facts.floors.delta).length > 0,
    stake: (c) => {
      const h = penalDrivers(c, ['water', 'ob'], c.facts.floors.anchor, c.facts.floors.delta)[0]!;
      return deltaShare(c, h) * (MARGINAL_COST[h.kind] ?? 1);
    },
    claim: (c) => {
      const h = penalDrivers(c, ['water', 'ob'], c.facts.floors.anchor, c.facts.floors.delta)[0]!;
      return build('penal-share', 'read', 'penal', 0, [
        t(`${AIM_PHRASE} `),
        key(String(pct(h.fraction, c.facts.floors))),
        t(` of your ${clubPlural(c.facts.player.clubLabel)} in ${labelFeature(h, c.labels)}.`),
      ]);
    },
    verify: (c, claim) => {
      const h = penalDrivers(c, ['water', 'ob'], c.facts.floors.anchor, c.facts.floors.delta)[0];
      return !!h && claim.text.includes(String(pct(h.fraction, c.facts.floors)));
    },
  },

  {
    id: 'hazard-swap',
    slot: 'read',
    tag: 'penal',
    guard: (c) =>
      c.facts.optimal !== null &&
      penalDrivers(c, ['bunker', 'recovery'], 0.15, 0.08).length > 0,
    stake: (c) => {
      const h = penalDrivers(c, ['bunker', 'recovery'], 0.15, 0.08)[0]!;
      return deltaShare(c, h) * (MARGINAL_COST[h.kind] ?? 0.5);
    },
    claim: (c) => {
      const h = penalDrivers(c, ['bunker', 'recovery'], 0.15, 0.08)[0]!;
      const verb = h.kind === 'recovery' ? 'in' : 'in';
      return build('hazard-swap', 'read', 'penal', 0, [
        t(`${AIM_PHRASE} `),
        key(String(pct(h.fraction, c.facts.floors))),
        t(
          ` of your ${clubPlural(c.facts.player.clubLabel)} ${verb} ${labelFeature(h, c.labels)}.`,
        ),
      ]);
    },
    verify: (c) => penalDrivers(c, ['bunker', 'recovery'], 0.15, 0.08).length > 0,
  },

  {
    id: 'penal-aggregate',
    slot: 'read',
    tag: 'penal',
    guard: (c) => {
      const { facts } = c;
      if (!facts.optimal) return false;
      const sand = facts.player.hits.filter((h) => h.kind === 'bunker');
      if (sand.length < 2) return false;
      const total = sand.reduce((s, h) => s + h.fraction, 0);
      const optTotal = sand.reduce(
        (s, h) => s + (facts.optimal!.shareById.get(h.id) ?? 0),
        0,
      );
      return total >= 0.12 && total - optTotal >= facts.floors.delta;
    },
    stake: (c) => {
      const sand = c.facts.player.hits.filter((h) => h.kind === 'bunker');
      const total = sand.reduce((s, h) => s + h.fraction, 0);
      const optTotal = sand.reduce(
        (s, h) => s + (c.facts.optimal!.shareById.get(h.id) ?? 0),
        0,
      );
      return (total - optTotal) * MARGINAL_COST.bunker!;
    },
    claim: (c) => {
      const sand = c.facts.player.hits.filter((h) => h.kind === 'bunker');
      const total = sand.reduce((s, h) => s + h.fraction, 0);
      return build('penal-aggregate', 'read', 'penal', 0, [
        t(`${AIM_PHRASE} `),
        key(String(pct(total, c.facts.floors))),
        t(
          ` of your ${clubPlural(c.facts.player.clubLabel)} in ${labelKindPlural('bunker')}.`,
        ),
      ]);
    },
    verify: (c) => c.facts.player.hits.filter((h) => h.kind === 'bunker').length >= 2,
  },

  {
    id: 'depth-error',
    slot: 'read',
    tag: 'depth',
    guard: ({ facts }) => {
      if (
        facts.toOptimal === null ||
        facts.player.clamped ||
        Math.abs(facts.toOptimal.long) < 8 ||
        Math.abs(facts.toOptimal.lat) >= 8
      ) {
        return false;
      }
      // Coherence: never diagnose "you were short" above a MOVE that says
      // play shorter still. If the recommended correction disagrees in
      // direction, the correction is the honest instruction and this claim
      // stands down.
      const c = facts.correction;
      if (c && Math.abs(c.long) >= facts.floors.yards) {
        return Math.sign(c.long) === Math.sign(facts.toOptimal.long);
      }
      return true;
    },
    stake: ({ facts }) => Math.max(facts.floors.strokes, facts.sgLoss),
    claim: ({ facts }) => {
      const long = facts.toOptimal!.long;
      const word = long > 0 ? 'short' : 'long';
      return build('depth-error', 'read', 'depth', 0, [
        t('The line was right; the number was '),
        key(String(yardsMeasured(long))),
        t(` ${word}.`),
      ]);
    },
    verify: ({ facts }) => facts.toOptimal !== null && Math.abs(facts.toOptimal.long) >= 8,
  },

  {
    id: 'forced-carry',
    slot: 'read',
    tag: 'forced',
    guard: ({ facts }) =>
      facts.optimal !== null && facts.optimal.penalShare >= facts.floors.anchor,
    stake: ({ facts }) => facts.optimal!.penalShare * 0.5,
    claim: ({ facts }) =>
      build('forced-carry', 'read', 'forced', 0, [
        t('Even the best line here leaves '),
        m(String(pct(facts.optimal!.penalShare, facts.floors))),
        t(' of a pattern in trouble. Yours left '),
        key(String(pct(facts.player.penalShare, facts.floors))),
        t('.'),
      ]),
    verify: ({ facts }) => (facts.optimal?.penalShare ?? 0) >= facts.floors.anchor,
  },

  {
    id: 'lie-widens',
    slot: 'read',
    tag: 'lie',
    guard: ({ facts }) => facts.lie === 'sand' || facts.lie === 'rough' || facts.lie === 'recovery',
    stake: () => 0.05,
    claim: ({ facts }) => {
      const mult = LIE_SIGMA_MULTIPLIER[facts.lie as 'sand' | 'rough' | 'recovery'];
      return build('lie-widens', 'read', 'lie', 0, [
        t(`From ${lieNoun(facts.lie)} your pattern runs `),
        key(`${mult.toFixed(2).replace(/0$/, '')}×`),
        t(' as wide as it does from grass — the same line covers more ground.'),
      ]);
    },
    verify: ({ facts }) => ['sand', 'rough', 'recovery'].includes(facts.lie),
  },

  {
    id: 'room',
    slot: 'read',
    tag: 'room',
    guard: ({ facts }) => {
      const c = facts.corridor?.['0.10'];
      if (!c) return false;
      const lo = Math.min(c.left, c.right);
      const hi = Math.max(c.left, c.right);
      return lo >= 6 && hi / Math.max(1, lo) >= 1.8 && !c.leftClipped && !c.rightClipped;
    },
    stake: () => 0.05,
    claim: ({ facts }) => {
      const c = facts.corridor!['0.10'];
      const wideDir: Dir = c.right > c.left ? 'right' : 'left';
      const wide = Math.max(c.left, c.right);
      const narrow = Math.min(c.left, c.right);
      return build('room', 'read', 'room', 0, [
        t('The good line has '),
        key(String(yardsExact(wide))),
        t(` of room to the ${wideDir} and `),
        m(String(yardsExact(narrow))),
        t(' the other way.'),
      ]);
    },
    verify: ({ facts }) => facts.corridor !== null,
  },

  {
    id: 'leave',
    slot: 'read',
    tag: 'leave',
    guard: ({ facts }) =>
      (facts.category === 'tee' || facts.category === 'layup') &&
      facts.player.inPlayShare >= 0.9 &&
      (facts.optimal?.inPlayShare ?? 0) >= 0.9 &&
      Math.abs(facts.playerAimDistance - (facts.optimal?.aimDistance ?? 0)) >= 8,
    stake: ({ facts }) =>
      Math.min(0.08, Math.abs(facts.playerAimDistance - (facts.optimal?.aimDistance ?? 0)) / 400),
    claim: ({ facts }) => {
      const delta = (facts.optimal?.aimDistance ?? 0) - facts.playerAimDistance;
      const word = delta > 0 ? 'less' : 'more';
      return build('leave', 'read', 'leave', 0, [
        t('Both lines are in play; the better one leaves '),
        key(String(yardsMeasured(delta))),
        t(` ${word} club into the green.`),
      ]);
    },
    verify: ({ facts }) => facts.player.inPlayShare >= 0.9,
  },

  {
    id: 'green-rate',
    slot: 'read',
    tag: 'green',
    guard: ({ facts }) => facts.player.greenShare > 0,
    stake: () => 0.02,
    claim: ({ facts }) => {
      const ft = facts.player.greenFeet !== null ? feet(facts.player.greenFeet / 3) : null;
      const tokens: Token[] = [
        t('That pattern finds the green '),
        key(String(pct(facts.player.greenShare, facts.floors))),
        t(' of the time'),
      ];
      if (ft) tokens.push(t(', averaging '), m(String(ft)), t(' from the flag'));
      tokens.push(t('.'));
      return build('green-rate', 'read', 'green', 0, tokens);
    },
    verify: ({ facts }) => facts.player.greenShare > 0,
  },

  // ---------------------------------------------------------------- MOVE
  {
    id: 'cheap-bail',
    slot: 'move',
    tag: 'move',
    guard: ({ facts }) => {
      if (!facts.correction) return false;
      const before = facts.player.penalShare;
      const after =
        (facts.correction.result.outcomeStats.lieBreakdown.water ?? 0) +
        (facts.correction.result.outcomeStats.lieBreakdown.ob ?? 0);
      return before - after >= 0.08;
    },
    stake: ({ facts }) => facts.player.e - (facts.correction?.e ?? facts.player.e),
    claim: ({ facts }) => {
      const p = facts.correction!;
      const after =
        (p.result.outcomeStats.lieBreakdown.water ?? 0) +
        (p.result.outcomeStats.lieBreakdown.ob ?? 0);
      const dir = p.lat !== 0 ? lateralDir(p.lat) : p.long > 0 ? 'long' : 'short';
      const dist = p.lat !== 0 ? Math.abs(p.lat) : Math.abs(p.long);
      const gain = facts.player.e - p.e;
      const tokens: Token[] = [
        t('Aim '),
        key(String(yardsExact(dist))),
        t(` ${dir} of that and the trouble `),
      ];
      tokens.push(
        after < facts.floors.print
          ? t('drops under 5%')
          : t(`falls to ${pct(after, facts.floors)}`),
      );
      tokens.push(
        gain >= facts.floors.strokes
          ? t(', for ')
          : t(', which is the best there is from here'),
      );
      if (gain >= facts.floors.strokes) {
        tokens.push(m(String(strokes(gain))), t(' strokes back.'));
      } else {
        tokens.push(t('.'));
      }
      return build('cheap-bail', 'move', 'move', 0, tokens);
    },
    verify: ({ facts }) => facts.correction !== null,
  },

  {
    id: 'club-down',
    slot: 'move',
    tag: 'move',
    guard: ({ facts }) =>
      facts.optimal !== null &&
      facts.optimal.clubLabel !== facts.player.clubLabel &&
      Math.abs(facts.optimal.aimDistance - facts.playerAimDistance) >= 6 &&
      (!facts.player.clamped || facts.optimal.aimDistance < facts.playerAimDistance),
    stake: ({ facts }) => Math.max(facts.floors.strokes, facts.player.e - (facts.optimal?.e ?? 0)),
    claim: ({ facts }) =>
      build('club-down', 'move', 'move', 0, [
        t(`Take ${club(facts.optimal!.clubLabel)} — `),
        key(String(yardsMeasured(facts.optimal!.aimDistance))),
        t(' instead of '),
        m(String(yardsMeasured(facts.playerAimDistance))),
        t('.'),
      ]),
    verify: ({ facts }) => facts.optimal !== null,
  },

  {
    id: 'free-gain',
    slot: 'move',
    tag: 'move',
    guard: ({ facts }) => {
      if (!facts.correction || facts.player.e - facts.correction.e < 0.05) return false;
      // The sentence is about the green, so the green has to be reachable —
      // otherwise it reads "holds 0% instead of 0%".
      const after = facts.correction.result.outcomeStats.onGreen?.fraction ?? 0;
      return after >= facts.floors.print && after - facts.player.greenShare >= facts.floors.delta;
    },
    stake: ({ facts }) => facts.player.e - (facts.correction?.e ?? facts.player.e),
    claim: ({ facts }) => {
      const p = facts.correction!;
      const dir = p.lat !== 0 ? lateralDir(p.lat) : p.long > 0 ? 'long' : 'short';
      const dist = p.lat !== 0 ? Math.abs(p.lat) : Math.abs(p.long);
      const greenAfter = p.result.outcomeStats.onGreen?.fraction ?? 0;
      return build('free-gain', 'move', 'move', 0, [
        t('Aim '),
        key(String(yardsExact(dist))),
        t(` ${dir} of that and the green holds `),
        m(String(pct(greenAfter, facts.floors))),
        t(' of the pattern instead of '),
        m(String(pct(facts.player.greenShare, facts.floors))),
        t('.'),
      ]);
    },
    verify: ({ facts }) => facts.correction !== null,
  },

  {
    id: 'hold-the-line',
    slot: 'move',
    tag: 'move',
    guard: ({ facts }) => {
      const c = facts.corridor?.['0.10'];
      // A corridor of zero yards is not room; it means the walk failed.
      return facts.sgLoss <= facts.floors.strokes && !!c && Math.max(c.left, c.right) >= facts.floors.yards;
    },
    stake: () => 0.01,
    claim: ({ facts }) => {
      const c = facts.corridor!['0.10'];
      const missDir: Dir = c.right > c.left ? 'right' : 'left';
      const wide = Math.max(c.left, c.right);
      return build('hold-the-line', 'move', 'move', 0, [
        t('Hold that line. It has '),
        key(String(yardsExact(wide))),
        t(` of room to the ${missDir} — miss there, not the other way.`),
      ]);
    },
    verify: ({ facts }) => facts.corridor !== null,
  },

  {
    id: 'sub-resolution',
    slot: 'move',
    tag: 'move',
    guard: ({ facts }) =>
      facts.toOptimal !== null &&
      Math.hypot(facts.toOptimal.lat, facts.toOptimal.long) <= Math.max(6, facts.sigmaLat),
    stake: () => 0.01,
    claim: ({ facts }) => {
      const off = Math.hypot(facts.toOptimal!.lat, facts.toOptimal!.long);
      if (off < facts.floors.yards) {
        return build('sub-resolution', 'move', 'move', 0, [
          t('That is the line. Play it again from here.'),
        ]);
      }
      return build('sub-resolution', 'move', 'move', 0, [
        t('The best line sits '),
        key(String(yardsExact(off))),
        t(' from yours, inside your own pattern. There is nothing here to correct.'),
      ]);
    },
    verify: ({ facts }) => facts.toOptimal !== null,
  },

  {
    // MOVE's totality backstop: when no probe improved on the player's aim,
    // the instruction is still a direction they can execute, taken from the
    // optimal's offset rather than from a probe.
    id: 'aim-line',
    slot: 'move',
    tag: 'move',
    guard: ({ facts }) =>
      facts.toOptimal !== null &&
      Math.hypot(facts.toOptimal.lat, facts.toOptimal.long) > Math.max(6, facts.sigmaLat),
    stake: () => 0.01,
    claim: ({ facts }) => {
      const { lat, long } = facts.toOptimal!;
      const lateral = Math.abs(lat) >= Math.abs(long);
      const dist = lateral ? Math.abs(lat) : Math.abs(long);
      const dir: Dir = lateral ? lateralDir(lat) : long > 0 ? 'long' : 'short';
      const word = dir === 'long' ? 'further on' : dir === 'short' ? 'shorter' : `${dir}`;
      return build('aim-line', 'move', 'move', 0, [
        t('The line that plays best starts '),
        key(String(yardsMeasured(dist))),
        t(lateral ? ` ${word} of the flag.` : ` ${word} than that.`),
      ]);
    },
    verify: ({ facts }) => facts.toOptimal !== null,
  },

  // ------------------------------------------------------------- backstop
  {
    id: 'fallback-strokes',
    slot: 'read',
    tag: 'fallback',
    // The literal constant: proof of totality. Every input produces a note,
    // including the degraded path where no outcomeStats or grid exist.
    guard: () => true,
    stake: () => 0,
    claim: ({ facts }) =>
      build('fallback-strokes', 'read', 'fallback', 0, [
        t('That line plays '),
        key(String(strokes(Math.max(facts.floors.strokes, facts.sgLoss)))),
        t(' strokes worse than the best one on this hole.'),
      ]),
    verify: () => true,
  },
];

export const RULES_BY_ID = new Map(RULES.map((r) => [r.id, r]));
