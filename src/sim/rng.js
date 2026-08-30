// 种子随机数发生器：模拟层唯一的随机来源。
// 换任何执行环境，只要种子与调用顺序相同，序列完全一致 —— 这是回放与分享码的地基。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
    this.calls = 0;
  }
  // [0,1)
  float() {
    this.calls++;
    return this.next();
  }
  // [min,max) 浮点
  range(min, max) {
    return min + (max - min) * this.float();
  }
  // [min,max] 整数
  int(min, max) {
    return Math.floor(this.range(min, max + 1 - 1e-9));
  }
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }
  sign() {
    return this.float() < 0.5 ? -1 : 1;
  }
}
