// P33：案例9 · 气球空袭 —— 新玩具关卡的设计验证。
// 理想玩家（炮仗飘到苍蝇带、且苍蝇靠近时点燃）应稳定达成目标；
// 懒玩家（开局无脑全点）应明显更差 —— 差距就是这一关的"技巧含量"。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { SCENARIOS, getScenario } from '../src/game/scenario.js';

const sc = getScenario('case9');

function fresh(seed) {
  return new Simulation({ seed, entities: sc.entities.map((e) => ({ ...e })) });
}

function dist2(ax, ay, bx, by) {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

test('P33: 场景注册 —— 下拉/下一关链路能看到 case9，目标可调用', () => {
  assert.ok(SCENARIOS.some((s) => s.id === 'case9'));
  assert.equal(sc.entities.filter((e) => e.t === 'balloon').length, 3);
  assert.equal(sc.entities.filter((e) => e.t === 'fly').length, 4);
  assert.ok(sc.noAutoIgnite, '吊炮不能自动点燃 —— 时机就是玩法');
});

test('P33: 理想玩家 20 种子达成率 ≥ 85%', () => {
  let done = 0;
  const N = 20;
  for (let s = 0; s < N; s++) {
    const sim = fresh(9021 + s * 17);
    for (let t = 0; t < 900; t++) {
      sim.step();
      for (const b of sim.world.bodies) {
        if (b.kind !== 'explosive' || !b.alive || b.data.lit) continue;
        if (b.y > 120 || b.y < 50) continue; // 只在苍蝇带内出手
        const near = sim.world.bodies.some(
          (o) =>
            o.kind === 'bug' && o.data.bugType === 'fly' && o.alive && !o.data.knocked && dist2(b.x, b.y, o.x, o.y) < 45 * 45,
        );
        if (near) sim.playerIgnite(b.id);
      }
    }
    if (sc.goal(sim).done) done++;
  }
  assert.ok(done / N >= 0.85, `理想玩家达成率过低: ${done}/${N}`);
});

test('P33: 懒玩家（开局全点）明显更差 —— 技巧门槛存在', () => {
  let done = 0;
  const N = 20;
  for (let s = 0; s < N; s++) {
    const sim = fresh(9021 + s * 17);
    sim.step();
    for (const b of sim.world.bodies) {
      if (b.kind === 'explosive' && b.alive) sim.playerIgnite(b.id);
    }
    sim.runFor(10);
    if (sc.goal(sim).done) done++;
  }
  assert.ok(done < 20, `懒玩家居然全达成(${done}/${N}) —— 目标太松，没有时机博弈`);
});

test('P33: 全场景回归纳入 case9 —— 无 NaN、可正常终局', () => {
  for (let s = 0; s < 5; s++) {
    const sim = fresh(9021 + s * 7919);
    sim.runFor(10);
    for (const b of sim.world.bodies) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), `case9#${s} 出现 NaN 坐标`);
      assert.ok(b.x >= -50 && b.x <= 350 && b.y >= -50 && b.y <= 230, `case9#${s} 严重越界`);
    }
  }
});
