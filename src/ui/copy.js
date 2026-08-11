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
  firstAim: (yds) =>
    `${yds} yds to the pin. Move to aim — the ellipse is everywhere this shot can finish. Click the course (or tap Hit it) to play it.`,
  nextShot: (shot, yds) => `${yds} yds in. Shot ${shot} — pick your target from this lie.`,
  // `plays` is the elevation-adjusted number when the land moves it: the
  // caddie's own "165 yds — plays 178".
  aimReadout: ({ carry, club, leaves, atFlag, plays }) =>
    `${carry}-yd carry` + (plays ? ` — plays ${plays}` : '') + `, ${club}`
    + (atFlag ? ' — going at the flag.' : ` · leaves ${leaves} yds.`),
  patternLine: ({ w, l, pct, medianLeave }) => {
    const parts = [];
    if (pct.green) parts.push(`<span class="fw">${pct.green}% green</span>`);
    if (pct.fairway) parts.push(`<span class="fw">${pct.fairway}% fairway</span>`);
    if (pct.rough) parts.push(`${pct.rough}% rough`);
    if (pct.sand) parts.push(`${pct.sand}% sand`);
    if (pct.trees) parts.push(`${pct.trees}% trees`);
    if (pct.wet) parts.push(`<span class="wet">${pct.wet}% water/OB</span>`);
    return `Lands inside ${w} × ${l} yds · ${parts.join(' · ')}` +
      (medianLeave !== null ? ` · median leave ${medianLeave} yds` : '');
  },
  proPattern: 'Pro mode — no odds, no dots. Your read against the reveal. 🧠',

  // ---- putting ----
  // Same voice on the green: say the footage, then the pace, then nothing.
  puttFirst: (ft) => `On the dance floor — a ${ft}-footer. Aim your pace; the ball rolls the line you set.`,
  puttNext: (n, ft) => `Putt ${n}: a ${ft}-footer left. Pick your pace.`,
  /** Pace call for `ft` feet past (+) or short (−) of the cup. */
  paceCall: (ft) => {
    const inches = Math.round(ft * 12);
    if (Math.abs(inches) < 3) return 'dead weight at the cup';
    const mag = Math.abs(ft) < 2 ? `${Math.abs(inches)} inches` : `${Math.round(Math.abs(ft))} feet`;
    return ft > 0 ? `${mag} of pace past the cup` : `${mag} short of the cup`;
  },
  puttAim: ({ ft, pace, make }) => `${ft}-footer, playing ${pace} — ${make}% to drop.`,
  /** Break call when slope bends the current line. `cups` is break in cup-widths. */
  puttBreakNote: (side, cups) =>
    cups < 1
      ? ` Breaks ${side} edge — hold your line.`
      : ` Breaks ${side} — play ${cups === 1 ? 'a cup' : `${cups} cups`} out.`,
  puttPatternLine: ({ make, three, leave }) =>
    `<span class="fw">${make}% make</span> · ${three}% three-putt risk` +
    (leave !== null ? ` · a miss leaves ${leave} ft` : ''),
  puttVerdictCall: (sg) =>
    sg < 0.02 ? 'Caddie-approved — perfect pace.'
    : sg < 0.08 ? 'Good read — a hair off the best pace.'
    : sg < 0.2 ? 'Playable, but the pace gave a little away.'
    : 'Costly — that pace burns putts.',
  puttVerdictLine: ({ call, pace, points, result }) =>
    `${call} The caddie's read: ${pace} · +${points} pts · ${result}`,
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
  // Reveal line: name what the map means, then the caddie's line, then stop.
  // The E-vs-E detail lives on the stamp chip — never say it twice.
  verdictLine: ({ call, optCarry, sg, points, ballNow }) =>
    `${call} The map grades every aim — green smart, red costly. The ring: ` +
    `the caddie's ${optCarry}-yd line · +${points} pts · ${ballNow}`,
  riskLedger: (yours, caddies) =>
    `Risk: your line ran <span class="wet">${yours}%</span> trouble (water/sand/trees) · ` +
    `the caddie's held <span class="fw">${caddies}%</span>.`,
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
  share: ({ label, total, max, squares }) => `${label} — ${total}/${max} ${squares}`,

  // ---- first-run onboarding (three cards, under fifteen seconds) ----
  onboardingStep: (n, total) => `Step ${n} of ${total}`,
  onboarding: [
    { title: 'Aim the ellipse', body: 'Move the mouse — or drag a finger — and the ellipse follows. That is your shot pattern: the ball can finish anywhere inside it.' },
    { title: 'Commit the shot', body: 'Click the course (or tap Hit it) when you like the shape. The ball flies to one spot from your pattern — then the caddie shows the line they would have picked.' },
    { title: 'Keep score', body: 'Every target is scored against the caddie’s best line — up to 1,000 points a hole. Closer call, bigger score.' },
  ],
  onboardingNext: 'Next',
  onboardingPlay: "Let's play",
  onboardingSkip: 'Skip',
};
