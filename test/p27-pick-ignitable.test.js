import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';

// R66-B: 运行中"点击未点燃爆炸物点火"的拾取判定（玩家反馈：6px 命中圈太小）
test('pickIgnitable: 精确点击命中未点燃炮仗', () => {
  const sim = new Simulation({ seed: 1, entities: [{ t: 'firecracker', x: 200, y: 176 }] });
  sim.runFor(0.1); // 落地
  const fc = sim.world.bodies.find((b) => b.kind === 'explosive');
  assert.ok(fc, '应有一根炮仗');
  const id = sim.pickIgnitable(fc.x, fc.y);
  assert.equal(id, fc.id, '正中应返回该炮仗 id');
});

test('pickIgnitable: 偏差 10px 仍可命中（默认半径 14），偏差 20px 不命中', () => {
  const sim = new Simulation({ seed: 1, entities: [{ t: 'firecracker', x: 200, y: 176 }] });
  sim.runFor(0.1);
  const fc = sim.world.bodies.find((b) => b.kind === 'explosive');
  assert.equal(sim.pickIgnitable(fc.x + 10, fc.y), fc.id, '偏 10px 应命中');
  assert.equal(sim.pickIgnitable(fc.x + 20, fc.y, 14), null, '偏 20px 超出默认半径');
});

test('pickIgnitable: 已点燃/不存在的位置返回 null，虫子不算', () => {
  const sim = new Simulation({
    seed: 2,
    entities: [
      { t: 'firecracker', x: 200, y: 176 },
      { t: 'roach', x: 400, y: 176 },
    ],
  });
  sim.runFor(0.1);
  const fc = sim.world.bodies.find((b) => b.kind === 'explosive');
  assert.ok(sim.playerIgnite(fc.id), '先点燃');
  sim.step(); // playerIgnite 调度到下一 tick 执行，步进一帧让 lit 生效
  assert.equal(sim.pickIgnitable(fc.x, fc.y), null, '已点燃的不再是可点燃目标');
  const roach = sim.world.bodies.find((b) => b.kind === 'bug');
  assert.ok(roach, '应有一只蟑螂');
  assert.equal(sim.pickIgnitable(roach.x, roach.y), null, '点虫子不触发点火');
});

test('pickIgnitable: 多根炮仗取最近的一根', () => {
  const sim = new Simulation({
    seed: 3,
    entities: [
      { t: 'firecracker', x: 150, y: 176 },
      { t: 'firecracker', x: 170, y: 176 },
    ],
  });
  sim.runFor(0.1);
  const fcs = sim.world.bodies.filter((b) => b.kind === 'explosive');
  assert.equal(fcs.length, 2, '应有两根炮仗');
  const id = sim.pickIgnitable(168, 176);
  const picked = sim.world.byId(id);
  assert.ok(Math.hypot(picked.x - 168, picked.y - 176) <= 14, '命中的应是更近那根');
});

test('pickIgnitable + playerIgnite 串联：偏 12px 的点击也能完成点火并入命令流', () => {
  const sim = new Simulation({ seed: 4, entities: [{ t: 'firecracker', x: 200, y: 176 }] });
  sim.runFor(0.1);
  const fc = sim.world.bodies.find((b) => b.kind === 'explosive');
  const id = sim.pickIgnitable(fc.x + 12, fc.y - 3);
  assert.equal(id, fc.id);
  assert.ok(sim.playerIgnite(id), '点火应成功');
  sim.runFor(2.5);
  assert.ok(sim.stats.explosions >= 1, '应已爆炸');
  const cmd = sim.commandLog.find((c) => c.op === 'ignite');
  assert.ok(cmd, '点燃命令应入流（分享可复现）');
  assert.equal(cmd.id, fc.id);
});
