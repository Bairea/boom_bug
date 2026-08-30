import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { World } from '../src/sim/world.js';
import { createBody, resetBodyIds } from '../src/sim/body.js';

test('R9: 蜗牛缓慢爬行并沿途留下黏液', () => {
  const sim = new Simulation({ seed: 4242, entities: [{ t: 'snail', x: 80, y: 176 }] });
  sim.runFor(3);
  const snail = sim.ents[0];
  assert.ok(!snail.data.knocked);
  const moved = Math.abs(snail.x - 80);
  assert.ok(moved > 5 && moved < 60, `应缓慢爬行, moved=${moved}`);
  assert.ok(sim.world.slime.length >= 3, `应留下黏液, n=${sim.world.slime.length}`);
  for (const p of sim.world.slime) {
    assert.ok(p.r > 0 && p.ttl > 0);
  }
});

test('R9: 黏液让物体打滑 —— 同样初速滑得更远', () => {
  const travel = (withSlime) => {
    resetBodyIds();
    const w = new World();
    if (withSlime) {
      // 铺一条黏液带（从 120 往右）
      for (let i = 0; i < 8; i++) w.addSlime(120 + i * 12, 177, 8, 30);
    }
    const b = w.add(createBody({ x: 60, y: 177, vx: 110, friction: 0.9, radius: 2.5 }));
    for (let i = 0; i < 60 * 4; i++) w.step(1 / 60);
    return b.x - 60;
  };
  const dry = travel(false);
  const slimy = travel(true);
  assert.ok(slimy > dry * 1.5, `黏液上应滑更远: dry=${dry.toFixed(1)} slimy=${slimy.toFixed(1)}`);
});

test('R9: 黏液会随时间干掉（World 层语义）', () => {
  const w = new World();
  w.addSlime(100, 177, 6, 1);
  assert.equal(w.slime.length, 1);
  for (let i = 0; i < 90; i++) w.step(1 / 60);
  assert.equal(w.slime.length, 0, 'ttl 过后黏液应消失');
});

test('R9: 蜗牛皮糙肉厚 —— 普通小炮仗炸不倒', () => {
  const sim = new Simulation({
    seed: 99,
    entities: [
      { t: 'snail', x: 150, y: 176 },
      { t: 'firecracker', x: 156, y: 176, delay: 0 },
    ],
  });
  sim.runFor(2.5);
  const snail = sim.ents[0];
  assert.equal(snail.data.knocked, false, 'hp80+armor0.2 不应被单发小炮仗击倒');
  assert.ok(snail.data.hp < 80, `但应受伤, hp=${snail.data.hp}`);
});

test('R9: 蜗牛可被分享码复现', () => {
  const exp = {
    seed: 7,
    width: 300,
    height: 180,
    entities: [{ t: 'snail', x: 120, y: 176 }],
    commands: [],
  };
  const a = new Simulation(exp);
  const b = new Simulation(exp);
  a.runFor(3);
  b.runFor(3);
  assert.equal(a.stateChecksum(), b.stateChecksum());
});
