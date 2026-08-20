import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeReplay, decodeReplay, ghostPath, quantizeAngle } from '../src/engine/replay.js';
import { makePuzzle } from '../src/engine/puzzle.js';

test('replay codec round-trips clubs and powers exactly, angles to 1e-4', () => {
  const shots = [
    { club: 'driver', angle: 0.5, power: 3 },
    { club: 'iron', angle: -1.2, power: 1 },
    { club: 'wedge', angle: 3.9, power: 2 },
    { club: 'putter', angle: 6.2, power: 2 },
  ];
  const decoded = decodeReplay(encodeReplay(shots));
  assert.equal(decoded.length, 4);
  for (let i = 0; i < shots.length; i++) {
    assert.equal(decoded[i].club, shots[i].club);
    assert.equal(decoded[i].power, shots[i].power);
    const tau = Math.PI * 2;
    const norm = ((shots[i].angle % tau) + tau) % tau;
    assert.ok(Math.abs(decoded[i].angle - norm) < 1e-4, `angle ${i} within tolerance`);
  }
});

test('encoded replays are compact: 6 hex chars per shot', () => {
  const shots = Array.from({ length: 7 }, (_, i) => ({ club: 'iron', angle: i, power: 2 }));
  assert.equal(encodeReplay(shots).length, 42);
});

test('malformed replay strings are rejected', () => {
  assert.throws(() => decodeReplay('xyz'));
  assert.throws(() => decodeReplay('abcde')); // not a multiple of 6
  assert.deepEqual(decodeReplay(''), []);
});

test('lattice-aimed shots replay bit-exactly through encode/decode (50 seeds)', () => {
  // The load-bearing property for ghosts: the UI aims on the quantized
  // lattice, so a played shot list round-trips losslessly and the ghost
  // reproduces the sharer's exact result — same tiles, same stroke count.
  for (let seed = 1; seed <= 50; seed++) {
    const p = makePuzzle(seed, 'standard');
    const played = p.certificate.line.map((s) => ({ ...s, angle: quantizeAngle(s.angle) }));
    const original = ghostPath(p.course, p.start, played);
    const decoded = decodeReplay(encodeReplay(played));
    assert.deepEqual(decoded, played, `seed ${seed}: codec is lossless on lattice angles`);
    const ghost = ghostPath(p.course, p.start, decoded);
    assert.deepEqual(ghost, original, `seed ${seed}: ghost reproduces the played round`);
  }
});

test('quantizeAngle is idempotent and stays in [0, 2π)', () => {
  for (const a of [-7.5, -0.001, 0, 1.234, Math.PI, 6.283, 100]) {
    const q = quantizeAngle(a);
    assert.equal(quantizeAngle(q), q);
    assert.ok(q >= 0 && q < Math.PI * 2);
  }
});

test('ghost path ends defensively on an illegal decoded shot', () => {
  const p = makePuzzle(1, 'standard');
  // A putter-only shot list aimed nowhere useful still produces a valid path.
  const ghost = ghostPath(p.course, p.start, [
    { club: 'putter', angle: 0, power: 3 },
    { club: 'putter', angle: Math.PI, power: 3 },
  ]);
  assert.equal(ghost.positions.length >= 1, true);
  assert.equal(ghost.holed, false);
});
