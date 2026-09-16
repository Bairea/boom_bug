import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';

test('P3: 蟑螂感知爆炸并背向逃离', () => {
  // 距离62：在威胁感知圈(90)内、爆炸冲击圈(60)外 —— 逃离行为独立于冲击
  const sim = new Simulation({
    seed: 101,
    entities: [
      { t: 'firecracker', x: 160, y: 176, delay: 0 },
      { t: 'roach', x: 98, y: 176 },
    ],
  });
  const roach = sim.ents[1];
  let minVx = 0;
  for (let i = 0; i < 120; i++) {
    sim.step();
    minVx = Math.min(minVx, roach.vx);
  }
  assert.ok(minVx < -50, `应观测到向左(背向爆炸点)的逃窜, minVx=${minVx}`);
});

test('P3: 蝗虫会周期性起跳', () => {
  const sim = new Simulation({ seed: 202, entities: [{ t: 'locust', x: 150, y: 176 }] });
  let minVy = 0;
  for (let i = 0; i < 240; i++) {
    sim.step();
    minVy = Math.min(minVy, sim.ents[0].vy);
  }
  assert.ok(minVy < -140, `应观测到跳跃, minVy=${minVy}`);
  assert.ok(sim.stats.jumps >= 1, '应有跳跃事件计数');
});

test('P3: 蝗虫高弹性 —— 落地反弹保留大半速度', () => {
  const sim = new Simulation({ seed: 303, entities: [{ t: 'locust', x: 150, y: 60 }] });
  const locust = sim.ents[0];
  const impact = Math.sqrt(2 * 560 * (180 - 2.4 - 60));
  let landed = false;
  let bounce = 0;
  for (let i = 0; i < 240; i++) {
    sim.step();
    if (!landed && locust.y >= 180 - 2.4 - 0.5)
      landed = true; // 触地后 wall solve 会把 vy 翻负
    else if (landed && locust.vy < 0) bounce = Math.max(bounce, -locust.vy);
  }
  assert.ok(bounce > impact * 0.5, `反弹速度${bounce}应>冲击${impact}的一半`);
});

test('P3: 被击倒的虫子停止行动、物理上静止成道具', () => {
  const sim = new Simulation({ seed: 404, entities: [{ t: 'roach', x: 150, y: 176 }] });
  const roach = sim.ents[0];
  sim._damage(roach.id, 999, 0.15);
  assert.equal(roach.data.knocked, true);
  sim.runFor(2);
  assert.ok(Math.abs(roach.vx) < 15 && Math.abs(roach.vy) < 15, `击倒后应静止, v=(${roach.vx},${roach.vy})`);
  assert.ok(roach.y > 170, '应留在地面');
});

test('P3: 固定的清道夫不移动也不被冲击推动', () => {
  const sim = new Simulation({
    seed: 505,
    entities: [
      { t: 'firecracker', x: 80, y: 170, delay: 0 },
      { t: 'scarab', x: 90, y: 170, fixed: true },
    ],
  });
  const scarab = sim.ents[1];
  sim.runFor(2);
  assert.equal(scarab.x, 90);
  assert.equal(scarab.y, 170);
  assert.equal(scarab.vx, 0);
});

test('P3: 未固定的清道夫缓慢爬行', () => {
  const sim = new Simulation({ seed: 606, entities: [{ t: 'scarab', x: 150, y: 175 }] });
  const scarab = sim.ents[0];
  sim.runFor(2);
  const moved = Math.abs(scarab.x - 150);
  assert.ok(moved > 2, `应缓慢爬行, moved=${moved}`);
  assert.ok(moved < 80, `但应很慢, moved=${moved}`);
});
