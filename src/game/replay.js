// 回放与事故报告：回放 = 快照环形缓冲（表现层重演）；
// 报告 = 从事件流统计出来的「事故调查单」（PRD §4 的 THE INCIDENT）。

import { DT } from '../sim/sim.js';

export const SNAPSHOT_INTERVAL = 3; // 每 3 tick 一帧（20Hz）
export const REPLAY_SECONDS = 12;

export class Recorder {
  constructor(maxSeconds = REPLAY_SECONDS) {
    this.maxFrames = Math.ceil((maxSeconds * 60) / SNAPSHOT_INTERVAL);
    this.frames = [];
    this.last = 0; // 上次采样的 tick
  }

  record(sim) {
    if (sim.tick - this.last < SNAPSHOT_INTERVAL) return;
    this.last = sim.tick;
    const bodies = [];
    for (const b of sim.world.bodies) {
      let state = 0;
      if (!b.alive) state = 1;
      else if (b.data?.knocked) state = 2;
      else if (b.data?.frozen) state = 3;
      bodies.push([
        b.id,
        b.kind,
        +b.x.toFixed(2),
        +b.y.toFixed(2),
        +b.angle.toFixed(3),
        state,
        b.data?.etype ?? b.data?.bugType ?? b.data?.propType ?? '',
      ]);
    }
    this.frames.push({ tick: sim.tick, bodies });
    if (this.frames.length > this.maxFrames) this.frames.shift();
  }
}

// 事故报告：连锁、击倒、意外事件、时间线
export function buildReport(sim, scenario = null) {
  const s = sim.stats;
  const explosions = sim.eventLog.filter((e) => e.type === 'explosion');
  const timeline = explosions.slice(-6).map((e) => ({
    t: e.tick * DT,
    depth: e.depth,
    cause: e.cause,
  }));
  const lastEvent = [...sim.eventLog]
    .reverse()
    .find((e) => ['explosion', 'knockout', 'ropeBreak', 'multiKill', 'armorCrack'].includes(e.type));
  const goalDone = scenario?.goal ? scenario.goal(sim) : null;
  return {
    id: 'BBL-' + (sim.seed >>> 0).toString(36).toUpperCase(),
    seed: sim.seed,
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
