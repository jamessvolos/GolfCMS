// src/ui/copy.js — every player-facing string for the game surface, in one
// module, in one voice: a calm tour caddie. Short, concrete, yardage-first.
// House principle: "say the yardage, then the choice, then nothing."
// At most one emoji per surface.

export const copy = {
  // ---- controls ----
  hitIt: 'Hit it ➜',
  playOn: 'Play on ➜',
  copyResult: 'Copy result',
  nextHole: 'Next hole ⛳',
  newRound: 'New round',

  // ---- status strip ----
  loadingHole: (n, count) => `Hole ${n} of ${count} — reading it now…`,
  holeMeta: ({ course, label, n, count, par, yds, arch, wind, green }) =>
    `${course} · ${label} · Hole ${n} of ${count} · Par ${par} · ${yds} yds · ${arch}${wind}`
    + (green ?? ''),
  /** The green the hole finishes on, the way a caddie hands you the book:
   *  "· punchbowl green, pin middle bowl". */
  greenNote: (archetype, pinName) =>
    ` · ${archetype} green` + (pinName ? `, pin ${pinName}` : ''),
  wind: (mag, dir) => ` · wind ${mag} ${dir}`,
  scoreLine: (shot, pts) => `Shot ${shot} · ${pts} pts`,

  // ---- aiming ----
  // One short line. The tutorial teaches the mechanics once; repeating them
  // under every shot was most of why the box crowded the bottom of the screen.
  firstAim: (yds) => `${yds} yds. Pick your target.`,
  nextShot: (shot, yds) => `${yds} yds in. Pick your target.`,
  // `plays` is the elevation-adjusted number when the land moves it: the
  // caddie's own "165 yds — plays 178".
  aimReadout: ({ carry, club, leaves, atFlag, plays }) =>
    `${carry}y` + (plays ? ` · plays ${plays}` : '') + ` · ${club}`
    + (atFlag ? ' · at the flag' : ` · leaves ${leaves}`),
  patternLine: ({ w, l, pct, medianLeave }) => {
    const parts = [];
    if (pct.green) parts.push(`<span class="fw">${pct.green}% green</span>`);
    if (pct.fairway) parts.push(`<span class="fw">${pct.fairway}% fairway</span>`);
    if (pct.rough) parts.push(`${pct.rough}% rough`);
    if (pct.sand) parts.push(`${pct.sand}% sand`);
    if (pct.trees) parts.push(`${pct.trees}% trees`);
    if (pct.wet) parts.push(`<span class="wet">${pct.wet}% water/OB</span>`);
    return `${w}×${l} yds · ${parts.join(' · ')}` +
      (medianLeave !== null ? ` · leave ~${medianLeave}` : '');
  },
  proPattern: 'Pro mode — no odds, no dots. Your read against the reveal. 🧠',

  // ---- putting ----
  // Same voice on the green: say the footage, then the pace, then nothing.
  puttFirst: (ft) => `A ${ft}-footer. Aim your pace.`,
  puttNext: (n, ft) => `Putt ${n}: a ${ft}-footer left. Pick your pace.`,
  /** Pace call for `ft` feet past (+) or short (−) of the cup. */
  paceCall: (ft) => {
    const inches = Math.round(ft * 12);
    if (Math.abs(inches) < 3) return 'dead weight at the cup';
    const mag = Math.abs(ft) < 2 ? `${Math.abs(inches)} inches` : `${Math.round(Math.abs(ft))} feet`;
    return ft > 0 ? `${mag} of pace past the cup` : `${mag} short of the cup`;
  },
  puttAim: ({ ft, pace, make }) => `${ft} ft · ${pace} · ${make}% to drop.`,
  /** Break call when slope bends the current line. `cups` is break in cup-widths. */
  puttBreakNote: (side, cups) =>
    cups < 1
      ? ` Breaks ${side} edge — hold your line.`
      : ` Breaks ${side} — play ${cups === 1 ? 'a cup' : `${cups} cups`} out.`,
  puttPatternLine: ({ make, three, leave }) =>
    `<span class="fw">${make}% make</span> · ${three}% 3-putt` +
    (leave !== null ? ` · miss leaves ~${leave} ft` : ''),
  puttVerdictCall: (sg) =>
    sg < 0.02 ? 'Caddie-approved — perfect pace.'
    : sg < 0.08 ? 'Good read — a hair off the best pace.'
    : sg < 0.2 ? 'Playable, but the pace gave a little away.'
    : 'Costly — that pace burns putts.',
  puttVerdictLine: ({ call, pace, points, result }) =>
    `Caddie's read: ${pace} · ${result}`,
  puttResult: {
    holed: 'center cup — it drops! ⛳',
    left: (ft) => `stays out — a ${ft}-footer left`,
    'penalty-water': 'raced off the green into the water — penalty, replay the putt',
  },
  puttHoledTitle: 'Drained',
  puttLedger: (yours, caddies) =>
    `Make: your pace <span class="fw">${yours}%</span> · the caddie's read ${caddies}%.`,
  holeSubReal: ({ decisions, strokes, putts, par, yds, vsPar }) =>
    `${decisions} decisions · ${strokes} strokes (${putts} putt${putts === 1 ? '' : 's'}) on the par-${par}, ${yds}-yarder (${vsPar})`,

  // ---- the reveal ----
  verdictCall: (sg) =>
    sg < 0.02 ? 'Caddie-approved — perfect target.'
    : sg < 0.08 ? 'Good call — a whisker off the best line.'
    : sg < 0.2 ? 'Playable, but there was a better line.'
    : 'Costly — that target gives strokes away.',
  // Reveal line. The STAMP owns the verdict and the chip owns the numbers, so
  // this says only what neither does: where the caddie's line was and where
  // the ball is. Saying the call twice was the crowding.
  verdictLine: ({ call, optCarry, sg, points, ballNow }) =>
    `The ring is the caddie's ${optCarry}-yd line · ${ballNow}`,
  riskLedger: (yours, caddies) =>
    `trouble: yours <span class="wet">${yours}%</span> · caddie <span class="fw">${caddies}%</span>`,
  ballOut: (yds) => `ball ${yds} yds out`,
  outcome: {
    landed: 'landed',
    splash: 'found the water',
    'penalty-water': 'splash — penalty, replay from the same spot',
    'penalty-ob': 'OB — penalty, replay from the same spot',
  },
  noteTitle: (sg) =>
    sg < 0.02 ? 'Caddie-approved' : sg < 0.08 ? 'Good call' : sg < 0.2 ? 'Loose' : 'Costly',
  noteLines: ({ sg, points, yourE, optimalE, yourRisk, caddieRisk, last }) => [
    `SG ${sg} · +${points} pts`,
    `E ${yourE} vs caddie ${optimalE}`,
    `risk ${yourRisk}% vs caddie ${caddieRisk}%`,
    last,
  ],

  // ---- recalibration (handicap / custom pattern changes) ----
  recalibratingHcp: (label) => `Rebuilding the numbers for a ${label} pattern…`,
  recalibratedHcp: (label, yds) => `Dialed in for ${label} dispersion. ${yds} yds to the pin.`,
  recalibratingCustom: 'Rebuilding the numbers for your pattern…',
  recalibratedCustom: (yds) => `Dialed in for your pattern. ${yds} yds to the pin.`,

  // ---- hole & round results ----
  holeScore: (n, pts) => `Hole ${n}: ${pts} / 1000`,
  roundScore: (label, pts, max) => `${label}: ${pts} / ${max}`,
  genericRoundLabel: 'Round',
  holeSub: ({ decisions, est, par, yds, vsPar }) =>
    `${decisions} decisions · est. ${est} strokes on the par-${par}, ${yds}-yarder (${vsPar})`,
  roundSub: (count, grade) => `Decision quality across ${count} holes — ${grade}`,
  boardRank: (rank, of) => `Board: #${rank} of ${of}`,
  roundGrade: (r) =>
    r > 0.97 ? 'tour-caddie reads. 🧠'
    : r > 0.9 ? 'sharp course management.'
    : r > 0.8 ? 'solid, with a few loose targets.'
    : 'the caddie would like a word.',
  coachClean: "Coach's note: clean card — every target inside a nickel of the best line.",
  coachNotes: (worst) =>
    "Coach's notes — where the strokes went:\n" + worst.map((d) =>
      `· Hole ${d.hole}, shot ${d.shot}: −${d.sgLost.toFixed(2)} SG — you took ` +
      `${d.risk}% trouble where the caddie's line held ${d.caddieRisk}%.`).join('\n'),
  /** The strokes-gained ledger by phase of the game — the line real SG apps
   *  stop at, and the one that tells you what to practice. Only phases that
   *  actually cost something are listed. */
  coachPhases: (lost) => {
    const names = { tee: 'off the tee', approach: 'approaches', putt: 'putting' };
    const parts = Object.entries(lost)
      .filter(([, v]) => v > 0.005)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${names[k]} −${v.toFixed(2)}`);
    return parts.length ? `Your round in SG: ${parts.join(' · ')}.` : '';
  },
  phaseTip: (cat) => ({
    tee: 'Biggest leak: tee shots. Favor the fat side — the caddie rarely flirts with the trouble line.',
    approach: 'Biggest leak: approach targets. Aim at the middle-of-green E, not the flag.',
    putt: 'Biggest leak: pace. Dying it at the cup beats racing it three feet past.',
  }[cat] ?? ''),

  // ---- round labels ----
  dailyLabel: (n) => `Daily #${n}`,
  roundLabel: (seed) => `Round ${seed}`,
  majorLabel: (wk) => `Major ${wk}`,
  champLabel: (seed) => `Championship ${seed}`,

  // ---- share ----
  shareDaily: (n) => `Caddie Daily #${n}`,
  shareRound: (seed) => `Caddie round ${seed}`,
  shareSquares: (holes) =>
    holes.map((h) => (h.points > 970 ? '🟩' : h.points > 900 ? '🟨' : '🟥')).join(''),
  /** The result line that travels: label, score, squares — and, when the game
   *  is served over http(s), the link that lets the reader play the same
   *  holes. Spoiler-free either way. */
  share: ({ label, total, max, squares, url }) =>
    `${label} — ${total}/${max} ${squares}` + (url ? `\n${url}` : ''),
  copiedToast: 'Result copied — paste it anywhere.',
  copyFailedToast: 'Couldn’t reach the clipboard — long-press to copy.',

  // ---- the daily ritual: next tee time ----
  nextDailyIn: (hms) => `Next daily hole in ${hms} · same hole, everyone on Earth.`,
  quickFive: 'Quick 5',

  // ---- first-reveal explainer (shown once, at the moment SG first appears) ----
  sgExplainer:
    'That chip is your bill. SG (strokes gained) is what your target cost ' +
    'against the caddie’s best line — SG −0.30 gave up a third of a stroke. ' +
    'E is expected strokes to hole out. Tap ? up top any time for the full key.',
  sgExplainerOk: 'Got it',

  // ---- first-run onboarding (three cards, under fifteen seconds) ----
  onboardingStep: (n, total) => `Step ${n} of ${total}`,
  onboarding: [
    { title: 'Aim the ellipse', body: 'Move the mouse — or drag a finger — and the ellipse follows. That is your shot pattern: the ball can finish anywhere inside it.' },
    { title: 'Read the light', body: 'The beam ahead of your ball is the caddie\u2019s honest read: lit ground costs fewer strokes from there, shadowed ground costs more. It only shows where this swing can reach \u2014 and it goes dark in Pro mode.' },
    { title: 'Commit the shot', body: 'Click the course (or tap Hit it) when you like the shape. The ball flies to one spot from your pattern — then the caddie shows the line they would have picked.' },
    { title: 'Keep score', body: 'After the shot, the map grades every aim — green smart, red costly — and your target is scored against the caddie’s best line, up to 1,000 points a hole.' },
  ],
  onboardingNext: 'Next',
  onboardingPlay: "Let's play",
  onboardingSkip: 'Skip',
};
