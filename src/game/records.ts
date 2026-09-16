// 本机最佳记录：localStorage 存每个场景的最佳战绩（连锁/击倒/爆炸数各自取最大）。
// storage 可注入（无头测试）；不可用时静默降级为无记录。

import type { SimStats } from '../sim/sim.js';

const PREFIX = 'bbl-best-';

export interface BestRecord {
  chain: number;
  knockouts: number;
  explosions: number;
}

export interface Records {
  load(key: string): BestRecord | null;
  save(key: string, val: BestRecord): void;
  update(key: string, counts: Pick<SimStats, 'chainMax' | 'knockouts' | 'explosions'>): { best: BestRecord; isNew: boolean };
}

export function createRecords(storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null): Records {
  return {
    load(key) {
      if (!storage) return null;
      try {
        return JSON.parse(storage.getItem(PREFIX + key) || 'null') as BestRecord | null;
      } catch {
        return null;
      }
    },
    save(key, val) {
      if (!storage) return;
      try {
        storage.setItem(PREFIX + key, JSON.stringify(val));
      } catch {
        // 隐私模式等场景：静默放弃
      }
    },
    // 用本场战绩更新最佳；返回 {best, isNew}
    update(key, counts) {
      const prev = this.load(key);
      const best: BestRecord = {
        chain: Math.max(prev?.chain ?? 0, counts.chainMax ?? 0),
        knockouts: Math.max(prev?.knockouts ?? 0, counts.knockouts ?? 0),
        explosions: Math.max(prev?.explosions ?? 0, counts.explosions ?? 0),
      };
      this.save(key, best);
      const isNew =
        !prev ||
        (counts.chainMax ?? 0) > (prev.chain ?? 0) ||
        (counts.knockouts ?? 0) > (prev.knockouts ?? 0);
      return { best, isNew };
    },
  };
}
