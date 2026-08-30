// 发条玩具虫：AI 的目标"不是聪明，而是不可预测"（PRD §12）。
// 被击倒 = 玩具机械故障（翻壳、冒火花、抽搐），不是死亡 —— 玩具世界观（PRD §18）。

import { createBody } from './body.js';
import { BUGS } from '../game/catalog.js';
import { clamp, norm } from './math.js';

export function spawnBug(sim, type, x, y, opts = {}) {
  const spec = BUGS[type];
  if (!spec) throw new Error(`未知虫子类型: ${type}`);
  const body = createBody({
    kind: 'bug',
    x,
    y,
    radius: spec.radius,
    mass: spec.mass,
    restitution: spec.restitution,
    friction: spec.friction,
    static: !!opts.fixed, // 构造期决定，invMass 才会正确归零
    data: {
      bugType: type,
      hp: spec.hp,
      maxHp: spec.hp,
      armor: spec.armor ?? 0,
      speed: sim.rng.range(spec.speed[0], spec.speed[1]),
      state: 'wander',
      stateT: sim.rng.range(0.3, 1.2),
      heading: sim.rng.range(0, Math.PI * 2),
      jumpT: sim.rng.range(0.8, 2.2),
      slimeT: 0,
      knocked: false,
      cracked: false,
      fixed: !!opts.fixed,
    },
  });
  sim.world.add(body);
  sim.ents.push(body);
  return body;
}

export function isGrounded(world, b) {
  return b.y >= world.height - b.radius - 1.5;
}

export function stepBugs(sim, dt) {
  const w = sim.world;
  const floor = w.height;
  for (const b of w.bodies) {
    if (!b.alive || b.kind !== 'bug') continue;
    const d = b.data;
    if (d.knocked) {
      // 故障抽搐：只抖不动
      b.angVel += sim.rng.range(-2, 2) * dt * 30;
      continue;
    }
    if (d.fixed || b.static) continue;

    const threat = sim.lastBlast && sim.tick < sim.lastBlast.until ? sim.lastBlast : null;
    const grounded = isGrounded(w, b);
    const speed = Math.hypot(b.vx, b.vy);

    // 被炸飞/高速翻滚时 AI 短暂"失神"，保留冲量表现
    if (speed > 260 || !grounded) {
      if (b.kind === 'bug' && d.bugType === 'locust') continue; // 蝗虫空中不操控
      if (speed > 260) continue;
    }

    if (d.bugType === 'roach') stepRoach(sim, b, d, threat, dt, w);
    else if (d.bugType === 'locust') stepLocust(sim, b, d, threat, dt, w);
    else if (d.bugType === 'scarab') stepScarab(sim, b, d, dt, w);
    else if (d.bugType === 'snail') stepSnail(sim, b, d, dt, w);
  }
}

function steer(b, heading, speed, dt, accel = 520) {
  const [dx, dy] = norm(Math.cos(heading), Math.sin(heading));
  const wantX = dx * speed;
  const wantY = dy * speed * 0.35; // 地面虫主要横向爬
  b.vx += clamp(wantX - b.vx, -accel * dt, accel * dt);
  b.vy += clamp(wantY - b.vy, -accel * dt, accel * dt);
}

function stepRoach(sim, b, d, threat, dt, w) {
  // 受惊逃离：远离威胁方向 + 抖动
  if (threat) {
    const distT = Math.hypot(b.x - threat.x, b.y - threat.y);
    if (distT < 90) {
      d.state = 'flee';
      d.stateT = sim.rng.range(0.9, 1.5);
      d.heading = Math.atan2(b.y - threat.y, b.x - threat.x) + sim.rng.range(-0.5, 0.5);
    }
  }
  if (d.state === 'flee') {
    d.stateT -= dt;
    steer(b, d.heading, d.speed * 2.1, dt, 900);
    if (d.stateT <= 0) d.state = 'panic';
    return;
  }
  // wander：随机急转
  d.stateT -= dt;
  if (d.stateT <= 0) {
    d.heading += sim.rng.sign() * sim.rng.range(0.8, 2.2);
    d.stateT = sim.rng.range(0.4, 1.2);
    if (sim.rng.float() < 0.18) d.state = 'panic';
    else d.state = 'wander';
  }
  // 贴墙回头
  if (b.x < b.radius + 2) d.heading = 0;
  else if (b.x > w.width - b.radius - 2) d.heading = Math.PI;
  const panic = d.state === 'panic';
  steer(b, d.heading, panic ? d.speed * 1.6 : d.speed, dt);
}

function stepLocust(sim, b, d, threat, dt, w) {
  if (!isGrounded(w, b)) return; // 空中随物理
  d.jumpT -= dt;
  const scared = threat && Math.hypot(b.x - threat.x, b.y - threat.y) < 70;
  if (d.jumpT <= 0 || scared) {
    // 随机方向跳；受惊则背向威胁
    let vx;
    if (scared) {
      vx = Math.sign(b.x - threat.x || sim.rng.sign()) * sim.rng.range(100, 180);
    } else {
      vx = sim.rng.range(-120, 120);
    }
    b.vy = -sim.rng.range(160, 240);
    b.vx += vx;
    d.jumpT = sim.rng.range(0.8, 2.2);
    sim._record({ type: 'locustJump', id: b.id, x: b.x, y: b.y });
  }
}

function stepScarab(sim, b, d, dt, w) {
  // 清道夫：厚重缓慢
  d.stateT -= dt;
  if (d.stateT <= 0) {
    d.heading += sim.rng.sign() * sim.rng.range(0.5, 1.6);
    d.stateT = sim.rng.range(0.8, 2);
  }
  steer(b, d.heading, d.speed, dt, 200);
}

function stepSnail(sim, b, d, dt, w) {
  // 蜗牛：极慢爬行，沿途留下黏液（滑溜地形）
  d.stateT -= dt;
  if (d.stateT <= 0) {
    d.heading += sim.rng.sign() * sim.rng.range(0.6, 1.8);
    d.stateT = sim.rng.range(1.2, 3);
  }
  if (isGrounded(w, b)) {
    steer(b, d.heading, d.speed, dt, 90);
    d.slimeT -= dt;
    if (d.slimeT <= 0 && Math.abs(b.vx) > 4) {
      w.addSlime(b.x, w.height - 2.5, 6.5, 6);
      d.slimeT = 0.22;
    }
  }
}

// 伤害结算：装甲按穿透率折减；hp 归零 → 玩具故障
export function applyDamage(sim, body, amount, pierce, cause) {
  const d = body.data;
  if (!body.alive || d.knocked) return 0;
  const eff = amount * (1 - (d.armor || 0) * (1 - clamp(pierce, 0, 1)));
  d.hp -= eff;
  if (d.armor > 0 && !d.cracked && d.hp < d.maxHp * 0.5) {
    d.cracked = true;
    sim._record({ type: 'armorCrack', id: body.id, x: body.x, y: body.y });
  }
  if (d.hp <= 0) {
    d.knocked = true;
    d.fixed = false;
    body.static = false;
    body.angVel += sim.rng.range(-14, 14);
    sim.stats.knockouts++;
    sim._record({ type: 'knockout', id: body.id, bugType: d.bugType, x: body.x, y: body.y, cause });
  }
  return eff;
}
