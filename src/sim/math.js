// 纯数学工具：不依赖随机源，保证确定性。

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const len = (x, y) => Math.hypot(x, y);

export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

// 单位化；零向量返回 (0,0)
export function norm(x, y) {
  const l = Math.hypot(x, y);
  if (l < 1e-9) return [0, 0];
  return [x / l, y / l];
}

// 把 [ax,ay] 单位方向旋转 90 度（用于垂直分量/切向）
export const perp = (ux, uy) => [-uy, ux];

// 弧度方向 → 单位向量
export const dirOf = (a) => [Math.cos(a), Math.sin(a)];

// 简单可复现校验和：把数字序列折成一个 32 位整数（测试与调试用）
export function checksum(nums) {
  let h = 2166136261 >>> 0;
  for (const raw of nums) {
    const v = Math.round(raw * 100) | 0;
    h ^= v & 0xffff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= v >>> 16;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
