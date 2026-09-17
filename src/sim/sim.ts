// Simulation 门面：把物理、虫 AI、爆炸物、配件拼成一个确定性状态机。
// 输入 = {seed, 盒子尺寸, 实体列表, 命令表}；输出 = 逐步事件流 + 统计。
// 模拟层内部禁止 Math.random / Date.now —— 一切随机走种子 RNG。

import { World } from './world.js';
import { Rng } from './rng.js';
import { resetBodyIds } from './body.js';
import type { Body } from './body.js';
import { spawnBug, stepBugs, applyDamage } from './bugs.js';
import {
  spawnExplosive,
  spawnProp,
  igniteExplosive,
  stepExplosives,
  stepProps,
  processExplosions,
  handleExplosiveContact,
} from './explosives.js';
import { isBugName, isExplosiveName, isPropName } from '../game/catalog.js';
import type { BugName, ExplosiveName } from '../game/catalog.js';
import type { EntitySpec, Command, TimedCommand } from '../game/encode.js';
import type { Cause, RecordedEvent, SimEvent } from './events.js';
import { checksum } from './math.js';

export const DT = 1 / 60;

export interface SimStats {
  explosions: number;
  chainMax: number;
  knockouts: number;
  multiKills: number;
  pins: number;
  glues: number;
  ropesBroken: number;
  jumps: number;
  maxPower: number;
  // 运行中动态累加的口径（?? 0 取用）
  throws?: number;
  cracks?: number;
  propsBroken?: number;
  koByType?: Partial<Record<BugName, number>>;
}

export interface PendingExplosion {
  x: number;
  y: number;
  power: number;
  blastRadius: number;
  dmg: number;
  cause: Cause;
  depth: number;
  pierce: number;
  srcId: number;
  etype: ExplosiveName;
}

// 虫子的威胁感知（最近一次爆炸）
export interface ThreatInfo {
  x: number;
  y: number;
  until: number;
}

export interface SimOptions {
  seed?: number;
  width?: number;
  height?: number;
  entities?: EntitySpec[];
  commands?: TimedCommand[];
}

export class Simulation {
  seed: number;
  width: number;
  height: number;
  rng: Rng;
  world: World;
  ents: Body[] = []; // 按摆放顺序的实体（与分享码里的索引对应）
  tick = 0;
  time = 0;
  eventLog: RecordedEvent[] = [];
  eventsThisStep: RecordedEvent[] = [];
  pendingExplosions: PendingExplosion[] = [];
  lastBlast: ThreatInfo | null = null; // 虫子的威胁感知
  stats: SimStats;
  pending: Map<number, Command[]> = new Map(); // tick -> ops[]
  commandLog: TimedCommand[] = []; // 实际执行的命令（分享码用，tick 必有）
  finished = false;

  constructor({ seed = 1, width = 300, height = 180, entities = [], commands = [] }: SimOptions = {}) {
    this.seed = seed >>> 0;
    this.width = width;
    this.height = height;
    resetBodyIds(); // 每个模拟独享 id 空间：分享码里的 id 才能跨会话成立
    this.rng = new Rng(this.seed);
    this.world = new World({ width, height });
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
    this._spawnEntities(entities);
    for (const c of commands) this.schedule(c.tick, c);
    this.finished = false;
  }

  _spawnEntities(entities: EntitySpec[]): void {
    for (const e of entities) {
      if (isBugName(e.t)) {
        spawnBug(this, e.t, e.x, e.y, { fixed: !!e.fixed });
      } else if (isExplosiveName(e.t)) {
        const angle = e.angle ?? -Math.PI / 2;
        const body = spawnExplosive(this, e.t, e.x, e.y, angle, e.acc ?? []);
        if (e.delay != null && e.delay >= 0) {
          this.schedule(Math.round(e.delay * 60), { op: 'ignite', id: body.id });
        }
      } else if (isPropName(e.t)) {
        spawnProp(this, e.t, e.x, e.y);
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

  schedule(tick: number, op: Command): void {
    const t = Math.max(1, tick | 0);
    if (!this.pending.has(t)) this.pending.set(t, []);
    this.pending.get(t)!.push(op);
  }

  // 玩家运行中点击点燃（记录 tick 保证可分享复现）
  playerIgnite(id: number): boolean {
    const body = this.world.byId(id);
    if (!body || body.kind !== 'explosive' || !body.alive) return false;
    if (body.data.lit) return false;
    // 调度到下一 tick：与分享码重放的执行时点完全一致
    this.schedule(this.tick + 1, { op: 'ignite', id });
    return true;
  }

  // 运行中点击拾取：点击点附近最近的未点燃爆炸物（半径放宽到视觉尺寸的
  // ~2 倍，乱蹦时也点得中）。返回 body id 或 null。
  pickIgnitable(x: number, y: number, r = 14): number | null {
    let best: number | null = null;
    let bestD = r * r;
    for (const b of this.world.bodies) {
      if (!b.alive || b.kind !== 'explosive' || b.data.lit) continue;
      const d = (b.x - x) * (b.x - x) + (b.y - y) * (b.y - y);
      if (d <= bestD) {
        bestD = d;
        best = b.id;
      }
    }
    return best;
  }

  // 玩家运行中扔进一根点燃的炮仗（拖拽向量 → 初速）
  playerThrow(x: number, y: number, vx: number, vy: number): boolean {
    this.schedule(this.tick + 1, { op: 'throw', x: +x.toFixed(1), y: +y.toFixed(1), vx: Math.round(vx), vy: Math.round(vy) });
    return true;
  }

  _exec(op: Command): void {
    if (op.op === 'ignite') {
      const body = this.world.byId(op.id);
      if (body && body.alive && body.kind === 'explosive') {
        igniteExplosive(this, body);
        this.commandLog.push({ op: 'ignite', tick: this.tick, id: op.id });
      }
    } else if (op.op === 'throw') {
      // 运行中玩家扔进一根点燃的炮仗（PRD 案例1 的灵魂操作）
      const body = spawnExplosive(this, 'firecracker', op.x, op.y, 0, []);
      body.vx = op.vx;
      body.vy = op.vy;
      igniteExplosive(this, body, this.rng.range(0.7, 1.1)); // 短引信：扔进去就是找炸
      body.angVel = this.rng.range(-18, 18);
      this.stats.throws = (this.stats.throws ?? 0) + 1;
      this.commandLog.push({ op: 'throw', tick: this.tick, x: op.x, y: op.y, vx: op.vx, vy: op.vy });
    }
  }

  step(): void {
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
        stepProps(this, DT);
      },
    });
    // 解算时刻的撞击接触：钉住/粘附/立即起爆（先于事件流 drain 处理）
    for (const e of this.world.events) {
      if (e.type === 'explosiveContact') {
        const body = this.world.byId(e.id);
        if (body) handleExplosiveContact(this, body);
      }
    }
    processExplosions(this);
    for (const e of this.world.events) {
      if (e.type !== 'explosiveContact') this._record(e);
    }
  }

  _record(e: SimEvent): void {
    const rec = e as RecordedEvent;
    rec.tick = this.tick;
    this.eventsThisStep.push(rec);
    this.eventLog.push(rec);
    if (e.type === 'pinStick') this.stats.pins++;
    if (e.type === 'glueStick') this.stats.glues++;
    if (e.type === 'ropeBreak') this.stats.ropesBroken++;
    if (e.type === 'locustJump') this.stats.jumps++;
    if (e.type === 'armorCrack') this.stats.cracks = (this.stats.cracks ?? 0) + 1;
    if (e.type === 'propBreak') this.stats.propsBroken = (this.stats.propsBroken ?? 0) + 1;
    if (e.type === 'knockout') {
      this.stats.koByType = this.stats.koByType ?? {};
      this.stats.koByType[e.bugType] = (this.stats.koByType[e.bugType] ?? 0) + 1;
    }
  }

  runFor(seconds: number): this {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) this.step();
    return this;
  }

  // 校验和：确定性测试与"再跑一次对照"用
  stateChecksum(): number {
    const nums: number[] = [];
    for (const b of this.world.bodies) nums.push(b.x, b.y, b.vx, b.vy, b.angle);
    return checksum(nums);
  }

  // 意外事件计数（报告用）：断裂/钉住/粘附/一爆多杀
  unexpectedCount(): number {
    const s = this.stats;
    return s.ropesBroken + s.pins + s.glues + s.multiKills;
  }

  // 调试辅助：直接伤害某虫（测试装甲公式用）
  _damage(bodyId: number, amount: number, pierce: number): number {
    const b = this.world.byId(bodyId);
    if (b && b.kind === 'bug') return applyDamage(this, b, amount, pierce, 'test');
    return 0;
  }
}
