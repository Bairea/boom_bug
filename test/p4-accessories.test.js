import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { tipEffect } from '../src/sim/accessories.js';

test('P4: 牙签提高对装甲的实际伤害', () => {
  const make = (acc) =>
    new Simulation({
      seed: 11, // 与 P2 同布局：爆点位置确定
      entities: [
        { t: 'firecracker', x: 65, y: 176, delay: 0, acc },
        { t: 'scarab', x: 70, y: 170, fixed: true },
      ],
    });
  const bare = make([]);
  const tooth = make(['toothpick']);
  bare.runFor(2.5);
  tooth.runFor(2.5);
  const hpBare = bare.ents[1].data.hp;
  const hpTooth = tooth.ents[1].data.hp;
  assert.ok(hpTooth < hpBare - 5, `牙签应显著增伤: bare=${hpBare} tooth=${hpTooth}`);
  assert.ok(hpTooth < 90 && hpBare < 90, '双方都应受损');
});

test('P4: 穿透率修饰器合成正确', () => {
  assert.equal(tipEffect([]).pierce, 0.15);
  assert.equal(tipEffect(['toothpick']).pierce, 0.6);
  assert.equal(tipEffect(['pin']).pierce, 0.95);
  assert.equal(tipEffect(['toothpick', 'pin']).pierce, 0.95, '取最强穿透');
  assert.equal(tipEffect(['glue']).glue, true);
});

test('P4: 大头针命中后钉住、延迟起爆', () => {
  const sim = new Simulation({
    seed: 707,
    entities: [{ t: 'bottle', x: 30, y: 120, angle: -0.35, delay: 0, acc: ['pin'] }],
  });
  sim.runFor(2.5);
  const pin = sim.eventLog.find((e) => e.type === 'pinStick');
  const exp = sim.eventLog.find((e) => e.type === 'explosion');
  assert.ok(pin, '应有钉住事件');
  assert.ok(exp, '最终应爆炸');
  const gap = exp.tick - pin.tick;
  assert.ok(gap >= 10 && gap <= 25, `钉住${gap}tick 后起爆≈0.25s`);
  assert.equal(sim.stats.pins, 1);
});

test('P4: 无大头针的窜天猴命中即爆（无钉住事件）', () => {
  const sim = new Simulation({
    seed: 707, // 同种子同布局，只去掉配件
    entities: [{ t: 'bottle', x: 30, y: 120, angle: -0.35, delay: 0 }],
  });
  sim.runFor(2.5);
  assert.ok(!sim.eventLog.some((e) => e.type === 'pinStick'));
  const exp = sim.eventLog.find((e) => e.type === 'explosion');
  assert.ok(exp, '命中即爆');
  const pin = sim.eventLog.find((e) => e.type === 'pinStick');
  assert.equal(pin, undefined);
});

test('P4: 胶水命中粘附、原地滞留后起爆', () => {
  const sim = new Simulation({
    seed: 808,
    entities: [{ t: 'bottle', x: 30, y: 120, angle: -0.35, delay: 0, acc: ['glue'] }],
  });
  sim.runFor(2.5);
  const glue = sim.eventLog.find((e) => e.type === 'glueStick');
  const exp = sim.eventLog.find((e) => e.type === 'explosion');
  assert.ok(glue, '应有粘附事件');
  assert.ok(exp, '粘附后应起爆');
  assert.ok(Math.abs(exp.x - glue.x) < 3 && Math.abs(exp.y - glue.y) < 3, '应原地起爆');
  assert.ok(exp.tick > glue.tick, '粘附先于爆炸');
  assert.equal(sim.stats.glues, 1);
});

test('P4: 绳子把虫子拽上天空（冲天炮+绳子拖拽）', () => {
  const sim = new Simulation({
    seed: 909,
    entities: [
      { t: 'skyrocket', x: 80, y: 176, delay: 0, ropes: [[0, 1]] },
      { t: 'roach', x: 95, y: 176 },
    ],
  });
  const roach = sim.ents[1];
  const exp = sim.eventLog.find((e) => e.type === 'explosion');
  let dragged = false;
  for (let i = 0; i < Math.min(exp ? exp.tick : 33, 33); i++) {
    sim.step();
    if (roach.y < 168) dragged = true; // 爆炸前就被绳子拉离地面
  }
  assert.ok(dragged, `冲天炮升空应把蟑螂拽离地面 (爆炸前)`);
});

test('P4: 绳子超载断裂并计为意外事件', () => {
  const sim = new Simulation({
    seed: 111,
    entities: [
      { t: 'locust', x: 140, y: 90, ropes: [[0, 1]] },
      { t: 'locust', x: 160, y: 90 },
    ],
  });
  const a = sim.ents[0];
  const b = sim.ents[1];
  a.vx = -700; // 相离方向制造超载拉扯
  b.vx = 700;
  sim.step();
  const brk = sim.eventLog.find((e) => e.type === 'ropeBreak');
  assert.ok(brk, '超载应断裂');
  assert.equal(sim.stats.ropesBroken, 1);
});

test('P4: 完整小场景确定性 —— 同输入双跑校验和一致', () => {
  const build = () =>
    new Simulation({
      seed: 1234,
      entities: [
        { t: 'firecracker', x: 80, y: 176, delay: 0.2 },
        { t: 'firecracker', x: 120, y: 176, delay: 0.5 },
        { t: 'bottle', x: 60, y: 100, angle: -0.4, delay: 0.1, acc: ['toothpick'] },
        { t: 'roach', x: 150, y: 176 },
        { t: 'roach', x: 200, y: 176 },
        { t: 'locust', x: 240, y: 176 },
      ],
      commands: [{ tick: 90, op: 'ignite', id: 3 }],
    });
  const a = build();
  const b = build();
  a.runFor(6);
  b.runFor(6);
  assert.equal(a.stateChecksum(), b.stateChecksum());
  assert.ok(a.stats.explosions >= 2, `场景应发生多次爆炸: ${a.stats.explosions}`);
});
