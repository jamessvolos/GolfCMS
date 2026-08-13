// The certified-seed table.
//
// Release D built an instrument and measured an uncomfortable number: only
// about a third of generated par 4s and 5s contain a decision. The generator
// cannot fix that at runtime — one `strokesField` is about a second, so a
// reroll loop would hang the browser — so the fork is filtered OFFLINE and
// Caddie deals its two-shotters from the survivors.
//
// What has to hold: the swap preserves the round's length mix, it is a pure
// function of (roundSeed, index) so client and verifier agree, and the seeds
// in the table genuinely certify.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CERTIFIED_PAR4, CERTIFIED_PAR5, certifiedPool } from '../src/engine/certified.js';
import { caddieHoleSeed, caddieHoleShape, caddieHoleCourse } from '../src/engine/caddierec.js';
import { certifyHole } from '../src/engine/certify.js';
import { handicapById } from '../src/engine/dispersion.js';
import { HOLE_LENGTHS } from '../src/engine/yards.js';
import { substream } from '../src/engine/rng.js';

const POPULATED = CERTIFIED_PAR4.length > 0 && CERTIFIED_PAR5.length > 0;

test('the pools are keyed by par, and par 3 has none', () => {
  assert.equal(certifiedPool(4), CERTIFIED_PAR4);
  assert.equal(certifiedPool(5), CERTIFIED_PAR5);
  // Not an oversight. A par 3 is not certifiable at this board resolution —
  // a real pin sits about a fifth of a tile from the green's edge — so
  // one-shotters keep coming from the raw seed stream.
  assert.equal(certifiedPool(3), null);
  assert.equal(certifiedPool(6), null);
});

test('hole selection is a pure function of (roundSeed, index)', () => {
  // The verifier re-derives every hole from the round seed. If this were not
  // pure, a legitimate round would fail verification.
  for (const roundSeed of [1, 7919, 0xdeadbeef, 0xffffffff]) {
    for (let i = 0; i < 6; i++) {
      assert.equal(caddieHoleSeed(roundSeed, i), caddieHoleSeed(roundSeed, i));
    }
  }
});

test('every dealt seed is a valid uint32', () => {
  for (let r = 0; r < 40; r++) {
    for (let i = 0; i < 5; i++) {
      const s = caddieHoleSeed((r * 2654435761) >>> 0, i);
      assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff, `bad seed ${s}`);
    }
  }
});

test('THE SWAP PRESERVES PAR: a par 4 slot never becomes a par 5', () => {
  // Length mix belongs to the round, not to whichever pars happened to certify
  // more often. A round that quietly stopped dealing par 5s would be a worse
  // round, and it is exactly the failure a naive "just use the pool" would give.
  for (let r = 0; r < 60; r++) {
    const roundSeed = (r * 2654435761 + 17) >>> 0;
    for (let i = 0; i < 5; i++) {
      const rng = rawSeed(roundSeed, i);
      const dealt = caddieHoleSeed(roundSeed, i);
      assert.equal(caddieHoleShape(dealt).par, caddieHoleShape(rng).par,
        `round ${roundSeed} hole ${i}: par changed under the swap`);
    }
  }
});

/**
 * The raw draw, before any certified swap.
 *
 * Built on the real `substream` rather than a hand-rolled copy of it. The first
 * version of this helper reimplemented the hash and the PRNG from memory, got
 * both subtly wrong, and failed against an EMPTY pool — where the swap is a
 * no-op and the two seeds are the same number by construction. A duplicate that
 * disagrees with the thing it duplicates tests nothing.
 *
 * What is still deliberately duplicated is the SEQUENCE — the substream name
 * and the draw-per-index loop — because that is the part a careless edit to
 * caddierec.js could change without any other test noticing.
 */
function rawSeed(roundSeed, index) {
  const rng = substream(roundSeed >>> 0, 'caddieround');
  let s = 0;
  for (let k = 0; k <= index; k++) s = Math.floor(rng() * 0xffffffff) >>> 0;
  return s;
}

test('the par mix still matches HOLE_LENGTHS after the swap', () => {
  const weights = Object.fromEntries(HOLE_LENGTHS.map((b) => [b.par, b.weight]));
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const counts = { 3: 0, 4: 0, 5: 0 };
  const N = 400;
  for (let r = 0; r < N; r++) {
    const s = caddieHoleSeed((r * 2654435761 + 99) >>> 0, r % 7);
    counts[caddieHoleShape(s).par]++;
  }
  for (const par of [3, 4, 5]) {
    const want = weights[par] / total;
    const got = counts[par] / N;
    assert.ok(Math.abs(got - want) < 0.09,
      `par ${par} came out ${(got * 100).toFixed(0)}%, expected ~${(want * 100).toFixed(0)}%`);
  }
});

test('an empty pool is a clean no-op, not a crash', () => {
  // The placeholder table ships this way while a sweep is running, and a
  // half-built table must never take the game down.
  assert.equal(certifiedPool(3), null);
  const s = caddieHoleSeed(4242, 0);
  assert.ok(Number.isInteger(s));
});

// --- the expensive ones, only once there is a table to check -----------------

test('the table is filed under the right par', { skip: !POPULATED }, () => {
  for (const [par, pool] of [[4, CERTIFIED_PAR4], [5, CERTIFIED_PAR5]]) {
    const step = Math.max(1, Math.floor(pool.length / 60));
    for (let i = 0; i < pool.length; i += step) {
      assert.equal(caddieHoleShape(pool[i]).par, par,
        `seed ${pool[i]} is filed as par ${par} but derives par ${caddieHoleShape(pool[i]).par}`);
    }
  }
});

test('the table holds no duplicates and is sorted', { skip: !POPULATED }, () => {
  for (const pool of [CERTIFIED_PAR4, CERTIFIED_PAR5]) {
    for (let i = 1; i < pool.length; i++) {
      assert.ok(pool[i] > pool[i - 1], `table not strictly ascending at ${i}`);
    }
  }
});

test('seeds in the table really do certify', { skip: !POPULATED }, () => {
  // The claim the whole table rests on, spot-checked — certifying every entry
  // would take hours, which is the reason the table exists at all.
  const P = handicapById('scratch');
  for (const pool of [CERTIFIED_PAR4, CERTIFIED_PAR5]) {
    for (const i of [0, Math.floor(pool.length / 2)]) {
      const course = caddieHoleCourse(pool[i]);
      const cert = certifyHole(course, { skipDivergence: true, sweeps: 5, profile: P });
      assert.ok(cert.pass, `seed ${pool[i]} is in the table but does not certify: ${cert.reasons.join('; ')}`);
    }
  }
});

test('a dealt two-shotter comes from the pool', { skip: !POPULATED }, () => {
  const p4 = new Set(CERTIFIED_PAR4);
  const p5 = new Set(CERTIFIED_PAR5);
  let checked = 0;
  for (let r = 0; r < 80; r++) {
    for (let i = 0; i < 4; i++) {
      const s = caddieHoleSeed((r * 2654435761 + 5) >>> 0, i);
      const par = caddieHoleShape(s).par;
      if (par === 3) continue;
      assert.ok(par === 4 ? p4.has(s) : p5.has(s),
        `dealt par ${par} seed ${s} is not in the certified pool`);
      checked++;
    }
  }
  assert.ok(checked > 100, `only ${checked} two-shotters dealt`);
});
