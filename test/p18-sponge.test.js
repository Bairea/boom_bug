import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { World } from '../src/sim/world.js';
import { createBody, resetBodyIds } from '../src/sim/body.js';

test('R27: 海绵垫吸收冲击 —— 落地几乎不弹', () => {
  const dropOn = (spongeX) => {
    resetBodyIds();
    const w = new World();
    if (spongeX != null)
      w.add(
        createBody({
          kind: 'prop',
          x: spongeX,
          y: 174,
          radius: 10,
          restitution: 0.02,
          static: true,
          data: { propType: 'sponge' },
        }),
      );
    const ball = w.add(createBody({ x: spongeX ?? 150, y: 60, radius: 3, restitution: 0.6 }));
    let bounce = 0;
    let landed = false;
    for (let i = 0; i < 240; i++) {
      w.step(1 / 60);
      if (!landed && ball.y >= 180 - 3 - 0.5 - (spongeX != null ? 4 : 0)) landed = true;
      else if (landed && ball.vy < 0) bounce = Math.max(bounce, -ball.vy);
    }
    return bounce;
  };
  const onFloor = dropOn(null);
  const onSponge = dropOn(150);
  assert.ok(onSponge < onFloor * 0.35, `海绵上反弹应大幅衰减: floor=${onFloor.toFixed(0)} sponge=${onSponge.toFixed(0)}`);
});

test('R27: 海绵垫后的虫子爆炸减伤一半', () => {
  const make = (withSponge) =>
    new Simulation({
      seed: 4321,
      entities: [
        { t: 'roach', x: 100, y: 176 },
        ...(withSponge ? [{ t: 'sponge', x: 104, y: 174 }] : []),
        { t: 'firecracker', x: 115, y: 176, delay: 0 }, // dist 15: falloff 0.75 → dmg 33.75 → 裸蟑KO / 海绵17 不KO
      ],
    });
  const bare = make(false);
  const cushioned = make(true);
  bare.runFor(2.5);
  cushioned.runFor(2.5);
  const bareHp = bare.ents[0].data.hp;
  const cushionHp = cushioned.ents[0].data.hp;
  assert.ok(bareHp < 30, `裸蟑螂应受伤, hp=${bareHp}`);
  assert.ok(cushionHp > bareHp + 8, `海绵减伤应显著: bare=${bareHp.toFixed(1)} sponge=${cushionHp.toFixed(1)}`);
  assert.equal(cushioned.ents[0].data.knocked, false, '海绵后不应被击倒');
});
