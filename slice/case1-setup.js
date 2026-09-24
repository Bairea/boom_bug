// 案例实体构建：逐位复刻 src/ui/editor.ts buildEntities(true, noAutoIgnite) 的语义，
// 供浏览器切片（main.js）与 Node 基线脚本（baseline.mjs）共用 —— 两边输入完全一致，
// 数字才有对拍意义。sim 层零改动，本文件只组装输入。
const IGNITE_TYPES = ['firecracker', 'skyrocket', 'bottle']; // 与 editor.buildEntities 同表

export function buildEntitiesFor(specs, { autoIgnite = true, noAutoIgnite = false } = {}) {
  const entities = specs.map((s) => ({
    t: s.t,
    x: s.x,
    y: s.y,
    angle: s.angle,
    acc: s.acc,
    fixed: s.fixed,
  }));
  // 场景自带绳子 →（游戏里先进编辑器 ropeList）→ buildEntities 统一挂到 entities[0]
  const ropes = [];
  for (const s of specs) for (const pair of s.ropes ?? []) ropes.push([pair[0], pair[1]]);
  if (ropes.length && entities.length) entities[0].ropes = ropes;
  if (autoIgnite && !noAutoIgnite) {
    let i = 0;
    for (const e of entities) {
      if (IGNITE_TYPES.includes(e.t)) {
        e.delay = 0.15 + i * 0.35; // 摆放顺序依次点燃（与游戏同节奏）
        i++;
      }
    }
  }
  return entities;
}
