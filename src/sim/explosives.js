// 爆炸物：小炮仗（原地引信）、冲天炮（竖直上冲）、窜天猴（定向+摆动）。
// 爆炸 = 参数化冲击球：冲量 + 伤害 + 连锁引燃（PRD §11 半物理）。

import { createBody } from './body.js';
import { EXPLOSIVES, PROP } from '../game/catalog.js';
import { tipEffect, tipMassMul } from './accessories.js';
import { applyDamage } from './bugs.js';
import { dirOf, perp, norm, dist } from './math.js';

export function spawnExplosive(sim, type, x, y, angle = -Math.PI / 2, acc = []) {
  const spec = EXPLOSIVES[type];
  if (!spec) throw new Error(`未知爆炸物: ${type}`);
  const body = createBody({
    kind: 'explosive',
    x,
    y,
    angle,
    radius: spec.bodyRadius,
    mass: spec.mass * tipMassMul(acc),
    restitution: 0.3,
    friction: 0.8,
    data: {
      etype: type,
      aim: angle, // 玩家的瞄准方向（飞行中 angle 会被物理改变）
      lit: false,
      fuse: -1,
      burn: 0,
      acc: [...acc],
      wobblePhase: sim.rng.range(0, Math.PI * 2),
      chainDepth: 0,
      stuck: 0,
      glued: false,
      exploded: false,
      armTick: 0, // 点燃后短暂"武装延迟"，避免贴地发射误判撞击
    },
  });
  sim.world.add(body);
  sim.ents.push(body);
  return body;
}

export function spawnProp(sim, type, x, y) {
  const spec = PROP[type];
  const body = createBody({
    kind: 'prop',
    x,
    y,
    radius: spec.radius,
    mass: spec.mass,
    static: true,
    restitution: 0.2,
    data: { propType: type },
  });
  sim.world.add(body);
  sim.ents.push(body);
  return body;
}

export function igniteExplosive(sim, body, fuseSec = null) {
  const d = body.data;
  if (d.lit || !body.alive) return;
  const spec = EXPLOSIVES[d.etype];
  d.lit = true;
  d.fuse = fuseSec != null ? fuseSec : spec.fuse ? sim.rng.range(spec.fuse[0], spec.fuse[1]) : Infinity;
  d.burn = spec.burn ?? 0;
  d.armTick = sim.tick + 5;
  // 发射初速：窜天猴是"砰"地冲出去的，不是慢慢加速
  if (spec.launchKick) {
    const [kx, ky] = dirOf(body.angle);
    body.vx = kx * spec.launchKick;
    body.vy = ky * spec.launchKick;
  }
  sim._record({ type: 'ignite', id: body.id, etype: d.etype, x: body.x, y: body.y });
}

// pre 钩子：引信计时、推力、撞击检测
export function stepExplosives(sim, dt) {
  const w = sim.world;
  for (const b of w.bodies) {
    if (!b.alive || b.kind !== 'explosive') continue;
    const d = b.data;
    if (!d.lit) continue;
    const spec = EXPLOSIVES[d.etype];

    // 大头针钉住 / 胶水粘附：钉在原地，燃料继续烧
    if (d.stuck > 0 || d.glued) {
      d.frozen = true; // 跳过积分：对抗重力漂移，粘得死死的
      b.vx = 0;
      b.vy = 0;
      if (d.stuck > 0) {
        d.stuck -= dt;
        if (d.stuck <= 0) {
          queueExplosion(sim, b, spec, 'impact');
          continue;
        }
      } else {
        d.burn -= dt;
        if (d.burn <= 0) {
          queueExplosion(sim, b, spec, 'burnout');
          continue;
        }
      }
      continue;
    }

    if (d.etype === 'firecracker') {
      d.fuse -= dt;
      // 末期乱蹦：引信火花让它抽跳（不可预测感）
      if (d.fuse > 0 && d.fuse < 0.45 && !d.glued && isGroundedExplosive(w, b)) {
        if (sim.rng.float() < 0.3) {
          b.vx += sim.rng.range(-55, 55);
          b.vy -= sim.rng.range(30, 90);
        }
      }
      if (d.fuse <= 0) {
        queueExplosion(sim, b, spec, 'fuse');
        continue;
      }
      // 被扔出去的燃烧弹：高速飞行中撞上任何东西即刻起爆（不穿透虫子）
    }

    // 火箭类：推力飞行
    const frozen = d.stuck > 0 || d.glued;
    if (d.burn > 0 && !frozen) {
      d.burn -= dt;
      const [ax, ay] = dirOf(b.angle);
      b.vx += ax * spec.thrust * dt;
      b.vy += ay * spec.thrust * dt;
      if (d.etype === 'bottle') {
        // 横向摆动 + 随机漂移：窜天猴的"不看路"
        const wob = Math.sin(sim.time * 21 + d.wobblePhase) * spec.wobble;
        const [px, py] = perp(ax, ay);
        b.vx += px * wob * dt + sim.rng.range(-45, 45) * dt;
        b.vy += py * wob * dt + sim.rng.range(-45, 45) * dt;
      } else {
        b.angle += sim.rng.range(-0.35, 0.35) * dt; // 冲天炮轻微歪斜
      }
      if (d.burn <= 0) {
        queueExplosion(sim, b, spec, 'burnout');
        continue;
      }
    }

    // 撞击检测：火箭武装后随时；炮仗仅在被扔出去高速飞行时（撞击即炸）
    const flying = d.burn > 0 || d.stuck > 0 || (d.etype === 'firecracker' && Math.hypot(b.vx, b.vy) > 120);
    if (!d.exploded && flying && sim.tick > d.armTick && Math.hypot(b.vx, b.vy) > 80 && hitSomething(w, b)) {
      const eff = tipEffect(d.acc);
      if (eff.stick > 0 && d.stuck === 0 && !d.glued && !d.stuckDone) {
        d.stuck = eff.stick;
        d.stuckDone = true;
        sim._record({ type: 'pinStick', id: b.id, x: b.x, y: b.y });
      } else if (eff.glue && !d.glued) {
        d.glued = true;
        sim._record({ type: 'glueStick', id: b.id, x: b.x, y: b.y });
      } else if (d.stuck <= 0 && !d.glued) {
        const spec2 = EXPLOSIVES[d.etype];
        queueExplosion(sim, b, spec2, 'impact');
      }
    }
  }
}

function isGroundedExplosive(w, b) {
  return b.y >= w.height - b.radius - 1.5;
}

function hitSomething(w, b) {
  // 撞墙（位置被墙解算夹住即视为接触）
  const m = 1.2;
  if (b.x <= b.radius + m || b.x >= w.width - b.radius - m) return true;
  if (b.y <= b.radius + m || b.y >= w.height - b.radius - m) return true;
  // 撞物体（含虫子：大头钉扎进装甲壳/窜天猴直击蟑螂是核心玩法）
  for (const o of w.bodies) {
    if (o === b || !o.alive) continue;
    if (dist(b.x, b.y, o.x, o.y) < b.radius + o.radius + 0.5) return true;
  }
  return false;
}

export function queueExplosion(sim, body, spec, cause) {
  if (body.data.exploded) return;
  body.data.exploded = true;
  body.alive = false;
  const depth = body.data.chainDepth || 0;
  const eff = tipEffect(body.data.acc);
  sim.pendingExplosions.push({
    x: body.x,
    y: body.y,
    power: spec.power,
    blastRadius: spec.blastRadius,
    dmg: spec.dmg,
    cause,
    depth,
    pierce: eff.pierce,
    srcId: body.id,
    etype: body.data.etype,
  });
}

// post 钩子：结算本 tick 的所有爆炸
export function processExplosions(sim) {
  const queue = sim.pendingExplosions;
  sim.pendingExplosions = [];
  for (const ex of queue) {
    const depth = ex.depth;
    sim.stats.explosions++;
    if (depth > sim.stats.chainMax) sim.stats.chainMax = depth;
    if (ex.power > sim.stats.maxPower) sim.stats.maxPower = ex.power;
    let blastKills = 0;

    for (const b of sim.world.bodies) {
      if (!b.alive || b.id === ex.srcId) continue;
      const d = dist(ex.x, ex.y, b.x, b.y);
      if (d > ex.blastRadius) continue;
      const falloff = 1 - d / ex.blastRadius;

      // 冲量：径向 + 随机自旋（轻的东西飞得更远）
      const [ux, uy] = norm(b.x - ex.x, b.y - ex.y);
      const dv = (ex.power * 6 * falloff) / Math.max(b.mass, 0.5);
      if (!b.static) {
        b.vx += ux * dv;
        b.vy += uy * dv - dv * 0.25; // 稍微向上抬，视觉更好看
        b.angVel += sim.rng.sign() * sim.rng.range(4, 14) * falloff;
      }

      // 连锁引燃：范围内的未点燃爆炸物
      if (b.kind === 'explosive' && !b.data.lit) {
        b.data.chainDepth = depth + 1;
        igniteExplosive(sim, b, sim.rng.range(0.04, 0.1));
        sim._record({ type: 'chainIgnite', id: b.id, x: b.x, y: b.y, depth: depth + 1 });
      }

      // 伤害虫子
      if (b.kind === 'bug') {
        const before = b.data.knocked;
        applyDamage(sim, b, ex.dmg * falloff, ex.pierce, ex.cause);
        if (!before && b.data.knocked) blastKills++;
      }
    }

    if (blastKills >= 2) {
      sim.stats.multiKills++;
      sim._record({ type: 'multiKill', x: ex.x, y: ex.y, count: blastKills });
    }
    // 爆炸烧掉范围内的黏液（世界逻辑自洽，确定性保持）
    const before = sim.world.slime.length;
    sim.world.slime = sim.world.slime.filter((p) => dist(p.x, p.y, ex.x, ex.y) > ex.blastRadius * 0.9);
    if (sim.world.slime.length < before) {
      sim._record({ type: 'slimeBurn', x: ex.x, y: ex.y, count: before - sim.world.slime.length });
    }
    sim._record({
      type: 'explosion',
      x: ex.x,
      y: ex.y,
      power: ex.power,
      blastRadius: ex.blastRadius,
      cause: ex.cause,
      depth,
      etype: ex.etype,
    });
    // 威胁源：虫子会感知并逃跑
    sim.lastBlast = { x: ex.x, y: ex.y, until: sim.tick + 54 };
  }
}
