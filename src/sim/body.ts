// 圆形刚体：一切物体（虫、炮仗、配件挂点）的物理载体。
// 用圆形近似足够表达"玩具盒子"里的混乱，也让确定性可控。
//
// 类型模型：Body 按 kind 判别（bug | explosive | prop），各自的 data 必需字段
// 在 ExplosiveData/BugData/PropData 里收紧；跨 kind 读取的运行时状态（冰面、
// 燃烧、击倒……）放在 EntityDataBase 上做成可选 —— 这样泛型代码里
// `b.data?.waterZone` 这类读取合法，而 `b.kind === 'explosive'` 收窄后
// `d.fuse`、`d.etype` 就是强类型。

import type { BugName, ExplosiveName, PropName } from '../game/catalog.js';

export interface EntityDataBase {
  // —— 跨 kind 读取的运行时状态（可选）——
  frozen?: boolean; // 钉住/粘附：跳过积分
  knocked?: boolean; // 虫子被击倒
  cracked?: boolean; // 装甲/道具裂纹
  burning?: boolean; // 道具燃烧中
  burnT?: number; // 燃烧剩余
  fireTick?: number; // 下次灼烧结算
  hp?: number | null; // 当前耐久（虫子/可破坏道具；null=永固）
  maxHp?: number;
  airborne?: boolean; // 被炸离地的地面道具（动态）
  settleAfterTick?: number; // 最早允许落地固化的 tick
  waterZone?: boolean; // 水盆：非实体浮力区
  oilZone?: boolean; // 油盆：非实体可燃区
  materialZone?: boolean; // 冰面/沙坑：非实体地面材质区（只改脚下摩擦，不挡路）
  slippery?: boolean; // 冰面：脚下打滑
  sand?: boolean; // 沙坑：脚下陷入减速
  bouncy?: boolean; // 金属板：高弹反弹
  aim?: number; // 玩家瞄准方向
  burn?: number; // 火箭推进剩余
  stuck?: number; // 大头针钉住剩余时间
  glued?: boolean; // 胶水粘附
  chainDepth?: number; // 殉爆代际
  exploded?: boolean; // 已入爆炸队列
  lit?: boolean; // 已点燃
  acc?: string[]; // 头部配件（爆炸物）
  fixed?: boolean; // 被固定（虫子）
}

export interface ExplosiveData extends EntityDataBase {
  etype: ExplosiveName;
  aim: number;
  lit: boolean;
  fuse: number;
  burn: number;
  acc: string[];
  wobblePhase: number;
  chainDepth: number;
  stuck: number;
  glued: boolean;
  exploded: boolean;
  armTick: number; // 点燃后短暂"武装延迟"，避免贴地发射误判撞击
  doused?: boolean; // 曾被水浇熄（哑弹标记）
  stuckDone?: boolean; // 本条命已用过钉住机会
}

export interface BugData extends EntityDataBase {
  bugType: BugName;
  hp: number;
  maxHp: number;
  armor: number;
  speed: number;
  state: 'wander' | 'flee' | 'panic';
  stateT: number;
  heading: number;
  jumpT: number;
  slimeT: number;
  knocked: boolean;
  cracked: boolean;
  fixed: boolean;
}

export interface PropData extends EntityDataBase {
  propType: PropName;
  staticPinned: boolean; // 舞台顶部道具（礼盒等）永远静态
  hp: number | null;
  maxHp: number;
  waterZone: boolean;
  oilZone: boolean;
  slippery: boolean;
  sand: boolean;
  bouncy: boolean;
  children: (BugName | ExplosiveName)[] | null; // 礼盒内胆
}

export interface BodyBase {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angVel: number;
  radius: number;
  mass: number;
  // static 的物体不受积分与冲量影响（invMass=0）
  invMass: number;
  restitution: number;
  friction: number; // 地面滚动阻力（每秒衰减比例）
  drag: number; // 空气阻力（每秒速度衰减比例）
  static: boolean;
  alive: boolean;
}

export interface ExplosiveBody extends BodyBase {
  kind: 'explosive';
  data: ExplosiveData;
}
export interface BugBody extends BodyBase {
  kind: 'bug';
  data: BugData;
}
export interface PropBody extends BodyBase {
  kind: 'prop';
  data: PropData;
}
export type Body = ExplosiveBody | BugBody | PropBody;

let NEXT_ID = 1;
export function resetBodyIds(): void {
  NEXT_ID = 1;
}

export interface BodyOptions {
  kind?: 'bug' | 'explosive' | 'prop';
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  angle?: number;
  radius?: number;
  mass?: number;
  static?: boolean;
  restitution?: number;
  friction?: number;
  drag?: number;
  data?: EntityDataBase;
}

export function createBody(opts: BodyOptions = {}): Body {
  const radius = opts.radius ?? 3;
  const mass = opts.mass ?? 1;
  const isStatic = !!opts.static;
  return {
    id: NEXT_ID++,
    kind: opts.kind ?? 'prop',
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    vx: opts.vx ?? 0,
    vy: opts.vy ?? 0,
    angle: opts.angle ?? 0,
    angVel: 0,
    radius,
    mass,
    invMass: isStatic ? 0 : 1 / Math.max(mass, 1e-6),
    restitution: opts.restitution ?? 0.35,
    friction: opts.friction ?? 0.85,
    drag: opts.drag ?? 0.1,
    static: isStatic,
    alive: true,
    // 各类型自用数据（引信、AI 状态、配件…）
    data: opts.data ?? {},
  } as Body;
}

// 半隐式欧拉积分一步
export function integrateBody(b: Body, dt: number, gravity: number): void {
  if (b.static || b.data.frozen) return;
  b.vy += gravity * dt;
  const airKeep = Math.max(0, 1 - b.drag * dt);
  b.vx *= airKeep;
  b.vy *= airKeep;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.angle += b.angVel * dt;
  b.angVel *= Math.max(0, 1 - 3 * dt);
}
