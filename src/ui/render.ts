// Canvas 渲染：玩具实验室风格（PRD §19 极简美术 + "实验录像"感）。
// 不持有状态：每帧从视图模型重画。视图模型来自 specs(编辑) 或 sim(运行)。

import { BUGS, EXPLOSIVES, PROP } from '../game/catalog.js';
import type { EntityKind } from '../game/catalog.js';
import { kindOfName } from '../game/catalog.js';
import type { Simulation } from '../sim/sim.js';
import type { SlimeDrop } from '../sim/world.js';
import type { Particles } from './particles.js';
import { ItemFx } from './fx.js';

export const VIEW_W = 300;
export const VIEW_H = 180;

// ---- 视图模型 ----
export interface ItemView {
  t: string;
  kind: EntityKind;
  x: number;
  y: number;
  id?: number;
  radius?: number;
  angle?: number;
  aim?: number | null;
  lit?: boolean;
  burning?: boolean;
  acc?: string[];
  knocked?: boolean;
  cracked?: boolean;
  fixed?: boolean;
  picked?: boolean;
  hover?: boolean;
  hp?: number | null;
  maxHp?: number;
  speed?: number;
  speedX?: number;
  speedY?: number;
  onFire?: boolean;
  frozen?: boolean;
  blocked?: boolean; // 幽灵专用：该类摆放已达上限
  fuse?: number; // 点燃的爆炸物剩余引信秒数（表现"越烧越短"）
  aiState?: string; // 虫子 AI 状态（panic 等表现标记）
}

export interface RopeView {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface SceneView {
  items: ItemView[];
  ropes: RopeView[];
  slime?: SlimeDrop[];
}

export interface Scorch {
  x: number;
  y: number;
  r: number;
  age: number;
  ttl: number;
}

export interface ThrowPreview {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  age: number;
  ttl: number;
}

export interface DrawOptions {
  particles?: Particles;
  shakeX?: number;
  shakeY?: number;
  shakeRoll?: number;
  flash?: number; // 全屏白闪强度 0..1（大爆炸反馈）
  panX?: number; // 镜头平移（慢镜头向爆心缓推，世界单位）
  panY?: number;
  time?: number;
  zoom?: number;
  scorches?: Scorch[];
  floatTexts?: FloatText[];
  slowmoActive?: boolean;
  showAim?: boolean;
  ghost?: ItemView | null;
  recDot?: boolean;
  throwPreview?: ThrowPreview;
  replayWatermark?: boolean;
  replayProgress?: number;
  itemFx?: ItemFx;
  hoverId?: number | null; // 运行中悬停的可交互爆炸物（ignite=点火 / detonate=遥控引爆）
  hoverKind?: 'ignite' | 'detonate';
  ropePreview?: RopeView | null; // 绳子工具：第一选点到鼠标的连接预览
  hoverDestructive?: boolean; // 悬停目标是删除工具（红圈可供性）
  centerHint?: string | null; // 空场景中央引导语
}

function typeNameOf(b: { kind: string; data: { etype?: string; bugType?: string; propType?: string } }): string {
  if (b.kind === 'explosive') return b.data.etype ?? '';
  if (b.kind === 'bug') return b.data.bugType ?? '';
  return b.data.propType ?? '';
}

export function viewFromSim(sim: Simulation): SceneView {
  const items: ItemView[] = [];
  for (const b of sim.world.bodies) {
    if (!b.alive) continue;
    items.push({
      t: typeNameOf(b),
      kind: b.kind,
      x: b.x,
      y: b.y,
      id: b.id,
      radius: b.radius,
      angle: b.angle,
      aim: b.data.aim,
      lit: !!b.data.lit,
      burning: (b.data.burn ?? 0) > 0 && (b.data.stuck ?? 0) <= 0 && !b.data.glued,
      acc: b.data.acc ?? [],
      knocked: !!b.data.knocked,
      cracked: !!b.data.cracked,
      fixed: !!b.data.fixed,
      hp: b.data.hp,
      maxHp: b.data.maxHp,
      speed: Math.hypot(b.vx, b.vy),
      speedX: b.vx,
      speedY: b.vy,
      onFire: !!b.data.burning,
      fuse:
        b.kind === 'explosive' && b.data.lit && Number.isFinite(b.data.fuse) && b.data.fuse > 0
          ? Math.max(0, b.data.fuse)
          : undefined,
      aiState: b.kind === 'bug' ? b.data.state : undefined,
    });
  }
  const slime: SlimeDrop[] = sim.world.slime.map((p) => ({ ...p }));
  const ropes: RopeView[] = sim.world.ropes
    .filter((r) => !r.broken)
    .map((r) => {
      const a = sim.world.byId(r.aId);
      const b = sim.world.byId(r.bId);
      return a && b && a.alive && b.alive ? { ax: a.x, ay: a.y, bx: b.x, by: b.y } : null;
    })
    .filter((r): r is RopeView => r != null);
  return { items, ropes, slime };
}

export function viewFromSpecs(
  specs: { t: string; x: number; y: number; angle?: number; acc?: string[]; fixed?: boolean }[],
  ropeList: { a: number; b: number }[] = [],
  pickedIndex = -1,
  hoverIndex = -1,
): SceneView {
  const items: ItemView[] = specs.map((s, i) => ({
    t: s.t,
    kind: kindOfName(s.t),
    x: s.x,
    y: s.y,
    id: i, // 编辑态用索引当 id：摆放弹跳等表现层动效可寻址
    radius: specRadius(s.t),
    angle: s.angle ?? (s.t === 'skyrocket' ? -Math.PI / 2 : 0),
    aim: s.angle,
    lit: false,
    acc: s.acc ?? [],
    fixed: s.fixed,
    hp: BUGS[s.t as keyof typeof BUGS]?.hp,
    maxHp: BUGS[s.t as keyof typeof BUGS]?.hp,
    picked: i === pickedIndex,
    hover: i === hoverIndex,
  }));
  const ropes: RopeView[] = ropeList
    .map(({ a, b }) => {
      const A = specs[a];
      const B = specs[b];
      return A && B ? { ax: A.x, ay: A.y, bx: B.x, by: B.y } : null;
    })
    .filter((r): r is RopeView => r != null);
  return { items, ropes };
}

// 编辑视图里的幽灵半径：虫/道具取表值，爆炸物用固定值（绘制本身不依赖它）
function specRadius(t: string): number {
  const bug = BUGS[t as keyof typeof BUGS];
  if (bug) return bug.radius;
  const prop = PROP[t as keyof typeof PROP];
  if (prop) return prop.radius;
  return EXPLOSIVES[t as keyof typeof EXPLOSIVES]?.bodyRadius ?? 3;
}

// ---- 主绘制 ----

// 背景缓存：静态桌面（渐变+灯辉+暗角+网格）只在有 DOM 的环境预渲染一次
let bgCache: { key: string; cv: HTMLCanvasElement } | null = null;

function drawBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number, s: number): void {
  const key = `${W}x${H}`;
  if (typeof document !== 'undefined') {
    if (bgCache?.key === key) {
      ctx.drawImage(bgCache.cv, 0, 0);
      return;
    }
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d');
    if (c) {
      paintBackdrop(c, W, H, s);
      bgCache = { key, cv };
      ctx.drawImage(cv, 0, 0);
      return;
    }
  }
  paintBackdrop(ctx, W, H, s);
}

function paintBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number, s: number): void {
  // 实验桌：上冷下暖的微渐变，中央一盏台灯的柔光，四周暗角收拢视线
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#272c37');
  bg.addColorStop(0.55, '#1d212a');
  bg.addColorStop(1, '#14171d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const lamp = ctx.createRadialGradient(W * 0.5, H * 0.18, 0, W * 0.5, H * 0.18, Math.max(W, H) * 0.75);
  lamp.addColorStop(0, 'rgba(255,241,214,0.075)');
  lamp.addColorStop(0.5, 'rgba(255,241,214,0.02)');
  lamp.addColorStop(1, 'rgba(255,241,214,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, W, H);
  drawGrid(ctx, W, H, s);
  const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.38, W / 2, H / 2, Math.max(W, H) * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}

export function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, view: SceneView, opts: DrawOptions = {}): void {
  const s = W / VIEW_W; // 世界→屏幕缩放
  const time = opts.time ?? 0;
  ctx.clearRect(0, 0, W, H);

  // 背景：实验桌
  drawBackdrop(ctx, W, H, s);

  // 盒子
  const ox = (W - VIEW_W * s) / 2;
  const oy = (H - VIEW_H * s) / 2;
  const zoom = opts.zoom ?? 1;
  const cx = (VIEW_W * s) / 2;
  const cy = (VIEW_H * s) / 2;
  ctx.save();
  ctx.translate(ox + (opts.shakeX ?? 0), oy + (opts.shakeY ?? 0));
  // 镜头平移（慢镜头向爆心缓推）
  ctx.translate(-(opts.panX ?? 0) * s, -(opts.panY ?? 0) * s);
  // 震屏滚转（trauma 模型的 roll 分量）：绕盒子中心小幅旋转
  const roll = opts.shakeRoll ?? 0;
  if (roll !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(roll);
    ctx.translate(-cx, -cy);
  }
  if (zoom !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
  }

  // 盒子内部：玻璃罩质感（后壁微光 + 地面沉降 + 对角反光）
  const bw = VIEW_W * s;
  const bh = VIEW_H * s;
  ctx.fillStyle = 'rgba(140,180,220,0.07)';
  ctx.fillRect(0, 0, bw, bh);
  const wall = ctx.createLinearGradient(0, 0, 0, bh);
  wall.addColorStop(0, 'rgba(190,220,255,0.05)');
  wall.addColorStop(0.6, 'rgba(190,220,255,0.012)');
  wall.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, bw, bh);
  // 地面：底部沉降 + 一条微亮的地平线
  const floor = ctx.createLinearGradient(0, (VIEW_H - 10) * s, 0, VIEW_H * s);
  floor.addColorStop(0, 'rgba(0,0,0,0)');
  floor.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = floor;
  ctx.fillRect(0, (VIEW_H - 10) * s, bw, 10 * s);
  ctx.fillStyle = 'rgba(210,235,255,0.09)';
  ctx.fillRect(0, (VIEW_H - 1.6) * s, bw, 1.6 * s);
  // 玻璃对角反光（静态、极淡）
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, bw, bh);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.028)';
  ctx.beginPath();
  ctx.moveTo(bw * 0.62, 0);
  ctx.lineTo(bw * 0.78, 0);
  ctx.lineTo(bw * 0.4, bh);
  ctx.lineTo(bw * 0.28, bh);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.016)';
  ctx.beginPath();
  ctx.moveTo(bw * 0.84, 0);
  ctx.lineTo(bw * 0.9, 0);
  ctx.lineTo(bw * 0.56, bh);
  ctx.lineTo(bw * 0.5, bh);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 蜗牛黏液（画在物体脚下）
  for (const p of view.slime ?? []) drawSlime(ctx, p, s);

  // 爆炸焦痕（战损记忆，纯表现层）：外圈淡晕 + 深色核心
  for (const sc of opts.scorches ?? []) {
    const fade = Math.max(0, 1 - sc.age / sc.ttl);
    ctx.fillStyle = `rgba(10, 8, 6, ${0.32 * fade})`;
    ctx.beginPath();
    ctx.ellipse(sc.x * s, sc.y * s, sc.r * 1.25 * s, sc.r * 0.45 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(12, 10, 8, ${0.5 * fade})`;
    ctx.beginPath();
    ctx.ellipse(sc.x * s, sc.y * s, sc.r * s, sc.r * 0.36 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 连锁浮动大字：爆点冒出，先弹一下再上升淡出（描边+渐变字面+微倾斜）
  for (const ft of opts.floatTexts ?? []) {
    const k = Math.min(1, ft.age / ft.ttl);
    const rise = 16 * k;
    const pop = k < 0.16 ? 1 + (0.16 - k) * 2.4 : 1;
    const tilt = ((ft.x * 7) % 6 - 3) * 0.02; // 由坐标衍生的稳定微倾斜
    ctx.save();
    ctx.translate(ft.x * s, (ft.y - rise) * s);
    ctx.rotate(tilt);
    ctx.scale(pop, pop);
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(24, 18, 8, 0.85)';
    ctx.strokeText(ft.text, 0, 0);
    const tg = ctx.createLinearGradient(0, -8 * s, 0, 4 * s);
    tg.addColorStop(0, '#fff3c4');
    tg.addColorStop(1, '#ffb347');
    ctx.fillStyle = tg;
    ctx.fillText(ft.text, 0, 0);
    ctx.restore();
  }

  // 绳子
  for (const r of view.ropes) drawRope(ctx, r, s);

  // 物体（阴影 → 本体）
  for (const it of view.items) drawShadow(ctx, it, s);
  for (const it of view.items) drawItem(ctx, it, s, time, opts.itemFx);

  // 绳子第一选点高亮（虚线圆环）：玩家点完第一个端点能看到选中了谁
  // 悬停高亮（更淡）：配件/删除/绳子工具下提示"点下去会作用到谁"；删除工具红色示警
  for (const it of view.items) {
    if (!it.picked && !it.hover) continue;
    const destructive = !it.picked && it.hover && opts.hoverDestructive;
    ctx.strokeStyle = it.picked
      ? 'rgba(126,200,255,0.9)'
      : destructive
        ? 'rgba(255,99,71,0.75)'
        : 'rgba(126,200,255,0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(it.x * s, it.y * s, ((it.radius ?? 6) + 5) * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 绳子连接预览：第一选点 → 鼠标（虚线垂弧）
  if (opts.ropePreview) {
    const rp = opts.ropePreview;
    const mx = (rp.ax + rp.bx) / 2;
    const my = (rp.ay + rp.by) / 2 + Math.min(14, Math.max(0, 24 - Math.hypot(rp.bx - rp.ax, rp.by - rp.ay) * 0.12));
    ctx.save();
    ctx.strokeStyle = 'rgba(126,200,255,0.55)';
    ctx.lineWidth = 0.7 * s;
    ctx.setLineDash([2.4 * s, 2 * s]);
    ctx.beginPath();
    ctx.moveTo(rp.ax * s, rp.ay * s);
    ctx.quadraticCurveTo(mx * s, my * s, rp.bx * s, rp.by * s);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(126,200,255,0.8)';
    ctx.beginPath();
    ctx.arc(rp.bx * s, rp.by * s, 1.2 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 运行中悬停反馈：可点燃=蓝圈呼吸，可遥控引爆=橙圈呼吸
  if (opts.hoverId != null) {
    const target = view.items.find((it) => it.id === opts.hoverId);
    if (target) {
      const breathe = 0.65 + 0.35 * Math.sin(time * 6);
      ctx.save();
      ctx.strokeStyle = opts.hoverKind === 'detonate' ? `rgba(255,150,80,${breathe})` : `rgba(126,200,255,${breathe})`;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 2.4]);
      ctx.beginPath();
      ctx.arc(target.x * s, target.y * s, ((target.radius ?? 6) + 4.5) * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  // 瞄准线（编辑模式未点燃的定向爆炸物）
  if (opts.showAim) {
    for (const it of view.items) {
      if ((it.t === 'bottle' || it.t === 'skyrocket') && it.aim != null && !it.lit) {
        drawAim(ctx, it, s);
      }
    }
  }

  // 幽灵预览（放置提示）：呼吸透明度；该类达上限时半透明+红色禁止圈
  if (opts.ghost) {
    const blocked = !!opts.ghost.blocked;
    ctx.globalAlpha = blocked ? 0.3 : 0.38 + 0.12 * Math.sin(time * 5);
    drawItem(ctx, opts.ghost, s, time);
    if (blocked) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,90,70,0.9)';
      ctx.lineWidth = 1.6 * s;
      ctx.setLineDash([3 * s, 2.4 * s]);
      ctx.beginPath();
      ctx.arc(opts.ghost.x * s, opts.ghost.y * s, 7 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(opts.ghost.x * s - 4.6 * s, opts.ghost.y * s - 4.6 * s);
      ctx.lineTo(opts.ghost.x * s + 4.6 * s, opts.ghost.y * s + 4.6 * s);
      ctx.stroke();
      ctx.restore();
    }
    if (opts.ghost.t === 'bottle' || opts.ghost.t === 'skyrocket') drawAim(ctx, opts.ghost, s);
    ctx.globalAlpha = 1;
  }

  // 投掷预览（运行中拖拽扔炮仗）
  if (opts.throwPreview) drawThrowPreview(ctx, opts.throwPreview, s);

  // 慢镜头视觉提示：四周泛蓝光晕（径向）+ 上下渐变，中心保持通透
  if (opts.slowmoActive) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H * s);
    g.addColorStop(0, 'rgba(126,200,255,0.16)');
    g.addColorStop(0.2, 'rgba(126,200,255,0)');
    g.addColorStop(0.8, 'rgba(126,200,255,0)');
    g.addColorStop(1, 'rgba(126,200,255,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W * s, VIEW_H * s);
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    const rg = ctx.createRadialGradient(VIEW_W * s / 2, VIEW_H * s / 2, VIEW_H * s * 0.3, VIEW_W * s / 2, VIEW_H * s / 2, VIEW_W * s * 0.62);
    rg.addColorStop(0, 'rgba(126,200,255,0)');
    rg.addColorStop(1, `rgba(90,160,235,${0.1 + 0.06 * pulse})`);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, VIEW_W * s, VIEW_H * s);
  }

  // 盒子边框：上亮下暗的金属渐变 + 内圈暗线（玻璃厚度感）
  const frame = ctx.createLinearGradient(0, 0, 0, VIEW_H * s);
  frame.addColorStop(0, 'rgba(215,238,255,0.92)');
  frame.addColorStop(0.5, 'rgba(160,195,230,0.66)');
  frame.addColorStop(1, 'rgba(120,150,190,0.8)');
  ctx.strokeStyle = frame;
  ctx.lineWidth = Math.max(2, 1.2 * s);
  ctx.strokeRect(0, 0, VIEW_W * s, VIEW_H * s);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, 0.5 * s);
  ctx.strokeRect(1.6 * s, 1.6 * s, VIEW_W * s - 3.2 * s, VIEW_H * s - 3.2 * s);
  // 四角螺丝：金属圆点 + 高光 + 一字槽
  for (const [sx, sy] of [
    [1.5, 1.5],
    [VIEW_W - 1.5, 1.5],
    [1.5, VIEW_H - 1.5],
    [VIEW_W - 1.5, VIEW_H - 1.5],
  ]) {
    const px = sx * s;
    const py = sy * s;
    const pr = 1.15 * s;
    const mg = ctx.createRadialGradient(px - pr * 0.35, py - pr * 0.35, pr * 0.1, px, py, pr);
    mg.addColorStop(0, '#e8eef5');
    mg.addColorStop(0.5, '#9aa8b8');
    mg.addColorStop(1, '#5d6a7a');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,26,34,0.7)';
    ctx.lineWidth = Math.max(0.6, 0.22 * s);
    ctx.beginPath();
    ctx.moveTo(px - pr * 0.55, py);
    ctx.lineTo(px + pr * 0.55, py);
    ctx.stroke();
  }

  // 粒子
  opts.particles?.draw(ctx, s);

  // 空场景中央引导语（呼吸透明度）
  if (opts.centerHint) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.1 * Math.sin(time * 2.2);
    ctx.fillStyle = '#c9d6e8';
    ctx.font = `${Math.max(11, 5.5 * s)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(opts.centerHint, VIEW_W * s / 2, VIEW_H * s / 2);
    ctx.font = `${Math.max(9, 3.6 * s)}px system-ui, sans-serif`;
    ctx.globalAlpha *= 0.75;
    ctx.fillText('点燃之后，物理会替你完成剩下的故事', VIEW_W * s / 2, VIEW_H * s / 2 + 7 * s);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  ctx.restore();

  // 大爆炸全屏白闪（曝光反馈）：强度外置、快速衰减由调用方控制
  if (opts.flash && opts.flash > 0.005) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,244,220,${Math.min(0.55, opts.flash)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // HUD
  if (opts.recDot) {
    // 录制指示：呼吸脉冲的红点 + REC
    const pulse = 0.55 + 0.45 * Math.sin(time * 4.2);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.65 * pulse;
    ctx.fillStyle = '#ff5555';
    ctx.beginPath();
    ctx.arc(W - 74, 26, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.25 * pulse;
    const rg = ctx.createRadialGradient(W - 74, 26, 0, W - 74, 26, 12);
    rg.addColorStop(0, 'rgba(255,85,85,0.8)');
    rg.addColorStop(1, 'rgba(255,85,85,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(W - 74, 26, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px ui-monospace, monospace';
    ctx.fillText('REC', W - 62, 31);
  }
  if (opts.replayWatermark) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = 'bold 30px ui-monospace, monospace';
    ctx.fillText('⟲ REPLAY', 24, 50);
    ctx.fillStyle = 'rgba(126,200,255,0.75)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('INCIDENT ARCHIVE · SLOW MOTION', 25, 66);
    ctx.restore();
    if (opts.replayProgress != null) {
      // 底部进度条：轨道 + 发光进度头
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(ox, H - 10, VIEW_W * s, 4);
      ctx.fillStyle = '#7ec8ff';
      ctx.fillRect(ox, H - 10, VIEW_W * s * opts.replayProgress, 4);
      const hx = ox + VIEW_W * s * opts.replayProgress;
      const hg = ctx.createRadialGradient(hx, H - 8, 0, hx, H - 8, 10);
      hg.addColorStop(0, 'rgba(126,200,255,0.9)');
      hg.addColorStop(1, 'rgba(126,200,255,0)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(hx, H - 8, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, s: number): void {
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const step = 6 * s;
  ctx.beginPath();
  for (let x = 0; x < W; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let y = 0; y < H; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
}

function drawShadow(ctx: CanvasRenderingContext2D, it: ItemView, s: number): void {
  if (it.t === 'brick') return;
  const floorY = VIEW_H * s;
  const h = Math.max(0, floorY - it.y * s);
  const w = it.kind === 'bug' ? 2.6 : 2.2;
  // 双层软阴影：外圈大而淡（半影），内圈小而深（本影）
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.03, 0.1 - h / (300 * s))})`;
  ctx.beginPath();
  ctx.ellipse(it.x * s, floorY - 1.2 * s, w * s * (1.35 + h / (200 * s)), 1 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.05, 0.22 - h / (140 * s))})`;
  ctx.beginPath();
  ctx.ellipse(it.x * s, floorY - 1.5 * s, w * s * (1 + h / (260 * s)), 0.7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawItem(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number, fx?: ItemFx): void {
  ctx.save();
  ctx.translate(it.x * s, it.y * s);
  // 手感动效：速度对齐的拉伸（动感）+ 弹跳挤压（冲击），两者都绕本体原点，保体积
  const speed = it.speed ?? 0;
  const stretch = ItemFx.stretch(speed);
  const pop = fx?.scaleOf(it.id);
  if (pop) ctx.scale(pop.sx, pop.sy);
  if (stretch > 0 && (it.speedY ?? 0) !== 0) {
    const a = Math.atan2(it.speedY ?? 0, it.speedX ?? 1);
    ctx.rotate(a);
    ctx.scale(1 + stretch, 1 - stretch * 0.7);
    ctx.rotate(-a);
  }
  if (it.t === 'roach') drawRoach(ctx, it, s, time);
  else if (it.t === 'locust') drawLocust(ctx, it, s, time);
  else if (it.t === 'scarab') drawScarab(ctx, it, s, time);
  else if (it.t === 'snail') drawSnail(ctx, it, s, time);
  else if (it.t === 'fly') drawFly(ctx, it, s, time);
  else if (it.t === 'firecracker') drawFirecracker(ctx, it, s, time);
  else if (it.t === 'skyrocket') drawSkyrocket(ctx, it, s, time);
  else if (it.t === 'bottle') drawBottle(ctx, it, s, time);
  else if (it.t === 'brick') drawBrick(ctx, it, s);
  else if (it.t === 'glass') drawGlass(ctx, it, s, time);
  else if (it.t === 'sponge') drawSponge(ctx, it, s);
  else if (it.t === 'water') drawWater(ctx, it, s, time);
  else if (it.t === 'oil') drawOil(ctx, it, s, time);
  else if (it.t === 'sand') drawSand(ctx, it, s, time);
  else if (it.t === 'giftbox') drawGiftbox(ctx, it, s);
  else if (it.t === 'wood') drawWood(ctx, it, s, time);
  else if (it.t === 'ice') drawIce(ctx, it, s, time);
  else if (it.t === 'metal') drawMetal(ctx, it, s);
  else if (it.t === 'balloon') drawBalloon(ctx, it, s, time);
  else if (it.t === 'debris') drawDebris(ctx, it, s);
  ctx.restore();
  // 受损血条
  if (it.kind === 'bug' && it.hp != null && it.hp < (it.maxHp ?? 0) && !it.knocked) {
    const w = 8 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(it.x * s - w / 2, (it.y - 7) * s, w, 1.6 * s);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(it.x * s - w / 2, (it.y - 7) * s, (w * Math.max(0, it.hp)) / (it.maxHp ?? 1), 1.6 * s);
  }
}

function knockedTint(ctx: CanvasRenderingContext2D, it: ItemView, s: number, draw: () => void): void {
  if (!it.knocked) {
    draw();
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.rotate(Math.PI); // 翻壳朝天
  draw();
  ctx.restore();
  // 故障火花
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 1 * s;
  const j = Math.random() * 2;
  ctx.beginPath();
  ctx.moveTo(-2 * s, -j * s);
  ctx.lineTo(-1 * s, -1 * s - j * s);
  ctx.stroke();
}

function drawRoach(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  const r = 2.6 * s;
  // 活着时朝向固定（顶视角靠腿动表现移动），被击倒后随物理角度翻滚
  ctx.rotate(it.knocked ? (it.angle ?? 0) : 0);
  // 奔跑时腿部大幅摆动；静立时触角轻摆（生命感）
  const running = (it.speed ?? 0) > 12;
  const idleSway = running ? 0 : Math.sin(time * 3.1 + (it.id ?? 0) * 1.7) * 0.16;
  const wig = running ? Math.sin(time * 20) * 0.35 : idleSway;
  knockedTint(ctx, it, s, () => {
    // 腿
    ctx.strokeStyle = '#5d3a17';
    ctx.lineWidth = 0.5 * s;
    for (let i = -1; i <= 1; i++) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.45, side * r * 0.5);
        ctx.lineTo(i * r * 0.75 + wig * s * side, side * r * 1.15);
        ctx.stroke();
      }
    }
    // 身体：棕壳渐变 + 翅鞘高光
    const bodyG = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.8);
    bodyG.addColorStop(0, it.knocked ? '#9c8a6e' : '#a06a34');
    bodyG.addColorStop(0.55, it.knocked ? '#8c7a5f' : '#8a5a2b');
    bodyG.addColorStop(1, it.knocked ? '#6e604a' : '#6b441f');
    ctx.fillStyle = bodyG;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.35, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 翅鞘高光（左上弧）
    ctx.strokeStyle = 'rgba(255,230,180,0.35)';
    ctx.lineWidth = 0.35 * s;
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, -r * 0.12, r * 0.95, r * 0.5, 0, Math.PI * 1.1, Math.PI * 1.75);
    ctx.stroke();
    // 头
    ctx.fillStyle = it.knocked ? '#6e604a' : '#5d3a17';
    ctx.beginPath();
    ctx.arc(r * 1.15, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    // 触角
    ctx.strokeStyle = it.knocked ? '#6e604a' : '#5d3a17';
    ctx.lineWidth = 0.35 * s;
    ctx.beginPath();
    ctx.moveTo(r * 1.3, -r * 0.2);
    ctx.quadraticCurveTo(r * 2.1, -r * 0.7, r * 2.4, -r * 0.2 + wig * s);
    ctx.moveTo(r * 1.3, r * 0.2);
    ctx.quadraticCurveTo(r * 2.1, r * 0.7, r * 2.4, r * 0.2 - wig * s);
    ctx.stroke();
    // 翅线
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.moveTo(-r * 1.1, 0);
    ctx.lineTo(r * 0.9, 0);
    ctx.stroke();
    // 恐慌速度线：狂奔时身后三道闪线（AI panic 表现标记）
    if (it.aiState === 'panic' && !it.knocked) {
      const flick = Math.sin(time * 26) > 0 ? 0.6 : 0.25;
      ctx.strokeStyle = `rgba(255,209,102,${flick})`;
      ctx.lineWidth = 0.4 * s;
      ctx.beginPath();
      for (const oy of [-0.45, 0, 0.45]) {
        ctx.moveTo(-r * 1.5, oy * r);
        ctx.lineTo(-r * 2.3, oy * r * 1.15);
      }
      ctx.stroke();
    }
  });
}

function drawLocust(ctx: CanvasRenderingContext2D, it: ItemView, s: number, _time: number): void {
  const r = 2.4 * s;
  knockedTint(ctx, it, s, () => {
    ctx.rotate(it.knocked ? (it.angle ?? 0) : -0.35);
    // 后腿
    ctx.strokeStyle = '#4c7028';
    ctx.lineWidth = 0.7 * s;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.4);
    ctx.lineTo(-r * 0.9, -r * 1.2);
    ctx.lineTo(-r * 1.3, -r * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, r * 0.4);
    ctx.lineTo(-r * 0.9, r * 1.2);
    ctx.lineTo(-r * 1.3, r * 0.2);
    ctx.stroke();
    // 身体
    ctx.fillStyle = it.knocked ? '#7f9166' : '#6a9c3f';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.5, r * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    // 头 + 触角
    ctx.fillStyle = it.knocked ? '#5f7049' : '#4c7028';
    ctx.beginPath();
    ctx.arc(r * 1.4, 0, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4c7028';
    ctx.lineWidth = 0.3 * s;
    ctx.beginPath();
    ctx.moveTo(r * 1.6, -r * 0.2);
    ctx.lineTo(r * 2.5, -r * 0.9);
    ctx.moveTo(r * 1.6, r * 0.2);
    ctx.lineTo(r * 2.5, r * 0.9);
    ctx.stroke();
  });
}

function drawScarab(ctx: CanvasRenderingContext2D, it: ItemView, s: number, _time: number): void {
  const r = 5 * s;
  knockedTint(ctx, it, s, () => {
    // 壳：金属装甲渐变
    const g = ctx.createLinearGradient(-r * 0.8, -r * 0.8, r * 0.8, r * 0.8);
    g.addColorStop(0, it.knocked ? '#4d5764' : '#4d5a6b');
    g.addColorStop(0.5, it.knocked ? '#39424f' : '#39424f');
    g.addColorStop(1, it.knocked ? '#2b323c' : '#2c333d');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    // 装甲高光
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.25, -r * 0.3, r * 0.72, r * 0.4, -0.35, 0, Math.PI * 2);
    ctx.fill();
    // 中缝 + 铆钉
    ctx.strokeStyle = '#232a33';
    ctx.lineWidth = 0.5 * s;
    ctx.beginPath();
    ctx.moveTo(-r * 1.05, 0);
    ctx.lineTo(r * 1.05, 0);
    ctx.stroke();
    for (const [rx, ry] of [
      [-0.6, -0.4],
      [0.6, -0.4],
      [-0.6, 0.4],
      [0.6, 0.4],
    ]) {
      const rg = ctx.createRadialGradient(rx * r - 0.1 * s, ry * r - 0.1 * s, 0, rx * r, ry * r, 0.42 * s);
      rg.addColorStop(0, '#8b98a6');
      rg.addColorStop(1, '#232a33');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(rx * r, ry * r, 0.32 * s, 0, Math.PI * 2);
      ctx.fill();
    }
    // 裂纹
    if (it.cracked) {
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 0.45 * s;
      ctx.beginPath();
      ctx.moveTo(-r * 0.9, -r * 0.3);
      ctx.lineTo(-r * 0.4, 0);
      ctx.lineTo(-r * 0.7, r * 0.4);
      ctx.moveTo(-r * 0.4, 0);
      ctx.lineTo(r * 0.2, r * 0.15);
      ctx.stroke();
      // 裂纹微光
      ctx.strokeStyle = 'rgba(255,179,71,0.4)';
      ctx.lineWidth = 0.9 * s;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, 0);
      ctx.lineTo(r * 0.2, r * 0.15);
      ctx.stroke();
    }
  });
}

function drawFuse(ctx: CanvasRenderingContext2D, it: ItemView, s: number, _time: number, withStem = false): void {
  if (!it.lit) return;
  // withStem（firecracker）：画出引信杆，火花沿曲线按剩余比例回缩（越烧越短）
  // 其余爆炸物：火花固定在原位（与旧版一致）
  let px = -3.2 * s;
  let py = -2.4 * s;
  if (withStem) {
    const frac = it.fuse != null ? Math.max(0.12, Math.min(1, it.fuse / 1.5)) : 1;
    const t = frac;
    px = (1 - t) * (1 - t) * -1.7 * s + 2 * (1 - t) * t * -2.6 * s + t * t * -3.2 * s;
    py = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * -1 * s + t * t * -2.4 * s;
    ctx.strokeStyle = '#8a6d3b';
    ctx.lineWidth = 0.4 * s;
    ctx.beginPath();
    ctx.moveTo(-1.7 * s, 0);
    ctx.quadraticCurveTo(-2.6 * s, -1 * s, px, py);
    ctx.stroke();
  }
  // 火花：抖动弧线 + 加法辉光亮点
  const jx = (Math.random() - 0.5) * 1.4 * s;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + jx, py - 1.2 * s);
  ctx.stroke();
  const g = ctx.createRadialGradient(px + jx, py - 1.4 * s, 0, px + jx, py - 1.4 * s, 2.6 * s);
  g.addColorStop(0, 'rgba(255,240,200,0.9)');
  g.addColorStop(0.4, 'rgba(255,180,80,0.45)');
  g.addColorStop(1, 'rgba(255,140,50,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px + jx, py - 1.4 * s, 2.6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(px + jx, py - 1.4 * s, (0.7 + Math.random() * 0.5) * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFirecracker(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  ctx.rotate(it.angle ?? 0);
  // 纸筒：圆柱渐变（上亮下暗）+ 金箍带
  const g = ctx.createLinearGradient(0, -1.1 * s, 0, 1.1 * s);
  g.addColorStop(0, '#d95445');
  g.addColorStop(0.5, '#c0392b');
  g.addColorStop(1, '#96271c');
  ctx.fillStyle = g;
  roundRect(ctx, -1.7 * s, -1.1 * s, 3.4 * s, 2.2 * s, 0.5 * s);
  ctx.fill();
  // 金色标签带（微渐变）
  const band = ctx.createLinearGradient(0, -1.1 * s, 0, 1.1 * s);
  band.addColorStop(0, '#f2d077');
  band.addColorStop(1, '#d3a944');
  ctx.fillStyle = band;
  ctx.fillRect(-0.5 * s, -1.1 * s, 1 * s, 2.2 * s);
  // 卷纸边缘高光
  ctx.strokeStyle = 'rgba(255,235,200,0.4)';
  ctx.lineWidth = 0.25 * s;
  ctx.beginPath();
  ctx.moveTo(-1.5 * s, -0.95 * s);
  ctx.lineTo(1.5 * s, -0.95 * s);
  ctx.stroke();
  // 引信杆+火花（lit 时随剩余引信回缩）
  drawFuse(ctx, it, s, time, true);
}

function drawThrusterFlame(ctx: CanvasRenderingContext2D, s: number, len: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 外圈柔光
  const halo = ctx.createRadialGradient(0, len * s * 0.4, 0, 0, len * s * 0.4, len * s * 0.9);
  halo.addColorStop(0, 'rgba(255,150,60,0.3)');
  halo.addColorStop(1, 'rgba(255,90,40,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, len * s * 0.4, len * s * 0.9, 0, Math.PI * 2);
  ctx.fill();
  // 主焰舌
  const g = ctx.createLinearGradient(0, 0, 0, len * s);
  g.addColorStop(0, '#fff3c4');
  g.addColorStop(0.5, '#ffb347');
  g.addColorStop(1, 'rgba(255,90,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-0.9 * s, 0);
  ctx.quadraticCurveTo(0, len * s * (0.9 + Math.random() * 0.25), 0.9 * s, 0);
  ctx.fill();
  ctx.restore();
}

function drawSkyrocket(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  // 未点燃：立在地面；飞行：沿 angle 方向
  const a = it.lit ? (it.angle ?? -Math.PI / 2) : -Math.PI / 2;
  ctx.rotate(a + Math.PI / 2);
  if (it.burning) drawThrusterFlame(ctx, s, 6);
  // 箭体：金属渐变
  const g = ctx.createLinearGradient(-1 * s, 0, 1 * s, 0);
  g.addColorStop(0, '#aab6c2');
  g.addColorStop(0.5, '#8d99a6');
  g.addColorStop(1, '#6f7a86');
  ctx.fillStyle = g;
  roundRect(ctx, -1 * s, -3.2 * s, 2 * s, 5 * s, 0.8 * s);
  ctx.fill();
  // 红鼻锥（高光）
  ctx.fillStyle = '#d64541';
  ctx.beginPath();
  ctx.moveTo(0, -4.6 * s);
  ctx.lineTo(-1 * s, -2.9 * s);
  ctx.lineTo(1 * s, -2.9 * s);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(0, -4.5 * s);
  ctx.lineTo(-0.45 * s, -3.5 * s);
  ctx.lineTo(-0.05 * s, -3.4 * s);
  ctx.fill();
  // 尾翼
  ctx.fillStyle = '#b8433a';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 0.9 * s, 1.4 * s);
    ctx.lineTo(side * 1.7 * s, 2.8 * s);
    ctx.lineTo(side * 0.9 * s, 2.4 * s);
    ctx.closePath();
    ctx.fill();
  }
  // 尾杆
  ctx.strokeStyle = '#a5713d';
  ctx.lineWidth = 0.5 * s;
  ctx.beginPath();
  ctx.moveTo(0, 1.8 * s);
  ctx.lineTo(0, 4.6 * s);
  ctx.stroke();
  drawFuse(ctx, it, s, time);
}

function drawBottle(ctx: CanvasRenderingContext2D, it: ItemView, s: number, _time: number): void {
  const a = it.aim ?? it.angle ?? 0;
  ctx.rotate(a);
  if (it.burning || it.lit) drawThrusterFlame(ctx, s, 5);
  // 尾杆
  ctx.strokeStyle = '#a5713d';
  ctx.lineWidth = 0.55 * s;
  ctx.beginPath();
  ctx.moveTo(-3.6 * s, 0);
  ctx.lineTo(-0.6 * s, 0);
  ctx.stroke();
  // 管身
  ctx.fillStyle = '#5b7d99';
  roundRect(ctx, -0.8 * s, -0.8 * s, 3 * s, 1.6 * s, 0.5 * s);
  ctx.fill();
  ctx.fillStyle = '#d64541';
  ctx.beginPath();
  ctx.arc(2.2 * s, 0, 0.8 * s, 0, Math.PI * 2);
  ctx.fill();
  // 配件头
  drawTip(ctx, it, s);
}

function drawTip(ctx: CanvasRenderingContext2D, it: ItemView, s: number): void {
  for (const acc of it.acc ?? []) {
    if (acc === 'toothpick') {
      ctx.strokeStyle = '#e8cfa0';
      ctx.lineWidth = 0.5 * s;
      ctx.beginPath();
      ctx.moveTo(2.6 * s, 0);
      ctx.lineTo(5.2 * s, 0);
      ctx.stroke();
    } else if (acc === 'pin') {
      ctx.strokeStyle = '#c0c8d0';
      ctx.lineWidth = 0.45 * s;
      ctx.beginPath();
      ctx.moveTo(2.6 * s, 0);
      ctx.lineTo(5.6 * s, 0);
      ctx.stroke();
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(3.2 * s, 0, 0.55 * s, 0, Math.PI * 2);
      ctx.fill();
    } else if (acc === 'glue') {
      ctx.fillStyle = 'rgba(80,160,255,0.85)';
      ctx.beginPath();
      ctx.arc(2.9 * s, 0, 0.9 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBrick(ctx: CanvasRenderingContext2D, it: ItemView, s: number): void {
  const w = 9 * s;
  // 砖面：上亮下暗 + 倒角
  const g = ctx.createLinearGradient(0, -w * 0.66, 0, w * 0.66);
  g.addColorStop(0, '#b57e49');
  g.addColorStop(0.5, '#a5713d');
  g.addColorStop(1, '#8a5a2e');
  ctx.fillStyle = g;
  roundRect(ctx, -w, -w * 0.66, w * 2, w * 1.32, 1 * s);
  ctx.fill();
  // 顶面受光
  ctx.fillStyle = 'rgba(255,235,200,0.18)';
  roundRect(ctx, -w + 0.5 * s, -w * 0.66 + 0.4 * s, w * 2 - 1 * s, w * 0.32, 0.7 * s);
  ctx.fill();
  // 砖缝
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 0.4 * s;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(w, 0);
  ctx.moveTo(-w * 0.33, -w * 0.66);
  ctx.lineTo(-w * 0.33, 0);
  ctx.moveTo(w * 0.33, 0);
  ctx.lineTo(w * 0.33, w * 0.66);
  ctx.stroke();
  // 颗粒斑点
  ctx.fillStyle = 'rgba(60,35,15,0.22)';
  for (const [px, py] of [
    [-0.62, -0.3],
    [0.48, -0.28],
    [-0.15, -0.36],
    [0.7, 0.34],
    [-0.52, 0.4],
    [0.12, 0.44],
  ]) {
    ctx.beginPath();
    ctx.arc(px * w, py * w, 0.09 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGlass(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time = 0): void {
  const w = 9 * s;
  ctx.fillStyle = 'rgba(150, 200, 235, 0.4)';
  roundRect(ctx, -w, -w * 0.66, w * 2, w * 1.32, 1 * s);
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,230,255,0.8)';
  ctx.lineWidth = 0.45 * s;
  roundRect(ctx, -w, -w * 0.66, w * 2, w * 1.32, 1 * s);
  ctx.stroke();
  // 高光
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.6, -w * 0.4);
  ctx.lineTo(-w * 0.1, -w * 0.55);
  ctx.stroke();
  // 流动 glint：一颗高光沿顶边缓慢扫过（由坐标派生相位，避免同帧齐闪）
  const phase = ((it.x * 0.13 + it.y * 0.07) % 1 + 1) % 1;
  const t = ((time * 0.18 + phase) % 1 + 1) % 1;
  const gx = (-w + 2 * w * t) * 1;
  const fade = Math.sin(t * Math.PI);
  ctx.fillStyle = `rgba(255,255,255,${0.35 * fade})`;
  ctx.beginPath();
  ctx.ellipse(gx, -w * 0.6, 1.2 * s, 0.35 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // 裂纹
  if (it.cracked) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 0.4 * s;
    ctx.beginPath();
    ctx.moveTo(-w * 0.8, 0);
    ctx.lineTo(-w * 0.3, w * 0.1);
    ctx.lineTo(-w * 0.5, w * 0.45);
    ctx.moveTo(-w * 0.3, w * 0.1);
    ctx.lineTo(w * 0.4, -w * 0.2);
    ctx.stroke();
  }
}

function drawWater(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  const w = (it.radius ?? 16) * s;
  const wob = Math.sin(time * 2.2) * 1.2 * s;
  // 盆底深水
  const g = ctx.createRadialGradient(-w * 0.2, 0, 0, 0, 2 * s, w);
  g.addColorStop(0, 'rgba(90, 165, 220, 0.42)');
  g.addColorStop(1, 'rgba(50, 110, 175, 0.3)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 2 * s, w, w * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // 涟漪高光（慢速晃动）
  ctx.fillStyle = 'rgba(140, 205, 245, 0.4)';
  ctx.beginPath();
  ctx.ellipse(-w * 0.15, (2.6 + wob * 0.04) * s, w * 0.62, w * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  // 水面闪点（随时间游动）
  ctx.fillStyle = 'rgba(220, 245, 255, 0.65)';
  for (const [px, py, ph] of [
    [-0.35, -0.05, 0],
    [0.3, 0.12, 2.1],
    [0.02, 0.02, 4.2],
  ] as const) {
    const tw = 0.5 + 0.5 * Math.sin(time * 3 + ph);
    ctx.globalAlpha = 0.25 + 0.55 * tw;
    ctx.beginPath();
    ctx.ellipse(px * w, (2 + py * w * 0.4) * s, (0.1 + tw * 0.06) * w, (0.035 + tw * 0.02) * w, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 盆沿
  ctx.strokeStyle = 'rgba(190, 230, 255, 0.7)';
  ctx.lineWidth = 0.45 * s;
  ctx.beginPath();
  ctx.ellipse(0, 2 * s, w, w * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
  // 环境涟漪：一圈缓慢扩散消隐的水纹（周期循环）
  const rp = ((time * 0.33 + it.x * 0.11) % 1 + 1) % 1;
  ctx.strokeStyle = `rgba(190, 230, 255, ${0.3 * Math.sin(rp * Math.PI)})`;
  ctx.lineWidth = 0.35 * s;
  ctx.beginPath();
  ctx.ellipse(0, 2 * s, w * 0.25 + rp * w * 0.7, (w * 0.25 + rp * w * 0.7) * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
}
function drawGiftbox(ctx: CanvasRenderingContext2D, it: ItemView, s: number): void {
  const w = 8 * s;
  // 盒身：竖直渐变（顶亮）
  const g = ctx.createLinearGradient(0, -w * 0.8, 0, w * 0.8);
  if (it.cracked) {
    g.addColorStop(0, '#e08698');
    g.addColorStop(1, '#c56a7d');
  } else {
    g.addColorStop(0, '#e2688a');
    g.addColorStop(1, '#c24560');
  }
  ctx.fillStyle = g;
  roundRect(ctx, -w, -w * 0.8, w * 2, w * 1.6, 1.2 * s);
  ctx.fill();
  // 盒盖分割线
  ctx.strokeStyle = 'rgba(60,20,30,0.35)';
  ctx.lineWidth = 0.4 * s;
  ctx.beginPath();
  ctx.moveTo(-w, -w * 0.34);
  ctx.lineTo(w, -w * 0.34);
  ctx.stroke();
  // 缎带（带渐变高光）
  const rb = ctx.createLinearGradient(0, -w * 0.8, 0, w * 0.8);
  rb.addColorStop(0, '#fbe08a');
  rb.addColorStop(1, '#e5bd55');
  ctx.fillStyle = rb;
  ctx.fillRect(-w * 0.22, -w * 0.8, w * 0.44, w * 1.6);
  ctx.fillRect(-w, -w * 0.12, w * 2, w * 0.28);
  // 蝴蝶结双环
  ctx.strokeStyle = rb;
  ctx.lineWidth = 0.5 * s;
  ctx.beginPath();
  ctx.ellipse(-w * 0.3, -w * 0.85, w * 0.26, w * 0.17, -0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(w * 0.3, -w * 0.85, w * 0.26, w * 0.17, 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f5d06a';
  ctx.beginPath();
  ctx.arc(0, -w * 0.82, w * 0.11, 0, Math.PI * 2);
  ctx.fill();
  if (it.cracked) {
    ctx.strokeStyle = 'rgba(60,20,30,0.8)';
    ctx.lineWidth = 0.5 * s;
    ctx.beginPath();
    ctx.moveTo(-w * 0.7, -w * 0.5);
    ctx.lineTo(-w * 0.2, 0);
    ctx.lineTo(-w * 0.5, w * 0.5);
    ctx.stroke();
  }
}

function drawWood(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  const w = 10 * s;
  // 板身：木纹渐变
  const g = ctx.createLinearGradient(0, -w * 0.35, 0, w * 0.35);
  if (it.onFire) {
    g.addColorStop(0, '#96622f');
    g.addColorStop(1, '#6f4420');
  } else {
    g.addColorStop(0, '#a87844');
    g.addColorStop(1, '#8c5c32');
  }
  ctx.fillStyle = g;
  roundRect(ctx, -w, -w * 0.35, w * 2, w * 0.7, 1.5 * s);
  ctx.fill();
  // 板端面（年轮头）
  ctx.fillStyle = it.onFire ? '#7a4c22' : '#95652f';
  ctx.beginPath();
  ctx.ellipse(-w + 1.2 * s, 0, 0.9 * s, w * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // 木纹
  ctx.strokeStyle = 'rgba(70,40,15,0.6)';
  ctx.lineWidth = 0.4 * s;
  for (const gx of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(gx * w, -w * 0.3);
    ctx.lineTo(gx * w, w * 0.3);
    ctx.stroke();
  }
  if (it.onFire) {
    // 灼烧黑边
    ctx.strokeStyle = 'rgba(30,18,10,0.8)';
    ctx.lineWidth = 0.9 * s;
    ctx.beginPath();
    ctx.moveTo(-w + 1.5 * s, -w * 0.22);
    ctx.lineTo(w - 1.5 * s, -w * 0.22);
    ctx.stroke();
    // 加法火光 + 舔动的火舌
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.95);
    fg.addColorStop(0, 'rgba(255,170,60,0.5)');
    fg.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.95 * (0.85 + Math.sin(time * 22) * 0.15), 0, Math.PI * 2);
    ctx.fill();
    // 三簇小火舌
    ctx.fillStyle = 'rgba(255,190,80,0.65)';
    for (const [fx, fh, fp] of [
      [-w * 0.45, 1.5, 0],
      [0, 1.9, 2],
      [w * 0.45, 1.4, 4],
    ] as const) {
      const flick = 0.75 + 0.25 * Math.sin(time * 17 + fp);
      ctx.beginPath();
      ctx.moveTo(fx - 1.4 * s, -w * 0.3);
      ctx.quadraticCurveTo(fx, -w * 0.3 - fh * s * 2.4 * flick, fx + 1.4 * s, -w * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawIce(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  const w = 12 * s;
  const g = ctx.createRadialGradient(-w * 0.25, -w * 0.1, 0, 0, 1 * s, w);
  g.addColorStop(0, 'rgba(215, 242, 252, 0.6)');
  g.addColorStop(1, 'rgba(165, 215, 240, 0.42)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 1 * s, w, w * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(235, 250, 255, 0.9)';
  ctx.lineWidth = 0.5 * s;
  ctx.stroke();
  // 冰面棱面反光
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, -w * 0.05);
  ctx.lineTo(-w * 0.15, -w * 0.16);
  ctx.moveTo(w * 0.1, w * 0.12);
  ctx.lineTo(w * 0.5, w * 0.02);
  ctx.stroke();
  // 高光星点（呼吸闪烁，相位由坐标派生）
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  for (const [px, py, ph] of [
    [-0.4, -0.12, 0],
    [0.32, -0.05, 2.3],
  ] as const) {
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 2.1 + ph + it.x * 0.31));
    ctx.globalAlpha = tw;
    ctx.beginPath();
    ctx.moveTo(px * w - 0.12 * w, py * w);
    ctx.lineTo(px * w + 0.12 * w, py * w);
    ctx.moveTo(px * w, py * w - 0.05 * w);
    ctx.lineTo(px * w, py * w + 0.05 * w);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawMetal(ctx: CanvasRenderingContext2D, it: ItemView, s: number): void {
  const w = 9 * s;
  const g = ctx.createLinearGradient(0, -w * 0.5, 0, w * 0.5);
  g.addColorStop(0, '#c6cfd9');
  g.addColorStop(0.45, '#98a3ae');
  g.addColorStop(0.55, '#828d99');
  g.addColorStop(1, '#6f7a86');
  ctx.fillStyle = g;
  roundRect(ctx, -w, -w * 0.5, w * 2, w, 1.5 * s);
  ctx.fill();
  // 顶部拉丝高光
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.3 * s;
  ctx.beginPath();
  ctx.moveTo(-w * 0.8, -w * 0.34);
  ctx.lineTo(w * 0.8, -w * 0.34);
  ctx.stroke();
  // 铆钉（金属小渐变）
  for (const [px, py] of [
    [-0.75, -0.28],
    [0.75, -0.28],
    [-0.75, 0.28],
    [0.75, 0.28],
  ]) {
    const rg = ctx.createRadialGradient(px * w - 0.1 * s, py * w - 0.1 * s, 0, px * w, py * w, 0.42 * s);
    rg.addColorStop(0, '#e6ecf2');
    rg.addColorStop(1, '#59626c');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(px * w, py * w, 0.32 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSand(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  const w = 13 * s;
  ctx.fillStyle = '#e2c98f';
  ctx.beginPath();
  ctx.ellipse(0, 1.5 * s, w, w * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // 风纹：一道暗带缓慢游移（风吹沙动）
  {
    const t = ((time * 0.1 + it.x * 0.19) % 1 + 1) % 1;
    ctx.strokeStyle = `rgba(160, 130, 70, ${0.3 * Math.sin(t * Math.PI)})`;
    ctx.lineWidth = 0.6 * s;
    ctx.beginPath();
    ctx.ellipse(0, 1.5 * s, w * 0.55, w * 0.2, t * 0.16 - 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(160,130,70,0.6)';
  for (const [px, py] of [
    [-0.5, -0.1],
    [0.1, 0.1],
    [0.5, -0.05],
    [-0.1, 0.2],
  ]) {
    ctx.beginPath();
    ctx.arc(px * w, py * w, 0.05 * w, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOil(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  const w = (it.radius ?? 14) * s;
  const g = ctx.createRadialGradient(-w * 0.2, 0, 0, 0, 2 * s, w);
  g.addColorStop(0, 'rgba(78, 60, 95, 0.6)');
  g.addColorStop(1, 'rgba(44, 32, 56, 0.5)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 2 * s, w, w * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // 虹彩高光（两道异色弧随时间漂移）
  const ir = Math.sin(time * 1.4) * 0.05;
  ctx.strokeStyle = 'rgba(180, 140, 220, 0.5)';
  ctx.lineWidth = 0.4 * s;
  ctx.beginPath();
  ctx.ellipse(-w * (0.2 + ir), 1.6 * s, w * 0.4, w * 0.14, -0.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120, 200, 190, 0.4)';
  ctx.beginPath();
  ctx.ellipse(w * (0.18 - ir), 2.5 * s, w * 0.3, w * 0.1, 0.15, 0, Math.PI * 2);
  ctx.stroke();
  // 上浮气泡：一颗气泡缓慢升起破裂（周期循环，与水盆涟漪对仗）
  {
    const bp = ((time * 0.42 + it.x * 0.17) % 1 + 1) % 1;
    const by = 2 * s - bp * w * 0.5;
    const bs = (0.25 + bp * 0.5) * Math.sin(bp * Math.PI) * 2 + 0.3;
    ctx.strokeStyle = `rgba(190, 160, 230, ${0.5 * Math.sin(bp * Math.PI)})`;
    ctx.lineWidth = 0.3 * s;
    ctx.beginPath();
    ctx.arc(-w * 0.3, by, 1.2 * s * bs, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (it.onFire) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fg = ctx.createRadialGradient(0, 0, 0, 0, 0, w);
    fg.addColorStop(0, 'rgba(255,150,40,0.6)');
    fg.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(0, 0, w * (0.9 + Math.sin(time * 18) * 0.1), w * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawSponge(ctx: CanvasRenderingContext2D, it: ItemView, s: number): void {
  const w = 10 * s;
  ctx.fillStyle = '#e8d06a';
  roundRect(ctx, -w, -w * 0.5, w * 2, w, 2 * s);
  ctx.fill();
  // 气孔
  ctx.fillStyle = 'rgba(140,110,40,0.5)';
  for (const [px, py, pr] of [
    [-0.6, -0.2, 0.1],
    [0.2, 0.15, 0.13],
    [0.55, -0.25, 0.09],
    [-0.15, 0.25, 0.11],
    [0.65, 0.2, 0.08],
  ]) {
    ctx.beginPath();
    ctx.arc(px * w, py * w, pr * w, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDebris(ctx: CanvasRenderingContext2D, it: ItemView, s: number): void {
  // 玻璃碎片：棱面渐变三角 + 边缘高光
  const g = ctx.createLinearGradient(-2 * s, -2.4 * s, 2 * s, 1.8 * s);
  g.addColorStop(0, 'rgba(200, 230, 250, 0.95)');
  g.addColorStop(0.55, 'rgba(170, 215, 245, 0.75)');
  g.addColorStop(1, 'rgba(140, 190, 225, 0.6)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -2.4 * s);
  ctx.lineTo(2 * s, 1.6 * s);
  ctx.lineTo(-1.8 * s, 1.8 * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 0.3 * s;
  ctx.beginPath();
  ctx.moveTo(0, -2.4 * s);
  ctx.lineTo(2 * s, 1.6 * s);
  ctx.stroke();
}

function drawSnail(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  const r = 3 * s;
  const face = it.knocked ? 1 : Math.sign(it.speedX ?? 1);
  knockedTint(ctx, it, s, () => {
    // 腹足（爬行时轻微蠕动波纹）
    const crawl = !it.knocked && (it.speed ?? 0) > 1 ? Math.sin(time * 8 + (it.id ?? 0)) * 0.05 : 0;
    ctx.fillStyle = it.knocked ? '#9aa38a' : '#b7c98a';
    ctx.beginPath();
    ctx.ellipse(-face * r * 0.3, r * 0.45, r * 1.25, r * (0.42 + crawl), 0, 0, Math.PI * 2);
    ctx.fill();
    // 足底反光
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(-face * r * 0.3, r * 0.58, r * 0.95, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    // 壳（径向渐变 + 螺旋）
    const sg = ctx.createRadialGradient(face * r * 0.25 - r * 0.3, -r * 0.25 - r * 0.3, 0, face * r * 0.25, -r * 0.25, r);
    sg.addColorStop(0, it.knocked ? '#a89a7d' : '#dcba78');
    sg.addColorStop(1, it.knocked ? '#8d7f66' : '#c9a15f');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(face * r * 0.25, -r * 0.25, r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,60,20,0.7)';
    ctx.lineWidth = 0.4 * s;
    ctx.beginPath();
    ctx.arc(face * r * 0.25, -r * 0.25, r * 0.6, 0.5, 4.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(face * r * 0.25, -r * 0.25, r * 0.28, 1, 5);
    ctx.stroke();
    // 壳缘高光
    ctx.strokeStyle = 'rgba(255,240,200,0.4)';
    ctx.lineWidth = 0.3 * s;
    ctx.beginPath();
    ctx.arc(face * r * 0.25, -r * 0.25, r * 0.92, Math.PI * 1.15, Math.PI * 1.7);
    ctx.stroke();
    // 眼触角（闲时轻摇）
    if (!it.knocked) {
      const stalk = Math.sin(time * 2.2 + (it.id ?? 0) * 1.3) * 0.1 * r;
      ctx.strokeStyle = '#b7c98a';
      ctx.lineWidth = 0.3 * s;
      ctx.beginPath();
      ctx.moveTo(-face * r * 1.2, r * 0.2);
      ctx.lineTo(-face * r * 1.7, -r * 0.5 + stalk);
      ctx.stroke();
      ctx.fillStyle = '#b7c98a';
      ctx.beginPath();
      ctx.arc(-face * r * 1.7, -r * 0.55 + stalk, 0.22 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawFly(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  const r = 2 * s;
  const dirX = (it.speedX ?? 0) >= 0 ? 1 : -1;
  knockedTint(ctx, it, s, () => {
    // 悬停浮动（生命感）：被击倒后不浮动（随物理翻滚）
    if (!it.knocked) {
      ctx.translate(0, Math.sin(time * 6.3 + (it.id ?? 0) * 2.1) * 0.7 * s);
    }
    // 翅膀（高频扇动 + 运动模糊残影）
    const flap = Math.sin(time * 60) * 0.8;
    for (const side of [-1, 1]) {
      // 残影（半透明扇面）
      ctx.fillStyle = 'rgba(200,220,255,0.16)';
      ctx.beginPath();
      ctx.ellipse(-dirX * r * 0.3, side * r * 0.5, r * 1.05, r * (0.55 + Math.abs(flap) * 0.35), flap * side * 0.5, 0, Math.PI * 2);
      ctx.fill();
      // 实翅
      ctx.fillStyle = 'rgba(210,230,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(-dirX * r * 0.3, side * r * 0.5, r * 0.9, r * (0.35 + Math.abs(flap) * 0.3), flap * side * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // 身体：深色金属渐变
    const g = ctx.createLinearGradient(0, -r * 0.75, 0, r * 0.75);
    g.addColorStop(0, it.knocked ? '#8b96a3' : '#5d636e');
    g.addColorStop(1, it.knocked ? '#7d8896' : '#3c4048');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    // 复眼（双点 + 高光）
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(dirX * r * 0.8, -r * 0.2, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(dirX * r * 0.9, -r * 0.28, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSlime(ctx: CanvasRenderingContext2D, p: SlimeDrop, s: number): void {
  const fade = Math.max(0, 1 - p.age / p.ttl);
  ctx.fillStyle = `rgba(150, 220, 140, ${0.3 * fade})`;
  ctx.beginPath();
  ctx.ellipse(p.x * s, p.y * s, p.r * s, p.r * 0.42 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(190, 240, 170, ${0.22 * fade})`;
  ctx.beginPath();
  ctx.ellipse((p.x + p.r * 0.3) * s, (p.y - 1) * s, p.r * 0.55 * s, p.r * 0.26 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // 黏液高光点
  ctx.fillStyle = `rgba(235, 255, 225, ${0.35 * fade})`;
  ctx.beginPath();
  ctx.ellipse((p.x - p.r * 0.35) * s, (p.y - 0.6) * s, p.r * 0.16 * s, p.r * 0.08 * s, -0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawRope(ctx: CanvasRenderingContext2D, r: RopeView, s: number): void {
  const dx = r.bx - r.ax;
  const dy = r.by - r.ay;
  const d = Math.hypot(dx, dy);
  const sag = Math.min(14, Math.max(0, 24 - d * 0.12));
  ctx.strokeStyle = '#c9a86a';
  ctx.lineWidth = 0.55 * s;
  ctx.beginPath();
  ctx.moveTo(r.ax * s, r.ay * s);
  ctx.quadraticCurveTo(((r.ax + r.bx) / 2) * s, ((r.ay + r.by) / 2 + sag) * s, r.bx * s, r.by * s);
  ctx.stroke();
}

function drawAim(ctx: CanvasRenderingContext2D, it: ItemView, s: number): void {
  const a = it.aim ?? 0;
  const ex = it.x * s + Math.cos(a) * 16 * s;
  const ey = it.y * s + Math.sin(a) * 16 * s;
  // 主虚线 + 底下一条加法辉光线（发光瞄准）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(126,200,255,0.18)';
  ctx.lineWidth = 2.2 * s;
  ctx.beginPath();
  ctx.moveTo(it.x * s, it.y * s);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(126,200,255,0.8)';
  ctx.lineWidth = 0.5 * s;
  ctx.setLineDash([2 * s, 2 * s]);
  ctx.beginPath();
  ctx.moveTo(it.x * s, it.y * s);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  // 箭头
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(a - 0.4) * 2.4 * s, ey - Math.sin(a - 0.4) * 2.4 * s);
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(a + 0.4) * 2.4 * s, ey - Math.sin(a + 0.4) * 2.4 * s);
  ctx.stroke();
}

// 运行中拖拽投掷点燃炮仗的预览：起投点画一根点着的炮仗 + 重力弹道预测点（加法辉光渐隐）
function drawThrowPreview(ctx: CanvasRenderingContext2D, t: ThrowPreview, s: number): void {
  const l = Math.hypot(t.vx, t.vy);
  if (l < 10) return;
  // 弹道预测：粗积分重力（与模拟同 g=560）
  let px = t.x;
  let py = t.y;
  const vx = t.vx;
  let vy = t.vy;
  const stepDt = 1 / 20;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 8; i++) {
    vy += 560 * stepDt;
    px += vx * stepDt;
    py += vy * stepDt;
    if (px < 2 || px > 298 || py < 2 || py > 178) break;
    ctx.globalAlpha = 0.8 - i * 0.09;
    ctx.fillStyle = 'rgba(255,217,160,0.9)';
    ctx.beginPath();
    ctx.arc(px * s, py * s, 0.9 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = (0.8 - i * 0.09) * 0.35;
    ctx.beginPath();
    ctx.arc(px * s, py * s, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // 起投点：一根点着的炮仗（带引信火花感）
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(t.x * s, t.y * s, 1.6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc((t.x + (t.vx / l) * 2.4) * s, (t.y + (t.vy / l) * 2.4) * s, 0.7 * s, 0, Math.PI * 2);
  ctx.fill();
}

// 气球：球体+系结，随时间轻微摇曳（绳的连接感交给绳子渲染）。
// 注意：drawItem 已 translate 到本体原点 —— 这里必须用原点坐标画（R91 修复双重位移 bug）。
function drawBalloon(ctx: CanvasRenderingContext2D, it: ItemView, s: number, time: number): void {
  const sway = Math.sin(time * 2.6 + it.x * 0.7) * 0.8 * s;
  // 系绳（原点下方一小段；运行中被绳子吊起时由绳子渲染承担连接）
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.5 * s;
  ctx.beginPath();
  ctx.moveTo(0, 8 * s);
  ctx.quadraticCurveTo(sway, 14 * s, sway * 0.6, 20 * s);
  ctx.stroke();
  // 球体：径向渐变 + 高光 + 球结
  const g = ctx.createRadialGradient(-2 * s, -3 * s, s, 0, 0, 8 * s);
  g.addColorStop(0, '#ffb0a0');
  g.addColorStop(0.55, '#ff8a78');
  g.addColorStop(1, '#d85046');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.2 * s, 7.2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // 底部反光
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.ellipse(1.5 * s, 3.6 * s, 2.6 * s, 1.2 * s, 0.4, 0, Math.PI * 2);
  ctx.fill();
  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.ellipse(-2.2 * s, -2.8 * s, 1.4 * s, 2 * s, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // 球结
  ctx.fillStyle = '#b8433a';
  ctx.beginPath();
  ctx.moveTo(-1.3 * s, 6.8 * s);
  ctx.lineTo(1.3 * s, 6.8 * s);
  ctx.lineTo(0, 8.6 * s);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
