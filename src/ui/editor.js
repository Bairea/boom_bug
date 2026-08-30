// 编辑器：工具箱选择、摆放、瞄准拖拽、配件安装、绳子连接、运行中点燃。

import { VIEW_W, VIEW_H } from './render.js';
import { TIPS, BUG_TYPES } from '../game/catalog.js';

const LIMITS = { bug: 14, explosive: 8, prop: 2, ropes: 4 };

export class Editor {
  constructor(canvas) {
    this.canvas = canvas;
    this.tool = 'roach';
    this.specs = [];
    this.ropeList = []; // {a, b} 实体索引
    this.ropePicking = null; // 第一个选中的实体索引
    this.drag = null; // {t, x, y, angle} 拖拽瞄准中
    this.reaming = null; // 正在重新瞄准的实体索引
    this.ghost = null;
    this.locked = false; // 运行中锁定编辑（避免点击污染下一局的布置）
    this.fixScarab = true;
    this.onStatus = () => {};
    this._bind();
  }

  scale() {
    const rect = this.canvas.getBoundingClientRect();
    return { s: this.canvas.width / VIEW_W, rect };
  }

  toWorld(ev) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((ev.clientY - rect.top) / rect.height) * VIEW_H;
    return { x, y };
  }

  hitSpec(x, y) {
    const idx = this.specs.findIndex((s) => Math.hypot(s.x - x, s.y - y) < 5);
    return idx >= 0 ? idx : null;
  }

  _bind() {
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

  _down(ev) {
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
      if (this.ropeList.length >= LIMITS.ropes) return this.onStatus('绳子已达上限');
      this.ropeList.push({ a: this.ropePicking, b: idx });
      this.ropePicking = null;
      this.onStatus('绳子已连接 ✓');
      return;
    }

    if (TIPS.includes(t)) {
      const idx = this.hitSpec(x, y);
      if (idx == null || this.specs[idx].kind !== 'explosive') {
        return this.onStatus('配件：请点击一个爆炸物来安装');
      }
      const spec = this.specs[idx];
      spec.acc = spec.acc ?? [];
      const at = spec.acc.indexOf(t);
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

  _updateAim(idx, mx, my) {
    const s = this.specs[idx];
    const dx = mx - s.x;
    const dy = my - s.y;
    if (Math.hypot(dx, dy) < 3) return;
    let a = Math.atan2(dy, dx);
    if (s.t === 'skyrocket') {
      const UP = -Math.PI / 2;
      a = UP + Math.max(-0.44, Math.min(0.44, a - UP));
    }
    s.angle = a;
  }

  _move(ev) {
    const { x, y } = this.toWorld(ev);
    if (this.reaming != null) {
      this._updateAim(this.reaming, x, y);
      this.ghost = null;
      return;
    }
    if (this.drag && ['skyrocket', 'bottle'].includes(this.drag.t)) {
      const dx = x - this.drag.x;
      const dy = y - this.drag.y;
      if (Math.hypot(dx, dy) > 3) {
        let a = Math.atan2(dy, dx);
        if (this.drag.t === 'skyrocket') {
          // 冲天炮限制在竖直方向 ±25°
          const UP = -Math.PI / 2;
          const d = Math.max(-0.44, Math.min(0.44, a - UP));
          a = UP + d;
        }
        this.drag.angle = a;
      }
    }
    // 幽灵预览
    if (['roach', 'locust', 'scarab', 'snail', 'firecracker', 'skyrocket', 'bottle', 'brick'].includes(this.tool)) {
      this.ghost = {
        t: this.tool,
        kind: BUG_TYPES.includes(this.tool)
          ? 'bug'
          : this.tool === 'brick'
            ? 'prop'
            : 'explosive',
        x,
        y,
        angle: this.drag?.angle ?? (this.tool === 'skyrocket' ? -Math.PI / 2 : this.tool === 'bottle' ? -0.3 : 0),
        aim: this.drag?.angle,
        acc: [],
      };
    } else this.ghost = null;
  }

  _up() {
    if (this.reaming != null) {
      this.onStatus('瞄准已更新 ✓');
      this.reaming = null;
    }
    if (this.drag && ['skyrocket', 'bottle'].includes(this.drag.t)) this._commitDrag();
    this.drag = null;
  }

  _commitDrag() {
    const d = this.drag;
    // 统一走 addSpec：kind / fixed（清道夫固定）等属性只有这一个来源
    this.addSpec(d.t, d.x, d.y, { angle: d.angle });
    this.onStatus(`已放置 ${labelOf(d.t)}${['skyrocket', 'bottle'].includes(d.t) ? ' —— 拖拽可瞄准' : ''}`);
  }

  _canPlace(t) {
    const kind = BUG_TYPES.includes(t) ? 'bug' : t === 'brick' ? 'prop' : 'explosive';
    const n = this.specs.filter((s) => s.kind === kind).length;
    if (n >= LIMITS[kind]) {
      this.onStatus(`${kindName(kind)}已达上限（${LIMITS[kind]}）`);
      return false;
    }
    return true;
  }

  addSpec(t, x, y, extra = {}) {
    const kind = BUG_TYPES.includes(t) ? 'bug' : t === 'brick' ? 'prop' : 'explosive';
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

  removeSpec(idx) {
    this.specs.splice(idx, 1);
    this.ropeList = this.ropeList
      .filter((r) => r.a !== idx && r.b !== idx)
      .map((r) => ({ a: r.a > idx ? r.a - 1 : r.a, b: r.b > idx ? r.b - 1 : r.b }));
    this.onStatus('已移除');
  }

  clear() {
    this.specs = [];
    this.ropeList = [];
    this.ropePicking = null;
  }

  // 生成模拟输入：entities（绳子挂到 0 号实体） 
  buildEntities(ignite = true) {
    const entities = this.specs.map((s) => ({
      t: s.t,
      x: s.x,
      y: s.y,
      angle: s.angle,
      acc: s.acc,
      fixed: s.fixed,
    }));
    if (this.ropeList.length && entities.length) {
      entities[0].ropes = this.ropeList.map((r) => [r.a, r.b]);
    }
    if (ignite) {
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

function clampPos(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function labelOf(t) {
  return {
    roach: '蟑螂', locust: '蝗虫', scarab: '清道夫',
    firecracker: '小炮仗', skyrocket: '冲天炮', bottle: '窜天猴', brick: '砖头',
    toothpick: '牙签', pin: '大头针', glue: '胶水', rope: '绳子',
  }[t] ?? t;
}

function kindName(kind) {
  return { bug: '虫子', explosive: '爆炸物', prop: '道具' }[kind] ?? kind;
}
