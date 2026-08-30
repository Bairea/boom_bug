import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';

test('R16: 苍蝇持续悬飞在半空带、不停变向', () => {
  const sim = new Simulation({ seed: 8888, entities: [{ t: 'fly', x: 150, y: 90 }] });
  const fly = sim.ents[0];
  let minY = 999;
  let maxY = -999;
  let turns = 0;
  for (let i = 0; i < 240; i++) {
    sim.step();
    if (!fly.data.knocked) {
      minY = Math.min(minY, fly.y);
      maxY = Math.max(maxY, fly.y);
    }
    turns = sim.stats.jumps * 0 + sim.eventLog.filter((e) => e.type === 'flyTurn').length;
  }
  assert.ok(!fly.data.knocked, '无干扰时苍蝇应存活');
  assert.ok(maxY < 135, `应悬在半空不下地, maxY=${maxY}`);
  assert.ok(minY > 30, `不应撞顶, minY=${minY}`);
  assert.ok(turns >= 8, `应高频变向, turns=${turns}`);
});

test('R16: 苍蝇被击倒后坠落成道具', () => {
  const sim = new Simulation({ seed: 9999, entities: [{ t: 'fly', x: 150, y: 90 }] });
  const fly = sim.ents[0];
  sim.runFor(0.5);
  sim._damage(fly.id, 20, 0.15); // hp14，20 足够击倒
  assert.equal(fly.data.knocked, true);
  sim.runFor(1.5);
  assert.ok(fly.y > 160, `击落后应坠落到地面, y=${fly.y}`);
});

test('R16: 苍蝇加入分享码与确定性', () => {
  const exp = { seed: 3, width: 300, height: 180, entities: [{ t: 'fly', x: 150, y: 90 }], commands: [] };
  const a = new Simulation(exp);
  const b = new Simulation(exp);
  a.runFor(4);
  b.runFor(4);
  assert.equal(a.stateChecksum(), b.stateChecksum());
});
