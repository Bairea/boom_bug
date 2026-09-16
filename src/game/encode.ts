// 分享码：把一整个实验（种子+布置+运行中命令）压成一段 URL hash。
// 确定性模拟保证：拿到码的人重建出同一场事故（PRD §16 的 Replay Code）。

import type { EntityKind } from './catalog.js';

const VERSION = 1;

// 编辑器/分享码里的一个实体摆件
export interface EntitySpec {
  t: string;
  x: number;
  y: number;
  angle?: number;
  acc?: string[];
  fixed?: boolean;
  delay?: number;
  ropes?: [number, number][];
  kind?: EntityKind; // 编辑器自用：摆放时的分类（模拟/分享码不用）
}

// 运行期玩家命令（tick：入账时刻；调度队列里可省略，由队列的 tick 键承担）
export interface IgniteCommand {
  op: 'ignite';
  id: number;
  tick?: number;
}
export interface ThrowCommand {
  op: 'throw';
  x: number;
  y: number;
  vx: number;
  vy: number;
  tick?: number;
}
export type Command = IgniteCommand | ThrowCommand;

// 实验输入携带的命令表：tick 必填（分享码重放的时间线）
export type TimedCommand = (IgniteCommand | ThrowCommand) & { tick: number };

// 一次完整实验的输入（分享码的载荷）
export interface Experiment {
  seed: number;
  width: number;
  height: number;
  entities: EntitySpec[];
  commands?: TimedCommand[];
  custom?: boolean; // 来自分享码而非预设场景
}

// entities: [{t,x,y,angle,acc,fixed,delay,ropes:[[ai,bi]]}]
// commands: 运行期玩家命令
//   {tick, op:'ignite', id}  → [tick,'i',id]
//   {tick, op:'throw', x,y,vx,vy} → [tick,'t',x,y,vx,vy]
export function encodeExperiment({ seed, width, height, entities, commands = [] }: Experiment): string {
  const e = entities.map((s) => [
    s.t,
    +s.x.toFixed(1),
    +s.y.toFixed(1),
    s.angle != null ? +s.angle.toFixed(3) : null,
    s.acc?.length ? s.acc : null,
    s.fixed ? 1 : null,
    s.delay != null ? +s.delay.toFixed(2) : null,
    s.ropes?.length ? s.ropes : null,
  ]);
  const c = commands.map((cmd) =>
    cmd.op === 'throw'
      ? [cmd.tick, 't', +cmd.x.toFixed(1), +cmd.y.toFixed(1), Math.round(cmd.vx), Math.round(cmd.vy)]
      : [cmd.tick, 'i', cmd.id],
  );
  return b64urlEncode(JSON.stringify({ v: VERSION, s: seed >>> 0, w: width, h: height, e, c }));
}

interface WireExperiment {
  v: number;
  s: number;
  w: number;
  h: number;
  e: (string | number | null | (string | number)[][])[][];
  c: (string | number)[][];
}

export function decodeExperiment(code: string): Experiment {
  const obj = JSON.parse(b64urlDecode(code)) as WireExperiment;
  if (obj.v !== VERSION) throw new Error(`不支持的分享码版本: ${obj.v}`);
  return {
    seed: obj.s,
    width: obj.w,
    height: obj.h,
    entities: obj.e.map((row) => ({
      t: row[0] as string,
      x: row[1] as number,
      y: row[2] as number,
      angle: (row[3] as number | null) ?? undefined,
      acc: (row[4] as string[] | null) ?? [],
      fixed: row[5] === 1,
      delay: (row[6] as number | null) ?? undefined,
      ropes: (row[7] as [number, number][] | null) ?? undefined,
    })),
    commands: obj.c.map(decodeCommand),
  };
}

function decodeCommand(row: (string | number)[]): TimedCommand {
  if (row.length === 2) return { tick: row[0] as number, op: 'ignite', id: row[1] as number }; // v1 旧码
  if (row[1] === 't')
    return {
      tick: row[0] as number,
      op: 'throw',
      x: row[2] as number,
      y: row[3] as number,
      vx: row[4] as number,
      vy: row[5] as number,
    };
  return { tick: row[0] as number, op: 'ignite', id: row[2] as number };
}

export function experimentFromHash(hash: string | undefined): Experiment | null {
  const m = /[#&]e=([A-Za-z0-9_-]+)/.exec(hash ?? '');
  return m ? decodeExperiment(m[1]) : null;
}

export function toHash(experiment: Experiment): string {
  return `#e=${encodeExperiment(experiment)}`;
}

// ---- base64url（无填充，URL 安全） ----
function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
