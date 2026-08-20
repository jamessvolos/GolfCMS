import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  puttSigmas, puttPoints, puttHolesOut, samplePuttRoll, puttSkill,
  CUP_R, PUTT_MAX, PUTT_OVERRUN, HANDICAPS, captureAt,
} from '../src/engine/dispersion.js';
import {
  strokesField, evaluatePutt, bestPutt, scorePuttDecision, puttsFrom,
  puttStats, puttHeatmap, onPuttingSurface,
} from '../src/engine/strategy.js';
import { makeCourse, setCell, cellAt } from '../src/engine/course.js';
import { FAIRWAY, GREEN, WATER } from '../src/engine/terrain.js';
import { feet, YARDS_PER_TILE } from '../src/engine/yards.js';

const FT = YARDS_PER_TILE * 3; // 48 ft per tile

/** A big flat green around the cup, fairway everywhere else. */
function greenCourse() {
  const c = makeCourse(11, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.tee = { x: 2, y: 12 };
  c.hole = { x: 20, y: 12 };
  for (let y = 2; y <= 22; y++) for (let x = 6; x <= 34; x++) setCell(c, x, y, GREEN);
  return c;
}

function fromAt(c, ft) {
  return { x: c.hole.x - ft / FT, y: c.hole.y };
}

test('puttSigmas invert the full-swing shape: pace error dominates line error', () => {
  for (const d of [0.1, 0.5, 1, 3, 8, 15]) {
    const s = puttSigmas(d);
    assert.ok(s.long > s.lat, `pace > line at d=${d}: ${s.long} vs ${s.lat}`);
    assert.ok(s.long > 0 && s.lat > 0);
  }
  // sigmas grow with distance
  assert.ok(puttSigmas(5).long > puttSigmas(1).long);
  assert.ok(puttSigmas(5).lat > puttSigmas(1).lat);
  // sqrt(base) scaling: a 20-capper putts worse than a tour pro, but not
  // 1.7/0.78 = 2.2x worse — bad ballstrikers aren't equally bad putters
  const tour = HANDICAPS.find((h) => h.id === 'tour');
  const twenty = HANDICAPS.find((h) => h.id === 'twenty');
  const ratio = puttSigmas(2, twenty).long / puttSigmas(2, tour).long;
  assert.ok(ratio > 1, 'higher handicap = looser pace');
  assert.ok(ratio < twenty.base / tour.base, 'putting gap is compressed vs full swings');
  assert.ok(Math.abs(puttSkill(twenty) - Math.sqrt(1.7)) < 1e-9);
});

test('holing model: line, reach, and the lip-out overrun gradient', () => {
  const cup = { x: 10, y: 10 };
  const from = { x: 8, y: 10 }; // a 2-tile (96 ft) putt
  const cap = captureAt(2); // effective capture, inverted from the make curve
  assert.ok(cap > 0 && cap < CUP_R, 'capture is inches, not the drawn cup');
  // dead center, arriving at the front door: drops
  assert.ok(puttHolesOut(from, { x: 10, y: 10 }, cup));
  // a foot and a half of pace on a true line: still drops
  assert.ok(puttHolesOut(from, { x: 10 + PUTT_OVERRUN * 0.5, y: 10 }, cup));
  // dies short: stays out
  assert.ok(!puttHolesOut(from, { x: 9.7, y: 10 }, cup));
  // online but running past the 3-ft overrun cap: never drops
  assert.ok(!puttHolesOut(from, { x: 10 + PUTT_OVERRUN * 1.5, y: 10 }, cup));
  assert.ok(!puttHolesOut(from, { x: 13, y: 10 }, cup));
  // wide of the cup: stays out
  assert.ok(!puttHolesOut(from, { x: 10, y: 10 + cap * 1.5 }, cup));
  // capture shrinks with speed: a borderline line miss drops at dead pace...
  assert.ok(puttHolesOut(from, { x: 10, y: 10 + cap * 0.8 }, cup));
  // ...but the same line lips out when it would run three feet by
  assert.ok(!puttHolesOut(from, { x: 10 + PUTT_OVERRUN * 0.9, y: 10 + cap * 0.8 }, cup));
});

test('evaluatePutt is monotone: longer putts cost more expected putts', () => {
  const c = greenCourse();
  const V = strokesField(c);
  let prev = 0;
  // PUTT_MAX is now 2.5 tiles (120 ft) — the longest putt anyone actually has
  for (const ft of [3, 12, 30, 60, 90, 115]) {
    const e = evaluatePutt(c, V, fromAt(c, ft), { x: c.hole.x, y: c.hole.y });
    assert.ok(Number.isFinite(e), `finite at ${ft}ft`);
    assert.ok(e > prev, `E grows with distance: ${ft}ft gave ${e}, prev ${prev}`);
    prev = e;
  }
  // and the optimal decision, too (non-strict at gimme range)
  const best = (ft) => bestPutt(c, V, fromAt(c, ft)).value;
  assert.ok(best(3) <= best(30));
  assert.ok(best(30) < best(60));
  assert.ok(best(60) < best(115));
});

test('make-rate sanity: 3-footers are near-automatic, 60-footers are not', () => {
  const c = greenCourse();
  const V = strokesField(c);
  const three = bestPutt(c, V, fromAt(c, 3));
  assert.ok(three.value < 1.15, `3-footer expected putts ${three.value} < 1.15`);
  assert.ok(puttStats(c, fromAt(c, 3), three.target).makePct >= 90,
    'a well-played 3-footer drops >90% of the time');
  const sixty = bestPutt(c, V, fromAt(c, 60));
  // Broadie: ~2.21 expected putts from 60 ft, and a 2% one-putt rate
  assert.ok(sixty.value > 2.0 && sixty.value < 2.3, `60-footer expected putts ${sixty.value}`);
  assert.ok(puttStats(c, fromAt(c, 60), sixty.target).makePct <= 6,
    'a 60-footer is a lag, not a chance');
  // puttsFrom (the leave recursion) stays in [1, 3] and grows with distance
  assert.ok(puttsFrom(0.05) >= 1 && puttsFrom(0.05) < 1.05);
  assert.ok(puttsFrom(3) > puttsFrom(1));
  assert.ok(puttsFrom(PUTT_MAX) <= 3);
});

test('optimal pace is a golfer\'s pace: to the hole, never racing', () => {
  const c = greenCourse();
  const V = strokesField(c);
  // Inside the make range the caddie plays PAST the cup — a putt that dies
  // at the front door cannot drop.
  for (const ft of [3, 5, 6, 8]) {
    const b = bestPutt(c, V, fromAt(c, ft));
    assert.ok(b.past * FT > 0.4, `${ft}ft: plays it past the hole (past=${b.past * FT} ft)`);
  }
  // Across the whole range pace stays inside a foot short to two feet past —
  // the old model's optimum was 16-31 ft past, which is why it holed everything.
  for (const ft of [3, 12, 30, 60, 90]) {
    const b = bestPutt(c, V, fromAt(c, ft));
    assert.ok(b.past * FT >= -1.0, `${ft}ft: never leaves it short (past=${b.past * FT} ft)`);
    assert.ok(b.past * FT <= 2.0, `${ft}ft: never races it (past=${b.past * FT} ft)`);
    // the target lies on the line through the cup
    assert.ok(Math.abs(b.target.y - c.hole.y) < 1e-9);
  }
});

test('scorePuttDecision mirrors scoreDecision: optimal ≈ 1000, bad pace loses points', () => {
  const c = greenCourse();
  const V = strokesField(c);
  const from = fromAt(c, 40);
  const best = bestPutt(c, V, from);
  const perfect = scorePuttDecision(c, V, from, best.target);
  assert.ok(perfect.sgLost < 1e-9);
  assert.equal(perfect.points, 1000);
  // lag it 10 feet short on purpose
  const timid = scorePuttDecision(c, V, from, { x: from.x + (40 - 10) / FT, y: from.y });
  assert.ok(timid.sgLost > 0.02, `short lag costs putts, got ${timid.sgLost}`);
  assert.ok(timid.points < perfect.points);
  assert.ok(perfect.optimalE <= timid.yourE);
});

test('putt reach: green plus ~2 tiles of fringe, capped at PUTT_MAX', () => {
  const c = greenCourse();
  const V = strokesField(c);
  const from = { x: 8, y: 12 };
  assert.ok(onPuttingSurface(c, 20, 12), 'green is puttable');
  assert.ok(onPuttingSurface(c, 4.5, 12), 'fringe within 2 tiles of green is puttable');
  assert.ok(!onPuttingSurface(c, 1, 12), 'deep fairway is not');
  assert.equal(evaluatePutt(c, V, from, { x: 1, y: 12 }), Infinity, 'off-surface aim is priced out');
  assert.equal(evaluatePutt(c, V, { x: 6, y: 12 }, { x: 6 + PUTT_MAX + 2, y: 12 }), Infinity, 'beyond the cap');
  // heatmap covers only the putting surface and is finite
  const heat = puttHeatmap(c, V, from);
  assert.ok(heat.length > 10);
  for (const cell of heat) {
    assert.ok(Number.isFinite(cell.e) && cell.e >= 1);
    assert.ok(onPuttingSurface(c, cell.x, cell.y));
  }
});

test('putts that roll off the green are priced by the field, ponds by penalty', () => {
  const c = greenCourse();
  // shrink the green so an overrun can leave it: green only x 18..20, cup at 19
  for (let y = 2; y <= 22; y++) for (let x = 6; x <= 34; x++) setCell(c, x, y, FAIRWAY);
  for (let y = 8; y <= 16; y++) for (let x = 18; x <= 20; x++) setCell(c, x, y, GREEN);
  c.hole = { x: 19, y: 12 };
  const V = strokesField(c);
  const from = { x: 18.1, y: 12 };
  // racing a 43-ft putt 70 ft past risks leaving the surface entirely;
  // it must cost more than the caddie's measured pace
  const calm = bestPutt(c, V, from).value;
  const raced = evaluatePutt(c, V, from, { x: 20.5, y: 12 });
  assert.ok(Number.isFinite(raced) && raced > calm, `raced ${raced} > calm ${calm}`);
  // water behind the green makes racing strictly worse still
  for (let y = 8; y <= 16; y++) for (let x = 21; x <= 23; x++) setCell(c, x, y, WATER);
  const V2 = strokesField(c);
  const racedWet = evaluatePutt(c, V2, from, { x: 20.5, y: 12 });
  assert.ok(racedWet > raced - 0.5, 'pond behind keeps racing expensive');
  assert.ok(cellAt(c, 21, 12) === WATER);
});

test('determinism: expectation math and the seeded roll reproduce exactly', () => {
  const c = greenCourse();
  const V = strokesField(c);
  const from = fromAt(c, 45);
  const target = { x: c.hole.x + 0.2, y: c.hole.y };
  assert.equal(
    evaluatePutt(c, V, from, target),
    evaluatePutt(c, V, from, target)
  );
  const a = samplePuttRoll(c, from, target, 3);
  const b = samplePuttRoll(c, from, target, 3);
  assert.deepEqual(a, b);
  const other = samplePuttRoll(c, from, target, 4);
  assert.ok(other.x !== a.x || other.y !== a.y, 'different stroke index, different roll');
  // the sample space is the same pattern the expectation math prices
  const pts = puttPoints(from, target);
  assert.equal(pts.length, 16);
  const spreadAlong = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const spreadAcross = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
  assert.ok(spreadAlong > spreadAcross, 'putt patterns are long, not wide');
});

test('feet: the green reads in feet, 1 tile = 48 ft', () => {
  assert.equal(feet(1), 48);
  assert.equal(feet(0.75), 36);
  assert.equal(feet(0.0625), 3);
  assert.equal(feet(1.25), 60);
});
