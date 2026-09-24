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
  Text,
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
  // 原版 flash：三层加法渐变（白核 → 橙圈 → 深橙），色标逐项照抄 particles.ts
  flash: canvasTex(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,252,238,0.95)');
    g.addColorStop(0.3, 'rgba(255,190,90,0.75)');
    g.addColorStop(0.7, 'rgba(255,110,40,0.32)');
    g.addColorStop(1, 'rgba(255,80,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }),
  // 原版 ring：双描边冲击环（外柔内锐，金调）——线宽比例照抄（4.5 / 1.2 @64 半径）
  ringGold: canvasTex(128, 128, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(255,200,130,0.3)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,235,190,0.85)';
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); ctx.stroke();
  }),
  // 时间涟漪蓝环（慢镜头聚光灯）
  ringBlue: canvasTex(128, 128, (ctx, w, h) => {
    ctx.strokeStyle = 'rgba(126,200,255,0.3)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(190,230,255,0.9)';
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); ctx.stroke();
  }),
  // 焦痕：地面战损记忆（黑径向，12s 淡去）
  scorch: canvasTex(128, 128, (ctx, w, h) =>
    radial(ctx, w, h, [[0, 'rgba(12,10,8,0.62)'], [0.55, 'rgba(16,13,10,0.42)'], [1, 'rgba(20,16,12,0)']])),
  // 纸屑：白底矩形（ tint 分色：金/红/青白）
  debris: canvasTex(32, 32, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 11, 24, 11);
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

const scorchC = new Container();    // 焦痕（战损记忆，12s 淡去）—— bg 之上、物体之下
const ropeG = new Graphics();       // 绳子（最底层线材）
const bodyC = new Container();      // 物体 sprite
const smokeC = new Container();     // 普通混合：烟/纸屑/扬尘
const fxAddC = new Container();     // 加法混合：闪光/冲击环/余烬
const sparkG = new Graphics();      // 火花线拖尾（每帧重画，加法混合）
sparkG.blendMode = 'add';
const floatLayer = new Container(); // 连锁浮字
worldC.addChild(scorchC, ropeG, bodyC, smokeC, fxAddC, sparkG, floatLayer);

// 全屏白闪（爆炸打击感，原版 state.flash 语义：gain power/300 cap 0.38，衰减 3.4/s）
const flashOverlay = new Sprite(Texture.WHITE);
flashOverlay.width = 960; flashOverlay.height = 576;
flashOverlay.alpha = 0;
app.stage.addChild(flashOverlay);

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
let slowmoCenter = null;
let lastEventTick = 0;
let trauma = 0;
let zoomPunch = 1;
let flashV = 0; // 全屏白闪强度（原版 state.flash）
let panX = 0;   // 方向性推镜（世界单位，弹簧回中）
let panY = 0;
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
  clearFx();
  mode = 'running';
  acc = 0; hitStop = 0; slowmo = 0; slowmoUsed = false; slowmoCenter = null;
  trauma = 0; zoomPunch = 1; lastEventTick = 0; flashV = 0; panX = 0; panY = 0;
  els.checksum.style.display = 'none';
  els.ignite.disabled = true;
  els.status.textContent = '🔥 实验进行中……（本切片无交互点火 —— 专注观感对比，同 seed 必同灾难）';
}

function clearFx() {
  for (const p of parts) { p.sp?.destroy(); p.core?.destroy(); }
  parts.length = 0;
  for (const s of scorches) s.sp.destroy();
  scorches.length = 0;
  for (const f of floatTexts) f.t.destroy();
  floatTexts.length = 0;
  sparkG.clear();
  smokeC.removeChildren().forEach((s) => s.destroy());
  fxAddC.removeChildren().forEach((s) => s.destroy());
  scorchC.removeChildren().forEach((s) => s.destroy());
  floatLayer.removeChildren().forEach((s) => s.destroy());
}

function clearBodies() {
  sprites.forEach((sp) => sp.destroy());
  sprites.clear();
  fuseGlows.clear(); // sprite 生命周期已由 clearFx 统一销毁（都在 fxAddC 下）
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

// ============================================================
// 粒子系统：逐项移植 ui/particles.ts 原版配方（type 驱动，update/draw 对齐）
// ============================================================
const parts = [];
function addP(p) {
  if (parts.length > 600) parts.shift(); // 原版同款上限
  parts.push(p);
}

function mkSp(tex, layer, x, y, blend = 'add') {
  const sp = new Sprite(tex);
  sp.anchor.set(0.5);
  sp.blendMode = blend;
  sp.position.set(x, y);
  layer.addChild(sp);
  return sp;
}

// 原版 particles.explosion(x, y, power) —— r = 6+power*0.18（power 45-70 → r≈14-19）
function fxBurst(x, y, power) {
  const r = 6 + power * 0.18;
  // 闪光：四段渐变主辉光 + 白核收缩（life 0.14）
  {
    const sp = mkSp(TEX.flash, fxAddC, x, y);
    const core = mkSp(TEX.glow, fxAddC, x, y);
    core.tint = 0xfffff4;
    addP({ type: 'flash', sp, core, x, y, r: r * 0.8, life: 0.14, age: 0 });
  }
  // 冲击环：金双描边，r*0.4 起步、vr=r*7、life 0.45
  addP({ type: 'ring', sp: mkSp(TEX.ringGold, fxAddC, x, y), x, y, r: r * 0.4, vr: r * 7, life: 0.45, age: 0 });
  // 火花：min(30, 10+power*0.28) 颗，线拖尾渐冷色（sparkG 层），重力 700、抬升 -60
  const n = Math.min(30, (10 + power * 0.28) | 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 240;
    addP({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.35 + Math.random() * 0.4, age: 0 });
  }
  // 余烬：5 颗慢速上飘 + 热浮力 + 正弦摆动 + 闪烁
  for (let i = 0; i < 5; i++) {
    const ex = x + (Math.random() - 0.5) * r;
    const ey = y + (Math.random() - 0.5) * r * 0.6;
    addP({ type: 'ember', sp: mkSp(TEX.glow, fxAddC, ex, ey), x: ex, y: ey,
      vx: (Math.random() - 0.5) * 26, vy: -24 - Math.random() * 40,
      r: 0.8 + Math.random() * 1.2, life: 0.7 + Math.random() * 0.7, age: 0, seed: Math.random() * 10 });
  }
  // 碎片：min(10, 4+power*0.06) 颗纸屑，上抛 -120、重力 620、翻滚；金/红/青白三色
  const nd = Math.min(10, (4 + power * 0.06) | 0);
  for (let i = 0; i < nd; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 90 + Math.random() * 200;
    const hue = Math.random();
    const d = mkSp(TEX.debris, smokeC, x, y, 'normal');
    d.tint = hue < 0.55 ? 0xe8c15a : hue < 0.8 ? 0xc0392b : 0xaad7f5;
    addP({ type: 'debris', sp: d, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
      r: 0.9 + Math.random() * 1.4, rot: Math.random() * Math.PI * 2, vrot: (Math.random() - 0.5) * 18,
      life: 0.5 + Math.random() * 0.5, age: 0 });
  }
  // 烟：7 团暖灰（tone 107,91,78），持续长大（r+=6/s）
  for (let i = 0; i < 7; i++) {
    const sx = x + (Math.random() - 0.5) * r;
    const sy = y + (Math.random() - 0.5) * r;
    const s = mkSp(TEX.smoke, smokeC, sx, sy, 'normal');
    s.tint = 0x6b5b4e;
    addP({ type: 'smoke', sp: s, x: sx, y: sy, vx: (Math.random() - 0.5) * 30, vy: -20 - Math.random() * 30,
      r: 3 + Math.random() * 5, life: 0.9 + Math.random() * 0.6, age: 0, warm: 0.7 });
  }
}

// 原版 particles.spark(x, y, n)：小型火花迸溅（击倒/引信火星）
function fxSpark(x, y, n = 6) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 30 + Math.random() * 90;
    addP({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.3 + Math.random() * 0.25, age: 0 });
  }
}

// 原版 particles.puff(x, y)：小烟团
function fxPuff(x, y) {
  for (let i = 0; i < 4; i++) {
    const px = x + (Math.random() - 0.5) * 6;
    const py = y + (Math.random() - 0.5) * 6;
    const s = mkSp(TEX.smoke, smokeC, px, py, 'normal');
    s.tint = 0x666666;
    addP({ type: 'smoke', sp: s, x: px, y: py, vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 15,
      r: 2 + Math.random() * 3, life: 0.5 + Math.random() * 0.3, age: 0, warm: 0 });
  }
}

// 原版 particles.dust(x, floorY)：贴地扬尘浪
function fxDust(x, floorY) {
  for (let i = 0; i < 8; i++) {
    const dir = i < 4 ? -1 : 1;
    const dx = x + dir * Math.random() * 4;
    const dy = floorY - Math.random() * 2;
    const s = mkSp(TEX.smoke, smokeC, dx, dy, 'normal');
    s.tint = 0x8a8378;
    addP({ type: 'dust', sp: s, x: dx, y: dy, vx: dir * (30 + Math.random() * 70), vy: -8 - Math.random() * 22,
      r: 2 + Math.random() * 4, life: 0.5 + Math.random() * 0.4, age: 0 });
  }
}

// 原版 particles.rocketTrail(x, y)：火箭尾迹烟（每两 tick）
function fxRocketTrail(x, y) {
  const s = mkSp(TEX.smoke, smokeC, x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 2, 'normal');
  s.tint = 0x8a7563;
  addP({ type: 'smoke', sp: s, x: s.x, y: s.y, vx: (Math.random() - 0.5) * 8, vy: 6 + Math.random() * 10,
    r: 1.2 + Math.random() * 1.4, life: 0.45 + Math.random() * 0.35, age: 0, warm: 0.35 });
}

// 原版 timeRing(x, y) + 第二蓝环：慢镜头聚光灯的时间涟漪
function fxTimeRing(x, y) {
  addP({ type: 'ring', sp: mkSp(TEX.ringBlue, fxAddC, x, y), x, y, r: 4, vr: 55, life: 0.9, age: 0 });
  addP({ type: 'ring', sp: mkSp(TEX.ringBlue, fxAddC, x, y), x, y, r: 1.5, vr: 34, life: 0.8, age: 0 });
}

// ---- 焦痕（原版 state.scorches：最多 24 个，12s 淡去）----
const scorches = [];
function addScorch(x, y, power) {
  const sp = mkSp(TEX.scorch, scorchC, x, Math.min(y + 4, 178), 'normal');
  const r = 5 + power * 0.12;
  sp.width = sp.height = r * 2;
  scorches.push({ sp, age: 0, ttl: 12 });
  if (scorches.length > 24) { scorches[0].sp.destroy(); scorches.shift(); }
}

// ---- 连锁浮字（原版 state.floatTexts：先弹后升淡出）----
const floatTexts = [];
function addFloatText(x, y, str) {
  const t = new Text({
    text: str,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fontWeight: '700',
      fill: 0xffe9c4, stroke: { color: 0x4a1d08, width: 3 } },
  });
  t.anchor.set(0.5);
  t.position.set(x, y - 4);
  t.rotation = -0.04;
  floatLayer.addChild(t);
  floatTexts.push({ t, age: 0, ttl: 1.1 });
  if (floatTexts.length > 8) { floatTexts[0].t.destroy(); floatTexts.shift(); }
}

// ---- 爆炸事件 → 表现层（逐项移植 applyEventPresentation 的 explosion 分支）----
function fxExplosionEvent(x, y, power, depth) {
  fxBurst(x, y, power);
  addScorch(x, y, power);
  // 镜头推近一点，随时间回弹
  zoomPunch = Math.min(1.08, zoomPunch + power / 2600);
  // 反馈分级：威力决定 trauma/白闪；大威力才给顿帧
  trauma = Math.min(1, trauma + 0.22 + Math.min(0.55, power / 200));
  flashV = Math.min(0.38, flashV + Math.min(0.32, power / 300));
  // 方向性推镜：冲击波往爆点反方向推一下（弹簧回中）
  const kick = Math.min(2.5, power / 80);
  panX = Math.max(-4, Math.min(4, panX - ((x - VIEW_W / 2) / (VIEW_W / 2)) * kick));
  panY = Math.max(-3, Math.min(3, panY - ((y - VIEW_H / 2) / (VIEW_H / 2)) * kick));
  if (power >= 40) hitStop = Math.max(hitStop, 0.05 + Math.min(0.05, (power - 40) / 900));
  // 贴地爆炸 → 地面扬尘浪
  if (y > 130 && power >= 30) fxDust(x, 178);
  // 连锁 ≥2 → 慢镜头（一局一次）+ 时间涟漪 + 浮字
  if (depth >= 2 && !slowmoUsed) {
    slowmoUsed = true;
    slowmo = Math.max(slowmo, 0.7);
    slowmoCenter = { x, y };
    fxTimeRing(x, y);
  }
  if (depth >= 2) addFloatText(x, y, `连锁×${depth}`);
  triggerShock(x, y, Math.min(0.9, 0.25 + power / 140)); // 切片自有：屏幕空间畸变（原版没有）
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'explosion') fxExplosionEvent(e.x, e.y, e.power, e.depth ?? 0);
    else if (e.type === 'chainIgnite') {
      fxSpark(e.x, e.y, 4); // 原版 R209：殉爆引燃瞬间火花 + 微 trauma
      trauma = Math.min(1, trauma + 0.06);
    } else if (e.type === 'knockout') {
      fxSpark(e.x, e.y, 8); // 原版：击倒故障火花
    } else if (e.type === 'multiKill') {
      addFloatText(e.x, e.y, `一爆多杀 ×${e.count}`);
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
        fxRocketTrail(b.x, b.y);
      }
      if (b.data.lit && b.data.etype === 'firecracker' && sim.tick % 9 === 0) {
        fxSpark(b.x, b.y - 1, 1);
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
  // ---- 粒子推进：逐类型移植 particles.ts update()（重力/浮力/长大/衰减全部对齐原版数值）----
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age >= p.life) {
      if (p.sp) { p.sp.parent?.removeChild(p.sp); p.sp.destroy(); }
      if (p.core) { p.core.destroy(); }
      parts.splice(i, 1);
      continue;
    }
    const k = 1 - p.age / p.life;
    if (p.type === 'spark') {
      p.vy += 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    } else if (p.type === 'smoke') {
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += 6 * dt;
      p.sp.position.set(p.x, p.y);
      p.sp.width = p.sp.height = p.r * 2;
      p.sp.alpha = k * (0.3 + p.warm * 0.14);
    } else if (p.type === 'flash') {
      // 三层渐变闪光整体淡出 + 白核收缩（原版 draw 的两段）
      p.sp.width = p.sp.height = p.r * 2;
      p.sp.alpha = k;
      p.core.position.set(p.x, p.y);
      p.core.width = p.core.height = Math.max(0.2, p.r * 0.34 * 2 * k);
      p.core.alpha = 0.9 * k;
    } else if (p.type === 'ring') {
      p.r += p.vr * dt;
      p.sp.width = p.sp.height = p.r * 2;
      p.sp.alpha = k; // 原版线宽随 k 变细 —— 纹理近似：整体 alpha 线性衰减
    } else if (p.type === 'ember') {
      p.vy -= 26 * dt; // 热浮力
      p.x += p.vx * dt + Math.sin(p.age * 9 + p.seed) * 14 * dt;
      p.y += p.vy * dt;
      const flicker = 0.55 + 0.45 * Math.sin(p.age * 22 + p.seed * 7);
      p.sp.position.set(p.x, p.y);
      p.sp.width = p.sp.height = p.r * 3.8;
      p.sp.tint = 0xff8c3c;
      p.sp.alpha = k * 0.75 * flicker;
    } else if (p.type === 'debris') {
      p.vy += 620 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vrot * dt;
      p.sp.position.set(p.x, p.y);
      p.sp.rotation = p.rot;
      p.sp.width = p.r * 2; p.sp.height = p.r * 0.9;
      p.sp.alpha = Math.min(1, k * 1.6);
    } else if (p.type === 'dust') {
      p.vy += 60 * dt; p.vx *= 1 - 1.6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += 9 * dt;
      p.sp.position.set(p.x, p.y);
      p.sp.width = p.r * 2; p.sp.height = p.r; // 椭圆压扁（原版 r × r*0.5 直径比）
      p.sp.alpha = k * 0.16;
    }
  }
  // 火花线拖尾：每帧重画（渐冷色三档 + 头部辉光点，原版 draw spark 分支）
  sparkG.clear();
  for (const p of parts) {
    if (p.type !== 'spark') continue;
    const k = 1 - p.age / p.life;
    const heat = k * k;
    const col = heat > 0.6 ? 0xfff3c4 : heat > 0.3 ? 0xffb347 : 0xff7840;
    sparkG.moveTo(p.x, p.y);
    sparkG.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
    sparkG.stroke({ width: 1.4, color: col, alpha: k, cap: 'round' });
    sparkG.circle(p.x, p.y, 2.6);
    sparkG.fill({ color: 0xffb450, alpha: k * 0.85 });
  }
  // 焦痕淡出
  for (let i = scorches.length - 1; i >= 0; i--) {
    const s = scorches[i];
    s.age += dt;
    if (s.age >= s.ttl) { s.sp.destroy(); scorches.splice(i, 1); continue; }
    s.sp.alpha = 0.8 * (1 - s.age / s.ttl);
  }
  // 浮字：先弹后升淡出
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const f = floatTexts[i];
    f.age += dt;
    if (f.age >= f.ttl) { f.t.destroy(); floatTexts.splice(i, 1); continue; }
    const k = f.age / f.ttl;
    f.t.y -= 12 * dt;
    f.t.scale.set(f.age < 0.12 ? 0.6 + f.age / 0.12 * 0.5 : 1.1 - Math.min(0.1, (f.age - 0.12) * 0.5));
    f.t.alpha = Math.min(1, k * 2.2);
  }
  // ---- 相机：原版 trauma² 分层正弦 + 方向性推镜弹簧 + 慢镜头向爆心缓推 ----
  trauma = Math.max(0, trauma - dt * 1.7);
  flashV = Math.max(0, flashV - dt * 3.4);
  flashOverlay.alpha = flashV;
  zoomPunch += (1 - zoomPunch) * Math.min(1, dt * (slowmo > 0 ? 3 : 6));
  if (slowmo > 0 && slowmoCenter) {
    const tx = Math.max(-6, Math.min(6, (slowmoCenter.x - VIEW_W / 2) * 0.2));
    const ty = Math.max(-4, Math.min(4, (slowmoCenter.y - VIEW_H / 2) * 0.2));
    panX += (tx - panX) * Math.min(1, dt * 3.2);
    panY += (ty - panY) * Math.min(1, dt * 3.2);
  } else {
    panX += (0 - panX) * Math.min(1, dt * 5);
    panY += (0 - panY) * Math.min(1, dt * 5);
  }
  const t2 = trauma * trauma;
  const ts = performance.now() / 1000;
  const shakeX = 12 * t2 * (0.6 * Math.sin(ts * 23.7) + 0.4 * Math.sin(ts * 41.1 + 1.3));
  const shakeY = 8 * t2 * (0.6 * Math.sin(ts * 29.3 + 0.7) + 0.4 * Math.sin(ts * 47.9));
  const shakeRoll = 0.035 * t2 * Math.sin(ts * 19.1 + 2.1);
  worldC.rotation = shakeRoll;
  worldC.scale.set(S * zoomPunch);
  worldC.position.set(480 + shakeX + panX * S, 270 + shakeY + panY * S);
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
  clearFx();
  clearBodies();
  flashV = 0; panX = 0; panY = 0; trauma = 0; zoomPunch = 1;
  flashOverlay.alpha = 0;
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
