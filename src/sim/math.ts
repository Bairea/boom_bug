// 纯数学工具：不依赖随机源，保证确定性。
// 三角/距离一律走 dmath：ECMA 不规定 Math.sin/cos/atan2/hypot 的实现，
// 各引擎可差 1+ ULP —— 喂进布尔判定就是分享码跨浏览器失效的入口。

import { dcos, dhypot, dsin } from './dmath.js';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const len = (x: number, y: number): number => dhypot(x, y);

export const dist = (ax: number, ay: number, bx: number, by: number): number => dhypot(bx - ax, by - ay);

// 单位化；零向量返回 (0,0)
export function norm(x: number, y: number): [number, number] {
  const l = dhypot(x, y);
  if (l < 1e-9) return [0, 0];
  return [x / l, y / l];
}

// 把 [ax,ay] 单位方向旋转 90 度（用于垂直分量/切向）
export const perp = (ux: number, uy: number): [number, number] => [-uy, ux];

// 弧度方向 → 单位向量
export const dirOf = (a: number): [number, number] => [dcos(a), dsin(a)];

// 简单可复现校验和：把数字序列折成一个 32 位整数（测试与调试用）
export function checksum(nums: Iterable<number>): number {
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
