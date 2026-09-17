// 每日实验：日期 → 种子 + 确定性布局。
// 全世界同一天拿到同一份实验；布局由确定性 RNG 生成（只用规格化运算，
// 见 sim/dmath.ts），任何引擎/任何设备逐位一致 —— 分享码天然兼容，
// 战绩按日期入账，「对照上次」自动变成"和今天上一局比"。

import { Rng } from '../sim/rng.js';
import type { EntitySpec } from './encode.js';

export interface DailyExperiment {
  dateKey: string; // 'YYYYMMDD'（玩家本地时区的"今天"）
  seed: number;
  theme: DailyTheme;
  entities: EntitySpec[];
}

export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// 主题轮换：每天侧重不同的骚味（对玩家是"今天玩什么"的悬念）
const THEMES = ['chain', 'rockets', 'material', 'pest'] as const;
export type DailyTheme = (typeof THEMES)[number];
export const THEME_LABELS: Record<DailyTheme, string> = {
  chain: '连环日',
  rockets: '火箭日',
  material: '材料日',
  pest: '害虫日',
};

const BUGS_GROUND = ['roach', 'locust', 'scarab', 'snail'] as const;
const THEME_PROPS: Record<DailyTheme, readonly string[]> = {
  chain: ['giftbox', 'wood', 'brick'],
  rockets: ['wood', 'glass', 'sponge'],
  material: ['water', 'ice', 'oil', 'sponge', 'sand'],
  pest: ['giftbox', 'glass', 'brick'],
};

export function buildDaily(dateKey: string): DailyExperiment {
  // Knuth 乘法散列：日期 → 32 位种子（imul 保证 32 位确定性）
  const seed = Math.imul(Number(dateKey), 0x9e3779b1) >>> 0;
  const rng = new Rng(seed);
  const theme: DailyTheme = THEMES[Number(dateKey) % THEMES.length];

  const entities: EntitySpec[] = [];
  const add = (e: EntitySpec): void => {
    entities.push(e);
  };
  const clampX = (x: number): number => Math.max(16, Math.min(284, x));

  // 虫阵：6~9 只沿地面铺开（重灾区在中间），害虫日混入空中目标
  const nBug = rng.int(6, 9);
  for (let i = 0; i < nBug; i++) {
    const x = clampX(34 + (i * 236) / Math.max(1, nBug - 1) + rng.range(-9, 9));
    let t: string = rng.pick(BUGS_GROUND);
    if (theme === 'pest') t = i % 2 === 0 ? 'fly' : rng.pick(['locust', 'roach'] as const);
    const y = t === 'fly' ? rng.range(70, 115) : 173;
    const e: EntitySpec = { t, x: +x.toFixed(1), y: +y.toFixed(1) };
    if (t === 'scarab' && rng.float() < 0.5) e.fixed = true;
    add(e);
  }

  // 炮仗阵：2~4 根埋进虫堆（点燃时自动延迟起爆，一开局就有戏）
  const fireIdx: number[] = [];
  const nFire = rng.int(2, 4);
  for (let i = 0; i < nFire; i++) {
    const x = clampX(90 + (i * 120) / Math.max(1, nFire - 1) + rng.range(-12, 12));
    const acc = rng.float() < 0.3 ? ['toothpick'] : [];
    add({ t: 'firecracker', x: +x.toFixed(1), y: 170, acc });
    fireIdx.push(entities.length - 1);
  }

  // 火箭日：窜天猴从侧翼斜射虫堆
  if (theme === 'rockets') {
    const fromLeft = rng.sign() === 1;
    const angle = fromLeft ? -0.45 : Math.PI + 0.45;
    add({ t: 'bottle', x: fromLeft ? 20 : 280, y: 168, angle: +angle.toFixed(3) });
    if (rng.float() < 0.5) add({ t: 'skyrocket', x: +rng.range(120, 180).toFixed(1), y: 170 });
  } else {
    // 其余日子：一件主题道具落在地面（材质/掩体/彩蛋）
    add({ t: rng.pick(THEME_PROPS[theme]), x: +rng.range(50, 250).toFixed(1), y: 170 });
  }

  // 连锁日：把两根炮仗拴在一起 —— 断绳/连爆都是戏
  if (theme === 'chain' && fireIdx.length >= 2) {
    entities[fireIdx[0]].ropes = [
      [fireIdx[0], fireIdx[1]],
    ];
  }

  // 害虫日/火箭日：一只气球吊炮升空（吊炮会聚蝇 —— 空中目标自己送上门）
  if (theme === 'pest' || theme === 'rockets') {
    const bx = clampX(rng.range(60, 240));
    add({ t: 'balloon', x: +bx.toFixed(1), y: 120 });
    const fi = entities.length;
    add({ t: 'firecracker', x: +bx.toFixed(1), y: 140, ropes: [[fi - 1, fi]] });
  }

  return { dateKey, seed, theme, entities };
}
