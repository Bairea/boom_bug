import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { World } from '../src/sim/world.js';
import { createBody, resetBodyIds } from '../src/sim/body.js';

test('R39: 木板被炸点燃 → 持续灼烧周围虫子 → 烧尽消失', () => {
  const sim = new Simulation({
    seed: 606,
    entities: [
      { t: 'wood', x: 150, y: 174 },
      { t: 'roach', x: 158, y: 176 }, // 灼烧范围内
      { t: 'firecracker', x: 162, y: 174, delay: 0 }, // 贴脸引爆引燃木板
    ],
  });
  sim.runFor(2);
  const wood = sim.ents[0];
  assert.ok(sim.eventLog.some((e) => e.type === 'fireTick'), '应有灼烧事件');
  const roach = sim.ents[1];
  const roachHurt = roach.data.hp < 30 || roach.data.knocked;
  assert.ok(roachHurt, `灼烧应伤及蟑螂, hp=${roach.data.hp}`);
  sim.runFor(3);
  assert.equal(wood.alive, false, '木板应烧尽消失');
  assert.ok(sim.eventLog.some((e) => e.type === 'propBreak' && e.propType === 'wood'), '应有烧尽事件');
});

test('R39: 冰面语义 —— 覆盖区域内地面摩擦大减', () => {
  resetBodyIds();
  const w = new World();
  w.add(createBody({ kind: 'prop', x: 140, y: 174, radius: 12, static: true, data: { slippery: true, propType: 'ice' } }));
  assert.equal(w.slimeScaleAt(140, 170, 3), 0.1, '冰面上的物体应打滑');
  assert.equal(w.slimeScaleAt(60, 170, 3), 1, '冰面外正常摩擦');
});

test('R39: 金属板高弹 —— 反弹显著高于普通地面', () => {
  const bounce = (metalX) => {
    resetBodyIds();
    const w = new World();
    if (metalX != null) {
      w.add(createBody({ kind: 'prop', x: metalX, y: 170, radius: 9, restitution: 0.85, static: true, data: { propType: 'metal', bouncy: true } }));
    }
    const ball = w.add(createBody({ x: metalX ?? 150, y: 60, radius: 3, restitution: 0.2 }));
    let maxBounce = 0;
    let landed = false;
    for (let i = 0; i < 200; i++) {
      w.step(1 / 60);
      const floorY = metalX != null && Math.abs(ball.x - metalX) < 12 ? 170 - 9 - 3 : 180 - 3;
      if (!landed && ball.y >= floorY - 1) landed = true;
      else if (landed && ball.vy < 0) maxBounce = Math.max(maxBounce, -ball.vy);
    }
    return maxBounce;
  };
  const onFloor = bounce(null);
  const onMetal = bounce(150);
  assert.ok(onMetal > onFloor * 1.4, `金属板应弹更高: floor=${onFloor.toFixed(0)} metal=${onMetal.toFixed(0)}`);
});

test('R40: 燃烧的木板落水熄灭', () => {
  const sim = new Simulation({
    seed: 707,
    entities: [
      { t: 'wood', x: 150, y: 174 },
      { t: 'firecracker', x: 162, y: 174, delay: 0 },
      { t: 'water', x: 250, y: 150 }, // 水先放远处
    ],
  });
  sim.runFor(2.2);
  const wood = sim.ents[0];
  const water = sim.ents[2];
  assert.ok(wood.data.burning === true, '木板应被引燃');
  // 把水盆挪过来（模拟玩家布置/推动）
  water.x = 150;
  water.y = 170;
  sim.runFor(0.5);
  assert.equal(wood.data.burning, false, '落水应熄灭');
  assert.ok(sim.eventLog.some((e) => e.type === 'douse'), '应有熄灭事件');
});
