import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { World } from '../src/sim/world.js';

test('R11: 爆炸烧掉范围内的黏液（范围外保留）', () => {
  const sim = new Simulation({ seed: 5, entities: [{ t: 'firecracker', x: 100, y: 176, delay: 0 }] });
  // 爆点附近两块 + 远处一块
  sim.world.addSlime(110, 177, 6, 30);
  sim.world.addSlime(130, 177, 6, 30);
  sim.world.addSlime(260, 177, 6, 30);
  sim.runFor(2);
  const burn = sim.eventLog.find((e) => e.type === 'slimeBurn');
  assert.ok(burn, '应有烧黏液事件');
  assert.equal(burn.count, 2, '近处两块被烧掉');
  assert.equal(sim.world.slime.length, 1, '远处黏液保留');
  assert.equal(sim.world.slime[0].x, 260);
});

test('R11: 烧黏液不破坏确定性（双跑一致）', () => {
  const run = () => {
    const sim = new Simulation({
      seed: 88,
      entities: [
        { t: 'snail', x: 60, y: 176 },
        { t: 'firecracker', x: 120, y: 176, delay: 0.3 },
      ],
    });
    sim.runFor(3);
    return sim.stateChecksum();
  };
  assert.equal(run(), run());
});
