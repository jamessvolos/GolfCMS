// The share line and the coach's phase ledger are pure string builders —
// pin their shape here so a copy edit can't silently break what travels
// into group chats or the round overlay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copy } from '../src/ui/copy.js';

test('share carries label, score, squares — and the link when given one', () => {
  const base = { label: 'Caddie Daily #8', total: 4210, max: 5000, squares: '🟩🟨🟥🟩🟩' };
  assert.equal(copy.share(base), 'Caddie Daily #8 — 4210/5000 🟩🟨🟥🟩🟩');
  assert.equal(
    copy.share({ ...base, url: 'https://example.test/GolfCMS/' }),
    'Caddie Daily #8 — 4210/5000 🟩🟨🟥🟩🟩\nhttps://example.test/GolfCMS/'
  );
});

test('shareSquares grades holes spoiler-free', () => {
  assert.equal(
    copy.shareSquares([{ points: 1000 }, { points: 950 }, { points: 600 }]),
    '🟩🟨🟥'
  );
});

test('coachPhases lists only the phases that cost strokes, worst first', () => {
  assert.equal(
    copy.coachPhases({ tee: 0.12, approach: 0.61, putt: 0 }),
    'Your round in SG: approaches −0.61 · off the tee −0.12.'
  );
  assert.equal(copy.coachPhases({ tee: 0, approach: 0, putt: 0 }), '');
});

test('phaseTip has a line for every phase and fails closed', () => {
  for (const cat of ['tee', 'approach', 'putt']) assert.ok(copy.phaseTip(cat).length > 10);
  assert.equal(copy.phaseTip('nonsense'), '');
});

test('nextDailyIn embeds the clock it is handed', () => {
  assert.match(copy.nextDailyIn('07:41:12'), /07:41:12/);
});
