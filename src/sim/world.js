// 盒世界：积分、圆-圆碰撞、圆-墙约束、绳约束。
// 全部确定性：按数组顺序遍历，不用 Math.random / Date.now。

import { integrateBody } from './body.js';
import { clamp, norm, dist } from './math.js';

export class World {
  constructor(opts = {}) {
    this.width = opts.width ?? 300;
    this.height = opts.height ?? 180;
    this.gravity = opts.gravity ?? 560;
    this.wallRestitution = opts.wallRestitution ?? 0.5;
    this.bodies = [];
    this.ropes = []; // {aId, bId, rest, broken}
    this.events = []; // 每步产生的事件，由上层每步清空
  }

  add(body) {
    this.bodies.push(body);
    return body;
  }

  addRope(a, b, rest) {
    const rope = {
      aId: a.id,
      bId: b.id,
      rest: rest ?? Math.max(dist(a.x, a.y, b.x, b.y), 10),
      broken: false,
    };
    this.ropes.push(rope);
    return rope;
  }

  byId(id) {
    return this.bodies.find((b) => b.id === id) ?? null;
  }

  aliveBodies() {
    return this.bodies.filter((b) => b.alive);
  }

  // hooks: { pre(world,dt), post(world,dt) } —— AI/引信在 pre，爆炸结算可在 post
  step(dt, hooks) {
    this.events = [];
    if (hooks?.pre) hooks.pre(this, dt);

    for (const b of this.bodies) integrateBody(b, dt, this.gravity);

    this.solveRopes();
    for (let iter = 0; iter < 2; iter++) this.solveCollisions();
    this.solveWalls(dt);

    if (hooks?.post) hooks.post(this, dt);
  }

  solveRopes() {
    for (const rope of this.ropes) {
      if (rope.broken) continue;
      const a = this.byId(rope.aId);
      const b = this.byId(rope.bId);
      if (!a || !b || !a.alive || !b.alive) {
        rope.broken = true;
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      if (d > rope.rest * 1.8) {
        rope.broken = true;
        this.events.push({ type: 'ropeBreak', aId: a.id, bId: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        continue;
      }
      if (d <= rope.rest) continue;
      const invSum = a.invMass + b.invMass;
      if (invSum <= 0) continue;
      const corr = (d - rope.rest) / d; // 拉伸比例
      const [ux, uy] = [dx / d, dy / d];
      a.x += ux * corr * d * (a.invMass / invSum) * 0.5;
      a.y += uy * corr * d * (a.invMass / invSum) * 0.5;
      b.x -= ux * corr * d * (b.invMass / invSum) * 0.5;
      b.y -= uy * corr * d * (b.invMass / invSum) * 0.5;
    }
  }

  solveCollisions() {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minD = a.radius + b.radius;
        if (Math.abs(dx) > minD || Math.abs(dy) > minD) continue;
        const d = Math.hypot(dx, dy);
        if (d >= minD || d === 0) continue;

        const invSum = a.invMass + b.invMass;
        if (invSum <= 0) continue;

        const nx = dx / d;
        const ny = dy / d;
        const overlap = minD - d;

        // 位置修正（按质量分摊）
        const corr = overlap * 0.8;
        a.x -= nx * corr * (a.invMass / invSum);
        a.y -= ny * corr * (a.invMass / invSum);
        b.x += nx * corr * (b.invMass / invSum);
        b.y += ny * corr * (b.invMass / invSum);

        // 法向冲量
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const e = Math.min(a.restitution, b.restitution);
          const jImp = (-(1 + e) * vn) / invSum;
          a.vx -= jImp * nx * a.invMass;
          a.vy -= jImp * ny * a.invMass;
          b.vx += jImp * nx * b.invMass;
          b.vy += jImp * ny * b.invMass;

          // 切向摩擦（简化库仑：切向冲量 ≤ μ·法向冲量）
          const tx = -ny;
          const ty = nx;
          const vt = rvx * tx + rvy * ty;
          const mu = (a.friction + b.friction) * 0.25;
          let jt = (-vt / invSum) * mu;
          jt = clamp(jt, -Math.abs(jImp) * 0.5, Math.abs(jImp) * 0.5);
          a.vx -= jt * tx * a.invMass;
          a.vy -= jt * ty * a.invMass;
          b.vx += jt * tx * b.invMass;
          b.vy += jt * ty * b.invMass;

          // 自旋调味：切向相对速度带动旋转
          a.angVel += jt * a.invMass * 0.02;
          b.angVel -= jt * b.invMass * 0.02;
        }
      }
    }
  }

  solveWalls(dt) {
    const w = this.width;
    const h = this.height;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const r = b.radius;
      const e = this.wallRestitution;

      if (b.x - r < 0) {
        b.x = r;
        if (b.vx < 0) b.vx = -b.vx * Math.min(e, b.restitution);
        b.vy *= 0.98;
      } else if (b.x + r > w) {
        b.x = w - r;
        if (b.vx > 0) b.vx = -b.vx * Math.min(e, b.restitution);
        b.vy *= 0.98;
      }
      if (b.y - r < 0) {
        b.y = r;
        if (b.vy < 0) b.vy = -b.vy * Math.min(e, b.restitution);
        b.vx *= 0.98;
      } else if (b.y + r > h) {
        b.y = h - r;
        if (b.vy > 0) b.vy = -b.vy * Math.min(0.95, b.restitution); // 地面弹性由物体自身决定
        // 地面滚动阻力
        b.vx *= Math.max(0, 1 - b.friction * dt);
        if (Math.abs(b.vy) < 12) b.vy = 0; // 防止无限微弹
      }
    }
  }
}
