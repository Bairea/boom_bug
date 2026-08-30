// 物品目录：一切数值集中在这一张表（PRD §24 —— 物体只有物理属性，没有特化规则）。

export const BUGS = {
  roach: {
    label: '玩具蟑螂',
    icon: '🪳',
    radius: 2.6,
    mass: 0.55,
    hp: 30,
    armor: 0,
    restitution: 0.3,
    friction: 0.9,
    speed: [60, 90],
  },
  locust: {
    label: '玩具蝗虫',
    icon: '🦗',
    radius: 2.4,
    mass: 0.45,
    hp: 22,
    armor: 0,
    restitution: 0.7, // 高弹性，会弹跳
    friction: 0.6,
    speed: [40, 60],
  },
  scarab: {
    label: '清道夫机甲',
    icon: '🪲',
    radius: 5,
    mass: 3.5,
    hp: 90,
    armor: 0.6, // 装甲：默认爆炸伤害 ×0.4，需要牙签/大头针穿透
    restitution: 0.15,
    friction: 0.95,
    speed: [22, 30],
    canFix: true, // 可固定在砖块上（破甲实验靶）
  },
  snail: {
    label: '玩具蜗牛',
    icon: '🐌',
    radius: 3,
    mass: 1.2,
    hp: 80,
    armor: 0.2,
    restitution: 0.05,
    friction: 0.5,
    speed: [8, 14], // 龟速爬行
    leavesSlime: true, // 爬过之处留下黏液：物体落地打滑
  },
  fly: {
    label: '玩具苍蝇',
    icon: '🪰',
    radius: 2,
    mass: 0.3,
    hp: 14,
    armor: 0,
    restitution: 0.5,
    friction: 0.5,
    speed: [90, 130], // 悬飞 + 随机急变向，最难命中
    flies: true, // 持续飞行（悬空带）
  },
};


export const BUG_TYPES = Object.keys(BUGS);

export const EXPLOSIVES = {
  firecracker: {
    label: '小炮仗',
    icon: '🧨',
    bodyRadius: 2,
    mass: 0.9,
    fuse: [0.9, 1.5], // 点燃后随机引信时长
    power: 55,
    blastRadius: 60,
    dmg: 45,
    thrust: 0, // 原地爆炸
  },
  skyrocket: {
    label: '冲天炮',
    icon: '🎆',
    bodyRadius: 2.6,
    mass: 1.4,
    power: 70,
    blastRadius: 70,
    dmg: 55,
    thrust: 900, // 竖直上冲
    burn: 0.55, // 燃尽时间，燃尽即爆
  },
  bottle: {
    label: '窜天猴',
    icon: '🚀',
    bodyRadius: 2.4,
    mass: 0.8,
    power: 45,
    blastRadius: 50,
    dmg: 35,
    thrust: 450, // 维持飞行
    launchKick: 420, // 点燃瞬间沿瞄准方向的爆冲初速
    burn: 0.75,
    wobble: 130, // 横向摆动幅度（不可预测感的来源）
  },
};

export const ACCESSORIES = {
  toothpick: { label: '牙签', icon: '🥢', pierce: 0.6, massMul: 0.9 },
  pin: { label: '大头针', icon: '📌', pierce: 0.95, massMul: 1.1, stick: 0.25 },
  glue: { label: '胶水', icon: '🫙', glue: true },
  rope: { label: '绳子', icon: '🪢' },
};

// 爆炸物可安装的"头部配件"（绳是独立连接件，不占头部）
export const TIPS = ['toothpick', 'pin', 'glue'];

export const PROP = {
  brick: { label: '砖头', radius: 9, mass: 8, hp: null }, // 永固
  glass: { label: '玻璃砖', radius: 9, mass: 3, hp: 55, brittle: true }, // 可碎裂
  sponge: { label: '海绵垫', radius: 10, mass: 2, hp: null, soft: true }, // 吸收冲击：不弹、爆炸伤害减半
  water: { label: '水盆', radius: 16, mass: 1, hp: null, water: true }, // 浮力区：浇灭引信、闷熄爆炸
  oil: { label: '油盆', radius: 14, mass: 1, hp: null, oil: true }, // 可燃油区：遇火爆燃，持续灼烧区内
  giftbox: { label: '礼物盒', radius: 8, mass: 2.5, hp: 30, children: true }, // 套娃：炸开弹出内含物
  wood: { label: '木板', radius: 10, mass: 4, hp: 45, flammable: true }, // 可燃：引燃后持续灼烧周围
  ice: { label: '冰面', radius: 12, mass: 5, hp: null, slippery: true }, // 永久光滑（同黏液）
  metal: { label: '金属板', radius: 9, mass: 10, hp: null, bouncy: true }, // 高弹反弹
  debris: { label: '碎片', radius: 3, mass: 0.6, hp: null },
};

export const PROP_TYPES = Object.keys(PROP).filter((k) => k !== 'debris');
