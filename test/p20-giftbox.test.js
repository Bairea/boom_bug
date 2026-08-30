import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';

test('R34: 礼物盒被炸开弹出内胆，内胆炮仗被殉爆点燃（套娃爆炸）', () => {
  const sim = new Simulation({
    seed: 888,
    entities: [
      { t: 'giftbox', x: 150, y: 176 },
      { t: 'firecracker', x: 161, y: 176, delay: 0 }, // 贴脸引爆
    ],
  });
  sim.runFor(4);
  const box = sim.ents[0];
  assert.equal(box.alive, false, '礼盒应被炸开');
  const bro = sim.eventLog.find((e) => e.type === 'propBreak' && e.propType === 'giftbox');
  assert.ok(bro, '应有礼盒炸开事件');
  // 内胆：2 虫 + 1 炮仗（未点燃的炮仗会被殉爆点燃 → 第二波爆炸）
  const innerFcs = sim.world.bodies.filter((b) => b.kind === 'explosive');
  assert.ok(innerFcs.length >= 1, '应弹出内胆炮仗');
  assert.ok(sim.stats.explosions >= 2, `套娃应有第二波爆炸, exp=${sim.stats.explosions}`);
  const bugs = sim.world.bodies.filter((b) => b.kind === 'bug');
  assert.ok(bugs.length >= 2, '应弹出内胆虫子');
});

test('R34: 礼盒内容物由种子决定（确定性/分享可复现）', () => {
  const run = () => {
    const sim = new Simulation({ seed: 123, entities: [{ t: 'giftbox', x: 150, y: 176 }] });
    return sim.ents[0].data.children.join(',');
  };
  assert.equal(run(), run());
});
