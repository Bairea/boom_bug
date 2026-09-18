// 编辑器：工具箱选择、摆放、瞄准拖拽、配件安装、绳子连接、运行中点燃。

import { VIEW_W, VIEW_H } from './render.js';
import type { ItemView } from './render.js';
import { TIPS } from '../game/catalog.js';
import { isBugName, isPropName } from '../game/catalog.js';
import type { EntityKind } from '../game/catalog.js';
import type { EntitySpec } from '../game/encode.js';
import { ddatan2, dhypot } from '../sim/dmath.js';

// 说明：编辑器算出的 angle 会被写进分享码（toFixed(3) 后整体复现）。
// atan2 必须用确定性版本，否则不同浏览器对同一手势算出的角度差 1 ULP，
// 靠近 0.0005 取整边界时分享码就会在对方浏览器里演化出不同的事故。

// 摆放上限：沙盒创作空间（性能余量 100×+，宽松些鼓励大场面）
export const LIMITS: Record<EntityKind, number> = { bug: 14, explosive: 10, prop: 4 };
const ROPE_LIMIT = 4;

interface DragState {
  t: string;
  x: number;
  y: number;
  angle: number;
}

export class Editor {
  canvas: HTMLCanvasElement;
  tool = 'roach';
  specs: EntitySpec[] = [];
  ropeList: { a: number; b: number }[] = []; // {a, b} 实体索引
  ropePicking: number | null = null; // 第一个选中的实体索引
  hoverPos: { x: number; y: number } | null = null; // 鼠标世界坐标（绳子连接预览用）
  hoverIdx: number | null = null; // 点选类工具悬停中的实体索引（配件/删除/绳子）
  drag: DragState | null = null; // {t, x, y, angle} 拖拽瞄准中
  reaming: number | null = null; // 正在重新瞄准的实体索引
  ghost: ItemView | null = null;
  locked = false; // 运行中锁定编辑（避免点击污染下一局的布置）
  fixScarab = true;
  onStatus: (msg: string) => void = () => {};
  onPlace: (x: number, y: number) => void = () => {}; // 摆放落点反馈（表现层）

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this._bind();
  }

  scale(): { s: number; rect: DOMRect } {
    const rect = this.canvas.getBoundingClientRect();
    return { s: this.canvas.width / VIEW_W, rect };
  }

  toWorld(ev: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((ev.clientY - rect.top) / rect.height) * VIEW_H;
    return { x, y };
  }

  // 点击拾取半径放宽到视觉尺寸的 ~2 倍：配件安装/删除/连绳不必点正中心
  hitSpec(x: number, y: number, r = 12): number | null {
    const idx = this.specs.findIndex((s) => dhypot(s.x - x, s.y - y) < r);
    return idx >= 0 ? idx : null;
  }

  _bind(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (ev) => this._down(ev));
    c.addEventListener('pointermove', (ev) => this._move(ev));
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', (ev) => this._up(ev));
      c.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        this.ropePicking = null;
        this.onStatus('已取消绳子选择');
      });
    }
  }

  _down(ev: PointerEvent): void {
    const { x, y } = this.toWorld(ev);
    if (ev.button === 2) return;
    if (this.locked) return; // 实验进行中，编辑器不响应
    const t = this.tool;

    if (t === 'eraser') {
      const idx = this.hitSpec(x, y);
      if (idx != null) this.removeSpec(idx);
      return;
    }

    if (t === 'rope') {
      const idx = this.hitSpec(x, y);
      if (idx == null) return this.onStatus('绳子：请点击一个虫子或爆炸物');
      if (this.ropePicking == null) {
        this.ropePicking = idx;
        return this.onStatus('绳子：再点击另一个物体完成连接（右键取消）');
      }
      if (this.ropePicking === idx) return this.onStatus('不能连接到自身');
      if (this.ropeList.length >= ROPE_LIMIT) return this.onStatus('绳子已达上限');
      this.ropeList.push({ a: this.ropePicking, b: idx });
      this.ropePicking = null;
      this.onStatus('绳子已连接 ✓');
      return;
    }

    if ((TIPS as readonly string[]).includes(t)) {
      const idx = this.hitSpec(x, y);
      if (idx == null || this.specs[idx].kind !== 'explosive') {
        return this.onStatus('配件：请点击一个爆炸物来安装');
      }
      const spec = this.specs[idx];
      spec.acc = spec.acc ?? [];
      const at = (spec.acc as string[]).indexOf(t);
      if (at >= 0) {
        spec.acc.splice(at, 1);
        this.onStatus(`已拆除 ${labelOf(t)}`);
      } else {
        if (spec.acc.length >= 2) return this.onStatus('每个爆炸物最多 2 个配件');
        spec.acc.push(t);
        this.onStatus(`${labelOf(t)} 已装上 ✓（再点一次可拆除）`);
      }
      return;
    }

    // 放置类工具：点中同款火箭 → 进入重新瞄准模式（不用删了重摆）
    if (['skyrocket', 'bottle'].includes(t)) {
      const hitIdx = this.hitSpec(x, y);
      if (hitIdx != null && this.specs[hitIdx].t === t) {
        this.reaming = hitIdx;
        this._updateAim(hitIdx, x, y);
        this.onStatus('重新瞄准中……松手确认');
        return;
      }
    }

    // 放置类工具：记录起点，火箭类拖拽瞄准
    if (!this._canPlace(t)) return;
    this.drag = { t, x, y, angle: t === 'skyrocket' ? -Math.PI / 2 : t === 'bottle' ? -0.3 : 0 };
    if (!['skyrocket', 'bottle'].includes(t)) this._commitDrag();
  }

  _updateAim(idx: number, mx: number, my: number): void {
    const s = this.specs[idx];
    const dx = mx - s.x;
    const dy = my - s.y;
    if (dhypot(dx, dy) < 3) return;
    let a = ddatan2(dy, dx);
    if (s.t === 'skyrocket') {
      const UP = -Math.PI / 2;
      a = UP + Math.max(-0.44, Math.min(0.44, a - UP));
    }
    s.angle = a;
  }

  _move(ev: PointerEvent): void {
    const { x, y } = this.toWorld(ev);
    this.hoverPos = { x, y };
    // 点选类工具：悬停高亮将要作用的物体（放置类用幽灵预览，不需要）
    const pickyTool = this.tool === 'rope' || this.tool === 'eraser' || (TIPS as readonly string[]).includes(this.tool);
    this.hoverIdx = pickyTool ? this.hitSpec(x, y) : null;
    if (this.reaming != null) {
      this._updateAim(this.reaming, x, y);
      this.ghost = null;
      return;
    }
    if (this.drag && ['skyrocket', 'bottle'].includes(this.drag.t)) {
      const dx = x - this.drag.x;
      const dy = y - this.drag.y;
      if (dhypot(dx, dy) > 3) {
        let a = ddatan2(dy, dx);
        if (this.drag.t === 'skyrocket') {
          // 冲天炮限制在竖直方向 ±25°
          const UP = -Math.PI / 2;
          const d = Math.max(-0.44, Math.min(0.44, a - UP));
          a = UP + d;
        }
        this.drag.angle = a;
      }
    }
    // 幽灵预览（该类摆放已达上限时标记 blocked，渲染成红色提示放不了）
    if (isBugName(this.tool) || isPropName(this.tool) || ['firecracker', 'skyrocket', 'bottle'].includes(this.tool)) {
      this.ghost = {
        t: this.tool,
        kind: isBugName(this.tool) ? 'bug' : isPropName(this.tool) ? 'prop' : 'explosive',
        x,
        y,
        angle: this.drag?.angle ?? (this.tool === 'skyrocket' ? -Math.PI / 2 : this.tool === 'bottle' ? -0.3 : 0),
        aim: this.drag?.angle,
        acc: [],
        blocked: this._atLimit(this.tool),
      };
    } else this.ghost = null;
  }

  _up(_ev: PointerEvent): void {
    if (this.reaming != null) {
      this.onStatus('瞄准已更新 ✓');
      this.reaming = null;
    }
    if (this.drag && ['skyrocket', 'bottle'].includes(this.drag.t)) this._commitDrag();
    this.drag = null;
  }

  _commitDrag(): void {
    const d = this.drag;
    if (!d) return;
    // 统一走 addSpec：kind / fixed（清道夫固定）等属性只有这一个来源
    this.addSpec(d.t, d.x, d.y, { angle: d.angle });
    this.onPlace(d.x, d.y);
    this.onStatus(`已放置 ${labelOf(d.t)}${['skyrocket', 'bottle'].includes(d.t) ? ' —— 拖拽可瞄准' : ''}`);
  }

  _canPlace(t: string): boolean {
    const kind = kindOf(t);
    const n = this.specs.filter((s) => s.kind === kind).length;
    if (n >= LIMITS[kind]) {
      this.onStatus(`${kindName(kind)}已达上限（${LIMITS[kind]}）`);
      return false;
    }
    return true;
  }

  // 静默版上限检查（幽灵预览标记用，不发 status）
  _atLimit(t: string): boolean {
    const kind = kindOf(t);
    return this.specs.filter((s) => s.kind === kind).length >= LIMITS[kind];
  }

  addSpec(
    t: string,
    x: number,
    y: number,
    extra: { angle?: number; acc?: string[]; fixed?: boolean; delay?: number } = {},
  ): void {
    const kind = kindOf(t);
    this.specs.push({
      t,
      x: clampPos(x, 3, VIEW_W - 3),
      y: clampPos(y, 2, VIEW_H - 2),
      angle: extra.angle ?? (t === 'skyrocket' ? -Math.PI / 2 : t === 'bottle' ? -0.3 : undefined),
      acc: extra.acc ?? [],
      fixed: extra.fixed ?? (t === 'scarab' ? this.fixScarab : undefined),
      kind,
    });
  }

  removeSpec(idx: number): void {
    this.specs.splice(idx, 1);
    this.ropeList = this.ropeList
      .filter((r) => r.a !== idx && r.b !== idx)
      .map((r) => ({ a: r.a > idx ? r.a - 1 : r.a, b: r.b > idx ? r.b - 1 : r.b }));
    this.onStatus('已移除');
  }

  clear(): void {
    this.specs = [];
    this.ropeList = [];
    this.ropePicking = null;
  }

  // 生成模拟输入：entities（绳子挂到 0 号实体）
  buildEntities(ignite = true, noAutoIgnite = false): EntitySpec[] {
    const entities: EntitySpec[] = this.specs.map((s) => ({
      t: s.t,
      x: s.x,
      y: s.y,
      angle: s.angle,
      acc: s.acc,
      fixed: s.fixed,
    }));
    if (this.ropeList.length && entities.length) {
      entities[0].ropes = this.ropeList.map((r) => [r.a, r.b] as [number, number]);
    }
    if (ignite && !noAutoIgnite) {
      let i = 0;
      for (const e of entities) {
        if (['firecracker', 'skyrocket', 'bottle'].includes(e.t)) {
          e.delay = 0.15 + i * 0.35; // 摆放顺序依次点燃
          i++;
        }
      }
    }
    return entities;
  }
}

function kindOf(t: string): EntityKind {
  if (isBugName(t)) return 'bug';
  if (isPropName(t)) return 'prop';
  return 'explosive';
}

function clampPos(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function labelOf(t: string): string {
  return (
    {
      roach: '蟑螂',
      locust: '蝗虫',
      scarab: '清道夫',
      firecracker: '小炮仗',
      skyrocket: '冲天炮',
      bottle: '窜天猴',
      brick: '砖头',
      balloon: '气球',
      toothpick: '牙签',
      pin: '大头针',
      glue: '胶水',
      rope: '绳子',
    }[t] ?? t
  );
}

function kindName(kind: EntityKind): string {
  return ({ bug: '虫子', explosive: '爆炸物', prop: '道具' }[kind] as string) ?? kind;
}
