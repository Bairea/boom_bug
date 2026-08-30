import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecords } from '../src/game/records.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

test('R12: 战绩更新取各项最大并标记新纪录', () => {
  const rec = createRecords(fakeStorage());
  let { best, isNew } = rec.update('case1', { chainMax: 2, knockouts: 3, explosions: 5 });
  assert.equal(isNew, true);
  assert.deepEqual(best, { chain: 2, knockouts: 3, explosions: 5 });
  ({ best, isNew } = rec.update('case1', { chainMax: 1, knockouts: 6, explosions: 2 }));
  assert.equal(isNew, true, '击倒破纪录');
  assert.deepEqual(best, { chain: 2, knockouts: 6, explosions: 5 });
  ({ best, isNew } = rec.update('case1', { chainMax: 1, knockouts: 2, explosions: 1 }));
  assert.equal(isNew, false, '全面平庸不算新纪录');
  assert.deepEqual(best, { chain: 2, knockouts: 6, explosions: 5 });
});

test('R12: 不同场景互不干扰；无 storage 时优雅降级', () => {
  const storage = fakeStorage();
  const rec = createRecords(storage);
  rec.update('case1', { chainMax: 5, knockouts: 5, explosions: 5 });
  const { best } = rec.update('case2', { chainMax: 1, knockouts: 1, explosions: 1 });
  assert.deepEqual(best, { chain: 1, knockouts: 1, explosions: 1 });
  assert.equal(rec.load('case1').chain, 5);

  const bare = createRecords(null);
  const { best: b2, isNew } = bare.update('x', { chainMax: 3, knockouts: 3, explosions: 3 });
  assert.equal(isNew, true);
  assert.deepEqual(b2, { chain: 3, knockouts: 3, explosions: 3 });
});
