import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { createBody, resetBodyIds } from '../src/sim/body.js';
import { checksum } from '../src/sim/math.js';

const DT = 1 / 60;

function runSteps(world, n, hooks) {
  for (let i = 0; i < n; i++) world.step(DT, hooks);
}

test('P1: 自由落体后落地静止在盒内', () => {
  resetBodyIds();
  const w = new World();
  const b = w.add(createBody({ kind: 'ball', x: 150, y: 20, radius: 3, mass: 1 }));
  runSteps(w, 60 * 3);
  assert.ok(b.y > 170 && b.y <= 177.01, `y=${b.y}`);
  assert.ok(Math.abs(b.vy) < 20, `vy=${b.vy}`);
  assert.equal(b.x, 150);
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
});

test('P1: 等质量弹性对撞动量守恒', () => {
  resetBodyIds();
  const w = new World();
  const a = w.add(createBody({ x: 100, y: 100, vx: 100, restitution: 1, drag: 0, friction: 0 }));
  const b = w.add(createBody({ x: 120, y: 100, restitution: 1, drag: 0, friction: 0 }));
  const p0 = a.vx + b.vx;
  runSteps(w, 60);
  const p1 = a.vx + b.vx;
  assert.ok(Math.abs(p0 - p1) < 0.5, `p0=${p0} p1=${p1}`);
  assert.ok(b.vx > 80, `撞后 b 应获得速度, vx=${b.vx}`);
  assert.ok(a.vx < 20, `撞后 a 应近乎停止, vx=${a.vx}`);
});

test('P1: 超高速撞击墙壁仍被约束在盒内', () => {
  resetBodyIds();
  const w = new World();
  const b = w.add(createBody({ x: 150, y: 90, vx: 2000, vy: -1500, radius: 3 }));
  runSteps(w, 120);
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
  assert.ok(b.x >= 3 && b.x <= w.width - 3, `x=${b.x}`);
  assert.ok(b.y >= 3 && b.y <= w.height - 3, `y=${b.y}`);
});

test('P1: 圆堆叠散落后稳定、能量有界', () => {
  resetBodyIds();
  const w = new World();
  w.add(createBody({ x: 150, y: 177, radius: 3 }));
  w.add(createBody({ x: 150, y: 171, radius: 3 }));
  w.add(createBody({ x: 152, y: 165, radius: 3 }));
  runSteps(w, 60 * 5);
  let maxSpeed = 0;
  for (const b of w.bodies) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
    assert.ok(b.x >= 3 && b.x <= w.width - 3 && b.y >= 3 && b.y <= w.height - 3);
    maxSpeed = Math.max(maxSpeed, Math.hypot(b.vx, b.vy));
  }
  assert.ok(maxSpeed < 30, `5秒后应基本静止, maxSpeed=${maxSpeed}`);
});

test('P1: 落地反弹速度衰减（能量损失）', () => {
  resetBodyIds();
  const w = new World();
  const b = w.add(createBody({ x: 150, y: 30, radius: 3, restitution: 0.5 }));
  let bounceSpeed = null;
  runSteps(w, 240, {
    post(world) {
      if (bounceSpeed === null && b.y >= w.height - b.radius - 0.5 && b.vy < -1) {
        bounceSpeed = -b.vy;
      }
    },
  });
  const impact = Math.sqrt(2 * 560 * (180 - 3 - 30));
  assert.ok(bounceSpeed !== null, '应观测到反弹');
  assert.ok(bounceSpeed > impact * 0.35 && bounceSpeed < impact * 0.55, `bounce=${bounceSpeed} impact=${impact}`);
});

test('P1: 相同输入两次模拟校验和一致（确定性）', () => {
  const snapshot = () => {
    resetBodyIds();
    const w = new World();
    w.add(createBody({ x: 60, y: 40, vx: 120 }));
    w.add(createBody({ x: 200, y: 90, vx: -90, radius: 4 }));
    w.add(createBody({ x: 120, y: 20, radius: 2.5, restitution: 0.6 }));
    runSteps(w, 600);
    return checksum(w.bodies.flatMap((b) => [b.x, b.y, b.vx, b.vy]));
  };
  assert.equal(snapshot(), snapshot());
});
