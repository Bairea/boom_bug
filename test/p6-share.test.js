import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeExperiment,
  decodeExperiment,
  toHash,
  experimentFromHash,
} from '../src/game/encode.js';
import { Recorder, buildReport, SNAPSHOT_INTERVAL } from '../src/game/replay.js';
import { Simulation } from '../src/sim/sim.js';
import { SCENARIOS } from '../src/game/scenario.js';

const exp = {
  seed: 123456789,
  width: 300,
  height: 180,
  entities: [
    { t: 'firecracker', x: 80, y: 176, delay: 0.2 },
    { t: 'bottle', x: 60, y: 100, angle: -0.4, acc: ['pin'], delay: 0.1 },
    { t: 'scarab', x: 150, y: 157, fixed: true },
    { t: 'roach', x: 200, y: 176, ropes: [[0, 3]] },
  ],
  commands: [{ tick: 90, id: 1, op: 'ignite' }],
};

test('P6: 分享码编码→解码往返无损', () => {
  const code = encodeExperiment(exp);
  assert.match(code, /^[A-Za-z0-9_-]+$/, '应为 URL 安全 base64');
  const back = decodeExperiment(code);
  assert.equal(back.seed, exp.seed);
  assert.equal(back.width, 300);
  assert.equal(back.entities.length, 4);
  assert.equal(back.entities[1].t, 'bottle');
  assert.deepEqual(back.entities[1].acc, ['pin']);
  assert.equal(back.entities[2].fixed, true);
  assert.deepEqual(back.entities[3].ropes, [[0, 3]]);
  assert.equal(back.entities[0].delay, 0.2);
  assert.deepEqual(back.commands, [{ tick: 90, op: 'ignite', id: 1 }]);
});

test('P6: hash 提取与回写', () => {
  const hash = toHash(exp);
  assert.match(hash, /^#e=/);
  const back = experimentFromHash(hash);
  assert.equal(back.seed, exp.seed);
  assert.equal(experimentFromHash(''), null);
  assert.equal(experimentFromHash('#other=1'), null);
});

test('P6: 分享码重建的模拟与原局完全一致（确定性核心承诺）', () => {
  const code = encodeExperiment(exp);
  const rebuilt = decodeExperiment(code);
  const a = new Simulation(exp);
  const b = new Simulation(rebuilt);
  a.runFor(6);
  b.runFor(6);
  assert.equal(a.stateChecksum(), b.stateChecksum());
  assert.deepEqual(a.commandLog, b.commandLog);
});

test('P6: 运行中点燃的命令被记录且可复现', () => {
  const base = {
    seed: 888,
    width: 300,
    height: 180,
    entities: [{ t: 'firecracker', x: 100, y: 176 }],
    commands: [],
  };
  const sim = new Simulation(base);
  for (let i = 0; i < 30; i++) sim.step();
  assert.ok(sim.playerIgnite(1), '运行中点燃应成功');
  sim.runFor(3);
  assert.equal(sim.commandLog.length, 1);
  const replay = new Simulation({ ...base, commands: sim.commandLog });
  replay.runFor(sim.tick);
  assert.equal(sim.stateChecksum(), replay.stateChecksum());
});

test('P6: 回放环形缓冲有界且覆盖最近时刻', () => {
  const sc = SCENARIOS.find((s) => s.id === 'case1');
  const sim = new Simulation({ seed: sc.seed, entities: sc.entities });
  const rec = new Recorder(12);
  for (let i = 0; i < 60 * 25; i++) {
    sim.step();
    rec.record(sim);
  }
  const maxFrames = Math.ceil((12 * 60) / SNAPSHOT_INTERVAL);
  assert.ok(rec.frames.length <= maxFrames, `帧数应有界: ${rec.frames.length}`);
  assert.ok(rec.frames[rec.frames.length - 1].tick > 60 * 24, '最后一帧应接近当前时刻');
});

test('P6: 事故报告统计与事件流一致', () => {
  const sc = SCENARIOS.find((s) => s.id === 'case1');
  const sim = new Simulation({ seed: sc.seed, entities: sc.entities });
  sim.runFor(6);
  const report = buildReport(sim, sc);
  const exps = sim.eventLog.filter((e) => e.type === 'explosion');
  assert.equal(report.counts.explosions, exps.length);
  const maxDepth = exps.reduce((m, e) => Math.max(m, e.depth), 0);
  assert.equal(report.counts.chainMax, maxDepth);
  const kos = sim.eventLog.filter((e) => e.type === 'knockout').length;
  assert.equal(report.counts.knockouts, kos);
  assert.match(report.id, /^BBL-/);
  assert.ok(report.quietFor >= 0);
  assert.ok(report.goal, '带目标的场景应返回目标判定');
});
