// Caddie scoreboard v2: the round record codec, the server-side replay
// verifier, and the /caddie-scores endpoints. The invariant under test:
// points exist ONLY as an output of replaying recorded targets — nothing a
// client claims about its own score is ever read, so a forged total is
// unrepresentable, not merely rejected.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  caddieHoleSeed, caddieHoleCourse, encodeCaddieRound, decodeCaddieRound, verifyCaddieRound,
} from '../src/engine/caddierec.js';
import {
  handicapById, lieParamsAt, reach, sampleLanding, samplePuttRoll, puttHolesOut, restingCell,
} from '../src/engine/dispersion.js';
import { strokesField, scoreDecision, scorePuttDecision, bestPutt } from '../src/engine/strategy.js';
import { cellAt } from '../src/engine/course.js';
import { GREEN } from '../src/engine/terrain.js';
import { createServer } from '../server/leaderboard.js';

const profile = handicapById('scratch');
const ROUND_SEED = 424242;
const COUNT = 2;

/** A modest aim toward the hole, integer like the UI commits. `back` tiles of
 *  timidity turn a decent player into a sloppy one. */
function towardHole(course, ball, back = 0) {
  const lie = lieParamsAt(course, ball.x, ball.y);
  const r = Math.max(1, reach(lie, profile) - 1 - back);
  const dx = course.hole.x - ball.x;
  const dy = course.hole.y - ball.y;
  const d = Math.hypot(dx, dy) || 0.001;
  const f = Math.min(1, r / d);
  return { x: Math.round(ball.x + dx * f), y: Math.round(ball.y + dy * f) };
}

/**
 * Play a round with the live engine, mirroring the caddie.js commit/advance
 * loop, recording every target — an honest client. Returns the record plus
 * the points the client itself computed along the way, so the verifier's
 * recomputation has an independent total to match.
 */
function playRound(roundSeed, count, { sloppy = false } = {}) {
  const holes = [];
  const holeSummaries = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const holeSeed = caddieHoleSeed(roundSeed, i);
    const course = caddieHoleCourse(holeSeed);
    const V = strokesField(course, 6, profile);
    const rec = { holeSeed, decisions: [], puttDecisions: [] };
    let ball = { ...course.tee };
    let puttPos = null;
    let strokes = 0;
    let putting = false;
    let puttCount = 0;
    let holedOut = false;
    const scores = [];
    for (let guard = 0; guard < 64; guard++) {
      if (holedOut) break;
      if (putting && puttCount >= 4) { strokes += 1; holedOut = true; break; }
      if (cellAt(course, ball.x, ball.y) === GREEN) {
        putting = true;
        puttPos = puttPos ?? { x: ball.x, y: ball.y };
      } else if (putting) {
        putting = false;
        puttPos = null;
      }
      if (!putting && scores.filter((s) => !s.putt).length >= 8) break;
      if (putting) {
        const from = { x: puttPos.x, y: puttPos.y };
        const target = sloppy
          ? { x: from.x + (course.hole.x - from.x) * 0.5, y: from.y + (course.hole.y - from.y) * 0.5 }
          : bestPutt(course, V, from, profile).target;
        rec.puttDecisions.push({ x: target.x, y: target.y });
        const score = scorePuttDecision(course, V, from, target, profile);
        score.putt = true;
        const roll = samplePuttRoll(course, from, target, strokes, profile);
        const holed = puttHolesOut(from, roll, course.hole);
        strokes += 1;
        puttCount += 1;
        scores.push(score);
        if (holed) {
          holedOut = true;
          ball = { ...course.hole };
          puttPos = { ...course.hole };
        } else {
          const rest = restingCell(course, roll.x, roll.y);
          if (rest.kind === 'rest') {
            puttPos = { x: roll.x, y: roll.y };
            ball = { x: rest.x, y: rest.y };
          } else {
            strokes += 1;
          }
        }
      } else {
        const from = { ...ball };
        const target = towardHole(course, from, sloppy ? 5 : 0);
        rec.decisions.push({ x: target.x, y: target.y });
        const lie = lieParamsAt(course, from.x, from.y);
        const score = scoreDecision(course, V, from, target, profile);
        const land = sampleLanding(course, from, target, lie.sigmaScale, strokes, profile);
        const rest = restingCell(course, land.x, land.y);
        strokes += 1;
        scores.push(score);
        if (rest.kind === 'rest') ball = { x: rest.x, y: rest.y };
        else strokes += 1;
      }
    }
    const points = Math.round(scores.reduce((s, x) => s + x.points, 0) / Math.max(1, scores.length));
    total += points;
    holes.push(rec);
    holeSummaries.push({ points, strokes, holed: holedOut });
  }
  return { record: { roundSeed, count, hcp: 'scratch', holes }, total, holeSummaries };
}

// Played once, shared by every test below (playing + verifying is the
// expensive part; the assertions are cheap).
const good = playRound(ROUND_SEED, COUNT);
const sloppy = playRound(ROUND_SEED, COUNT, { sloppy: true });

// base64url helpers for tampering with encoded records in tests
const b64uToJSON = (s) => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
const jsonToB64u = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('hole derivation helpers are deterministic and index-sensitive', () => {
  assert.equal(caddieHoleSeed(ROUND_SEED, 0), caddieHoleSeed(ROUND_SEED, 0));
  assert.notEqual(caddieHoleSeed(ROUND_SEED, 0), caddieHoleSeed(ROUND_SEED, 1));
  const a = caddieHoleCourse(caddieHoleSeed(ROUND_SEED, 1));
  const b = caddieHoleCourse(caddieHoleSeed(ROUND_SEED, 1));
  assert.deepEqual(a.cells, b.cells);
  assert.deepEqual(a.hole, b.hole);
  assert.equal(a.biome, b.biome);
});

test('codec round-trips deterministically and strips everything but the decisions', () => {
  const enc = encodeCaddieRound(good.record);
  assert.equal(enc, encodeCaddieRound(good.record), 'encoding is deterministic');
  assert.match(enc, /^[A-Za-z0-9_-]+$/, 'base64url alphabet only');
  assert.deepEqual(decodeCaddieRound(enc), good.record, 'round-trip is exact');
  // client-claimed points are not even representable: unknown fields are shed
  const junk = JSON.parse(JSON.stringify(good.record));
  junk.totalPoints = 999999;
  junk.holes[0].points = 5000;
  junk.holes[0].decisions[0].points = 1000;
  const decoded = decodeCaddieRound(encodeCaddieRound(junk));
  assert.deepEqual(decoded, good.record);
  assert.equal(decoded.totalPoints, undefined);
  assert.equal(decoded.holes[0].points, undefined);
  assert.equal(decoded.holes[0].decisions[0].points, undefined);
  // malformed records refuse to encode or decode
  assert.throws(() => encodeCaddieRound({ ...good.record, hcp: 'custom' }), /handicap/);
  assert.throws(() => encodeCaddieRound({ ...good.record, count: 0 }), /count/);
  assert.throws(() => encodeCaddieRound({ ...good.record, holes: good.record.holes.slice(1) }), /length/);
  assert.throws(() => encodeCaddieRound({ ...good.record, roundSeed: -1 }), /uint32/);
  const nan = JSON.parse(JSON.stringify(good.record));
  nan.holes[0].decisions[0] = { x: 'NaN', y: 3 };
  assert.throws(() => encodeCaddieRound(nan), /coordinates/);
  assert.throws(() => decodeCaddieRound('%%not-base64url%%'), /decode|base64/i);
});

test('verifyCaddieRound recomputes exactly the points the engine awarded live', () => {
  const result = verifyCaddieRound(encodeCaddieRound(good.record));
  assert.equal(result.totalPoints, good.total);
  assert.deepEqual(result.holes, good.holeSummaries);
  // the sloppier round verifies too, and earns strictly less
  const worse = verifyCaddieRound(sloppy.record);
  assert.equal(worse.totalPoints, sloppy.total);
  assert.ok(worse.totalPoints < result.totalPoints,
    `sloppy targets earn less: ${worse.totalPoints} < ${result.totalPoints}`);
});

test('forged points are impossible: injected claims are ignored, seeds are checked', () => {
  const baseline = verifyCaddieRound(good.record);
  // inject inflated point claims straight into the encoded JSON
  const tampered = b64uToJSON(encodeCaddieRound(good.record));
  tampered.totalPoints = 10000;
  tampered.holes.forEach((h) => { h.points = 1000; });
  tampered.holes[0].decisions.forEach((d) => { d.points = 1000; });
  const result = verifyCaddieRound(jsonToB64u(tampered));
  assert.deepEqual(result, baseline, 'claimed points change nothing — replay is the only source');
  // a cherry-picked hole seed (not derived from the round seed) is rejected
  const forgedSeed = JSON.parse(JSON.stringify(good.record));
  forgedSeed.holes[0].holeSeed = (forgedSeed.holes[0].holeSeed + 1) >>> 0;
  assert.throws(() => verifyCaddieRound(forgedSeed), /holeSeed/);
  // a truncated record cannot finish its holes
  const truncated = JSON.parse(JSON.stringify(good.record));
  const cut = truncated.holes.find((h) => h.puttDecisions.length > 0) ?? truncated.holes[0];
  if (cut.puttDecisions.length > 0) cut.puttDecisions.pop();
  else cut.decisions.pop();
  assert.throws(() => verifyCaddieRound(truncated), /mid-hole/);
});

// --- the /caddie-scores endpoints, against a real server on port 0 ----------

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function submit(body) {
  return fetch(`${base}/caddie-scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('server accepts a verified record and recomputes points itself', async () => {
  const res = await submit({
    name: 'slowpoke',
    record: encodeCaddieRound(sloppy.record),
    points: 999999, // a lie — the server must never read this
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.points, sloppy.total, 'points come from the replay, not the client');
  assert.equal(data.rank, 1);
  assert.equal(data.of, 1);
});

test('server rejects malformed and forged submissions', async () => {
  for (const body of [
    'not json',
    JSON.stringify(null),
    JSON.stringify({}),
    JSON.stringify({ record: 123 }),
    JSON.stringify({ record: '' }),
    JSON.stringify({ record: 'zzzz@@@@' }),
    JSON.stringify({ record: jsonToB64u({ hello: 'world' }) }),
    JSON.stringify({ record: encodeCaddieRound(good.record), name: 42 }),
  ]) {
    const res = await submit(body);
    assert.equal(res.status, 400, `expected 400 for ${String(body).slice(0, 40)}`);
  }
  // structurally valid but unreplayable: forged hole seed → 422
  const forged = b64uToJSON(encodeCaddieRound(good.record));
  forged.holes[0].holeSeed = (forged.holes[0].holeSeed + 7) >>> 0;
  const res = await submit({ record: jsonToB64u(forged) });
  assert.equal(res.status, 422);
  assert.ok((await res.json()).error);
});

test('rank ordering: a better round outranks a worse one, board is sorted', async () => {
  const res = await submit({ name: 'ace', record: encodeCaddieRound(good.record) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.points, good.total);
  assert.equal(data.rank, 1, 'more points ranks first');
  assert.ok(data.of >= 2);

  const list = await fetch(`${base}/caddie-scores/${ROUND_SEED}/${COUNT}/scratch`);
  assert.equal(list.status, 200);
  const { board } = await list.json();
  assert.ok(board.length >= 2);
  for (let i = 0; i < board.length; i++) {
    assert.deepEqual(Object.keys(board[i]).sort(), ['at', 'name', 'points'], 'no record strings leak');
    if (i > 0) assert.ok(board[i].points <= board[i - 1].points, 'sorted by points, descending');
  }
  const aceIdx = board.findIndex((e) => e.name === 'ace');
  const slowIdx = board.findIndex((e) => e.name === 'slowpoke');
  assert.ok(aceIdx >= 0 && slowIdx >= 0 && aceIdx < slowIdx);

  // list validation still bites
  assert.equal((await fetch(`${base}/caddie-scores/${ROUND_SEED}/${COUNT}/wizard`)).status, 400);
  assert.equal((await fetch(`${base}/caddie-scores/-1/${COUNT}/scratch`)).status, 400);
  assert.equal((await fetch(`${base}/caddie-scores/${ROUND_SEED}/99/scratch`)).status, 400);
});
