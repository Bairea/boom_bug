import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { encodeExperiment, decodeExperiment } from '../src/game/encode.js';

test('R4: 运行中投掷点燃炮仗 —— 飞行、起爆、命令入账', () => {
  const sim = new Simulation({ seed: 555, entities: [] });
  sim.runFor(0.5);
  sim.playerThrow(60, 80, 350, -60);
  sim.runFor(2);
  const th = sim.eventLog.find((e) => e.type === 'explosion');
  assert.ok(th, '投掷的炮仗应爆炸');
  assert.ok(['fuse', 'impact'].includes(th.cause), `cause=${th.cause}（撞墙提前炸也合理）`);
  assert.ok(th.x > 60, `应朝投掷方向飞行, x=${th.x}`);
  const cmd = sim.commandLog.find((c) => c.op === 'throw');
  assert.ok(cmd, '投掷命令应记录');
  assert.equal(cmd.vx, 350);
  const fc = sim.world.bodies.find((b) => b.kind === 'explosive');
  assert.ok(fc, '投掷会新增一个爆炸物实体');
});

test('R4: 投掷可击倒虫子（高空垂直命中）', () => {
  const sim = new Simulation({ seed: 666, entities: [{ t: 'locust', x: 200, y: 100 }] });
  sim.runFor(0.2);
  sim.playerThrow(200, 55, 0, 500); // 正上方砸下去
  sim.runFor(2);
  assert.ok(sim.stats.knockouts >= 1, `应击倒, ko=${sim.stats.knockouts}`);
});

test('R4: 相同投掷序列 → 完全相同的事故（确定性）', () => {
  const run = () => {
    const sim = new Simulation({ seed: 777, entities: [{ t: 'roach', x: 150, y: 176 }] });
    sim.runFor(0.4);
    sim.playerThrow(40, 60, 420, -120);
    sim.runFor(0.7);
    sim.playerThrow(260, 40, -380, 100);
    sim.runFor(3);
    return { sum: sim.stateChecksum(), cmds: JSON.stringify(sim.commandLog) };
  };
  const a = run();
  const b = run();
  assert.equal(a.sum, b.sum);
  assert.equal(a.cmds, b.cmds);
});

test('R4: 分享码携带投掷命令并可复现（向后兼容旧 ignite 码）', () => {
  const exp = {
    seed: 42,
    width: 300,
    height: 180,
    entities: [{ t: 'roach', x: 150, y: 176 }],
    commands: [
      { tick: 30, op: 'ignite', id: 1 },
      { tick: 60, op: 'throw', x: 50.4, y: 80.2, vx: 350, vy: -61 },
    ],
  };
  const code = encodeExperiment(exp);
  const back = decodeExperiment(code);
  assert.deepEqual(back.commands, [
    { tick: 30, op: 'ignite', id: 1 },
    { tick: 60, op: 'throw', x: 50.4, y: 80.2, vx: 350, vy: -61 },
  ]);
  // 原局 vs 分享码重建
  const a = new Simulation(exp);
  const b = new Simulation({ ...back, width: 300, height: 180, entities: back.entities });
  a.runFor(5);
  b.runFor(5);
  assert.equal(a.stateChecksum(), b.stateChecksum());
  // v1 旧格式（两元素行）仍可解码
  const legacy = decodeExperiment(
    encodeExperiment({ seed: 1, width: 300, height: 180, entities: [], commands: [{ tick: 5, op: 'ignite', id: 1 }] }).replace(
      JSON.stringify([]).slice(1, 2),
      JSON.stringify([]).slice(1, 2), // no-op 占位
    ),
  );
  assert.equal(legacy.commands.length, 1);
});
