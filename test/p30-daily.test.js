// P30：每日实验 —— 日期 → 种子+布局的确定性生成器。
// 全世界同一天必须拿到逐位一致的实验（R74 dmath 的直接变现）；
// 布局必须合法（种类/数量/坐标），并且"不冷场"（自动点燃的炮仗保证有戏）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDaily, todayKey, THEME_LABELS } from '../src/game/daily.js';
import { Simulation } from '../src/sim/sim.js';

const KNOWN_TYPES = new Set([
  'roach',
  'locust',
  'scarab',
  'snail',
  'fly',
  'firecracker',
  'skyrocket',
  'bottle',
  'brick',
  'glass',
  'sponge',
  'water',
  'oil',
  'giftbox',
  'wood',
  'ice',
  'metal',
  'sand',
  'balloon',
]);

test('P30: 同一天两次生成 —— 种子与布局逐位一致', () => {
  const a = buildDaily('20260918');
  const b = buildDaily('20260918');
  assert.equal(a.seed, b.seed);
  assert.deepEqual(a.entities, b.entities);
  assert.equal(a.theme, b.theme);
});

test('P30: 不同日期 → 不同种子与布局（100 天抽查）', () => {
  const seeds = new Set();
  const layouts = new Set();
  for (let i = 0; i < 100; i++) {
    const key = String(20260101 + i);
    const d = buildDaily(key);
    seeds.add(d.seed);
    layouts.add(JSON.stringify(d.entities));
  }
  assert.equal(seeds.size, 100, '种子应日日不同');
  assert.ok(layouts.size >= 80, `布局应高度多样（got ${layouts.size}/100）`);
});

test('P30: 布局合法性 —— 类型白名单/数量上限/坐标在盒内', () => {
  for (let i = 0; i < 60; i++) {
    const d = buildDaily(String(20260101 + i));
    let bug = 0;
    let explosive = 0;
    let prop = 0;
    for (const e of d.entities) {
      assert.ok(KNOWN_TYPES.has(e.t), `未知类型 ${e.t}`);
      assert.ok(e.x >= 3 && e.x <= 297, `x 越界 ${e.x}`);
      assert.ok(e.y >= 2 && e.y <= 178, `y 越界 ${e.y}`);
      if (['roach', 'locust', 'scarab', 'snail', 'fly'].includes(e.t)) bug++;
      else if (['firecracker', 'skyrocket', 'bottle'].includes(e.t)) explosive++;
      else prop++;
      if (e.fixed) assert.equal(e.t, 'scarab', '只有清道夫可固定');
    }
    assert.ok(bug <= 14, `虫数超上限 ${bug}`);
    assert.ok(explosive <= 8, `爆炸物超上限 ${explosive}`);
    assert.ok(prop <= 2, `道具超上限 ${prop}`);
    assert.ok(bug >= 5, `虫太少不像样 ${bug}`);
    assert.ok(explosive >= 1, '至少一根爆炸物');
  }
});

test('P30: 主题轮换 —— 四种主题都出现且与日期对应', () => {
  const themes = new Set();
  for (let i = 0; i < 8; i++) {
    const d = buildDaily(String(20260918 + i));
    themes.add(d.theme);
    assert.ok(THEME_LABELS[d.theme], `主题缺标签 ${d.theme}`);
  }
  assert.equal(themes.size, 4, '连续 8 天应覆盖全部 4 个主题');
});

test('P30: 实战冒烟 —— 今天的实验点燃后必炸且全程有限（模拟编辑器延迟点燃）', () => {
  for (let i = 0; i < 20; i++) {
    const d = buildDaily(String(20260101 + i));
    // 与 editor.buildEntities(true) 相同的延迟点燃策略
    const entities = d.entities.map((e, j) =>
      ['firecracker', 'skyrocket', 'bottle'].includes(e.t) ? { ...e, delay: +(0.15 + j * 0.35).toFixed(2) } : { ...e },
    );
    const sim = new Simulation({ seed: d.seed, entities });
    sim.runFor(12);
    assert.ok(sim.stats.explosions >= 1, `day ${20260101 + i}: 自动点燃的布局竟然零爆炸`);
    for (const b of sim.world.bodies) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), `day ${20260101 + i}: 坐标 NaN`);
    }
  }
});

test('P30: todayKey —— 本地日期格式 YYYYMMDD', () => {
  assert.match(todayKey(new Date(2026, 8, 18)), /^20260918$/);
  assert.match(todayKey(new Date(2026, 0, 5)), /^20260105$/);
});
