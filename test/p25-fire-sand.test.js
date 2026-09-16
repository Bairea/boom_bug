import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { resetBodyIds, createBody } from '../src/sim/body.js';
import { getScenario } from '../src/game/scenario.js';

// R61 回归：沙坑闷火 + 案例7 火烧连营（火焰沿木板链传播）。

test('R61: 沙埋火 —— 燃烧的木板陷进沙坑被闷熄', () => {
  resetBodyIds();
  const sim = new Simulation({ seed: 5, width: 300, height: 180, entities: [] });
  const sand = createBody({
    kind: 'prop',
    x: 150,
    y: 165,
    radius: 13,
    static: true,
    data: { propType: 'sand', sand: true, materialZone: true },
  });
  const wood = createBody({
    kind: 'prop',
    x: 150,
    y: 170,
    radius: 10,
    static: true,
    data: { propType: 'wood', burning: true, burnT: 2, fireTick: 0.1, hp: 45, maxHp: 45 },
  });
  sim.world.add(sand);
  sim.world.add(wood);
  sim.runFor(1);
  assert.equal(wood.data.burning, false, '沙坑应闷熄燃烧的木板');
  assert.ok(
    sim.eventLog.some((e) => e.type === 'douse'),
    '应有闷熄事件',
  );
});

test('R61: 沙坑安全区 —— 引燃的炮仗陷沙成哑弹', () => {
  resetBodyIds();
  const sim = new Simulation({
    seed: 6,
    width: 300,
    height: 180,
    entities: [
      { t: 'sand', x: 150, y: 172 },
      { t: 'firecracker', x: 150, y: 172, delay: 0 },
    ],
  });
  sim.runFor(3);
  assert.equal(
    sim.eventLog.some((e) => e.type === 'explosion'),
    false,
    '沙坑里的炮仗不应爆炸',
  );
  assert.ok(
    sim.eventLog.some((e) => e.type === 'douse'),
    '引信应被沙闷灭',
  );
});

test('R61: 案例7 —— 火焰沿木板链传播，火焰击倒 ≥2（20 种子全过）', () => {
  const SCENE = getScenario('case7');
  let pass = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const sim = new Simulation({ seed, width: 300, height: 180, entities: SCENE.entities.map((e) => ({ ...e })) });
    sim.runFor(10);
    const burnt = sim.eventLog.filter((e) => e.type === 'propBreak' && e.propType === 'wood').length;
    const fireKo = sim.eventLog.filter((e) => e.type === 'knockout' && e.cause === 'fire').length;
    if (burnt >= 4 && fireKo >= 2) pass++;
    if (seed === 1) {
      assert.equal(burnt, 4, '整条木板链应烧尽');
      assert.equal(SCENE.goal(sim).done, true, '案例7 目标应达成');
    }
  }
  assert.equal(pass, 20, `20 种子应全数传播到位（实际 ${pass}/20）`);
});
