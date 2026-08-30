import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, Rng } from '../src/sim/rng.js';
import { checksum } from '../src/sim/math.js';

test('P0: 同种子产生完全一致的序列', () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  for (let i = 0; i < 1000; i++) {
    assert.equal(a.float(), b.float());
  }
});

test('P0: 不同种子序列不同', () => {
  const a = new Rng(1);
  const b = new Rng(2);
  const seqA = Array.from({ length: 100 }, () => a.float());
  const seqB = Array.from({ length: 100 }, () => b.float());
  assert.notDeepEqual(seqA, seqB);
});

test('P0: range/int/pick 落在界内且可复现', () => {
  const a = new Rng(777);
  const b = new Rng(777);
  for (let i = 0; i < 500; i++) {
    const v = a.range(-3.5, 9.25);
    assert.ok(v >= -3.5 && v < 9.25);
    assert.equal(v, b.range(-3.5, 9.25));

    const n = a.int(2, 6);
    assert.ok(n >= 2 && n <= 6);
    assert.equal(n, b.int(2, 6));

    const p = a.pick([10, 20, 30]);
    assert.ok([10, 20, 30].includes(p));
    assert.equal(p, b.pick([10, 20, 30]));
  }
});

test('P0: 校验和对浮点序列稳定且对扰动敏感', () => {
  const nums = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 100);
  assert.equal(checksum(nums), checksum(nums.slice()));
  const perturbed = nums.slice();
  perturbed[10] += 0.5;
  assert.notEqual(checksum(nums), checksum(perturbed));
});
