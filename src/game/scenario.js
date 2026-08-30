// 预设场景：对应 PRD 的三个案例 + 自由实验。每个场景可带一个"实验目标"。

const FLOOR = 176;

function roachRow(count, x0, gap) {
  return Array.from({ length: count }, (_, i) => ({ t: 'roach', x: x0 + i * gap, y: FLOOR }));
}

export const SCENARIOS = [
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
    seed: 4102,
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
      { t: 'bottle', x: 25, y: 110, angle: 0.3, acc: ['pin'] }, // 8 斜下扫射
      { t: 'bottle', x: 150, y: 40, angle: 0.9, acc: ['pin'] }, // 9 俯射虫群
      { t: 'bottle', x: 275, y: 110, angle: Math.PI - 0.3, acc: ['pin'] }, // 10
      { t: 'firecracker', x: 120, y: FLOOR }, // 11 陷阱
      { t: 'firecracker', x: 190, y: FLOOR }, // 12 陷阱
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
    desc: '蜗牛铺出打滑球道：把点着的炮仗低平掷出去，看它滑进虫堆。目标：一爆双响（一爆多杀 ≥ 2）。',
    seed: 1234,
    entities: [
      { t: 'snail', x: 70, y: 176 }, // 0 铺道员
      { t: 'roach', x: 235, y: 176 }, // 1 球瓶
      { t: 'roach', x: 245, y: 176 }, // 2
      { t: 'roach', x: 255, y: 176 }, // 3
      { t: 'roach', x: 265, y: 176 }, // 4
      { t: 'firecracker', x: 150, y: 176 }, // 5 备用球
      { t: 'bottle', x: 270, y: 60, angle: Math.PI - 0.4, acc: ['glue'] }, // 6 空中支援
    ],
    goal: (sim) => ({ label: '一爆双响（一爆多杀 ≥ 2）', done: sim.stats.multiKills >= 2 }),
  },
];

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
