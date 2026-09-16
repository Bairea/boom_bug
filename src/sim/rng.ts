// 种子随机数发生器：模拟层唯一的随机来源。
// 换任何执行环境，只要种子与调用顺序相同，序列完全一致 —— 这是回放与分享码的地基。

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  seed: number;
  next: () => number;
  calls: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.next = mulberry32(this.seed);
    this.calls = 0;
  }
  // [0,1)
  float(): number {
    this.calls++;
    return this.next();
  }
  // [min,max) 浮点
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }
  // [min,max] 整数
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1 - 1e-9));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
  sign(): number {
    return this.float() < 0.5 ? -1 : 1;
  }
}
