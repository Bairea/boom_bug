import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';

// R54 回归：地面材质区必须在真实局面里生效（而不只是在裸 World 里）。
// 这两条覆盖了 R39 引入但一直没被集成验证的路径。

test('R54: 冰面在真实局面中提供打滑（地面道具被炸后仍固化）', () => {
  const sim = new Simulation({
    seed: 9001,
    entities: [
      { t: 'ice', x: 150, y: 172 },
      { t: 'roach', x: 152, y: 174 },
    ],
  });
  const ice = sim.ents[0];
  assert.equal(ice.static, true, '冰面初始应为静态地形');
  sim.runFor(1);
  assert.equal(ice.static, true, '无爆炸时冰面应保持静态');
  assert.equal(sim.world.slimeScaleAt(150, 172, 3), 0.1, '冰面上应打滑');
});

test('R54: 爆炸把地面道具炸离地面（转动态），落地后重新固化', () => {
  // 场景：金属板旁放一颗引信最短的炮仗。引信在 0.9~1.5s 随机，
  // 所以先跑到爆炸发生（最多 1.5s + 余量），再断言金属板处于"被轰飞"状态。
  const sim = new Simulation({
    seed: 9002,
    entities: [
      { t: 'metal', x: 150, y: 172 },
      { t: 'firecracker', x: 141, y: 172, delay: 0 },
    ],
  });
  const metal = sim.ents[0];
  assert.equal(metal.static, true, '金属板初始应为静态');

  let boomTick = -1;
  for (let i = 0; i < 240 && boomTick < 0; i++) {
    sim.step();
    if (sim.eventsThisStep.some((e) => e.type === 'explosion')) boomTick = sim.tick;
  }
  assert.ok(boomTick > 0, '炮仗应在 4s 内爆炸');
  assert.equal(sim.ents[0].static, false, '被轰飞的金属板应转为动态（可被推走）');

  sim.runFor(4);
  assert.equal(sim.ents[0].static, true, '落地后应重新固化为地形（材质层稳定）');
  assert.ok(Math.abs(sim.ents[0].x - 150) < 40, '板被推走后仍应留在盒内合理范围');
});

