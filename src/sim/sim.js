// Simulation 门面：把物理、虫 AI、爆炸物、配件拼成一个确定性状态机。
// 输入 = {seed, 盒子尺寸, 实体列表, 命令表}；输出 = 逐步事件流 + 统计。
// 模拟层内部禁止 Math.random / Date.now —— 一切随机走种子 RNG。

import { World } from './world.js';
import { Rng } from './rng.js';
import { resetBodyIds } from './body.js';
import { spawnBug, stepBugs, applyDamage } from './bugs.js';
import {
  spawnExplosive,
  spawnProp,
  igniteExplosive,
  stepExplosives,
  processExplosions,
} from './explosives.js';
import { isTip } from './accessories.js';
import { checksum } from './math.js';

export const DT = 1 / 60;

export class Simulation {
  constructor({ seed = 1, width = 300, height = 180, entities = [], commands = [] } = {}) {
    this.seed = seed >>> 0;
    this.width = width;
    this.height = height;
    resetBodyIds(); // 每个模拟独享 id 空间：分享码里的 id 才能跨会话成立
    this.rng = new Rng(this.seed);
    this.world = new World({ width, height });
    this.ents = []; // 按摆放顺序的实体（与分享码里的索引对应）
    this.tick = 0;
    this.time = 0;
    this.eventLog = [];
    this.eventsThisStep = [];
    this.pendingExplosions = [];
    this.lastBlast = null; // 虫子的威胁感知
    this.stats = {
      explosions: 0,
      chainMax: 0,
      knockouts: 0,
      multiKills: 0,
      pins: 0,
      glues: 0,
      ropesBroken: 0,
      jumps: 0,
      maxPower: 0,
    };
    this.pending = new Map(); // tick -> ops[]
    this.commandLog = []; // 实际执行的点燃命令（分享码用）
    this._spawnEntities(entities);
    for (const c of commands) this.schedule(c.tick, c);
    this.finished = false;
  }

  _spawnEntities(entities) {
    for (const e of entities) {
      if (['roach', 'locust', 'scarab'].includes(e.t)) {
        spawnBug(this, e.t, e.x, e.y, { fixed: !!e.fixed });
      } else if (['firecracker', 'skyrocket', 'bottle'].includes(e.t)) {
        const angle = e.angle ?? -Math.PI / 2;
        const body = spawnExplosive(this, e.t, e.x, e.y, angle, e.acc ?? []);
        if (e.delay != null && e.delay >= 0) {
          this.schedule(Math.round(e.delay * 60), { op: 'ignite', id: body.id });
        }
      } else if (e.t === 'brick') {
        spawnProp(this, 'brick', e.x, e.y);
      }
    }
    // 绳子：按实体索引连接
    for (const e of entities) {
      if (!e.ropes) continue;
      for (const [ai, bi] of e.ropes) {
        const a = this.ents[ai];
        const b = this.ents[bi];
        if (a && b) this.world.addRope(a, b);
      }
    }
  }

  schedule(tick, op) {
    const t = Math.max(1, tick | 0);
    if (!this.pending.has(t)) this.pending.set(t, []);
    this.pending.get(t).push(op);
  }

  // 玩家运行中点击点燃（记录 tick 保证可分享复现）
  playerIgnite(id) {
    const body = this.world.byId(id);
    if (!body || body.kind !== 'explosive' || !body.alive) return false;
    if (body.data.lit) return false;
    // 调度到下一 tick：与分享码重放的执行时点完全一致
    this.schedule(this.tick + 1, { op: 'ignite', id });
    return true;
  }

  _exec(op) {
    if (op.op === 'ignite') {
      const body = this.world.byId(op.id);
      if (body && body.alive && body.kind === 'explosive') {
        igniteExplosive(this, body);
        this.commandLog.push({ op: 'ignite', tick: this.tick, id: op.id });
      }
    }
  }

  step() {
    this.tick++;
    this.time = this.tick * DT;
    const due = this.pending.get(this.tick);
    if (due) for (const op of due) this._exec(op);

    this.eventsThisStep = [];
    this.pendingExplosions = [];
    this.world.step(DT, {
      pre: () => {
        stepBugs(this, DT);
        stepExplosives(this, DT);
      },
    });
    processExplosions(this);
    for (const e of this.world.events) this._record(e);
  }

  _record(e) {
    e.tick = this.tick;
    this.eventsThisStep.push(e);
    this.eventLog.push(e);
    if (e.type === 'pinStick') this.stats.pins++;
    if (e.type === 'glueStick') this.stats.glues++;
    if (e.type === 'ropeBreak') this.stats.ropesBroken++;
    if (e.type === 'locustJump') this.stats.jumps++;
    if (e.type === 'armorCrack') this.stats.cracks = (this.stats.cracks ?? 0) + 1;
    if (e.type === 'knockout') {
      this.stats.koByType = this.stats.koByType ?? {};
      this.stats.koByType[e.bugType] = (this.stats.koByType[e.bugType] ?? 0) + 1;
    }
  }

  runFor(seconds) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) this.step();
    return this;
  }

  // 校验和：确定性测试与"再跑一次对照"用
  stateChecksum() {
    const nums = [];
    for (const b of this.world.bodies) nums.push(b.x, b.y, b.vx, b.vy, b.angle);
    return checksum(nums);
  }

  // 意外事件计数（报告用）：断裂/钉住/粘附/一爆多杀
  unexpectedCount() {
    const s = this.stats;
    return s.ropesBroken + s.pins + s.glues + s.multiKills;
  }

  // 调试辅助：直接伤害某虫（测试装甲公式用）
  _damage(bodyId, amount, pierce) {
    const b = this.world.byId(bodyId);
    if (b) return applyDamage(this, b, amount, pierce, 'test');
  }
}
