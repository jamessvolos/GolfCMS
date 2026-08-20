import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, substream, randInt, pickWeighted } from '../src/engine/rng.js';

test('same seed produces identical sequences', () => {
  const a = mulberry32(1837462913);
  const b = mulberry32(1837462913);
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test('different seeds diverge', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const seqA = Array.from({ length: 10 }, a);
  const seqB = Array.from({ length: 10 }, b);
  assert.notDeepEqual(seqA, seqB);
});

test('values stay in [0, 1)', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 10000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1);
  }
});

test('named substreams are independent and stable', () => {
  const t1 = substream(99, 'terrain');
  const t2 = substream(99, 'terrain');
  const h = substream(99, 'hazards');
  assert.equal(t1(), t2());
  assert.notEqual(substream(99, 'terrain')(), h());
});

test('randInt covers the full inclusive range', () => {
  const rng = mulberry32(7);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const v = randInt(rng, 1, 3);
    assert.ok(v >= 1 && v <= 3);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('pickWeighted respects zero-ish weights over many draws', () => {
  const rng = mulberry32(5);
  let heavy = 0;
  for (let i = 0; i < 1000; i++) {
    if (pickWeighted(rng, [['heavy', 99], ['light', 1]]) === 'heavy') heavy++;
  }
  assert.ok(heavy > 900);
});
