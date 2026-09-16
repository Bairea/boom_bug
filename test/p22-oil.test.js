import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';

test('R53: 油盆遇火爆燃，持续灼烧盆内的虫', () => {
  const sim = new Simulation({
    seed: 400,
    entities: [
      { t: 'oil', x: 150, y: 170 },
      { t: 'roach', x: 150, y: 176, fixed: true }, // 泡在油里（固定靶防逃逸干扰）
      { t: 'firecracker', x: 108, y: 176, delay: 0 }, // 42u 外引爆（半径60 内 → 引燃油盆）
    ],
  });
  sim.runFor(3);
  const oil = sim.ents[0];
  const ignited = oil.data.burning || !oil.alive;
  assert.ok(ignited, '油盆应被引燃');
  assert.ok(
    sim.eventLog.some((e) => e.type === 'fireTick'),
    '应有灼烧事件',
  );
  const roach = sim.ents[1];
  assert.ok(roach.data.hp < 30 || roach.data.knocked, `油火应灼烧虫子, hp=${roach.data.hp}`);
});

test('R53: 爆心在油区 → 爆炸威力放大', () => {
  const make = (withOil) =>
    new Simulation({
      seed: 500,
      entities: [
        { t: 'snail', x: 150, y: 176, fixed: true },
        ...(withOil ? [{ t: 'oil', x: 150, y: 170 }] : []),
        { t: 'firecracker', x: 162, y: 176, delay: 0 },
      ],
    });
  const dry = make(false);
  const oiled = make(true);
  dry.runFor(2.5);
  oiled.runFor(2.5);
  const dryHp = dry.ents[0].data.hp;
  const oiledHp = oiled.ents[0].data.hp;
  assert.ok(oiledHp < dryHp, `油区爆炸应更痛: dry=${dryHp.toFixed(1)} oiled=${oiledHp.toFixed(1)}`);
});

test('R53: 水能扑灭燃烧的油盆', () => {
  const sim = new Simulation({
    seed: 600,
    entities: [
      { t: 'oil', x: 150, y: 170 },
      { t: 'firecracker', x: 108, y: 176, delay: 0 },
      { t: 'water', x: 260, y: 160 }, // 水先放远处
    ],
  });
  sim.runFor(1.6);
  const oil = sim.ents[0];
  assert.ok(oil.data.burning === true, '油应先被引燃');
  const water = sim.ents[2];
  water.x = 150; // 把水盆挪到油上（模拟布置）
  water.y = 168;
  sim.runFor(0.5);
  assert.equal(oil.data.burning, false, '水应扑灭油火');
});
