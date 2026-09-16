// 模拟事件流：world/虫 AI/爆炸结算每步产出，上层（录制、报告、表现层）消费。
// 每个事件由 type 判别；tick 由 Simulation._record 统一盖上。

import type { BugName, ExplosiveName, PropName } from '../game/catalog.js';

// 伤害/爆炸成因（报告文案用）
export type Cause = 'fuse' | 'impact' | 'burnout' | 'fire' | 'test';

export interface RopeBreakEvent {
  type: 'ropeBreak';
  aId: number;
  bId: number;
  x: number;
  y: number;
  tick?: number;
}
export interface ExplosiveContactEvent {
  type: 'explosiveContact';
  id: number;
  x: number;
  y: number;
  tick?: number;
}
export interface IgniteEvent {
  type: 'ignite';
  id: number;
  etype?: ExplosiveName;
  x: number;
  y: number;
  tick?: number;
}
export interface DouseEvent {
  type: 'douse';
  id: number;
  x: number;
  y: number;
  tick?: number;
}
export interface ChainIgniteEvent {
  type: 'chainIgnite';
  id: number;
  x: number;
  y: number;
  depth: number;
  sympathetic?: boolean;
  tick?: number;
}
export interface PinStickEvent {
  type: 'pinStick';
  id: number;
  x: number;
  y: number;
  tick?: number;
}
export interface GlueStickEvent {
  type: 'glueStick';
  id: number;
  x: number;
  y: number;
  tick?: number;
}
export interface PropBreakEvent {
  type: 'propBreak';
  x: number;
  y: number;
  propType?: PropName;
  tick?: number;
}
export interface PropCrackEvent {
  type: 'propCrack';
  x: number;
  y: number;
  propType?: PropName;
  tick?: number;
}
export interface FireTickEvent {
  type: 'fireTick';
  x: number;
  y: number;
  tick?: number;
}
export interface ExplosionEvent {
  type: 'explosion';
  x: number;
  y: number;
  power: number;
  blastRadius: number;
  cause: Cause;
  depth: number;
  etype?: ExplosiveName;
  tick?: number;
}
export interface MultiKillEvent {
  type: 'multiKill';
  x: number;
  y: number;
  count: number;
  tick?: number;
}
export interface SlimeBurnEvent {
  type: 'slimeBurn';
  x: number;
  y: number;
  count: number;
  tick?: number;
}
export interface KnockoutEvent {
  type: 'knockout';
  id: number;
  bugType: BugName;
  x: number;
  y: number;
  cause: Cause;
  tick?: number;
}
export interface ArmorCrackEvent {
  type: 'armorCrack';
  id: number;
  x: number;
  y: number;
  tick?: number;
}
export interface FlyTurnEvent {
  type: 'flyTurn';
  id: number;
  x: number;
  y: number;
  tick?: number;
}
export interface LocustJumpEvent {
  type: 'locustJump';
  id: number;
  x: number;
  y: number;
  tick?: number;
}

export type SimEvent =
  | RopeBreakEvent
  | ExplosiveContactEvent
  | IgniteEvent
  | DouseEvent
  | ChainIgniteEvent
  | PinStickEvent
  | GlueStickEvent
  | PropBreakEvent
  | PropCrackEvent
  | FireTickEvent
  | ExplosionEvent
  | MultiKillEvent
  | SlimeBurnEvent
  | KnockoutEvent
  | ArmorCrackEvent
  | FlyTurnEvent
  | LocustJumpEvent;

// 入账后的事件（tick 必有）
export type RecordedEvent = SimEvent & { tick: number };
