// PixiJS 垂直切片主程序 —— 案例1「连环风暴」表现层重做实验（09-24）。
//
// 铁律（与主游戏一致）：
// 1. sim 层零改动：只 import 编译产物 /src/sim/*.js 与 /src/game/scenario.js，绝不 import ui 层。
// 2. 确定性归 sim：本文件可随便用 Math.random / 时间（表现层无确定性约束）。
// 3. 输入与游戏逐位一致：实体/点燃节奏由 case1-setup.js 复刻 editor.buildEntities 语义。
//
// 本文件是 A/B 实验件：不进 npm test 门禁（eslint 已 ignore slice/），可整目录丢弃重写。
import {
  Application,
  Container,
  Sprite,
  Texture,
  Graphics,
  Filter,
  GlProgram,
  UniformGroup,
  RenderTexture,
  BlurFilter,
  defaultFilterVert,
} from 'pixi.js';
import { Simulation, DT } from '/src/sim/sim.js';
import { getScenario } from '/src/game/scenario.js';
import { BUGS, EXPLOSIVES } from '/src/game/catalog.js';
import { buildEntitiesFor } from './case1-setup.js';

// ---- 常量（与 ui/render.ts 的 VIEW_W/VIEW_H 对齐，避免 import ui 层） ----
const VIEW_W = 300;
const VIEW_H = 180;
const S = 3.2; // 960/300 —— 世界单位 → 屏幕像素

const $ = (id) => document.getElementById(id);
const els = {
  exp: $('st-exp'), chain: $('st-chain'), ko: $('st-ko'), multi: $('st-multi'),
  perf: $('st-perf'), status: $('status'), checksum: $('checksum'), err: $('err'),
  ignite: $('ignite'), reset: $('reset'), stage: $('stage'),
};

// ============================================================
// 程序化纹理：全部位图一次性预渲染（真 sprite 路线，无逐帧矢量绘制）
// ============================================================
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return Texture.from(c);
}

function radial(ctx, w, h, stops) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

const TEX = {
  glow: canvasTex(256, 256, (ctx, w, h) =>
    radial(ctx, w, h, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']])),
  spark: canvasTex(48, 48, (ctx, w, h) =>
    radial(ctx, w, h, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']])),
  smoke: canvasTex(128, 128, (ctx, w, h) =>
    radial(ctx, w, h, [[0, 'rgba(200,200,205,.8)'], [0.6, 'rgba(180,180,188,.35)'], [1, 'rgba(170,170,180,0)']])),
  debris: canvasTex(32, 32, (ctx) => {
    // 纸屑碎片（炮仗纸筒炸开的碎纸）
    ctx.fillStyle = '#f2e9dc';
    ctx.fillRect(6, 10, 20, 12);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fillRect(6, 18, 20, 4);
  }),
  ring: canvasTex(128, 128, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 12, 0, Math.PI * 2);
    ctx.stroke();
  }),
  roach: canvasTex(128, 128, (ctx) => {
    // 玩具蟑螂：棕色渐变壳 + 高光 + 头部（朝右）
    const g = ctx.createLinearGradient(20, 30, 108, 98);
    g.addColorStop(0, '#8a4a22'); g.addColorStop(.5, '#6b3418'); g.addColorStop(1, '#4a2210');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(64, 64, 44, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a1a0c';
    ctx.beginPath(); ctx.ellipse(98, 64, 14, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,180,.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(58, 56, 36, 10, 0, Math.PI, Math.PI * 1.85); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,14,6,.8)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(108, 56); ctx.quadraticCurveTo(120, 42, 126, 36); ctx.stroke();
  }),
  locust: canvasTex(128, 128, (ctx) => {
    // 玩具蝗虫：绿身 + 大后腿（朝右）
    const g = ctx.createLinearGradient(24, 40, 104, 88);
    g.addColorStop(0, '#7ea83e'); g.addColorStop(1, '#4c6e24');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(60, 62, 38, 16, -.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8fb44a';
    ctx.beginPath(); ctx.ellipse(96, 56, 16, 10, -.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#33491a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(46, 70); ctx.lineTo(30, 88); ctx.lineTo(16, 84); ctx.stroke();
  }),
  firecracker: canvasTex(128, 128, (ctx) => {
    // 小炮仗：红纸筒 + 金标带（立式，点燃引信后旋转）
    const g = ctx.createLinearGradient(44, 0, 84, 0);
    g.addColorStop(0, '#c62f2f'); g.addColorStop(.45, '#e84444'); g.addColorStop(1, '#8e1f1f');
    ctx.fillStyle = g;
    roundRect(ctx, 46, 30, 36, 70, 6); ctx.fill();
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(46, 56, 36, 12);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(46, 30, 5, 70);
  }),
  skyrocket: canvasTex(128, 128, (ctx) => {
    // 冲天炮：金属箭体 + 红头锥 + 尾翼（立式，朝上）
    const g = ctx.createLinearGradient(48, 0, 80, 0);
    g.addColorStop(0, '#b9c2cc'); g.addColorStop(.5, '#eef2f6'); g.addColorStop(1, '#8b95a1');
    ctx.fillStyle = g;
    roundRect(ctx, 52, 40, 24, 66, 4); ctx.fill();
    ctx.fillStyle = '#d84343';
    ctx.beginPath(); ctx.moveTo(64, 10); ctx.lineTo(78, 42); ctx.lineTo(50, 42); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a6470';
    ctx.beginPath(); ctx.moveTo(52, 106); ctx.lineTo(40, 120); ctx.lineTo(52, 120); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(76, 106); ctx.lineTo(88, 120); ctx.lineTo(76, 120); ctx.closePath(); ctx.fill();
  }),
  bottle: canvasTex(128, 128, (ctx) => {
    // 窜天猴：细竹签 + 弹头（立式，朝上）
    ctx.strokeStyle = '#caa06a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(64, 122); ctx.lineTo(64, 44); ctx.stroke();
    const g = ctx.createLinearGradient(52, 0, 76, 0);
    g.addColorStop(0, '#d84343'); g.addColorStop(.5, '#f06a5a'); g.addColorStop(1, '#a02a2a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(64, 8); ctx.quadraticCurveTo(78, 30, 74, 48);
    ctx.lineTo(54, 48); ctx.quadraticCurveTo(50, 30, 64, 8); ctx.fill();
  }),
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 桌面 + 玻璃盒背景：Canvas2D 画一次成纹理（API 零风险，一次成本）
const bgTex = canvasTex(960, 576, (ctx) => {
  const desk = ctx.createLinearGradient(0, 0, 0, 576);
  desk.addColorStop(0, '#2a2f3a'); desk.addColorStop(.55, '#20242d'); desk.addColorStop(1, '#161920');
  ctx.fillStyle = desk; ctx.fillRect(0, 0, 960, 576);
  // 台灯辉光（左上暖光）
  const lamp = ctx.createRadialGradient(200, 60, 20, 200, 60, 520);
  lamp.addColorStop(0, 'rgba(255,214,150,.20)'); lamp.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = lamp; ctx.fillRect(0, 0, 960, 576);
  // 玻璃盒内部（世界 300×180 → 960×576）：后壁光 + 地面沉降
  const inner = ctx.createLinearGradient(0, 0, 0, 576);
  inner.addColorStop(0, 'rgba(120,150,190,.10)'); inner.addColorStop(.8, 'rgba(10,12,16,.30)');
  ctx.fillStyle = inner; ctx.fillRect(0, 0, 960, 576);
  const floor = ctx.createLinearGradient(0, 500, 0, 576);
  floor.addColorStop(0, 'rgba(0,0,0,0)'); floor.addColorStop(1, 'rgba(0,0,0,.42)');
  ctx.fillStyle = floor; ctx.fillRect(0, 500, 960, 76);
  // 金属边框
  ctx.strokeStyle = 'rgba(190,200,215,.55)'; ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 956, 572);
  ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
  ctx.strokeRect(8, 8, 944, 560);
});

// ============================================================
// Pixi 舞台与图层
// ============================================================
const app = new Application();
await app.init({
  width: 960, height: 576, backgroundColor: '#0b0e14',
  antialias: true, powerPreference: 'high-performance',
  resolution: Math.min(2, window.devicePixelRatio || 1), // 高 DPI 锐化（同主游戏 R155）
  autoDensity: true,
});
els.stage.appendChild(app.canvas);

const worldC = new Container(); // 世界坐标（300×180），scale=S，pivot 在盒心
worldC.pivot.set(VIEW_W / 2, VIEW_H / 2);
worldC.position.set(480, 270);
app.stage.addChild(worldC);

const bg = new Sprite(bgTex);
bg.scale.set(960 / bgTex.width); // 1:1
worldC.addChild(bg);

const ropeG = new Graphics();       // 绳子（最底层线材）
const bodyC = new Container();      // 物体 sprite
const smokeC = new Container();     // 普通混合：烟
const fxAddC = new Container();     // 加法混合：辉光/火花/冲击环
worldC.addChild(ropeG, bodyC, smokeC, fxAddC);

// 亮度阈值 pass：只有亮部（闪光/火花/引信辉光）能进 bloom，暗背景/物体归零 —— 否则整帧灰雾
const thresholdFilter = new Filter({
  glProgram: GlProgram.from({
    vertex: defaultFilterVert,
    fragment: `
      in vec2 vTextureCoord;
      out vec4 finalColor;
      uniform sampler2D uTexture;
      uniform float uThreshold;
      void main() {
        vec4 c = texture(uTexture, vTextureCoord);
        float l = max(max(c.r, c.g), c.b);
        float k = clamp((l - uThreshold) / max(1.0 - uThreshold, 0.001), 0.0, 1.0);
        finalColor = vec4(c.rgb * k, c.a);
      }`,
  }),
  resources: { thU: new UniformGroup({ uThreshold: { value: 0.5, type: 'f32' } }) },
});

// 真 bloom：整帧渲染进半分辨率 RT → 阈值提取亮部 → 高斯模糊 → 加法叠回
const bloomRT = RenderTexture.create({ width: 480, height: 288 });
const bloomSprite = new Sprite(bloomRT);
bloomSprite.scale.set(2); // 覆盖 960×576
bloomSprite.blendMode = 'add';
bloomSprite.alpha = 0.55;
bloomSprite.filters = [thresholdFilter, new BlurFilter({ strength: 8, quality: 2 })];
app.stage.addChild(bloomSprite);

// 屏幕空间畸变冲击波（自定义 shader：径向位移 + 波前色散）
const shockFilter = new Filter({
  glProgram: GlProgram.from({
    vertex: defaultFilterVert,
    fragment: `
      in vec2 vTextureCoord;
      out vec4 finalColor;
      uniform sampler2D uTexture;
      uniform float uCenterX;
      uniform float uCenterY;
      uniform float uTime;
      uniform float uStrength;
      uniform float uAspect;
      void main() {
        vec2 uv = vTextureCoord;
        vec2 dir = uv - vec2(uCenterX, uCenterY);
        dir.x *= uAspect;
        float d = length(dir);
        float dd = d - uTime * 0.62;
        float env = exp(-55.0 * dd * dd) * uStrength * (1.0 - uTime);
        vec2 n = d > 0.0001 ? dir / d : vec2(0.0);
        vec2 off = n * env * 0.020;
        off.x /= uAspect;
        float ca = env * 0.012;
        float r = texture(uTexture, uv + off + vec2(ca, 0.0)).r;
        float g = texture(uTexture, uv + off).g;
        float b = texture(uTexture, uv + off - vec2(ca, 0.0)).b;
        finalColor = vec4(r, g, b, 1.0);
      }`,
  }),
  resources: {
    shockU: new UniformGroup({
      uCenterX: { value: 0.5, type: 'f32' },
      uCenterY: { value: 0.5, type: 'f32' },
      uTime: { value: 1, type: 'f32' },
      uStrength: { value: 0, type: 'f32' },
      uAspect: { value: 960 / 576, type: 'f32' },
    }),
  },
});
shockFilter.enabled = false;
app.stage.filters = [shockFilter];
let shockT = 1;
function triggerShock(x, y, strength) {
  window.__shocks = (window.__shocks ?? 0) + 1; // 验证探针：爆炸当帧可被无头脚本捕捉
  const u = shockFilter.resources.shockU;
  const px = (x - VIEW_W / 2) * S + 480;
  const py = (y - VIEW_H / 2) * S + 270;
  u.uniforms.uCenterX = px / 960;
  u.uniforms.uCenterY = py / 576;
  u.uniforms.uTime = 0;
  u.uniforms.uStrength = Math.min(1, strength);
  shockT = 0;
  shockFilter.enabled = true;
}

// ============================================================
// 模拟状态与驱动（与 ui/main.ts 同节奏：1/60 固定步长累加器）
// ============================================================
let sim = null;
let mode = 'edit';
let acc = 0;
let hitStop = 0;
let slowmo = 0;
let slowmoUsed = false;
let lastEventTick = 0;
let trauma = 0;
let zoomPunch = 1;
const sprites = new Map(); // bodyId -> Sprite
const fuseGlows = new Map(); // bodyId -> Sprite（点燃辉光）
const prevState = new Map(); // bodyId -> {x,y,angle}（上一 tick 状态，渲染插值用）

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function startRun() {
  const sc = getScenario('case1');
  sim = new Simulation({
    seed: sc.seed,
    width: VIEW_W,
    height: VIEW_H,
    entities: buildEntitiesFor(sc.entities, { noAutoIgnite: sc.noAutoIgnite }),
  });
  clearBodies();
  mode = 'running';
  acc = 0; hitStop = 0; slowmo = 0; slowmoUsed = false; trauma = 0; zoomPunch = 1; lastEventTick = 0;
  smokeC.removeChildren().forEach((s) => s.destroy());
  fxAddC.removeChildren().forEach((s) => s.destroy());
  els.checksum.style.display = 'none';
  els.ignite.disabled = true;
  els.status.textContent = '🔥 实验进行中……（本切片无交互点火 —— 专注观感对比，同 seed 必同灾难）';
}

function clearBodies() {
  sprites.forEach((sp) => sp.destroy());
  sprites.clear();
  fuseGlows.forEach((g) => g.destroy());
  fuseGlows.clear();
  prevState.clear();
  ropeG.clear();
}

function finishRun() {
  mode = 'report';
  els.ignite.disabled = false;
  const s = sim.stats;
  els.status.textContent =
    `实验结束 —— 对拍：npm run build && node slice/baseline.mjs，checksum 应与本页一致（同灾难 ✓）`;
  els.checksum.textContent = `checksum = ${sim.stateChecksum()}`;
  els.checksum.style.display = 'block';
  updateStats();
}

// ============================================================
// 表现层：sprite 同步 + 事件 → 特效
// ============================================================
function radiusOf(b) {
  if (b.kind === 'bug') return BUGS[b.data.bugType].radius;
  if (b.kind === 'explosive') return EXPLOSIVES[b.data.etype].radius;
  return 3;
}
function texOf(b) {
  if (b.kind === 'bug') return b.data.bugType === 'roach' ? TEX.roach : TEX.locust;
  if (b.kind === 'explosive') {
    return { firecracker: TEX.firecracker, skyrocket: TEX.skyrocket, bottle: TEX.bottle }[b.data.etype] ?? TEX.glow;
  }
  return TEX.glow;
}

function syncBodies(alpha = 1) {
  if (!sim) return;
  for (const b of sim.world.bodies) {
    let sp = sprites.get(b.id);
    if (!sp) {
      sp = new Sprite(texOf(b));
      const d = radiusOf(b) * 2 * 1.6; // 玩具感：视觉比物理圆略大（与主游戏一致）
      sp.width = d; sp.height = d;
      sp.anchor.set(0.5);
      bodyC.addChild(sp);
      sprites.set(b.id, sp);
      const glow = new Sprite(TEX.glow);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.width = 14; glow.height = 14;
      glow.tint = 0xffc06a;
      glow.visible = false;
      fxAddC.addChild(glow);
      fuseGlows.set(b.id, glow);
      prevState.set(b.id, { x: b.x, y: b.y, angle: b.angle }); // 新生实体无上一帧 → 自插值
    }
    sp.visible = b.alive;
    if (!b.alive) { fuseGlows.get(b.id).visible = false; continue; }
    // 插值：渲染位置 = lerp(上一 tick, 当前 tick, alpha) —— 60Hz 模拟在任意刷新率下都顺滑
    const p = prevState.get(b.id);
    const x = p ? p.x + (b.x - p.x) * alpha : b.x;
    const y = p ? p.y + (b.y - p.y) * alpha : b.y;
    const ang = p ? lerpAngle(p.angle, b.angle, alpha) : b.angle;
    sp.position.set(x, y);
    const pointUp = b.kind === 'explosive'; // 立式纹理：angle=-PI/2 → 不旋转
    sp.rotation = pointUp ? ang + Math.PI / 2 : ang;
    const glow = fuseGlows.get(b.id);
    const lit = b.kind === 'explosive' && b.data.lit && !b.data.exploded;
    glow.visible = lit;
    if (lit) {
      glow.position.set(x, y - radiusOf(b) * 1.4);
      glow.alpha = 0.55 + 0.35 * Math.sin(performance.now() / 1000 * 40 + b.id);
    }
  }
  // 绳子：world.ropes = [{aId, bId, rest, broken}]
  ropeG.clear();
  for (const r of sim.world.ropes) {
    if (r.broken) continue;
    const pa = sim.world.byId(r.aId);
    const pb = sim.world.byId(r.bId);
    if (!pa || !pb || !pa.alive || !pb.alive) continue;
    ropeG.moveTo(pa.x, pa.y);
    ropeG.lineTo(pb.x, pb.y);
  }
  ropeG.stroke({ width: 0.7, color: 0x8a6b46, alpha: 0.9, cap: 'round' });
}

// ---- 粒子池（世界坐标，单位 = 世界单位） ----
const parts = [];
function addPart(layer, tex, opt) {
  if (parts.length > 700) return;
  const sp = new Sprite(tex);
  sp.anchor.set(0.5);
  sp.blendMode = opt.add === false ? 'normal' : 'add';
  sp.position.set(opt.x, opt.y);
  sp.width = opt.size ?? 2; sp.height = opt.size ?? 2;
  if (opt.tint != null) sp.tint = opt.tint;
  sp.alpha = opt.alpha ?? 1;
  layer.addChild(sp);
  parts.push({
    sp, layer,
    vx: opt.vx ?? 0, vy: opt.vy ?? 0, g: opt.g ?? 0,
    ttl: opt.ttl ?? 0.5, life: 0,
    s0: opt.size ?? 2, s1: opt.size2 ?? opt.size ?? 2,
    a0: opt.alpha ?? 1, spin: opt.spin ?? 0,
    ease: opt.ease ?? false, flick: opt.flick ?? false, ph: opt.ph ?? 0,
  });
}

const DEPTH_TINT = [0xffffff, 0xffd27a, 0xff9a4d, 0xff6a3d, 0xff4433];

function fxExplosion(x, y, power, blastRadius, depth) {
  // 参数按实测校准：case1 爆炸 power 45-70、blastRadius 50-70 世界单位（盒宽 300）
  const tint = DEPTH_TINT[Math.min(depth, DEPTH_TINT.length - 1)];
  // 双层闪光：小而烈的核心 + 大而柔的光晕（缓出消隐）
  addPart(fxAddC, TEX.glow, { x, y, size: blastRadius * 0.65, size2: blastRadius * 0.95, ttl: 0.15, tint: 0xffffff, alpha: 1 });
  addPart(fxAddC, TEX.glow, { x, y, size: blastRadius * 1.7, size2: blastRadius * 2.2, ttl: 0.24, tint, alpha: 0.55 });
  // 冲击环：缓出扩张（快起慢收，冲击感）
  addPart(fxAddC, TEX.ring, { x, y, size: blastRadius * 0.3, size2: blastRadius * 1.7, ttl: 0.36, tint, alpha: 0.85, ease: true });
  // 火花：加量 + 闪烁（每颗独立相位）
  const n = 26 + Math.min(depth, 4) * 8;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 60 + Math.random() * 190;
    addPart(fxAddC, TEX.spark, {
      x, y, size: 0.9 + Math.random() * 1.5, ttl: 0.45 + Math.random() * 0.55,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: 260, tint,
      alpha: 1, flick: true, ph: Math.random() * Math.PI * 2,
    });
  }
  for (let i = 0; i < 5; i++) {
    addPart(smokeC, TEX.smoke, {
      x: x + (Math.random() - 0.5) * blastRadius * 0.8, y: y + (Math.random() - 0.5) * 4,
      size: 4 + Math.random() * 5, size2: 12 + Math.random() * 8, ttl: 1.1 + Math.random() * 0.9,
      alpha: 0.32, vx: (Math.random() - 0.5) * 12, vy: -10 - Math.random() * 14, add: false,
    });
  }
  trauma = Math.min(1, trauma + 0.18 + power / 300);
  zoomPunch = Math.max(zoomPunch, 1.03 + power / 2000);
  if ((power >= 60 || depth >= 2) && hitStop <= 0) hitStop = 0.12; // 大威力/深连锁顿帧（时间缩放，不碰模拟）
  if (depth >= 2 && !slowmoUsed) {
    slowmoUsed = true; // 一局一次：深连锁慢镜头（同主游戏 R5/R13 语义）
    slowmo = 0.55;
    zoomPunch = Math.max(zoomPunch, 1.1);
  }
  triggerShock(x, y, Math.min(0.9, 0.25 + power / 140));
  // 纸屑碎片：炮仗纸筒炸开的碎纸（普通混合，翻滚下落）
  const nDebris = 6 + Math.min(depth, 4) * 2;
  for (let i = 0; i < nDebris; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 40 + Math.random() * 110;
    addPart(smokeC, TEX.debris, {
      x, y, size: 0.8 + Math.random() * 0.9, ttl: 0.9 + Math.random() * 0.5,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, g: 200,
      spin: (Math.random() - 0.5) * 22, alpha: 0.95, add: false,
    });
  }
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'explosion') fxExplosion(e.x, e.y, e.power, e.blastRadius, e.depth ?? 0);
    else if (e.type === 'chainIgnite') {
      addPart(fxAddC, TEX.ring, { x: e.x, y: e.y, size: 3, size2: 9, ttl: 0.25, tint: 0xffd27a, alpha: 0.8 });
      trauma = Math.min(1, trauma + 0.1);
    } else if (e.type === 'knockout') {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        addPart(fxAddC, TEX.spark, {
          x: e.x, y: e.y, size: 0.8, ttl: 0.3 + Math.random() * 0.25,
          vx: Math.cos(a) * (30 + Math.random() * 60), vy: Math.sin(a) * (30 + Math.random() * 60) - 30, g: 220,
          tint: 0xffb35c,
        });
      }
      addPart(smokeC, TEX.smoke, { x: e.x, y: e.y, size: 3, size2: 7, ttl: 0.7, alpha: 0.4, vy: -12, add: false });
      trauma = Math.min(1, trauma + 0.07);
    } else if (e.type === 'multiKill') {
      addPart(fxAddC, TEX.ring, { x: e.x, y: e.y, size: 8, ttl: 0.5, tint: 0xff6a3d, alpha: 0.85, grow: 1 });
    }
  }
}

function stepOnce() {
  // 插值基线：步进前快照（prev=tick N，步进后=tick N+1，渲染在两者之间插值）
  for (const b of sim.world.bodies) {
    if (!b.alive) continue;
    prevState.set(b.id, { x: b.x, y: b.y, angle: b.angle });
  }
  sim.step();
  if (sim.eventsThisStep.length) lastEventTick = sim.tick;
  handleEvents(sim.eventsThisStep);
  // 尾迹烟（skyrocket/bottle 推进中，每 2 tick）与炮仗火星（每 9 tick）—— 同主游戏节奏
  if (sim.tick % 2 === 0) {
    for (const b of sim.world.bodies) {
      if (!b.alive || b.kind !== 'explosive') continue;
      if ((b.data.burn ?? 0) > 0 && (b.data.etype === 'skyrocket' || b.data.etype === 'bottle')) {
        addPart(smokeC, TEX.smoke, { x: b.x, y: b.y, size: 2.2, size2: 5, ttl: 0.5, alpha: 0.4, vy: -6, add: false });
      }
      if (b.data.lit && b.data.etype === 'firecracker' && sim.tick % 9 === 0) {
        addPart(fxAddC, TEX.spark, { x: b.x, y: b.y - 2, size: 0.8, ttl: 0.3, vy: -20, g: 80, tint: 0xffd27a });
      }
    }
  }
}

function updateStats() {
  if (!sim) return;
  const s = sim.stats;
  els.exp.textContent = s.explosions;
  els.chain.textContent = '×' + s.chainMax;
  els.ko.textContent = s.knockouts;
  els.multi.textContent = s.multiKills;
}

// ============================================================
// 主循环（时间缩放：顿帧 > 实时；模拟 tick 内容不变 —— 确定性不破）
// ============================================================
let perfAcc = 0, perfN = 0, statTimer = 0;
app.ticker.add((t) => {
  const dt = Math.min(t.deltaMS, 50) / 1000;
  const t0 = performance.now();
  let alpha = 1;
  if (mode === 'running' && sim) {
    hitStop = Math.max(0, hitStop - dt);
    slowmo = Math.max(0, slowmo - dt);
    // 顿帧 > 慢镜头 > 实时（时间缩放只改步进节奏，tick 内容不变 —— 确定性不破）
    const scale = hitStop > 0 ? 0.06 : slowmo > 0 ? 0.35 : 1;
    acc += dt * scale;
    let steps = 0;
    while (acc >= DT && steps < 4) { acc -= DT; steps++; stepOnce(); }
    alpha = Math.min(1, acc / DT); // 渲染停在两 tick 之间的位置
    if (sim.tick - lastEventTick > 180) finishRun();
  }
  syncBodies(alpha); // 物体/引信辉光/绳子逐帧同步（插值 → 任意刷新率都顺滑）
  // 粒子推进（真实时间）：宽度 s0→s1 插值（ease=缓出），alpha 平方衰减 × 可选闪烁
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life += dt;
    if (p.life >= p.ttl) { p.layer.removeChild(p.sp); p.sp.destroy(); parts.splice(i, 1); continue; }
    p.vy += p.g * dt;
    p.sp.x += p.vx * dt;
    p.sp.y += p.vy * dt;
    let k = p.life / p.ttl;
    const w = p.s0 + (p.s1 - p.s0) * (p.ease ? 1 - (1 - k) ** 3 : k);
    p.sp.width = w; p.sp.height = w;
    if (p.spin) p.sp.rotation += p.spin * dt;
    let a = p.a0 * (1 - k * k);
    if (p.flick) a *= 0.65 + 0.35 * Math.sin(p.life * 80 + p.ph);
    p.sp.alpha = a;
  }
  // 震屏（trauma² 平滑正弦）+ zoom punch 回落
  trauma = Math.max(0, trauma - dt * 1.8);
  zoomPunch += (1 - zoomPunch) * Math.min(1, dt * 6);
  const sh = trauma * trauma;
  const now = performance.now() / 1000;
  worldC.scale.set(S * zoomPunch);
  worldC.position.set(
    480 + (Math.sin(now * 47) * 5 + Math.sin(now * 31 + 1.7) * 3) * sh,
    270 + (Math.sin(now * 41 + 0.9) * 5 + Math.sin(now * 23 + 2.3) * 3) * sh,
  );
  // 冲击波 uniform
  if (shockT < 1) {
    shockT = Math.min(1, shockT + dt / 0.45);
    const u = shockFilter.resources.shockU;
    u.uniforms.uTime = shockT;
    if (shockT >= 1) shockFilter.enabled = false;
  }
  // 真 bloom：世界当前帧渲染进半分辨率 RT（bloomSprite 自带 BlurFilter 加法叠回）；静止场景跳过重渲染
  if (mode === 'running' || parts.length > 0) {
    app.renderer.render({ container: worldC, target: bloomRT, clear: true });
  }
  // 统计与性能读数
  statTimer += dt;
  if (statTimer > 0.2) {
    statTimer = 0;
    updateStats();
    els.perf.textContent = `${Math.round(app.ticker.FPS)}fps · ${(perfN ? perfAcc / perfN : 0).toFixed(2)}ms`;
    perfAcc = 0; perfN = 0;
  }
  perfAcc += performance.now() - t0; perfN++;
});

// ---- 交互 ----
els.ignite.addEventListener('click', () => { if (mode !== 'running') startRun(); });
els.reset.addEventListener('click', reset);
function reset() {
  sim = null; mode = 'edit';
  smokeC.removeChildren().forEach((s) => s.destroy());
  fxAddC.removeChildren().forEach((s) => s.destroy());
  clearBodies();
  els.ignite.disabled = false;
  els.status.textContent = '就绪 —— 案例1（seed 4103）已装载，按「点燃」开跑（与 Canvas 版同输入同节奏）';
  els.checksum.style.display = 'none';
  els.exp.textContent = '0'; els.chain.textContent = '×0';
  els.ko.textContent = '0'; els.multi.textContent = '0';
  layoutEditView();
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (mode !== 'running') startRun(); }
  if (e.code === 'KeyR') reset();
});

// 编辑视图：先摆好静态场面（无 sim，用场景 spec 直接摆 sprite 供对照）
function layoutEditView() {
  const sc = getScenario('case1');
  let ph = 0;
  for (const s of sc.entities) {
    const kind = BUGS[s.t] ? 'bug' : EXPLOSIVES[s.t] ? 'explosive' : 'prop';
    const fake = { id: -1, kind, x: s.x, y: s.y, angle: s.angle ?? 0, alive: true,
      data: { bugType: s.t, etype: s.t, lit: false } };
    const sp = new Sprite(texOf(fake));
    const radius = BUGS[s.t]?.radius ?? EXPLOSIVES[s.t]?.radius ?? 3;
    const d = radius * 2 * 1.6;
    sp.width = d; sp.height = d;
    sp.anchor.set(0.5);
    sp.position.set(s.x, s.y);
    sp.rotation = kind === 'explosive' ? (s.angle ?? -Math.PI / 2) + Math.PI / 2 : (s.angle ?? 0);
    sp.alpha = 0.92;
    bodyC.addChild(sp);
    sprites.set('ph' + ph++, sp);
  }
}
reset(); // 初始 = 编辑视图（静态摆放场面）
window.__sliceReady = true; // index.html 的自诊断探针：模块完整执行完毕的标志
