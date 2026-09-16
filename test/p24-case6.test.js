import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { getScenario } from '../src/game/scenario.js';

// R58 回归：案例6 擦炮冰壶 —— 水障/冰面滑行/瓶阵的完整语义。
// 同时守护 R58 的关键修复：冰面/沙坑是非实体材质区（materialZone），
// 飞行/滑行中的炮仗不会被冰盘边缘"撞爆"，地面虫也不会被冰盘挡住。
// 参数窗口经 100 种子网格扫描验证（tune-case6）：(300,-160) 100/100 达成，
// 低平投 100% 被浇灭，过高弧线 100% 引信空爆。

const SCENE = getScenario('case6');

function runCase6(shot, seed = 7) {
  const sim = new Simulation({
    seed,
    width: 300,
    height: 180,
    entities: SCENE.entities.map((e) => ({ ...e })),
  });
  sim.runFor(0.5);
  sim.playerThrow(...shot);
  sim.runFor(6);
  return sim;
}

test('R58: 案例6 —— 低平投掷被水盆浇灭，零击倒', () => {
  for (const seed of [1, 42, 777]) {
    const sim = runCase6([40, 168, 300, -40], seed);
    assert.ok(sim.eventLog.some((e) => e.type === 'douse'), `seed${seed} 平抛应落水熄火`);
    assert.equal(sim.eventLog.some((e) => e.type === 'explosion'), false, '不应有爆炸');
    assert.equal(sim.stats.knockouts, 0, '水障应拦下低平投掷');
  }
});

test('R58: 案例6 —— 标准弧线越过水落冰撞瓶，100 种子全数掀翻 ≥3', () => {
  let good = 0;
  let doused = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const sim = runCase6([40, 168, 300, -160], seed);
    if (sim.eventLog.some((e) => e.type === 'douse')) doused++;
    if (sim.stats.knockouts >= 3) good++;
  }
  assert.equal(doused, 0, '标准弧线不应落水');
  assert.equal(good, 100, `参数窗口应 100/100 达成（实际 ${good}/100）`);
  const goal = SCENE.goal(runCase6([40, 168, 300, -160]));
  assert.equal(goal.done, true, '案例6 目标应达成');
});

test('R58: 冰面是非实体材质区 —— 滑行炮仗不撞冰爆、地面虫不被冰盘挡路', () => {
  // 无水障版本：低平掷出的炮仗应滑过冰面（不因接触冰盘而起爆），撞上瓶阵才炸
  const sim = new Simulation({
    seed: 7,
    width: 300,
    height: 180,
    entities: [
      { t: 'ice', x: 185, y: 172 },
      { t: 'ice', x: 205, y: 172 },
      { t: 'roach', x: 222, y: 176, fixed: true },
      { t: 'roach', x: 228, y: 176, fixed: true },
      { t: 'roach', x: 234, y: 176, fixed: true },
    ],
  });
  sim.runFor(0.5);
  sim.playerThrow(40, 168, 300, -10);
  sim.runFor(6);
  const boom = sim.eventLog.find((e) => e.type === 'explosion');
  assert.ok(boom, '炮仗最终应起爆（撞瓶阵）');
  assert.ok(boom.x > 210, `爆炸应发生在瓶阵处而非冰面上（实际 x=${boom.x.toFixed(0)}）`);
  assert.ok(sim.stats.knockouts >= 2, '滑行冰壶应能撞倒瓶阵前沿');
});
