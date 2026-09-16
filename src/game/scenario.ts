// 预设场景：对应 PRD 的三个案例 + 自由实验。每个场景可带一个"实验目标"。

import type { Simulation } from '../sim/sim.js';
import type { EntitySpec } from './encode.js';

const FLOOR = 176;

export interface GoalResult {
  label: string;
  done: boolean;
  bonus?: string | null;
}

export type GoalFn = (sim: Simulation) => GoalResult;

export interface Scenario {
  id: string;
  label: string;
  desc: string;
  seed: number;
  maxThrows?: number;
  entities: EntitySpec[];
  goal?: GoalFn;
}

function roachRow(count: number, x0: number, gap: number): EntitySpec[] {
  return Array.from({ length: count }, (_, i): EntitySpec => ({ t: 'roach', x: x0 + i * gap, y: FLOOR }));
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'free',
    label: '自由实验',
    desc: '空盒子。摆放后「点燃」；运行中空白处拖拽可扔进点着的炮仗；空格=点燃/重来。',
    seed: 20260830,
    entities: [],
  },
  {
    id: 'case1',
    label: '案例1 · 连环风暴',
    desc: '满盒玩具虫 + 冲天炮拖拽蝗虫 + 四散炮仗。目标：连锁 ≥ 3（试试往虫堆里再扔一根点着的！）',
    seed: 4103,
    entities: [
      ...roachRow(8, 30, 32), // 0-7 蟑螂
      { t: 'locust', x: 90, y: FLOOR }, // 8
      { t: 'locust', x: 205, y: FLOOR }, // 9 ← 绑冲天炮的倒霉蛋
      { t: 'skyrocket', x: 205, y: FLOOR, ropes: [[10, 9]] }, // 10 冲天炮拖拽蝗虫
      { t: 'firecracker', x: 60, y: FLOOR }, // 11 互相在殉爆半径内 → 可连环
      { t: 'firecracker', x: 105, y: FLOOR }, // 12
      { t: 'firecracker', x: 150, y: FLOOR }, // 13
      { t: 'firecracker', x: 195, y: FLOOR }, // 14
      { t: 'bottle', x: 270, y: 100, angle: -2.2 }, // 15
    ],
    goal: (sim) => ({ label: '连锁反应 ≥ 3', done: sim.stats.chainMax >= 3 }),
  },
  {
    id: 'case2',
    label: '案例2 · 蟑螂狩猎',
    desc: '大头针窜天猴瞄准跑动的蟑螂；也可以在必经之路上埋炮仗。目标：击倒 ≥ 4 只蟑螂。',
    seed: 777,
    entities: [
      ...roachRow(8, 40, 30), // 0-7
      { t: 'sponge', x: 130, y: 174 }, // 8 海绵掩体（PRD 案例2 原文：蟑螂放在类似海绵板的地方）
      { t: 'sponge', x: 205, y: 174 }, // 9
      { t: 'bottle', x: 25, y: 110, angle: 0.3, acc: ['pin'] }, // 10 斜下扫射
      { t: 'bottle', x: 150, y: 40, angle: 0.9, acc: ['pin'] }, // 11 俯射虫群
      { t: 'bottle', x: 275, y: 110, angle: Math.PI - 0.3, acc: ['pin'] }, // 12
      { t: 'firecracker', x: 95, y: FLOOR }, // 13 陷阱
      { t: 'firecracker', x: 235, y: FLOOR }, // 14 陷阱
    ],
    goal: (sim) => ({
      label: '击倒 ≥ 4 只蟑螂',
      done: (sim.stats.koByType?.roach ?? 0) >= 4,
    }),
  },
  {
    id: 'case3',
    label: '案例3 · 破甲实验',
    desc: '清道夫机甲固定在砖块上，装甲对普通爆炸减伤 60%。用牙签/大头针窜天猴击穿它。',
    seed: 909,
    entities: [
      { t: 'brick', x: 150, y: 171 }, // 0
      { t: 'scarab', x: 150, y: 157, fixed: true }, // 1 蹲在砖上
      { t: 'bottle', x: 60, y: 150, angle: 0.1, acc: ['toothpick'] }, // 2 平射装甲
      { t: 'bottle', x: 240, y: 150, angle: Math.PI - 0.1, acc: ['toothpick'] }, // 3
      { t: 'bottle', x: 150, y: 60, angle: Math.PI / 2, acc: ['pin'] }, // 4 俯冲顶甲
      { t: 'firecracker', x: 110, y: FLOOR }, // 5
      { t: 'firecracker', x: 190, y: FLOOR }, // 6
    ],
    goal: (sim) => ({
      label: '击穿装甲（出现裂纹）',
      done: (sim.stats.cracks ?? 0) >= 1,
      bonus: (sim.stats.koByType?.scarab ?? 0) >= 1 ? '瘫痪清道夫 ✓' : null,
    }),
  },
  {
    id: 'case4',
    label: '案例4 · 黏液保龄球馆',
    desc: '固定球瓶阵已就位，只有 3 次投掷机会：低平掷出点着的炮仗炸它个一爆双响。',
    seed: 1234,
    maxThrows: 3,
    entities: [
      { t: 'roach', x: 225, y: 176, fixed: true }, // 0-4 球瓶（固定，被击倒后解除）
      { t: 'roach', x: 235, y: 176, fixed: true }, // 1
      { t: 'roach', x: 245, y: 176, fixed: true }, // 2
      { t: 'roach', x: 255, y: 176, fixed: true }, // 3
      { t: 'roach', x: 265, y: 176, fixed: true }, // 4
    ],
    goal: (sim) => ({ label: '一爆双响（一次爆炸击倒 ≥ 2）', done: sim.stats.multiKills >= 1 }),
  },
  {
    id: 'case5',
    label: '案例5 · 空中狩猎',
    desc: '三只玩具苍蝇在半空乱飞。窜天猴上仰对空射击，被击落的苍蝇会坠机。目标：击落 ≥ 2 只苍蝇。',
    seed: 555,
    entities: [
      { t: 'fly', x: 100, y: 80 }, // 0
      { t: 'fly', x: 170, y: 70 }, // 1
      { t: 'fly', x: 240, y: 90 }, // 2
      { t: 'bottle', x: 40, y: 150, angle: -0.55, acc: ['pin'], delay: 0.2 }, // 3 对空炮
      { t: 'bottle', x: 150, y: 165, angle: -1.0, acc: ['pin'], delay: 0.8 }, // 4
      { t: 'bottle', x: 262, y: 150, angle: -Math.PI + 0.55, acc: ['pin'], delay: 1.4 }, // 5
    ],
    goal: (sim) => ({
      label: '击落 ≥ 2 只苍蝇',
      done: (sim.stats.koByType?.fly ?? 0) >= 2,
      bonus: (sim.stats.koByType?.fly ?? 0) >= 3 ? '全空域清空 ✓' : null,
    }),
  },
];

export function getScenario(id: string | null): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
