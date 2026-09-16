// 回放与事故报告：回放 = 快照环形缓冲（表现层重演）；
// 报告 = 从事件流统计出来的「事故调查单」（PRD §4 的 THE INCIDENT）。

import { DT } from '../sim/sim.js';
import type { Simulation, SimStats } from '../sim/sim.js';
import type { Body } from '../sim/body.js';
import type { Cause, ExplosionEvent, RecordedEvent } from '../sim/events.js';
import type { Scenario, GoalResult } from './scenario.js';
import type { BestRecord } from './records.js';

export const SNAPSHOT_INTERVAL = 3; // 每 3 tick 一帧（20Hz）
export const REPLAY_SECONDS = 12;

// 快照里的一行：[id, kind, x, y, angle, state(0活/1消耗/2击倒/3冻结), 类型名]
export type SnapshotRow = [number, string, number, number, number, number, string];

export interface ReplayFrame {
  tick: number;
  bodies: SnapshotRow[];
}

function snapshotState(b: Body): number {
  if (!b.alive) return 1;
  if (b.data.knocked) return 2;
  if (b.data.frozen) return 3;
  return 0;
}

function typeName(b: Body): string {
  if (b.kind === 'explosive') return b.data.etype;
  if (b.kind === 'bug') return b.data.bugType;
  return b.data.propType;
}

export class Recorder {
  maxFrames: number;
  frames: ReplayFrame[] = [];
  last = 0; // 上次采样的 tick

  constructor(maxSeconds = REPLAY_SECONDS) {
    this.maxFrames = Math.ceil((maxSeconds * 60) / SNAPSHOT_INTERVAL);
  }

  record(sim: Simulation): void {
    if (sim.tick - this.last < SNAPSHOT_INTERVAL) return;
    this.last = sim.tick;
    const bodies: SnapshotRow[] = [];
    for (const b of sim.world.bodies) {
      bodies.push([b.id, b.kind, +b.x.toFixed(2), +b.y.toFixed(2), +b.angle.toFixed(3), snapshotState(b), typeName(b)]);
    }
    this.frames.push({ tick: sim.tick, bodies });
    if (this.frames.length > this.maxFrames) this.frames.shift();
  }
}

// 事故标题生成器：从事件流提炼一句"事故简报"（PRD §3 的分享梗）
export function makeTitle(stats: SimStats, eventLog: RecordedEvent[]): string {
  const firstKo = eventLog.find((e): e is Extract<RecordedEvent, { type: 'knockout' }> => e.type === 'knockout');
  const KO_LABELS: Record<string, string> = { roach: '蟑螂', locust: '蝗虫', scarab: '清道夫', snail: '蜗牛' };
  const koLabel = KO_LABELS[firstKo?.bugType ?? ''] ?? '玩具虫';
  if ((stats.explosions ?? 0) === 0) return '什么都没发生……再来一次？';
  if ((stats.chainMax ?? 0) >= 4) return `本世纪连锁惨案 ×${stats.chainMax}`;
  if ((stats.multiKills ?? 0) >= 2) return '连环车祸现场';
  if ((stats.knockouts ?? 0) === 0) return '只炸坏了氛围';
  if ((stats.knockouts ?? 0) === 1 && (stats.explosions ?? 0) <= 2) return `我本来只想炸一只${koLabel}`;
  if ((stats.knockouts ?? 0) === 2 && (stats.explosions ?? 0) <= 3) return '一爆双响纪念';
  if ((stats.knockouts ?? 0) >= 6) return '虫虫灭绝日';
  if ((stats.ropesBroken ?? 0) >= 1 && (stats.knockouts ?? 0) >= 2) return '绳子营救行动失败';
  return '大型失控现场';
}

export interface ReportTimelineEntry {
  t: number;
  depth: number;
  cause: Cause;
}

export interface Report {
  id: string;
  seed: number;
  title: string;
  duration: number;
  firstBlastAt: number;
  quietFor: number;
  counts: {
    explosions: number;
    chainMax: number;
    knockouts: number;
    koByType: Record<string, number>;
    unexpected: number;
    ropesBroken: number;
    pins: number;
    glues: number;
    multiKills: number;
    cracks: number;
  };
  maxPower: number;
  timeline: ReportTimelineEntry[];
  goal: GoalResult | null;
  // main 层回填的本机对照数据
  best?: BestRecord | null;
  lastRun?: BestRecord | null;
  isNewRecord?: boolean;
}

// 事故报告：连锁、击倒、意外事件、时间线
export function buildReport(sim: Simulation, scenario: Scenario | null = null): Report {
  const s = sim.stats;
  const explosions = sim.eventLog.filter((e): e is ExplosionEvent & { tick: number } => e.type === 'explosion');
  const timeline: ReportTimelineEntry[] = explosions.slice(-6).map((e) => ({
    t: e.tick * DT,
    depth: e.depth,
    cause: e.cause,
  }));
  const lastEvent = [...sim.eventLog]
    .reverse()
    .find((e) => ['explosion', 'knockout', 'ropeBreak', 'multiKill', 'armorCrack'].includes(e.type));
  const goalDone = scenario?.goal ? scenario.goal(sim) : null;
  const title = goalDone?.done ? `实验成功 · ${makeTitle(s, sim.eventLog)}` : makeTitle(s, sim.eventLog);
  return {
    id: 'BBL-' + (sim.seed >>> 0).toString(36).toUpperCase(),
    seed: sim.seed,
    title,
    duration: sim.tick * DT,
    firstBlastAt: (explosions[0]?.tick ?? 0) * DT,
    quietFor: lastEvent ? (sim.tick - lastEvent.tick) * DT : sim.tick * DT,
    counts: {
      explosions: s.explosions,
      chainMax: s.chainMax,
      knockouts: s.knockouts,
      koByType: s.koByType ?? {},
      unexpected: sim.unexpectedCount(),
      ropesBroken: s.ropesBroken,
      pins: s.pins,
      glues: s.glues,
      multiKills: s.multiKills,
      cracks: s.cracks ?? 0,
    },
    maxPower: s.maxPower,
    timeline,
    goal: goalDone, // {label, done} | null
  };
}
