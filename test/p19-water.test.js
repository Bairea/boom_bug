import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { World } from '../src/sim/world.js';
import { createBody, resetBodyIds } from '../src/sim/body.js';

test('R29: 扔进水里的点燃炮仗熄灭成哑弹', () => {
  const sim = new Simulation({
    seed: 100,
    entities: [{ t: 'water', x: 200, y: 160 }],
  });
  sim.runFor(0.5);
  // 平抛入水（落点在盆心）
  sim.playerThrow(120, 140, 320, 20);
  sim.runFor(2);
  const douse = sim.eventLog.find((e) => e.type === 'douse');
  assert.ok(douse, '应有落水熄灭事件');
  assert.equal(sim.stats.explosions, 0, '水应浇灭引信，不爆炸');
});

test('R29: 浮力 —— 水中物体速度被浮力+阻力大幅吞掉', () => {
  const run = (withWater) => {
    resetBodyIds();
    const w = new World();
    if (withWater) {
      w.add(createBody({ kind: 'prop', x: 150, y: 150, static: true, data: { waterZone: true, propType: 'water' } }));
    }
    const b = w.add(createBody({ x: 150, y: 150, vy: 200 }));
    for (let i = 0; i < 30; i++) w.step(1 / 60);
    return b.vy;
  };
  const dry = run(false);
  const wet = run(true);
  assert.ok(Math.abs(wet) < Math.abs(dry) * 0.4, `水中速度应被吞掉: dry=${dry.toFixed(0)} wet=${wet.toFixed(0)}`);
});

test('R29: 水中爆炸威力大减', () => {
  const make = (waterBetween) =>
    new Simulation({
      seed: 200,
      entities: [
        { t: 'snail', x: 100, y: 176 },
        ...(waterBetween ? [{ t: 'water', x: 130, y: 170 }] : []),
        { t: 'firecracker', x: 130, y: 176, delay: 0 },
      ],
    });
  const dry = make(false);
  const wet = make(true);
  dry.runFor(2.5);
  wet.runFor(2.5);
  const dryHp = dry.ents[0].data.hp;
  const wetHp = wet.ents[0].data.hp;
  assert.ok(wetHp > dryHp + 8, `水中爆炸伤害应大减: dry=${dryHp.toFixed(1)} wet=${wetHp.toFixed(1)}`);
});

test('R29: 水世界确定性保持', () => {
  const run = () => {
    const sim = new Simulation({
      seed: 300,
      entities: [
        { t: 'water', x: 150, y: 150 },
        { t: 'snail', x: 60, y: 176 },
        { t: 'fly', x: 200, y: 90 },
        { t: 'firecracker', x: 145, y: 176, delay: 0.4 },
      ],
    });
    sim.runFor(5);
    return sim.stateChecksum();
  };
  assert.equal(run(), run());
});
