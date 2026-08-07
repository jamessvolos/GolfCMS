// Player stats: pure functions over a list of finished rounds. The UI owns
// storage; this module owns the arithmetic, so streaks and averages are
// testable without a browser.

/**
 * @typedef {{date: string, seed: number, strokes: number, par: number, daily: boolean}} Round
 */

/** Append a finished round (idempotent per daily date: first result stands). */
export function recordRound(rounds, round) {
  if (round.daily && rounds.some((r) => r.daily && r.date === round.date)) return rounds;
  return [...rounds, round];
}

/** Consecutive daily-play streak ending today (or yesterday, grace for timezones). */
export function dailyStreak(rounds, today) {
  const played = new Set(rounds.filter((r) => r.daily).map((r) => r.date));
  let day = played.has(today) ? today : previousDate(today);
  let streak = 0;
  while (played.has(day)) {
    streak++;
    day = previousDate(day);
  }
  return streak;
}

export function summary(rounds) {
  const s = {
    rounds: rounds.length,
    aces: 0,
    underPar: 0,
    onPar: 0,
    overPar: 0,
    totalVsPar: 0,
  };
  for (const r of rounds) {
    const d = r.strokes - r.par;
    s.totalVsPar += d;
    if (r.strokes === 1) s.aces++;
    if (d < 0) s.underPar++;
    else if (d === 0) s.onPar++;
    else s.overPar++;
  }
  s.avgVsPar = s.rounds ? +(s.totalVsPar / s.rounds).toFixed(2) : 0;
  return s;
}

function previousDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86400000).toISOString().slice(0, 10);
}
