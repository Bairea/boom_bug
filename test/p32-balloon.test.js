// P32：气球 —— 轻于空气的浮空玩具。
// 上升物理（净浮力+阻力+限速）、冲击波/火苗打爆（balloonPop 事件，无碎片）、
// 绳子联动（吊起炮仗 = 玩家自造空袭/无人机，与遥控引信组合）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { resetBodyIds } from '../src/sim/body.js';

test('P32: 气球从地面升起并停在盒内', () => {
  resetBodyIds();
  const sim = new Simulation({ seed: 11, entities: [{ t: 'balloon', x: 150, y: 170 }] });
  sim.runFor(3);
  const balloon = sim.ents[0];
  assert.ok(balloon.y < 100, `3 秒应明显升空, y=${balloon.y}`);
  assert.ok(balloon.y > 0, `应被天花板兜住, y=${balloon.y}`);
  assert.ok(Number.isFinite(balloon.x) && Number.isFinite(balloon.y));
  assert.ok(!balloon.static, '气球不应被静态固化');
});

test('P32: 冲击波打爆气球 —— balloonPop 事件，无碎片', () => {
  resetBodyIds();
  // 气球贴着炮仗放：在它飘远之前（0.15s 延迟引信）爆炸波就得够到它
  const sim = new Simulation({
    seed: 22,
    entities: [
      { t: 'balloon', x: 150, y: 172 },
      { t: 'firecracker', x: 150, y: 169, delay: 0.15 },
    ],
  });
  sim.runFor(2);
  const pops = sim.eventLog.filter((e) => e.type === 'balloonPop');
  assert.equal(pops.length, 1, '应有一次打爆事件');
  const balloon = sim.ents.find((b) => b.data.propType === 'balloon');
  assert.ok(balloon && !balloon.alive, '气球应消亡');
  // 不走玻璃砖那套碎裂：全场不应生成碎片道具
  const debris = sim.ents.filter((b) => b.data.propType === 'debris');
  assert.equal(debris.length, 0, '打爆不应产生碎片');
});

test('P32: 绳子吊炮仗 —— 气球把炮仗拽离地面（空袭工装）', () => {
  resetBodyIds();
  const sim = new Simulation({
    seed: 33,
    entities: [
      { t: 'balloon', x: 150, y: 140 },
      { t: 'firecracker', x: 150, y: 160, ropes: [[0, 1]] },
    ],
  });
  const y0 = sim.ents.find((b) => b.kind === 'explosive').y;
  sim.runFor(2);
  const fc = sim.ents.find((b) => b.kind === 'explosive');
  assert.ok(fc.y < y0 - 10, `炮仗应被气球拽升, y ${y0} -> ${fc.y}`);
  assert.ok(Number.isFinite(fc.y) && Number.isFinite(fc.x), '绳约束下保持有限');
  assert.ok(!fc.data.lit, '未点燃就不该自己爆（留给玩家遥控/点燃）');
});

test('P32: 火苗打爆气球 —— 燃烧木板的灼烧圈会点爆它', () => {
  resetBodyIds();
  const sim = new Simulation({
    seed: 44,
    entities: [
      { t: 'balloon', x: 154, y: 164 },
      { t: 'wood', x: 150, y: 168 },
    ],
  });
  // 直接点燃木板（隔离火苗分支：灼烧圈 14+radius 恰好罩住旁边的气球）
  const wood = sim.ents.find((b) => b.data.propType === 'wood');
  wood.data.burning = true;
  wood.data.burnT = 3;
  wood.data.fireTick = 0;
  sim.runFor(1);
  const pops = sim.eventLog.filter((e) => e.type === 'balloonPop');
  assert.equal(pops.length, 1, `火苗应打爆气球, pops=${pops.length}`);
  const balloon = sim.ents.find((b) => b.data.propType === 'balloon');
  assert.ok(balloon && !balloon.alive, '气球应消亡');
});
