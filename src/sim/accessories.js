// 配件：牙签（高穿透/轻）、大头针（极高穿透/命中钉住）、胶水（命中粘附）、绳子（连接两物）。
// 全部以"物理属性修饰器"的形式存在，不针对任何特定虫子（PRD §24）。

import { ACCESSORIES, TIPS } from '../game/catalog.js';

// 计算一组头部配件的合成效果
export function tipEffect(acc = []) {
  const eff = { pierce: 0.15, stick: 0, glue: false }; // 0.15 = 裸爆的基础穿透
  for (const a of acc) {
    const def = ACCESSORIES[a];
    if (!def) continue;
    if (def.pierce != null) eff.pierce = Math.max(eff.pierce, def.pierce);
    if (def.stick != null) eff.stick = Math.max(eff.stick, def.stick);
    if (def.glue) eff.glue = true;
  }
  return eff;
}

// 配件对质量的影响（在生成爆炸物时应用）
export function tipMassMul(acc = []) {
  let mul = 1;
  for (const a of acc) {
    const def = ACCESSORIES[a];
    if (def?.massMul != null) mul *= def.massMul;
  }
  return mul;
}

export function isTip(name) {
  return TIPS.includes(name);
}
