// 实体级表现层动效（squash & stretch / 击打弹跳）：纯视觉，不碰模拟。
// 手感法则（game-feel）：挤压瞬间发生、带 overshoot 弹回静止；速度对齐的拉伸表达动感。

interface Tracked {
  vy: number;
  y: number;
}

export interface ItemScale {
  sx: number;
  sy: number;
}

const POP_TTL = 0.42;

export class ItemFx {
  private prev = new Map<number, Tracked>();
  private pops = new Map<number, number>(); // id → 弹跳已进行秒数
  private bumps = new Map<number, number>(); // id → 冲击强度 0..1（击倒/重着陆）

  observe(items: { id?: number; vy?: number; y?: number }[], dt: number): void {
    for (const p of this.pops) this.pops.set(p[0], p[1] + dt);
    for (const id of this.pops.keys()) if (this.pops.get(id)! > POP_TTL) { this.pops.delete(id); this.bumps.delete(id); }
    for (const it of items) {
      if (it.id == null || it.vy == null || it.y == null) continue;
      const last = this.prev.get(it.id);
      if (last) {
        // 着陆判定：上一帧明显下坠，这一帧垂直速度骤降（或反弹反向）
        const impact = last.vy - it.vy;
        if (last.vy > 130 && impact > Math.max(90, last.vy * 0.7)) {
          this.pop(it.id, Math.min(1, impact / 420));
        }
      }
      this.prev.set(it.id, { vy: it.vy, y: it.y });
    }
    // 清理消失实体的跟踪（上限防泄漏）
    if (this.prev.size > 400) this.prev.clear();
  }

  // 外部事件触发的弹跳（击倒/殉爆波及）：strength 0..1
  pop(id: number, strength = 1): void {
    this.pops.set(id, 0);
    this.bumps.set(id, Math.min(1, strength));
  }

  reset(): void {
    this.prev.clear();
    this.pops.clear();
    this.bumps.clear();
  }

  // 速度对齐的拉伸系数（主动画）：高速时沿速度方向拉伸、垂直方向压缩（保体积）
  static stretch(speed: number, minV = 90, maxV = 460): number {
    if (speed < minV) return 0;
    const k = Math.min(1, (speed - minV) / (maxV - minV));
    return k * 0.2;
  }

  // 弹回动画的缩放（被动画）：衰减弹簧，带一次 overshoot
  scaleOf(id: number | undefined): ItemScale | null {
    if (id == null) return null;
    const age = this.pops.get(id);
    if (age == null) return null;
    const bump = this.bumps.get(id) ?? 1;
    const t = age / POP_TTL;
    // 衰减余弦：t=0 → 最大压缩，中途过冲（拉伸），收敛到 1
    const osc = Math.exp(-4.2 * t) * Math.cos(t * Math.PI * 2.6);
    const amount = 0.34 * bump * osc;
    return { sx: 1 + amount, sy: 1 - amount };
  }
}
