// 盒世界：积分、圆-圆碰撞、圆-墙约束、绳约束。
// 全部确定性：按数组顺序遍历，不用 Math.random / Date.now。

import { integrateBody } from './body.js';
import type { Body } from './body.js';
import type { SimEvent } from './events.js';
import { clamp, dist, len } from './math.js';

export interface SlimeDrop {
  x: number;
  y: number;
  r: number;
  age: number;
  ttl: number;
}

export interface Rope {
  aId: number;
  bId: number;
  rest: number;
  broken: boolean;
}

export interface WorldOptions {
  width?: number;
  height?: number;
  gravity?: number;
  wallRestitution?: number;
}

export interface StepHooks {
  pre?: (world: World, dt: number) => void;
  post?: (world: World, dt: number) => void;
}

export class World {
  width: number;
  height: number;
  gravity: number;
  wallRestitution: number;
  bodies: Body[] = [];
  ropes: Rope[] = [];
  slime: SlimeDrop[] = [];
  events: SimEvent[] = []; // 每步产生的事件，由上层每步清空

  constructor(opts: WorldOptions = {}) {
    this.width = opts.width ?? 300;
    this.height = opts.height ?? 180;
    this.gravity = opts.gravity ?? 560;
    this.wallRestitution = opts.wallRestitution ?? 0.5;
  }

  addSlime(x: number, y: number, r = 6, ttl = 6): void {
    this.slime.push({ x, y, r, age: 0, ttl });
    if (this.slime.length > 60) this.slime.shift();
  }

  // 物体脚下地面材质：黏液/冰 → 打滑；沙坑 → 陷入减速
  slimeScaleAt(x: number, y: number, radius: number): number {
    for (const s of this.slime) {
      if (dist(s.x, s.y, x, y) < s.r + radius * 0.5) return 0.12;
    }
    for (const b of this.bodies) {
      if (!b.alive) continue;
      // 地面材质区（冰面/沙坑）是静态地形，不能跳过 —— 它们永远不参与积分，
      // 但脚下摩擦必须认它们。waterZone/oilZone 是非实体区，不提供材质。
      if (b.data.waterZone || b.data.oilZone) continue;
      const near = dist(b.x, b.y, x, y) < b.radius + radius * 0.5;
      if (!near) continue;
      if (b.data.slippery) return 0.1;
      if (b.data.sand) return 2.5;
    }
    return 1;
  }

  add<T extends Body>(body: T): T {
    this.bodies.push(body);
    return body;
  }

  addRope(a: Body, b: Body, rest?: number): Rope {
    const rope: Rope = {
      aId: a.id,
      bId: b.id,
      rest: rest ?? Math.max(dist(a.x, a.y, b.x, b.y), 10),
      broken: false,
    };
    this.ropes.push(rope);
    return rope;
  }

  byId(id: number): Body | null {
    return this.bodies.find((b) => b.id === id) ?? null;
  }

  aliveBodies(): Body[] {
    return this.bodies.filter((b) => b.alive);
  }

  // hooks: { pre(world,dt), post(world,dt) } —— AI/引信在 pre，爆炸结算可在 post
  step(dt: number, hooks?: StepHooks): void {
    this.events = [];
    for (const s of this.slime) s.age += dt;
    this.slime = this.slime.filter((s) => s.age < s.ttl);
    this.applyWaterPhysics(dt);
    hooks?.pre?.(this, dt);

    for (const b of this.bodies) {
      if (b.alive) integrateBody(b, dt, this.gravity);
    }

    this.solveRopes();
    for (let iter = 0; iter < 2; iter++) this.solveCollisions();
    this.solveWalls(dt);

    hooks?.post?.(this, dt);
  }

  // 水盆物理：浸入水中的物体受浮力与强阻力（慢动作下沉/上浮）
  applyWaterPhysics(dt: number): void {
    const zones = this.bodies.filter((b) => b.alive && b.data.waterZone);
    if (!zones.length) return;
    for (const b of this.bodies) {
      if (!b.alive || b.data.waterZone) continue;
      for (const z of zones) {
        if (dist(b.x, b.y, z.x, z.y) < z.radius + b.radius * 0.3) {
          // 浮力抵消大半重力 + 强阻力
          b.vy += this.gravity * 0.72 * dt;
          b.vx *= Math.max(0, 1 - 3.2 * dt);
          b.vy *= Math.max(0, 1 - 3.2 * dt);
          break;
        }
      }
    }
  }

  solveRopes(): void {
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
      const d = len(dx, dy) || 1e-9;
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
      // 速度求解：拉紧时消除"继续拉伸"的相对速度 —— 绳才真正传力
      // （气球吊炮仗/冲天炮拖拽虫子都靠它；否则位置修正传不了持续拉力）
      const rvn = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
      if (rvn > 0) {
        const imp = (rvn * 0.85) / invSum; // 0.85：留一点弹性观感
        a.vx += imp * ux * a.invMass;
        a.vy += imp * uy * a.invMass;
        b.vx -= imp * ux * b.invMass;
        b.vy -= imp * uy * b.invMass;
      }
    }
  }

  solveCollisions(): void {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!b.alive) continue;
        // 水盆/油盆/冰面/沙坑是非实体区域（材质区），不参与碰撞
        if (
          a.data.waterZone ||
          a.data.oilZone ||
          a.data.materialZone ||
          b.data.waterZone ||
          b.data.oilZone ||
          b.data.materialZone
        )
          continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minD = a.radius + b.radius;
        if (Math.abs(dx) > minD || Math.abs(dy) > minD) continue;
        const d = len(dx, dy);
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
          // 金属等"高弹面"：取双方较大弹性（普通对仍取较小，保住海绵的软）
          const e =
            a.data.bouncy || b.data.bouncy ? Math.max(a.restitution, b.restitution) : Math.min(a.restitution, b.restitution);
          const jImp = (-(1 + e) * vn) / invSum;
          a.vx -= jImp * nx * a.invMass;
          a.vy -= jImp * ny * a.invMass;
          b.vx += jImp * nx * b.invMass;
          b.vy += jImp * ny * b.invMass;

          // 点燃的爆炸物撞上东西：在解算时刻记录接触（弹性反弹会让下一tick的位置检测漏掉）
          for (const [self] of [
            [a, b],
            [b, a],
          ] as const) {
            if (self.kind === 'explosive' && self.data.lit && !self.data.exploded && Math.abs(vn) > 40) {
              this.events.push({ type: 'explosiveContact', id: self.id, x: self.x, y: self.y });
            }
          }

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

  solveWalls(dt: number): void {
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
        // 地面滚动阻力（黏液上摩擦大减 → 打滑）
        b.vx *= Math.max(0, 1 - b.friction * this.slimeScaleAt(b.x, b.y, b.radius) * dt);
        if (Math.abs(b.vy) < 12) b.vy = 0; // 防止无限微弹
      }
    }
  }
}
