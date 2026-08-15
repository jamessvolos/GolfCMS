// The photo handoff's key binds a baked image to an exact trace. If this
// digest ever changes shape, every parked photo silently stops matching —
// pin it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoKey } from '../src/ui/photo.js';

test('photoKey is stable, distinct per trace, and shaped seed/biome/digest', () => {
  const a = photoKey(42, 'classic', 'g0123abc');
  assert.equal(a, photoKey(42, 'classic', 'g0123abc'), 'deterministic');
  assert.match(a, /^42\/classic\/[0-9a-f]+$/);
  assert.notEqual(a, photoKey(42, 'classic', 'g0123abd'), 'patch digest differs');
  assert.notEqual(a, photoKey(43, 'classic', 'g0123abc'), 'seed differs');
  assert.notEqual(a, photoKey(42, 'links', 'g0123abc'), 'biome differs');
  assert.equal(photoKey(-1 >>> 0, 'x', ''), photoKey(0xffffffff, 'x', ''), 'seed coerced u32');
});
