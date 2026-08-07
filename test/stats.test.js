import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordRound, dailyStreak, summary } from '../src/engine/stats.js';

const round = (date, strokes, par, daily = true) => ({ date, seed: 1, strokes, par, daily });

test('recordRound keeps the first daily result per date', () => {
  let rounds = recordRound([], round('2026-08-07', 3, 3));
  rounds = recordRound(rounds, round('2026-08-07', 1, 3));
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].strokes, 3);
  rounds = recordRound(rounds, { ...round('2026-08-07', 4, 3), daily: false });
  assert.equal(rounds.length, 2, 'free-play rounds always append');
});

test('daily streak counts consecutive days and tolerates not-yet-played today', () => {
  const rounds = [round('2026-08-05', 3, 3), round('2026-08-06', 4, 3), round('2026-08-07', 2, 3)];
  assert.equal(dailyStreak(rounds, '2026-08-07'), 3);
  assert.equal(dailyStreak(rounds, '2026-08-08'), 3, 'grace: yesterday finished, today pending');
  assert.equal(dailyStreak(rounds, '2026-08-09'), 0, 'a missed day breaks it');
  assert.equal(dailyStreak([], '2026-08-07'), 0);
});

test('streak ignores gaps behind a missed day', () => {
  const rounds = [round('2026-08-01', 3, 3), round('2026-08-03', 3, 3), round('2026-08-04', 3, 3)];
  assert.equal(dailyStreak(rounds, '2026-08-04'), 2);
});

test('summary aggregates aces, par splits, and average vs par', () => {
  const s = summary([
    round('2026-08-05', 1, 3), // ace, under
    round('2026-08-06', 3, 3), // on
    round('2026-08-07', 5, 3), // over
    { ...round('2026-08-07', 2, 3), daily: false }, // under
  ]);
  assert.equal(s.rounds, 4);
  assert.equal(s.aces, 1);
  assert.equal(s.underPar, 2);
  assert.equal(s.onPar, 1);
  assert.equal(s.overPar, 1);
  assert.equal(s.avgVsPar, -0.25);
});
