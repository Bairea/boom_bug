// P31：遥控引信 —— 运行中点击已点燃的爆炸物立即引爆。
// 走命令流（schedule tick+1 → commandLog → 分享码），重放必须逐位复现。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { encodeExperiment, decodeExperiment } from '../src/game/encode.js';

function setup() {
  return new Simulation({
    seed: 4242,
    entities: [
      { t: 'roach', x: 150, y: 173, fixed: true },
      { t: 'firecracker', x: 150, y: 169 },
    ],
  });
}

test('P31: playerDetonate —— 已点燃的炮仗下 tick 即爆', () => {
  const sim = setup();
  const fc = sim.ents.find((b) => b.kind === 'explosive');
  sim.step(); // 过 1 tick，绕开 delay 调度（本布局无 delay）
  assert.ok(sim.playerIgnite(fc.id), '点燃应成功');
  sim.step(); // ignite 调度执行，body.lit = true
  assert.ok(fc.data.lit, '应已点燃');
  assert.ok(sim.playerDetonate(fc.id), '遥控引爆应成功');
  sim.step(); // detonate 调度执行
  assert.ok(fc.data.exploded, '应已爆炸');
  assert.ok(!fc.alive, '爆炸后应消亡');
  assert.ok(sim.stats.explosions >= 1);
  // 命令流包含 ignite + detonate
  const ops = sim.commandLog.map((c) => c.op);
  assert.deepEqual(ops, ['ignite', 'detonate']);
});

test('P31: 遥控引爆不合法目标全部拒绝', () => {
  const sim = setup();
  const fc = sim.ents.find((b) => b.kind === 'explosive');
  const roach = sim.ents.find((b) => b.kind === 'bug');
  assert.equal(sim.playerDetonate(fc.id), false, '未点燃不可引爆');
  assert.equal(sim.playerDetonate(roach.id), false, '虫子不可引爆');
  assert.equal(sim.playerDetonate(9999), false, '不存在的 id');
  sim.step();
  sim.playerIgnite(fc.id);
  sim.step();
  sim.playerDetonate(fc.id);
  sim.step();
  assert.equal(sim.playerDetonate(fc.id), false, '已爆炸不可再引爆');
});

test('P31: pickDetonatable —— 只拾取已点燃未爆炸的，且取最近', () => {
  const sim = new Simulation({
    seed: 7,
    entities: [
      { t: 'firecracker', x: 100, y: 170 },
      { t: 'firecracker', x: 200, y: 170 },
    ],
  });
  sim.step();
  const [a, b] = sim.ents.filter((x) => x.kind === 'explosive');
  sim.playerIgnite(a.id);
  sim.playerIgnite(b.id);
  sim.step();
  assert.equal(sim.pickDetonatable(102, 170), a.id, '近者胜');
  assert.equal(sim.pickDetonatable(198, 170), b.id);
  // 引爆 a 后不再被拾取
  sim.playerDetonate(a.id);
  sim.step();
  assert.equal(sim.pickDetonatable(102, 170), null);
  assert.equal(sim.pickDetonatable(198, 170), b.id);
  // pickIgnitable 与 pickDetonatable 互补
  assert.equal(sim.pickIgnitable(198, 170), null, '已点燃不再是点火目标');
});

test('P31: 分享码往返 —— 带 detonate 命令重放同一场事故', () => {
  const sim = setup();
  sim.step();
  const fc = sim.ents.find((b) => b.kind === 'explosive');
  sim.playerIgnite(fc.id);
  // 让它烧 0.8 秒再遥控引爆（引信 0.9-1.5s，此时必然还活着；时机即技巧）
  sim.runFor(0.8);
  assert.ok(sim.playerDetonate(fc.id));
  sim.runFor(3);
  const code = encodeExperiment({
    seed: sim.seed,
    width: sim.width,
    height: sim.height,
    entities: [
      { t: 'roach', x: 150, y: 173, fixed: true },
      { t: 'firecracker', x: 150, y: 169 },
    ],
    commands: sim.commandLog,
  });
  const back = decodeExperiment(code);
  assert.ok(
    back.commands.some((c) => c.op === 'detonate'),
    '分享码应携带 detonate',
  );
  const replay = new Simulation(back);
  replay.runFor(sim.tick / 60); // 与原局等长对拍
  assert.equal(replay.stateChecksum(), sim.stateChecksum(), '重放校验和不一致');
  assert.equal(replay.stats.knockouts, sim.stats.knockouts);
});
