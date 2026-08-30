import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';

test('P2: 小炮仗引信到时爆炸', () => {
  const sim = new Simulation({
    seed: 42,
    entities: [{ t: 'firecracker', x: 150, y: 176, delay: 0 }],
  });
  sim.runFor(3);
  const exp = sim.eventLog.filter((e) => e.type === 'explosion');
  assert.equal(exp.length, 1);
  assert.equal(exp[0].cause, 'fuse');
  assert.equal(exp[0].depth, 0);
  assert.ok(exp[0].tick >= 54 && exp[0].tick <= 95, `爆炸tick=${exp[0].tick}应在0.9~1.5s+余量`);
  assert.equal(sim.ents[0].alive, false, '炮仗应被消耗');
  assert.equal(sim.stats.explosions, 1);
});

test('P2: 爆炸冲量把近处物体炸飞、远处无感（衰减）', () => {
  const sim = new Simulation({
    seed: 7,
    entities: [
      { t: 'firecracker', x: 60, y: 176, delay: 0 },
      { t: 'locust', x: 90, y: 176 }, // 30u：falloff 0.5
      { t: 'locust', x: 200, y: 176 }, // 140u：圈外
    ],
  });
  sim.runFor(2.5);
  const near = sim.ents[1];
  const far = sim.ents[2];
  assert.ok(near.x > 150, `近处蝗虫应被炸飞, x=${near.x}`);
  assert.ok(far.x < 260, `远处蝗虫不应受冲击, x=${far.x}`);
  assert.ok(near.x > far.x, '近处位移应远大于远处');
});

test('P2: 连锁引爆 —— 第二个炮仗被炸点着并迅速爆炸', () => {
  const sim = new Simulation({
    seed: 99,
    entities: [
      { t: 'firecracker', x: 100, y: 176, delay: 0 },
      { t: 'firecracker', x: 140, y: 176 }, // 40u < blastR 60
    ],
  });
  sim.runFor(3);
  const exp = sim.eventLog.filter((e) => e.type === 'explosion');
  assert.equal(exp.length, 2);
  const chain = sim.eventLog.find((e) => e.type === 'chainIgnite');
  assert.ok(chain, '应有连锁点燃事件');
  assert.equal(exp[1].depth, 1, '第二爆深度=1');
  const gap = exp[1].tick - exp[0].tick;
  assert.ok(gap > 0 && gap <= 15, `连锁间隔${gap}tick 应在0.04~0.1s+余量`);
  assert.equal(sim.stats.chainMax, 1);
});

test('P2: 爆炸伤害击倒玩具蟑螂（伤害结算直测）', () => {
  const sim = new Simulation({ seed: 5, entities: [{ t: 'roach', x: 70, y: 176 }] });
  const roach = sim.ents[0];
  const eff = sim._damage(roach.id, 45, 0.15);
  assert.ok(eff > 25, `无装甲应足额受伤, eff=${eff}`);
  assert.equal(roach.data.knocked, true, '超过hp应被击倒(玩具故障)');
  assert.equal(sim.stats.knockouts, 1);
  const ko = sim.eventLog.find((e) => e.type === 'knockout');
  assert.ok(ko, '应有击倒事件');
  assert.notEqual(roach.angVel, 0, '击倒时应有翻滚自旋');
});

test('P2: 爆炸对固定清道夫的实际伤害符合衰减与装甲公式', () => {
  // 清道夫固定 → 位置确定，爆炸位置确定 → 伤害可精确预期
  const sim = new Simulation({
    seed: 11,
    entities: [
      { t: 'firecracker', x: 65, y: 176, delay: 0 },
      { t: 'scarab', x: 70, y: 170, fixed: true },
    ],
  });
  sim.runFor(2.5);
  const scarab = sim.ents[1];
  const exp = sim.eventLog.find((e) => e.type === 'explosion');
  // 炮仗引信末期会乱蹦，用事件里的实际爆点反推期望伤害
  const d = Math.hypot(exp.x - 70, exp.y - 170);
  const expected = 45 * (1 - d / 60) * (1 - 0.6 * (1 - 0.15));
  assert.ok(Math.abs(scarab.data.hp - (90 - expected)) < 0.5, `hp=${scarab.data.hp} 期望≈${90 - expected}`);
  assert.equal(scarab.data.knocked, false, '单发小炮仗不该击倒清道夫');
  assert.equal(scarab.x, 70, '固定清道夫不该位移');
});

test('P2: 清道夫装甲大幅减伤，普通爆炸炸不倒', () => {
  const sim = new Simulation({
    seed: 11,
    entities: [
      { t: 'firecracker', x: 105, y: 176, delay: 0 },
      { t: 'scarab', x: 100, y: 170 },
    ],
  });
  sim.runFor(2.5);
  const scarab = sim.ents[1];
  assert.equal(scarab.data.knocked, false, '装甲减免后不应被击倒');
  assert.ok(scarab.data.hp < 90 && scarab.data.hp > 45, `hp=${scarab.data.hp} 应受损但过半`);
  assert.ok(!sim.eventLog.some((e) => e.type === 'armorCrack'), 'hp未过半不应出现裂纹事件');
});

test('P2: 冲天炮竖直上冲、燃尽在高处爆炸', () => {
  const sim = new Simulation({
    seed: 21,
    entities: [{ t: 'skyrocket', x: 150, y: 176, delay: 0 }],
  });
  const rocket = sim.ents[0];
  let sawFast = false;
  for (let i = 0; i < 60 * 2; i++) {
    sim.step();
    if (rocket.alive && rocket.vy < -150) sawFast = true;
  }
  assert.ok(sawFast, '燃烧期应有向上高速');
  const exp = sim.eventLog.find((e) => e.type === 'explosion');
  assert.ok(exp, '应爆炸(燃尽或撞顶)');
  assert.ok(exp.y < 150, `应在高处爆炸, y=${exp.y}`);
  assert.equal(sim.ents[0].alive, false);
});

test('P2: 窜天猴沿瞄准方向飞行并撞击爆炸', () => {
  const sim = new Simulation({
    seed: 33,
    entities: [{ t: 'bottle', x: 30, y: 120, angle: -0.35, delay: 0 }],
  });
  sim.runFor(2.5);
  const exp = sim.eventLog.filter((e) => e.type === 'explosion');
  assert.equal(exp.length, 1);
  assert.ok(exp[0].x > 240, `应飞到右侧才爆, x=${exp[0].x}`);
  assert.ok(['impact', 'burnout'].includes(exp[0].cause));
});
