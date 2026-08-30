// 本机最佳记录：localStorage 存每个场景的最佳战绩（连锁/击倒/爆炸数各自取最大）。
// storage 可注入（无头测试）；不可用时静默降级为无记录。

const PREFIX = 'bbl-best-';

export function createRecords(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  return {
    load(key) {
      if (!storage) return null;
      try {
        return JSON.parse(storage.getItem(PREFIX + key) || 'null');
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
      const best = {
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
