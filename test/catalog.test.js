import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeShareCode, decodeShareCode, makeRecord, setStatus,
  generateBatch, exportCatalog, importCatalog,
} from '../src/engine/catalog.js';
import { DIFFICULTIES, makePuzzle } from '../src/engine/puzzle.js';

test('share codes round-trip across seeds and difficulties', () => {
  for (let i = 0; i < 200; i++) {
    const seed = (i * 2654435761 + 17) >>> 0;
    for (const difficulty of DIFFICULTIES) {
      const code = encodeShareCode(seed, difficulty);
      assert.match(code, /^GLF-[0-9A-Z]{4}-[0-9A-Z]{4}-[ESR]$/);
      assert.deepEqual(decodeShareCode(code), { seed, difficulty, biome: 'classic' });
    }
  }
});

test('share codes are case-insensitive and whitespace-tolerant on redeem', () => {
  const code = encodeShareCode(1837462913, 'rude');
  assert.deepEqual(decodeShareCode('  ' + code.toLowerCase() + ' '), {
    seed: 1837462913,
    difficulty: 'rude',
    biome: 'classic',
  });
});

test('tampered share codes are rejected by the check digit', () => {
  const code = encodeShareCode(424242, 'standard');
  // flip one payload character
  const flipped = code.slice(0, 4) + (code[4] === 'A' ? 'B' : 'A') + code.slice(5);
  assert.throws(() => decodeShareCode(flipped));
  assert.throws(() => decodeShareCode('GLF-NOPE'));
  assert.throws(() => decodeShareCode(''));
});

test('a record redeemed from its code regenerates the identical puzzle', () => {
  const rec = makeRecord(555, 'standard');
  const { seed, difficulty } = decodeShareCode(rec.code);
  const p = makePuzzle(seed, difficulty);
  assert.equal(p.par, rec.par);
  assert.deepEqual(p.start, rec.start);
  assert.equal(p.course.archetype, rec.archetype);
});

test('generateBatch yields the requested number of distinct certified records', () => {
  const batch = generateBatch(1000, 10, 'standard');
  assert.equal(batch.length, 10);
  assert.equal(new Set(batch.map((r) => r.seed)).size, 10);
  for (const r of batch) {
    assert.equal(r.status, 'generated');
    assert.ok(r.par >= 2 && r.par <= 7);
  }
});

test('curation state machine accepts known statuses only', () => {
  const rec = makeRecord(77, 'easy');
  assert.equal(setStatus(rec, 'approved').status, 'approved');
  assert.equal(setStatus(rec, 'rejected').status, 'rejected');
  assert.throws(() => setStatus(rec, 'published'));
  assert.equal(rec.status, 'generated', 'setStatus is pure');
});

test('catalog export/import round-trips and validates integrity', () => {
  const batch = generateBatch(9000, 5, 'rude').map((r) => setStatus(r, 'approved'));
  const json = exportCatalog(batch);
  assert.deepEqual(importCatalog(json), batch);
  assert.throws(() => importCatalog('{"format":"other"}'));
  const bad = JSON.parse(json);
  bad.records[0].status = 'meh';
  assert.throws(() => importCatalog(JSON.stringify(bad)));
});
