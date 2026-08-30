import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';

test('R17: 玻璃砖两发炮仗炸碎、产生动态碎片', () => {
  const sim = new Simulation({
    seed: 17,
    entities: [
      { t: 'glass', x: 150, y: 171 },
      { t: 'firecracker', x: 161, y: 176, delay: 0 }, // 贴着放（接触距离）
      { t: 'firecracker', x: 139, y: 176, delay: 1.2 },
    ],
  });
  sim.runFor(4);
  assert.equal(sim.stats.propsBroken ?? 0, 1, '玻璃砖应碎裂');
  const debris = sim.world.bodies.filter((b) => b.data?.propType === 'debris');
  assert.equal(debris.length, 3, '应产生 3 块碎片');
  for (const d of debris) {
    assert.equal(d.static, false, '碎片应是动态体');
    assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
  }
});

test('R17: 普通砖头不可破坏', () => {
  const sim = new Simulation({
    seed: 18,
    entities: [
      { t: 'brick', x: 150, y: 120 },
      { t: 'firecracker', x: 156, y: 120, delay: 0 },
    ],
  });
  sim.runFor(3);
  assert.equal(sim.stats.propsBroken ?? 0, 0);
  assert.equal(sim.ents[0].alive, true, '砖头应完好');
});

test('R17: 玻璃砖先裂后碎（裂纹事件）', () => {
  const sim = new Simulation({
    seed: 19,
    entities: [
      { t: 'glass', x: 150, y: 171 },
      { t: 'firecracker', x: 161, y: 176, delay: 0 }, // 贴着放
    ],
  });
  sim.runFor(2.5);
  assert.ok(sim.eventLog.some((e) => e.type === 'propCrack'), '应出现裂纹事件');
  assert.equal(sim.stats.propsBroken ?? 0, 0, '单发不碎');
});
