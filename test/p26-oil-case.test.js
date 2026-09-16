import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { getScenario } from '../src/game/scenario.js';

// R62 回归：案例8 油锅 —— 油中爆炸放大（×1.4）是三杀的唯一途径。
// 50 种子网格调参：进油弧线 50/50 三杀；干岸落点只有 2 杀；无油对照 0/50 三杀。

const SCENE = getScenario('case8');

function runCase8(shot, seed) {
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

test('R62: 案例8 —— 甜点弧线落油放大爆炸，50 种子全数三杀', () => {
  let ko3 = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const sim = runCase8([40, 168, 280, -180], seed);
    if (sim.stats.knockouts >= 3) ko3++;
    if (seed === 1) assert.equal(SCENE.goal(sim).done, true, '案例8 目标应达成');
  }
  assert.equal(ko3, 50, `甜点弧线应 50/50 三杀（实际 ${ko3}/50）`);
});

test('R62: 案例8 —— 干岸落点（错过油湖）只能击倒 2', () => {
  let ko3 = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const sim = runCase8([40, 168, 280, -100], seed);
    assert.ok(sim.stats.knockouts < 3, `seed${seed} 干岸落点不应三杀`);
    if (sim.stats.knockouts >= 3) ko3++;
  }
  assert.equal(ko3, 0, '干岸落点不应有三杀');
});

test('R62: 油盆语义 —— 油中爆炸被放大且油面被点燃', () => {
  const sim = new Simulation({
    seed: 3,
    width: 300,
    height: 180,
    entities: [{ t: 'oil', x: 150, y: 172 }, { t: 'firecracker', x: 150, y: 172, delay: 0 }],
  });
  sim.runFor(3);
  const boom = sim.eventLog.find((e) => e.type === 'explosion');
  assert.ok(boom, '炮仗应在油中爆炸');
  assert.ok(boom.power > 60, `油中爆炸威力应被放大到 55×1.4=77（实际 ${boom.power.toFixed(1)}）`);
  const oil = sim.world.bodies.find((b) => b.data.oilZone);
  assert.equal(oil.data.burning, true, '爆炸应点燃油面');
});
