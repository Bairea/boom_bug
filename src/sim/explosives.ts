// 爆炸物：小炮仗（原地引信）、冲天炮（竖直上冲）、窜天猴（定向+摆动）。
// 爆炸 = 参数化冲击球：冲量 + 伤害 + 连锁引燃（PRD §11 半物理）。

import { createBody } from './body.js';
import type { Body, ExplosiveBody, ExplosiveData, PropBody, PropData } from './body.js';
import type { Simulation, PendingExplosion } from './sim.js';
import { EXPLOSIVES, PROP } from '../game/catalog.js';
import type { ExplosiveName, ExplosiveSpec, PropName } from '../game/catalog.js';
import { tipEffect, tipMassMul } from './accessories.js';
import { applyDamage, spawnBug } from './bugs.js';
import type { Cause } from './events.js';
import { isBugName } from '../game/catalog.js';
import { dirOf, perp, norm, dist } from './math.js';

export function spawnExplosive(
  sim: Simulation,
  type: ExplosiveName,
  x: number,
  y: number,
  angle = -Math.PI / 2,
  acc: string[] = [],
): ExplosiveBody {
  const spec = EXPLOSIVES[type];
  if (!spec) throw new Error(`未知爆炸物: ${type}`);
  const data: ExplosiveData = {
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
  };
  const body = createBody({
    kind: 'explosive',
    x,
    y,
    angle,
    radius: spec.bodyRadius,
    mass: spec.mass * tipMassMul(acc),
    restitution: 0.3,
    friction: 0.8,
    data,
  }) as ExplosiveBody;
  sim.world.add(body);
  sim.ents.push(body);
  return body;
}

export function spawnProp(sim: Simulation, type: PropName, x: number, y: number): PropBody {
  const spec = PROP[type];
  const data: PropData = {
    propType: type,
    // 初始位置在舞台顶部的道具（礼盒等）永远是静态地形；其余落到地面后转静态，
    // 使地面上形成稳定的材质/平台层（见爆炸结算里的"落地转静态"）
    staticPinned: y < 168,
    hp: spec.hp,
    maxHp: spec.hp ?? 0,
    waterZone: !!spec.water,
    oilZone: !!spec.oil,
    materialZone: !!(spec.slippery || spec.sand), // 冰面/沙坑是"地面材质"，不是障碍物
    slippery: !!spec.slippery,
    sand: !!spec.sand,
    bouncy: !!spec.bouncy,
    // 礼盒内胆：生成时用种子 RNG 决定（确定性保持，分享码可复现）
    children: spec.children
      ? [sim.rng.pick(['roach', 'locust', 'fly', 'snail'] as const), sim.rng.pick(['roach', 'locust'] as const), 'firecracker']
      : null,
  };
  const body = createBody({
    kind: 'prop',
    x,
    y,
    radius: spec.radius,
    mass: spec.mass,
    static: true,
    restitution: spec.soft ? 0.02 : spec.brittle ? 0.1 : spec.bouncy ? 0.85 : 0.2,
    friction: spec.soft ? 1.4 : 0.8,
    data,
  }) as PropBody;
  sim.world.add(body);
  sim.ents.push(body);
  return body;
}

// 玻璃砖碎裂：化作 3 块动态碎片飞散；礼盒炸开：弹出内胆（PRD §15 套娃）
function shatterProp(sim: Simulation, body: PropBody): void {
  body.alive = false;
  sim._record({ type: 'propBreak', x: body.x, y: body.y, propType: body.data.propType });
  const children = body.data.children;
  if (children) {
    // 礼盒：内胆在原地弹出（内胆炮仗未点燃 —— 会被同一波冲击波殉爆点燃）
    for (const childType of children) {
      if (isBugName(childType)) {
        spawnBug(sim, childType, body.x + sim.rng.range(-6, 6), body.y - 4);
      } else if (EXPLOSIVES[childType as ExplosiveName]) {
        spawnExplosive(sim, childType as ExplosiveName, body.x + sim.rng.range(-5, 5), body.y - 3, -Math.PI / 2, []);
      }
    }
    return;
  }
  for (let i = 0; i < 3; i++) {
    const angle = -Math.PI / 2 + (i - 1) * 0.8;
    const shard = spawnProp(sim, 'debris', body.x + (i - 1) * 4, body.y - 2);
    shard.static = false;
    shard.invMass = 1 / shard.mass;
    shard.vx = Math.cos(angle) * sim.rng.range(80, 200);
    shard.vy = Math.sin(angle) * sim.rng.range(120, 260);
    shard.angVel = sim.rng.range(-10, 10);
  }
}

export function igniteExplosive(sim: Simulation, body: ExplosiveBody, fuseSec: number | null = null): void {
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
export function stepExplosives(sim: Simulation, dt: number): void {
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
      // 落水：引信熄灭成哑弹（可被再次点燃/殉爆）
      if (inWater(w, b)) {
        d.lit = false;
        d.fuse = -1;
        d.doused = true;
        sim._record({ type: 'douse', id: b.id, x: b.x, y: b.y });
        continue;
      }
      // 末期乱蹦：引信火花让它抽跳（不可预测感）
      if (d.fuse > 0 && d.fuse < 0.45 && !d.glued && isGroundedExplosive(w, b)) {
        if (sim.rng.float() < 0.18) {
          b.vx += sim.rng.range(-45, 45);
          b.vy -= sim.rng.range(25, 70);
        }
      }
      if (d.fuse <= 0) {
        queueExplosion(sim, b, spec, 'fuse');
        continue;
      }
      // 被扔出去的燃烧弹：高速飞行中撞上任何东西即刻起爆（不穿透虫子）
    }

    // 火箭类：落水直接熄火坠毁（不再推进/起爆）
    if (inWater(w, b) && d.burn > 0) {
      d.burn = 0;
      d.fuse = Infinity;
      d.doused = true;
      sim._record({ type: 'douse', id: b.id, x: b.x, y: b.y });
      continue;
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
        const wob = Math.sin(sim.time * 21 + d.wobblePhase) * (spec.wobble ?? 0);
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

function inWater(w: { bodies: Body[] }, b: { x: number; y: number }): boolean {
  for (const z of w.bodies) {
    if (z.alive && z.data.waterZone && dist(b.x, b.y, z.x, z.y) < z.radius) return true;
  }
  return false;
}

function inWaterPos(w: { bodies: Body[] }, x: number, y: number): boolean {
  for (const z of w.bodies) {
    if (z.alive && z.data.waterZone && dist(x, y, z.x, z.y) < z.radius) return true;
  }
  return false;
}

function isGroundedExplosive(w: { height: number }, b: { y: number; radius: number }): boolean {
  return b.y >= w.height - b.radius - 1.5;
}

function hitSomething(w: { bodies: Body[]; width: number; height: number }, b: ExplosiveBody): boolean {
  // 炮仗（燃烧弹）：只算撞到"东西"——地面/天花板是正常滚动面，不算撞击
  for (const o of w.bodies) {
    if (o === b || !o.alive || o.data.waterZone || o.data.oilZone || o.data.materialZone) continue; // 水/油盆/冰面/沙坑是非实体区域
    if (dist(b.x, b.y, o.x, o.y) < b.radius + o.radius + 0.5) return true;
  }
  if (b.data.etype === 'firecracker') return false;
  // 火箭：撞墙（位置被墙解算夹住即视为接触）
  const m = 1.2;
  if (b.x <= b.radius + m || b.x >= w.width - b.radius - m) return true;
  if (b.y <= b.radius + m || b.y >= w.height - b.radius - m) return true;
  return false;
}

// 道具每步：木板燃烧（周期灼烧周围虫子，烧完化为灰；落水熄灭）
// + 被炸飞的地面道具重新落地 → 转回静态，恢复"稳定材质层"语义
export function stepProps(sim: Simulation, dt: number): void {
  const w = sim.world;
  for (const b of w.bodies) {
    // 落地沉降：仅在静止贴地时才固化，避免把还在飞的碎片钉在半空
    if (b.alive && b.data.airborne && sim.tick >= (b.data.settleAfterTick ?? 0)) {
      if (b.y >= w.height - b.radius - 0.6 && Math.hypot(b.vx, b.vy) < 25) {
        b.vx = 0;
        b.vy = 0;
        b.angVel = 0;
        b.static = true;
        b.invMass = 0;
        b.data.airborne = false;
      }
    }
    if (!b.alive || b.kind !== 'prop' || !b.data.burning) continue;
    const p = b.data;
    if (inWater(w, b)) {
      p.burning = false;
      sim._record({ type: 'douse', id: b.id, x: b.x, y: b.y });
      continue;
    }
    p.burnT = (p.burnT ?? 0) - dt;
    p.fireTick = (p.fireTick ?? 0) - dt;
    if (p.fireTick <= 0) {
      p.fireTick = 0.4;
      sim._record({ type: 'fireTick', x: b.x, y: b.y });
      for (const o of w.bodies) {
        if (!o.alive || o === b) continue;
        if (dist(b.x, b.y, o.x, o.y) >= 14 + o.radius) continue;
        if (o.kind === 'bug') {
          if (!o.data.knocked) applyDamage(sim, o, 8, 0.15, 'fire');
        } else if (o.kind === 'prop' && o.data.oilZone && !o.data.burning) {
          o.data.burning = true;
          o.data.burnT = 3;
          o.data.fireTick = 0;
        } else if (o.kind === 'prop' && o.data.hp != null) {
          // 火势蔓延：灼烧范围内的可破坏道具（木板续燃/玻璃炸裂/礼盒弹胆）
          o.data.hp -= 8;
          if (o.data.hp <= 0) {
            shatterProp(sim, o);
          } else if (PROP[o.data.propType]?.flammable && !o.data.burning) {
            o.data.burning = true;
            o.data.burnT = 2.5;
            o.data.fireTick = 0.3;
            sim._record({ type: 'fireTick', x: o.x, y: o.y });
          }
        }
      }
    }
    if ((p.burnT ?? 0) <= 0) {
      b.alive = false;
      sim._record({ type: 'propBreak', x: b.x, y: b.y, propType: p.propType });
    }
  }
}

// 撞击接触的统一处理：大头针钉住 / 胶水粘附 / 直接起爆（供解算时刻的接触事件调用）
export function handleExplosiveContact(sim: Simulation, body: Body): void {
  if (!body.alive || body.kind !== 'explosive') return;
  const d = body.data;
  if (!d.lit || d.exploded) return;
  if (d.stuck > 0 || d.glued || d.stuckDone) return; // 已在钉住/粘附流程中
  const spec = EXPLOSIVES[d.etype];
  const eff = tipEffect(d.acc);
  if (eff.stick > 0) {
    d.stuck = eff.stick;
    d.stuckDone = true;
    d.frozen = true;
    sim._record({ type: 'pinStick', id: body.id, x: body.x, y: body.y });
  } else if (eff.glue) {
    d.glued = true;
    d.frozen = true;
    sim._record({ type: 'glueStick', id: body.id, x: body.x, y: body.y });
  } else {
    queueExplosion(sim, body, spec, 'impact');
  }
}

export function queueExplosion(sim: Simulation, body: ExplosiveBody, spec: ExplosiveSpec, cause: Cause): void {
  if (body.data.exploded) return;
  body.data.exploded = true;
  body.alive = false;
  const depth = body.data.chainDepth || 0;
  const eff = tipEffect(body.data.acc);
  const ex: PendingExplosion = {
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
  };
  sim.pendingExplosions.push(ex);
}

// post 钩子：结算本 tick 的所有爆炸
export function processExplosions(sim: Simulation): void {
  const queue = sim.pendingExplosions;
  sim.pendingExplosions = [];
  for (const ex of queue) {
    const depth = ex.depth;
    // 水下爆炸被闷熄：威力与伤害大减；油区爆炸则被轰然放大
    if (inWaterPos(sim.world, ex.x, ex.y)) {
      ex.power *= 0.45;
      ex.dmg *= 0.45;
    }
    for (const z of sim.world.bodies) {
      if (z.alive && z.data.oilZone && dist(z.x, z.y, ex.x, ex.y) < z.radius + ex.blastRadius) {
        if (dist(z.x, z.y, ex.x, ex.y) < z.radius) {
          ex.power *= 1.4;
          ex.dmg *= 1.4;
        }
        if (!z.data.burning) {
          z.data.burning = true;
          z.data.burnT = 3;
          z.data.fireTick = 0;
          sim._record({ type: 'fireTick', x: z.x, y: z.y });
        }
      }
    }
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
      // 地面道具被炸离地面 → 转为动态：既有的"重物被推走/掀翻"观感得以保留，
      // 又让地面形成稳定材质层（冰面/沙坑/金属板不再能被爆炸随意推走）
      if (
        b.static &&
        b.kind === 'prop' &&
        b.data.propType !== 'debris' &&
        !b.data.staticPinned &&
        !b.data.materialZone
      ) {
        b.static = false;
        b.invMass = 1 / Math.max(b.mass, 1e-6);
        b.vx += ux * dv * 0.35;
        b.vy += uy * dv * 0.35 - dv * 0.1;
        b.angVel += sim.rng.sign() * sim.rng.range(2, 7) * falloff;
        b.data.airborne = true;
        // 冲量在本步末尾才被积分，下一步才真正离开地面。若在同一 tick 就允许沉降判定，
        // 会把"刚被轰飞的板"原地固化回去 —— 记一个最短滞空，避免这一步被吃掉。
        b.data.settleAfterTick = sim.tick + 2;
      }

      // 连锁引燃：范围内的爆炸物 —— 未点燃的点着（连锁），已点燃的殉爆（立即引爆，代际+1）
      if (b.kind === 'explosive' && !b.data.exploded) {
        if (!b.data.lit) {
          b.data.chainDepth = depth + 1;
          igniteExplosive(sim, b, sim.rng.range(0.04, 0.1));
          sim._record({ type: 'chainIgnite', id: b.id, x: b.x, y: b.y, depth: depth + 1 });
        } else if ((b.data.chainDepth ?? 0) < depth + 1) {
          // 殉爆：冲击波引爆已点燃的炮仗/截断火箭推进，连锁向四周传播
          b.data.chainDepth = depth + 1;
          if (b.data.fuse !== Infinity) b.data.fuse = Math.min(b.data.fuse, 0.02 + sim.rng.range(0, 0.03));
          if (b.data.burn > 0) b.data.burn = Math.min(b.data.burn, 0.04);
          sim._record({ type: 'chainIgnite', id: b.id, x: b.x, y: b.y, depth: depth + 1, sympathetic: true });
        }
      }

      // 伤害虫子（贴着海绵垫的虫被缓冲：伤害减半 —— PRD 案例2 的海绵板构想）
      if (b.kind === 'bug') {
        const before = b.data.knocked;
        let dmg = ex.dmg * falloff;
        for (const o of sim.world.bodies) {
          if (o.alive && o.kind === 'prop' && o.data.propType === 'sponge') {
            if (dist(b.x, b.y, o.x, o.y) < o.radius + b.radius + 1) {
              dmg *= 0.5;
              break;
            }
          }
        }
        applyDamage(sim, b, dmg, ex.pierce, ex.cause);
        if (!before && b.data.knocked) blastKills++;
      }
      // 可破坏道具（玻璃砖）：受伤 → 裂纹 → 碎裂；木板：受伤 → 引燃
      if (b.kind === 'prop' && b.data.hp != null) {
        b.data.hp -= ex.dmg * falloff;
        if (b.data.hp <= 0) {
          shatterProp(sim, b);
        } else {
          if (!b.data.cracked && b.data.maxHp > 0 && b.data.hp < b.data.maxHp * 0.5) {
            b.data.cracked = true;
            sim._record({ type: 'propCrack', x: b.x, y: b.y, propType: b.data.propType });
          }
          if (b.data.hp < b.data.maxHp && PROP[b.data.propType]?.flammable && !b.data.burning) {
            b.data.burning = true;
            b.data.burnT = 2.5;
            b.data.fireTick = 0;
            sim._record({ type: 'ignite', id: b.id, x: b.x, y: b.y });
          }
        }
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
