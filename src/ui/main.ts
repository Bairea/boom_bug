// 主循环与游戏状态机：edit → running → report →(replay)→ report。

import { Simulation, DT } from '../sim/sim.js';
import { VIEW_W, VIEW_H, drawScene, viewFromSim, viewFromSpecs } from './render.js';
import type { DrawOptions, ItemView, SceneView, Scorch, FloatText } from './render.js';
import { Particles } from './particles.js';
import { ItemFx } from './fx.js';
import { Editor } from './editor.js';
import { Recorder, buildReport } from '../game/replay.js';
import type { Report } from '../game/replay.js';
import { SCENARIOS, getScenario } from '../game/scenario.js';
import type { EntitySpec, Experiment, TimedCommand } from '../game/encode.js';
import { toHash, experimentFromHash } from '../game/encode.js';
import { buildDaily, todayKey, THEME_LABELS } from '../game/daily.js';
import { Sfx } from './sounds.js';
import { createRecords } from '../game/records.js';
import type { RecordedEvent } from '../sim/events.js';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
}

const canvas = $<HTMLCanvasElement>('stage');
// 高 DPI 锐化：内部按 devicePixelRatio 放大，逻辑坐标仍是 960×576（绘制代码无感知）
const DPR = Math.min(2, Math.max(1, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1));
canvas.width = canvas.width * DPR;
canvas.height = canvas.height * DPR;
const ctx = canvas.getContext('2d', { alpha: false })!; // 背景全幅不透明：关 alpha 走更快合成路径
ctx.scale(DPR, DPR);
const W = canvas.width / DPR; // 逻辑宽度（绘制坐标统一用逻辑值）
const H = canvas.height / DPR;

const els = {
  status: $<HTMLElement>('status'),
  ignite: $<HTMLButtonElement>('btn-ignite'),
  rerun: $<HTMLButtonElement>('btn-rerun'),
  newSeed: $<HTMLButtonElement>('btn-newseed'),
  clear: $<HTMLButtonElement>('btn-clear'),
  daily: $<HTMLButtonElement>('btn-daily'),
  share: $<HTMLButtonElement>('btn-share'),
  replayShare: $<HTMLButtonElement>('btn-replay-share'),
  end: $<HTMLButtonElement>('btn-end'),
  skip: $<HTMLButtonElement>('btn-skip'),
  speed: $<HTMLButtonElement>('btn-speed'),
  scenario: $<HTMLSelectElement>('scenario'),
  report: $<HTMLElement>('report'),
  reportBody: $<HTMLElement>('report-body'),
  reportTitle: $<HTMLElement>('report-title'),
  toast: $<HTMLElement>('toast'),
  toolButtons: [...document.querySelectorAll<HTMLButtonElement>('[data-tool]')],
  mute: null as HTMLButtonElement | null,
};

type GameMode = 'edit' | 'running' | 'report' | 'replay';

interface ReplayCursor {
  cursor: number;
  startTick?: number;
  eventIdx: number; // 完整事件流重演指针
}

let replaySpeed = 0.5; // 回放倍速（0.5×/1×，按钮切换）

interface GameState {
  mode: GameMode;
  seed: number;
  scenarioId: string;
  sim: Simulation | null;
  recorder: Recorder | null;
  particles: Particles;
  lastEventTick: number;
  report: Report | null;
  runExperiment: Experiment | null; // {seed,width,height,entities,commands} 本次运行的输入
  dailyKey: string | null; // 每日实验模式：战绩/对照按 daily-日期 入账
  replay: ReplayCursor | null; // 回放游标
  slowmo: number; // 慢镜头剩余秒数（表现层）
  slowmoUsed: boolean; // 一局只慢放第一次大连锁
  zoomPunch: number; // 镜头推近系数（表现层）
  trauma: number; // 震屏创伤值 0..1（trauma² 驱动平滑震屏，表现层）
  hitStop: number; // 顿帧剩余秒数（大爆炸时时间短暂凝滞，表现层）
  flash: number; // 全屏白闪强度（表现层）
  itemFx: ItemFx; // 实体挤压/弹跳动效（表现层）
  lastDt: number; // 上一帧真实秒数（着陆检测用）
  slowmoCenter: { x: number; y: number } | null; // 慢镜头爆心（镜头缓推目标）
  panX: number; // 镜头平移（表现层）
  panY: number;
  scorches: Scorch[]; // 爆炸焦痕（纯表现层）
  floatTexts: FloatText[]; // 连锁浮动大字（纯表现层）
}

const state: GameState = {
  mode: 'edit', // edit | running | report | replay
  seed: 20260830,
  scenarioId: 'free',
  sim: null,
  recorder: null,
  particles: new Particles(),
  lastEventTick: 0,
  report: null,
  runExperiment: null,
  dailyKey: null,
  replay: null,
  slowmo: 0,
  slowmoUsed: false,
  zoomPunch: 1,
  trauma: 0,
  hitStop: 0,
  flash: 0,
  itemFx: new ItemFx(),
  lastDt: 1 / 60,
  slowmoCenter: null,
  panX: 0,
  panY: 0,
  scorches: [],
  floatTexts: [],
};

const editor = new Editor(canvas);
editor.onStatus = (msg) => (els.status.textContent = msg);
editor.onPlace = (x, y, index) => {
  state.particles.puff(x, y + 2); // 摆放落点的小烟尘反馈
  state.itemFx.pop(index, 0.55); // 落地弹跳挤压
};

// 减少动态偏好（无障碍）：系统开启时压低震屏/白闪/滚转，跳过顿帧与彩带
let reducedMotion = false;
try {
  reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
} catch {}

// 音效：首个用户手势（点燃/点击画布）后创建 AudioContext
const sfx = new Sfx(typeof window !== 'undefined' && window.AudioContext ? () => new AudioContext() : null);
// 本机最佳战绩
const records = createRecords();
els.mute = document.getElementById('btn-mute') as HTMLButtonElement | null;
try {
  if (localStorage.getItem('bbl-muted') === '1') {
    sfx.muted = true;
    if (els.mute) {
      els.mute.textContent = '🔇';
      els.mute.setAttribute('aria-pressed', 'true');
    }
  }
} catch {}
els.mute?.addEventListener('click', () => {
  sfx.muted = !sfx.muted;
  if (els.mute) {
    els.mute.textContent = sfx.muted ? '🔇' : '🔊';
    els.mute.setAttribute('aria-pressed', String(sfx.muted));
  }
  try {
    localStorage.setItem('bbl-muted', sfx.muted ? '1' : '0');
  } catch {}
  if (!sfx.muted) sfx.ensure();
});
// 首次任意画布交互时预热音频（自动播放策略要求手势）
canvas.addEventListener('pointerdown', () => sfx.ensure(), { once: true });

// ---- 实验手册 ----
const helpEl = document.getElementById('help');
const helpClose = document.getElementById('btn-help-close');

function openHelp(): void {
  if (helpEl) {
    helpEl.hidden = false;
    helpClose?.focus(); // dialog 焦点管理：Esc/回车即可关闭
  }
}

function closeHelp(): void {
  if (helpEl) helpEl.hidden = true;
}

document.getElementById('btn-help')?.addEventListener('click', openHelp);
helpClose?.addEventListener('click', closeHelp);
// 首次到访自动弹出（localStorage 记忆）
try {
  if (!localStorage.getItem('bbl-help-seen')) {
    openHelp();
    localStorage.setItem('bbl-help-seen', '1');
  }
} catch {
  // 无 localStorage：不弹
}

// ---- 全屏切换 ----
function toggleFullscreen(): void {
  const el = document.getElementById('stage-wrap');
  if (!el) return;
  try {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else if (!document.fullscreenEnabled) {
      toast('当前环境不支持全屏'); // 环境直接禁用（如受控 iframe）
    } else {
      const p = el.requestFullscreen?.();
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(() => toast('当前环境不支持全屏'));
      }
    }
  } catch {
    toast('当前环境不支持全屏');
  }
}
document.getElementById('btn-full')?.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const b = document.getElementById('btn-full');
  if (b) {
    const on = !!document.fullscreenElement;
    b.textContent = on ? '🗗' : '⛶';
    b.setAttribute('aria-pressed', String(on));
  }
});

// ---- 工具箱 ----
for (const btn of els.toolButtons) {
  btn.addEventListener('click', () => {
    editor.tool = btn.dataset.tool ?? 'roach';
    els.toolButtons.forEach((b) => b.classList.toggle('active', b === btn));
    editor.onStatus('工具：' + btn.title);
  });
}
document.getElementById('fix-scarab')?.addEventListener('change', (e) => {
  editor.fixScarab = (e.target as HTMLInputElement).checked;
});

// ---- 场景 ----
{
  const sandbox = document.createElement('optgroup');
  sandbox.label = '🧪 沙盒';
  const cases = document.createElement('optgroup');
  cases.label = '📁 教学案例';
  for (const sc of SCENARIOS) {
    const opt = document.createElement('option');
    opt.value = sc.id;
    opt.textContent = sc.label;
    (sc.id === 'free' ? sandbox : cases).appendChild(opt);
  }
  els.scenario.appendChild(sandbox);
  els.scenario.appendChild(cases);
}
els.scenario.addEventListener('change', () => {
  loadScenario(els.scenario.value);
});

function loadScenario(id: string): void {
  const sc = getScenario(id);
  state.scenarioId = id;
  state.seed = sc.seed;
  state.dailyKey = null; // 切走场景即退出每日实验（战绩回归场景键）
  els.scenario.value = id;
  editor.clear();
  // 自由实验：恢复上次没摆完的布置（其余场景永远从预设开始）
  let entities = sc.entities;
  let restored = false;
  if (id === 'free') {
    const saved = loadFreeLayout();
    if (saved) {
      entities = saved;
      restored = true;
    }
  }
  loadEntitiesIntoEditor(entities);
  state.mode = 'edit';
  editor.locked = false;
  hideReport();
  state.particles = new Particles(); // 场景切换：上一局的烟尘不带入
  document.title = `擦炮虫虫实验室 · ${sc.label}`;
  editor.onStatus(restored ? '已恢复上次的自由实验布置 —— ' + sc.desc : sc.desc);
  try {
    localStorage.setItem('bbl-last-scenario', id);
  } catch {}
  // 场景切换画布淡入（轻过渡，标记新布置）
  canvas.classList.remove('scene-swap');
  void canvas.offsetWidth; // 重启动画
  canvas.classList.add('scene-swap');
}

// 自由实验的布置持久化：刷新/关页不丢摆放
function loadFreeLayout(): EntitySpec[] | null {
  try {
    const raw = localStorage.getItem('bbl-free-layout');
    if (!raw) return null;
    const saved = JSON.parse(raw) as { specs?: EntitySpec[] };
    return Array.isArray(saved.specs) && saved.specs.length ? saved.specs : null;
  } catch {
    return null;
  }
}

function saveFreeLayout(): void {
  // 每日实验的布局不属于玩家的自由存档，不能覆盖
  if (state.scenarioId !== 'free' || state.dailyKey || editor.specs.length === 0) return;
  try {
    localStorage.setItem('bbl-free-layout', JSON.stringify({ specs: editor.specs }));
  } catch {}
}

// 把实体列表装入编辑器（绳子索引对换算成编辑器的绳子表）
function loadEntitiesIntoEditor(entities: EntitySpec[]): void {
  entities.forEach((e) => editor.addSpec(e.t, e.x, e.y, e));
  for (const e of entities) {
    for (const [a, b] of e.ropes ?? []) editor.ropeList.push({ a, b });
  }
}

// ---- 运行控制 ----
function startRun(useRecordedCommands = false): void {
  // 重跑/重放：完整复用上一次（或分享码）的输入，保证同一灾难；新跑：从编辑器取当前布置
  const prev = useRecordedCommands && state.runExperiment ? state.runExperiment : null;
  const entities = prev ? prev.entities : editor.buildEntities(true, getScenario(state.scenarioId)?.noAutoIgnite);
  const commands = prev ? (prev.commands ?? []) : [];
  if (!prev) saveFreeLayout();
  state.runExperiment = {
    seed: state.seed,
    width: VIEW_W,
    height: VIEW_H,
    entities,
    commands,
  };
  state.sim = new Simulation(state.runExperiment);
  state.recorder = new Recorder();
  state.particles = new Particles();
  state.lastEventTick = 0;
  state.slowmo = 0;
  state.slowmoUsed = false;
  state.zoomPunch = 1;
  state.trauma = 0;
  state.hitStop = 0;
  state.flash = 0;
  state.itemFx.reset();
  state.slowmoCenter = null;
  state.panX = 0;
  state.panY = 0;
  state.scorches = [];
  state.floatTexts = [];
  state.mode = 'running';
  editor.locked = true;
  hideReport();
  if (!reducedMotion) state.flash = Math.max(state.flash, 0.07); // 点燃瞬间的微闪启动感
  els.skip.hidden = true;
  els.speed.hidden = true;
  editor.onStatus('实验进行中：点未点燃物=点火；点已点燃的=💥遥控引爆；空白处拖拽=扔炮仗！');
  document.title = '🔥 实验进行中 · 擦炮虫虫实验室';
  els.ignite.disabled = true;
  els.end.hidden = false;
}

function finishRun(): void {
  state.mode = 'report';
  editor.locked = false;
  if (!state.sim) return;
  editor.onStatus(`实验结束 —— 报告已生成（爆炸${state.sim.stats.explosions} · 连锁×${state.sim.stats.chainMax}）`);
  document.title = '📋 事故报告 · 擦炮虫虫实验室';
  state.report = buildReport(state.sim, getScenario(state.scenarioId));
  // 本机最佳：分享来的自定义实验记入 custom 键；每日实验按日期入账（对照上次=今天上一局）
  const key = state.runExperiment?.custom ? 'custom' : state.dailyKey ? `daily-${state.dailyKey}` : state.scenarioId;
  const { best, isNew } = records.update(key, state.report.counts);
  state.report.best = best;
  state.report.isNewRecord = isNew;
  if (isNew) {
    sfx.fanfare();
    if (!reducedMotion) state.particles.confetti(VIEW_W); // 全屏彩带雨（表现层；减少动态时跳过）
    toast('🏆 新纪录！');
  }
  // 今日已挑战 → 按钮挂 ✓
  if (state.dailyKey) {
    els.daily.textContent = '📅 每日实验 ✓';
    els.daily.classList.remove('undone');
  }
  // 对照实验：与上一局的关键数字对比
  const lastKey = key + ':last';
  state.report.lastRun = records.load(lastKey) ?? undefined;
  records.save(lastKey, {
    chain: state.report.counts.chainMax,
    knockouts: state.report.counts.knockouts,
    explosions: state.report.counts.explosions,
  });
  showReport(state.report);
  // 目标达成：画布外框短暂泛绿光（正反馈）
  if (state.report.goal?.done) {
    canvas.classList.add('goal-done');
    setTimeout(() => canvas.classList.remove('goal-done'), 1600);
  }
  els.ignite.disabled = false;
  els.end.hidden = true;
}

function backToEdit(): void {
  state.mode = 'edit';
  editor.locked = false;
  state.trauma = 0; // 回编辑即恢复平静（清残留震屏/白闪/慢镜/推镜）
  state.flash = 0;
  state.hitStop = 0;
  state.slowmo = 0;
  state.panX = 0;
  state.panY = 0;
  state.sim = null;
  state.report = null;
  hideReport();
  els.ignite.disabled = false;
  canvas.focus({ preventScroll: true }); // 键盘用户：焦点回画布，空格/Esc 立即可用
  editor.onStatus('回到编辑：调整布置后再次点燃');
}

function toggleIgnite(): void {
  if (state.mode === 'edit') startRun(false);
}

els.ignite.addEventListener('click', toggleIgnite);
els.end.addEventListener('click', () => state.mode === 'running' && finishRun());
els.rerun.addEventListener('click', () => {
  if (state.mode === 'report' && state.runExperiment) startRun(true);
});
els.newSeed.addEventListener('click', () => {
  state.seed = (Math.random() * 0x7fffffff) | 0;
  state.runExperiment = null;
  state.dailyKey = null; // 换种子就不再是"今天那份实验"
  toast('新种子 #' + state.seed.toString(36).toUpperCase() + '（虫子行为将不同）');
  if (state.mode !== 'edit') backToEdit();
});
// 每日实验：全世界今天同一份种子+布局（确定性生成），跑完和今天上一局比
els.daily.addEventListener('click', () => {
  const key = todayKey();
  const daily = buildDaily(key);
  state.dailyKey = key;
  state.seed = daily.seed;
  // 每日实验不是任何案例：目标行/场景记忆必须退出案例语境
  state.scenarioId = 'free';
  els.scenario.value = 'free';
  editor.clear();
  for (const e of daily.entities) editor.addSpec(e.t, e.x, e.y, e);
  state.mode = 'edit';
  editor.locked = false;
  hideReport();
  els.ignite.disabled = false;
  document.title = `擦炮虫虫实验室 · 📅 每日实验 ${key}`;
  const doneToday = records.load(`daily-${key}`);
  const now = new Date();
  const hoursLeft = 24 - now.getHours();
  editor.onStatus(
    `📅 每日实验 #${key} · ${THEME_LABELS[daily.theme]} —— 全世界今天同一份布局（想改也行）。点燃开跑，跑完和今天上一局比！约 ${hoursLeft} 小时后换新实验。${doneToday ? '（今天已挑战过，试试打破自己的纪录）' : ''}`,
  );
});
// 今日已挑战过 → 按钮上挂个 ✓（未完成挂呼吸点）；留存钩子：让"今天玩过了吗"可见
function refreshDailyBadge(): void {
  try {
    const done = !!records.load(`daily-${todayKey()}`);
    els.daily.classList.toggle('undone', !done);
    if (done) els.daily.textContent = '📅 每日实验 ✓';
  } catch {}
}
refreshDailyBadge();
// 清空重摆：编辑模式下一键清掉所有摆放（含自由实验的本地存档）
els.clear.addEventListener('click', () => {
  if (state.mode !== 'edit') return;
  editor.clear();
  state.dailyKey = null; // 布局清空即退出每日实验
  try {
    localStorage.removeItem('bbl-free-layout');
  } catch {}
  editor.onStatus('已清空 —— 重新摆放你的实验吧');
});
els.share.addEventListener('click', () => {
  if (!state.runExperiment || !state.sim) return toast('先跑一次实验再分享');
  const exp: Experiment = {
    ...state.runExperiment,
    // 完整命令流：点燃/投掷/遥控引爆都要带上，否则对方重放不出同一场事故
    commands: state.sim.commandLog.map((c): TimedCommand =>
      c.op === 'throw'
        ? { tick: c.tick, op: 'throw', x: c.x, y: c.y, vx: c.vx, vy: c.vy }
        : c.op === 'detonate'
          ? { tick: c.tick, op: 'detonate', id: c.id }
          : { tick: c.tick, op: 'ignite', id: c.id },
    ),
  };
  const url = location.origin + location.pathname + toHash(exp);
  // 同步写进地址栏：①"复制失败请手动复制地址栏"的兜底真实可用；②刷新页面即重放这场事故
  history.replaceState(null, '', toHash(exp));
  // 文案带事故标题+战绩：粘贴到聊天里不用点开链接就想看
  const headline = state.report
    ? `《${state.report.title}》连锁×${state.report.counts.chainMax}·击倒${state.report.counts.knockouts} —— `
    : '';
  navigator.clipboard?.writeText(headline + url).then(
    () => toast('分享链接已复制 ✓ 对方打开就是同一个实验'),
    () => toast('复制失败，请手动复制地址栏链接'),
  );
});
els.replayShare.addEventListener('click', () => startRun(true)); // 分享码重放 = 带命令重跑模拟
els.skip.addEventListener('click', () => {
  if (state.mode === 'replay') finishReplay();
});
els.speed.addEventListener('click', () => {
  if (state.mode === 'replay') toggleReplaySpeed();
});

// 报告浮层按钮
document.getElementById('btn-overlay-replay')?.addEventListener('click', () => startReplay());
document.getElementById('btn-overlay-rerun')?.addEventListener('click', () => {
  if (state.runExperiment) startRun(true);
});
document.getElementById('btn-overlay-edit')?.addEventListener('click', backToEdit);
document.getElementById('report-close')?.addEventListener('click', backToEdit);

// ---- 运行中输入：点未点燃爆炸物=点燃；空白处拖拽=扔进点燃的炮仗 ----
interface RunDrag {
  wx: number;
  wy: number;
  vx: number;
  vy: number;
}
let runDrag: RunDrag | null = null; // {wx, wy, vx, vy} 世界坐标起投点与当前投掷速度

function canvasWorld(ev: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * VIEW_W,
    y: ((ev.clientY - rect.top) / rect.height) * VIEW_H,
  };
}

canvas.addEventListener('pointerdown', (ev) => {
  if (state.mode !== 'running' || !state.sim || ev.button !== 0) return;
  const { x, y } = canvasWorld(ev);
  const id = state.sim.pickIgnitable(x, y);
  if (id !== null) {
    state.sim.playerIgnite(id);
    const b = state.sim.world.byId(id);
    if (b) state.particles.spark(b.x, b.y, 4);
    editor.onStatus('点燃！');
    return;
  }
  // 遥控引信：点已点燃的爆炸物 = 立即引爆（引爆时机从运气变成技巧）
  const did = state.sim.pickDetonatable(x, y);
  if (did !== null) {
    state.sim.playerDetonate(did);
    const b = state.sim.world.byId(did);
    if (b) state.particles.spark(b.x, b.y, 6);
    editor.onStatus('💥 遥控引爆！');
    return;
  }
  // 投掷机会用完：不再启动拖拽（防无效交互）
  const cap = getScenario(state.scenarioId).maxThrows;
  if (cap && (state.sim.stats.throws ?? 0) >= cap) {
    editor.onStatus(`投掷机会用完了（${cap} 次）—— 想想怎么一发命中`);
    return;
  }
  runDrag = { wx: x, wy: y, vx: 0, vy: 0 };
});

// 运行中悬停：可点燃/可引爆物高亮 + 光标提示（交互可读性）
interface RunHover {
  id: number;
  kind: 'ignite' | 'detonate';
}
let runHover: RunHover | null = null;

canvas.addEventListener('pointermove', (ev) => {
  if (state.mode !== 'running' || !state.sim || runDrag) {
    runHover = null;
    canvas.style.cursor = 'crosshair';
    return;
  }
  const { x, y } = canvasWorld(ev);
  const ig = state.sim.pickIgnitable(x, y);
  if (ig !== null) {
    runHover = { id: ig, kind: 'ignite' };
  } else {
    const de = state.sim.pickDetonatable(x, y);
    runHover = de !== null ? { id: de, kind: 'detonate' } : null;
  }
  canvas.style.cursor = runHover ? 'pointer' : 'crosshair';
});

window.addEventListener('pointermove', (ev) => {
  if (!runDrag) return;
  const { x, y } = canvasWorld(ev);
  runDrag.vx = Math.max(-750, Math.min(750, (x - runDrag.wx) * 4));
  runDrag.vy = Math.max(-750, Math.min(750, (y - runDrag.wy) * 4));
});

window.addEventListener('pointerup', () => {
  if (!runDrag) return;
  const d = runDrag;
  runDrag = null;
  if (Math.hypot(d.vx, d.vy) > 60) {
    const cap = getScenario(state.scenarioId).maxThrows;
    if (cap && state.sim && (state.sim.stats.throws ?? 0) >= cap) {
      editor.onStatus(`投掷机会用完了（${cap} 次）—— 想想怎么一发命中`);
      return;
    }
    state.sim?.playerThrow(d.wx, d.wy, d.vx, d.vy);
    sfx.whoosh();
    editor.onStatus('扔进去一根点着的炮仗 💣');
    try {
      if (!localStorage.getItem('bbl-threw-once')) {
        localStorage.setItem('bbl-threw-once', '1');
        toast('会了！高抛可以越过障碍，平抛可以贴地滑行');
      }
    } catch {}
  }
});

// ---- 报告 ----
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showReport(rep: Report): void {
  const c = rep.counts;
  const sc = rep.goal;
  els.reportTitle.innerHTML = `THE INCIDENT · ${rep.id}<div style="font-size:13px;color:var(--dim);font-family:system-ui;margin-top:2px">《${rep.title}》</div>`;
  if (sc?.done) markGoalDone(state.scenarioId);
  const rows: [string, string | number][] = [
    ['爆炸次数', c.explosions],
    ['最大连锁', '×' + c.chainMax],
    [
      '击倒玩具',
      c.knockouts +
        (() => {
          // 击倒分类全列出：案例2 蟑螂、案例5 苍蝇等狩猎目标一眼可读
          const names: Record<string, string> = { roach: '蟑螂', locust: '蝗虫', scarab: '清道夫', snail: '蜗牛', fly: '苍蝇' };
          const detail = Object.entries(c.koByType ?? {})
            .filter(([, n]) => (n as number) > 0)
            .map(([t, n]) => `${names[t] ?? t}×${n}`)
            .join(' ');
          return detail ? `（${detail}）` : '';
        })(),
    ],
    ['意外事件', c.unexpected],
    ['绳子断裂', c.ropesBroken],
    ['大头针命中', c.pins],
    ['胶水粘附', c.glues],
    ['一爆多杀', c.multiKills],
    ['装甲裂纹', c.cracks],
    ['实验时长', rep.duration.toFixed(1) + 's'],
  ];
  let html = rows
    .map(([k, v], i) => `<div class="stat" style="animation-delay:${i * 45}ms"><span>${k}</span><b>${v}</b></div>`)
    .join('');
  // 零爆炸 = 新玩家最可能的迷路点：报告的第一使命是教会下一步，嘲讽只配当第二句
  if (c.explosions === 0) {
    const teachStyle = 'color:#ffd9a0;border-color:rgba(255,200,120,0.3);background:rgba(255,200,120,0.07)';
    if (rep.unlit) {
      html += `<div class="goal" style="${teachStyle}">💡 场上有 ${rep.unlit} 根没点着的炮仗（落水的哑弹也能再点燃）—— 运行中<b>点它一下</b>就炸</div>`;
    } else if ((rep.explosiveTotal ?? 0) === 0) {
      html +=
        state.scenarioId === 'free'
          ? `<div class="goal" style="${teachStyle}">💡 这场只有虫虫在散步 —— 从工具箱摆一根 🧨 小炮仗再点燃；运行中空白处<b>拖拽</b>还能扔点着的炮仗进去</div>`
          : `<div class="goal" style="${teachStyle}">💡 这一关靠投掷开场 —— 运行中在空白处<b>按住拖拽</b>，松手就把点着的炮仗扔出去（瞄准预览会显示落点）</div>`;
    }
  }
  // 对照实验：与上一局对比（首局给出可发现性提示；三平 = 确定性的高光时刻）
  if (rep.lastRun) {
    const dChain = rep.counts.chainMax - rep.lastRun.chain;
    const dKo = rep.counts.knockouts - rep.lastRun.knockouts;
    const dExp = rep.counts.explosions - rep.lastRun.explosions;
    if (dChain === 0 && dKo === 0 && dExp === 0) {
      html +=
        '<div class="stat" style="border-bottom:none"><span>对照上次</span><b style="font-weight:400;font-size:12px;color:#9fe6a0">与上次完全一致 —— 确定性 ✓（同种子同操作 = 同一场灾难）</b></div>';
    } else {
      const delta = (d: number): string => {
        if (d === 0) return '<span style="color:var(--dim)">＝</span>';
        return d > 0 ? `<span style="color:#9fe6a0">＋${d}</span>` : `<span style="color:#ff9a8a">${d}</span>`;
      };
      html += `<div class="stat" style="border-bottom:none"><span>对照上次</span><b style="font-weight:400;font-size:12px">连锁${delta(dChain)} · 击倒${delta(dKo)} · 爆炸${delta(dExp)}</b></div>`;
    }
  } else {
    html +=
      '<div class="stat" style="border-bottom:none"><span>对照上次</span><b style="font-weight:400;font-size:12px;color:var(--dim)">首局 —— 同场景再跑一次即可对比</b></div>';
  }
  if (rep.best) {
    html += `<div class="goal" style="color:#9fd0ff;border-color:rgba(126,200,255,0.3);background:rgba(126,200,255,0.07)">本机最佳 · 连锁×${rep.best.chain} · 击倒 ${rep.best.knockouts}${rep.isNewRecord ? ' 🎉 新纪录！' : ''}</div>`;
  }
  let nextScenario: { id: string; label: string } | null = null;
  if (sc) {
    html += `<div class="goal ${sc.done ? 'done' : ''}">目标「${sc.label}」：${sc.done ? '达成 ✓' : '未达成'}`;
    if (sc.bonus) html += ` · ${sc.bonus}`;
    html += '</div>';
    // 目标达成 → 引导挑战下一个场景（全达成则引导回自由实验）
    if (sc.done) {
      const idx = SCENARIOS.findIndex((s) => s.id === state.scenarioId);
      const nx = idx >= 0 ? SCENARIOS[idx + 1] : undefined;
      if (nx) {
        nextScenario = { id: nx.id, label: nx.label };
        html += `<div class="goal" id="btn-next-scenario" style="color:#9fd0ff;border-color:rgba(126,200,255,0.3);background:rgba(126,200,255,0.07);cursor:pointer">➡️ 挑战下一关：「${nx.label}」</div>`;
      } else {
        html += '<div class="goal done">九个案例全部达成 —— 去自由实验发明你自己的灾难吧！🎉</div>';
      }
    }
  }
  if (rep.timeline.length) {
    const chipStyle = (depth: number): string => {
      if (depth >= 4) return 'color:#ff8a70;border-color:rgba(255,120,64,0.6);background:rgba(255,120,64,0.12)';
      if (depth >= 3) return 'color:#ffb37a;border-color:rgba(255,150,80,0.45);background:rgba(255,140,70,0.08)';
      if (depth >= 2) return 'color:#ffd166;border-color:rgba(255,209,102,0.4);background:rgba(255,209,102,0.07)';
      return '';
    };
    html +=
      '<div class="timeline">' +
      rep.timeline
        .map((t) => {
          const tick = Math.max(0, Math.round(t.t * 60));
          const style = t.depth ? ` style="${chipStyle(t.depth)}"` : '';
          return `<span class="chip-jump" data-tick="${tick}"${style}>${t.t.toFixed(2)}s · ${causeName(t.cause)}${t.depth ? ` · 连锁${t.depth}` : ''}</span>`;
        })
        .join('') +
      '</div>';
  }
  els.reportBody.innerHTML = html;
  els.report.hidden = false;
  // 时间线芯片点击 → 跳到该时刻回放（从爆炸前 0.5s 开始看）
  els.reportBody.querySelectorAll('.chip-jump').forEach((chip) => {
    chip.addEventListener('click', () => {
      const tick = Number((chip as HTMLElement).dataset.tick ?? 0);
      startReplay();
      const rp = state.replay;
      if (rp) {
        const cur = Math.max(rp.startTick ?? 0, tick - 30);
        rp.cursor = cur;
        const events = state.sim?.eventLog ?? [];
        rp.eventIdx = events.findIndex((e) => (e.tick ?? 0) >= cur);
        if (rp.eventIdx < 0) rp.eventIdx = events.length;
      }
    });
  });
  // 整数统计滚动计数（600ms ease-out，纯装饰不影响数值本身）
  if (!reducedMotion) {
    const dur = 600;
    const t0 = performance.now();
    const counters: { el: HTMLElement; target: number }[] = [];
    els.reportBody.querySelectorAll<HTMLBRElement>('.stat b').forEach((b) => {
      const n = Number.parseInt(b.textContent ?? '', 10);
      if (Number.isFinite(n) && n > 0 && /^\d+$/.test((b.textContent ?? '').trim())) counters.push({ el: b, target: n });
    });
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      for (const c of counters) c.el.textContent = String(Math.round(c.target * e));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // 报告卡内加一个分享入口（生成刚才这场事故的分享码）
  const shareInReport = document.getElementById('btn-overlay-share');
  if (shareInReport && !shareInReport.dataset.wired) {
    shareInReport.dataset.wired = '1';
    shareInReport.addEventListener('click', () => els.share.click());
  }
  // 「挑战下一关」直达：切换场景并回到编辑
  if (nextScenario) {
    document.getElementById('btn-next-scenario')?.addEventListener('click', () => {
      loadScenario(nextScenario.id);
      toast('已载入 ' + nextScenario.label);
    });
  }
}

function causeName(c: string): string {
  return ({ fuse: '引信', impact: '撞击', burnout: '燃尽' }[c] as string | undefined) ?? c;
}

function hideReport(): void {
  els.report.hidden = true;
}

function toast(msg: string): void {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// ---- 回放 ----
function startReplay(): void {
  if (!state.recorder?.frames.length || !state.sim) return;
  state.mode = 'replay';
  const frames = state.recorder.frames;
  // 从第一声爆炸前 1.5s 开始看（跳过冗长的摆放等待）
  const firstExp = state.sim.eventLog.find((e) => e.type === 'explosion');
  const startTick = Math.max(frames[0].tick, (firstExp?.tick ?? frames[0].tick) - 90);
  state.replay = {
    cursor: startTick,
    startTick,
    eventIdx: state.sim.eventLog.findIndex((e) => (e.tick ?? 0) >= startTick),
  };
  if ((state.replay.eventIdx ?? 0) < 0) state.replay.eventIdx = state.sim.eventLog.length;
  // 焦痕/浮字清空，由重演逐步重建（视觉与实况时间轴一致）
  state.scorches = [];
  state.floatTexts = [];
  els.speed.textContent = `⏱ ${replaySpeed}×`;
  els.skip.hidden = false;
  els.speed.hidden = false;
  editor.onStatus('回放中：空格或「跳过回放」直达报告，⏱ 可切 1× 倍速');
  hideReport();
}

function finishReplay(): void {
  state.mode = 'report';
  state.replay = null;
  els.skip.hidden = true;
  els.speed.hidden = true;
  editor.onStatus('事故报告 —— 可回放、分享，或继续改造');
  if (state.report) showReport(state.report);
}

function toggleReplaySpeed(): void {
  replaySpeed = replaySpeed <= 0.5 ? 1 : 0.5;
  els.speed.textContent = `⏱ ${replaySpeed}×`;
}

function stepReplay(dt: number): void {
  const rp = state.replay;
  const frames = state.recorder?.frames;
  if (!rp || !frames || !frames.length) return;
  rp.cursor += dt * 60 * replaySpeed;
  // 到达的事件 → 表现层重演（完整事件流：爆炸/击倒/气球爆/断绳…，不重排时间轴）
  const events = state.sim?.eventLog ?? [];
  while (rp.eventIdx < events.length && (events[rp.eventIdx].tick ?? 0) <= rp.cursor) {
    applyEventPresentation(events[rp.eventIdx++], false);
  }
  if (rp.cursor >= frames[frames.length - 1].tick + 30) finishReplay();
}

// 快照插值
function viewAtCursor(): SceneView {
  const frames = state.recorder?.frames ?? [];
  const rp = state.replay;
  const t = rp?.cursor ?? 0;
  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].tick <= t) i++;
  const f0 = frames[i];
  const f1 = frames[Math.min(i + 1, frames.length - 1)];
  const k = f1.tick > f0.tick ? Math.min(1, (t - f0.tick) / (f1.tick - f0.tick)) : 0;
  const map1 = new Map(f1.bodies.map((b) => [b[0], b]));
  const items: ItemView[] = [];
  const frameDt = f1.tick > f0.tick ? (f1.tick - f0.tick) / 60 : 0;
  for (const b of f0.bodies) {
    const b1 = map1.get(b[0]) ?? b;
    if (b[5] === 1) continue; // 已消耗
    items.push({
      t: b[6],
      kind: b[1] as ItemView['kind'],
      x: b[2] + (b1[2] - b[2]) * k,
      y: b[3] + (b1[3] - b[3]) * k,
      id: b[0],
      angle: b[4] + (b1[4] - b[4]) * k,
      aim: null,
      lit: false,
      burning: false,
      acc: [],
      knocked: b[5] === 2,
      frozen: b[5] === 3,
      speed: frameDt > 0 ? Math.hypot(b1[2] - b[2], b1[3] - b[3]) / frameDt : 0,
      speedX: frameDt > 0 ? (b1[2] - b[2]) / frameDt : 0,
      speedY: frameDt > 0 ? (b1[3] - b[3]) / frameDt : 0,
    });
  }
  // 绳子：用 f0 帧端点近似画（断裂的不画）
  const ropeViews = [];
  for (const r of state.sim?.world.ropes ?? []) {
    if (r.broken) continue;
    const a = f0.bodies.find((b) => b[0] === r.aId);
    const b = f0.bodies.find((b) => b[0] === r.bId);
    if (a && b) ropeViews.push({ ax: a[2], ay: a[3], bx: b[2], by: b[3] });
  }
  return { items, ropes: ropeViews };
}

// ---- 主循环 ----
// 时间基准统一：rAF 与兜底 setInterval 都调 tick()，靠真实时间累加器步进，
// 后台标签页 rAF 被节流时也能以最低 4×4 步/秒推进（真实用户切窗不影响前台帧率）。
let last = performance.now();
let acc = 0;

function tick(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  state.lastDt = dt;

  // 焦痕老化
  for (const sc of state.scorches) sc.age += dt;
  state.scorches = state.scorches.filter((sc) => sc.age < sc.ttl);
  // 连锁浮动大字老化
  for (const ft of state.floatTexts) ft.age += dt;
  state.floatTexts = state.floatTexts.filter((ft) => ft.age < ft.ttl);

  // 表现层反馈衰减：trauma 线性衰减（震屏量 = trauma²）、白闪快衰（连锁时防过曝）、顿帧走真实时间
  state.trauma = Math.max(0, state.trauma - dt * 1.7);
  state.flash = Math.max(0, state.flash - dt * 3.4);
  if (state.hitStop > 0) state.hitStop = Math.max(0, state.hitStop - dt);
  // 环境微尘：台灯光束里的漂浮微粒（纯装饰）
  if (!reducedMotion && Math.random() < 0.1) state.particles.mote(VIEW_W, VIEW_H);

  // 慢镜头镜头缓推：向爆心平移（限幅），结束回中
  {
    const k = Math.min(1, dt * 3.2);
    if (state.slowmo > 0 && state.slowmoCenter) {
      const tx = Math.max(-6, Math.min(6, (state.slowmoCenter.x - VIEW_W / 2) * 0.2));
      const ty = Math.max(-4, Math.min(4, (state.slowmoCenter.y - VIEW_H / 2) * 0.2));
      state.panX += (tx - state.panX) * k;
      state.panY += (ty - state.panY) * k;
    } else {
      state.panX += (0 - state.panX) * Math.min(1, dt * 5);
      state.panY += (0 - state.panY) * Math.min(1, dt * 5);
    }
  }

  // 连锁慢镜头：真实时间变慢，模拟 tick 内容不变（不破坏确定性）
  if (state.slowmo > 0) {
    state.slowmo = Math.max(0, state.slowmo - dt);
    state.zoomPunch += (1 - state.zoomPunch) * Math.min(1, dt * 3);
  } else {
    state.zoomPunch += (1 - state.zoomPunch) * Math.min(1, dt * 6);
  }
  // 顿帧 > 慢镜头 > 实时（都是时间缩放，不碰模拟内容）
  const scale = state.hitStop > 0 ? 0.06 : state.slowmo > 0 ? 0.35 : 1;
  acc += dt * scale;

  if (state.mode === 'running') {
    let steps = 0;
    while (acc >= DT && steps < 4) {
      acc -= DT;
      steps++;
      stepOnce();
    }
    // 静默收尾：3s 无事件即出报告（自由实验的炮仗自带 0.15s 延迟点燃，
    // 3s 足够"扔进去→炸"；报告卡承担"为什么什么都没发生"的教学）
    const quiet = state.sim ? state.sim.tick - state.lastEventTick > 180 : false;
    if (quiet) finishRun();
  } else {
    acc = 0;
    state.particles.update(dt);
    if (state.mode === 'replay') stepReplay(dt);
  }

  if (!shouldSkipRender()) render();
}

// 后台标签页不渲染（模拟照走，rAF 本就被节流，省电）；自动化 renderNow 不受影响
function shouldSkipRender(): boolean {
  try {
    return typeof document !== 'undefined' && document.hidden;
  } catch {
    return false;
  }
}

function stepOnce(): void {
  if (!state.sim || !state.recorder) return;
  state.sim.step();
  state.recorder.record(state.sim);
  handleEvents(state.sim.eventsThisStep);
  // 火箭尾迹烟：飞行中的冲天炮/窜天猴每隔一 tick 冒一口（纯表现层）
  if (state.sim.tick % 2 === 0) {
    for (const b of state.sim.world.bodies) {
      if (!b.alive || b.kind !== 'explosive') continue;
      if ((b.data.burn ?? 0) > 0 && (b.data.etype === 'skyrocket' || b.data.etype === 'bottle')) {
        state.particles.rocketTrail(b.x, b.y);
      }
      // 点燃的炮仗偶发掉落火星
      if (b.data.lit && b.data.etype === 'firecracker' && state.sim.tick % 9 === 0) {
        state.particles.spark(b.x, b.y - 1, 1);
      }
    }
  }
  // 落水水花：物体从水盆外进入水盆且在下坠（纯表现层状态检测）
  {
    const zones = state.sim.world.bodies.filter((b) => b.alive && b.data.waterZone);
    for (const b of state.sim.world.bodies) {
      if (!b.alive || b.data.waterZone) continue;
      const inside = zones.some((z) => Math.hypot(b.x - z.x, b.y - z.y) < z.radius + b.radius * 0.3);
      const was = inWater.get(b.id) ?? false;
      if (inside && !was && b.vy > 40) state.particles.splash(b.x, b.y - b.radius * 0.4);
      inWater.set(b.id, inside);
    }
    if (inWater.size > 400) inWater.clear();
  }
  // 冰面滑行霜痕：在冰面上高速横移时脚下溅冰晶（纯表现层）
  {
    const ice = state.sim.world.bodies.filter(
      (b) => b.alive && b.kind === 'prop' && b.data.propType === 'ice' && b.data.materialZone,
    );
    if (ice.length) {
      for (const b of state.sim.world.bodies) {
        if (!b.alive || b.data.waterZone || b.data.materialZone) continue;
        if (Math.abs(b.vx) > 190 && ice.some((z) => Math.hypot(b.x - z.x, b.y - z.y) < z.radius + b.radius)) {
          state.particles.frost(b.x, b.y + b.radius * 0.6);
        }
      }
    }
  }
  state.particles.update(DT);
}

// 落水检测的每实体记忆（表现层）
const inWater = new Map<number, boolean>();

// HUD 连锁脉冲（表现层）
let hudChainShown = 0;
let hudChainPopUntil = 0;

function frame(_now: number): void {
  tick();
  requestAnimationFrame(frame);
}
setInterval(tick, 250); // 后台兜底驱动

// 事件 → 表现层副作用。live=true（实况）允许改时间轴（顿帧/慢镜头）；回放重演只做视听反馈。
function applyEventPresentation(e: RecordedEvent, live: boolean): void {
  if (e.type === 'explosion') {
    state.particles.explosion(e.x, e.y, e.power);
    sfx.explosion(e.power);
    // 焦痕：地面战损记忆（最多 24 个，12s 淡去）
    state.scorches.push({ x: e.x, y: Math.min(e.y + 4, 178), r: 5 + e.power * 0.12, age: 0, ttl: 12 });
    if (state.scorches.length > 24) state.scorches.shift();
    // 镜头推近一点，随时间回弹（减少动态时跳过这类镜头运动）
    if (!reducedMotion) state.zoomPunch = Math.min(1.08, state.zoomPunch + e.power / 2600);
    // 反馈分级（game-feel）：威力决定 trauma/白闪；大威力才给顿帧，小爆不拦节奏
    const motionK = reducedMotion ? 0.35 : 1;
    state.trauma = Math.min(1, state.trauma + (0.22 + Math.min(0.55, e.power / 200)) * motionK);
    state.flash = Math.min(0.38, state.flash + Math.min(0.32, e.power / 300) * motionK);
    // 方向性推镜：镜头被冲击波往爆点反方向推一下（回中弹簧自动收回）
    const kick = Math.min(2.5, e.power / 80) * motionK;
    state.panX = Math.max(-4, Math.min(4, state.panX - ((e.x - VIEW_W / 2) / (VIEW_W / 2)) * kick));
    state.panY = Math.max(-3, Math.min(3, state.panY - ((e.y - VIEW_H / 2) / (VIEW_H / 2)) * kick));
    if (live && !reducedMotion && e.power >= 40) {
      state.hitStop = Math.max(state.hitStop, 0.05 + Math.min(0.05, (e.power - 40) / 900));
    }
    // 贴地爆炸 → 地面扬尘浪
    if (e.y > 130 && e.power >= 30) state.particles.dust(e.x, 178);
    // 连锁 ≥2 → 慢镜头：一局只给第一次大连锁聚光灯，后续保持实时节奏
    if (live && e.depth >= 2 && !state.slowmoUsed) {
      state.slowmo = Math.max(state.slowmo, 0.7);
      state.slowmoUsed = true;
      state.slowmoCenter = { x: e.x, y: e.y };
      state.particles.timeRing(e.x, e.y); // 时间涟漪：聚光灯开启的仪式感
    }
    // 连锁浮动大字
    if (e.depth >= 2) {
      state.floatTexts.push({ x: e.x, y: e.y - 4, text: `连锁×${e.depth}`, age: 0, ttl: 1.1 });
      if (state.floatTexts.length > 8) state.floatTexts.shift();
    }
  } else if (e.type === 'knockout') {
    state.particles.spark(e.x, e.y, 8);
    sfx.knockout();
    state.itemFx.pop(e.id, 1); // 击倒瞬间：翻壳 + 弹跳挤压
    state.trauma = Math.min(1, state.trauma + 0.07);
  } else if (e.type === 'multiKill') {
    state.floatTexts.push({ x: e.x, y: e.y - 6, text: `一爆多杀 ×${e.count}`, age: 0, ttl: 1.2 });
    if (live && !state.slowmoUsed) {
      state.slowmo = Math.max(state.slowmo, 0.9);
      state.slowmoUsed = true;
    }
  } else if (e.type === 'pinStick' || e.type === 'glueStick') {
    state.particles.puff(e.x, e.y);
    sfx.stick();
    state.itemFx.pop(e.id, 0.5);
  } else if (e.type === 'balloonPop') {
    state.particles.spark(e.x, e.y, 5);
    state.particles.rubberPop(e.x, e.y); // 橡胶碎片
    sfx.pop();
  } else if (e.type === 'ropeBreak') {
    state.particles.spark(e.x, e.y, 4);
    state.particles.ropeBits(e.x, e.y); // 断绳飞散
    sfx.ropeBreak();
    state.trauma = Math.min(1, state.trauma + 0.05);
  } else if (e.type === 'chainIgnite') {
    // 殉爆引燃：火苗跳到下一根炮仗的瞬间
    state.particles.spark(e.x, e.y, 3);
    if (e.depth >= 2) state.trauma = Math.min(1, state.trauma + 0.04);
  } else if (e.type === 'ignite') {
    state.particles.spark(e.x, e.y, 2);
    sfx.fuse();
  } else if (e.type === 'slimeBurn') {
    state.particles.puff(e.x, e.y);
  } else if (e.type === 'locustJump') {
    state.itemFx.pop(e.id, 0.45); // 起跳蹬地：蓄力压缩弹回
  } else if (e.type === 'armorCrack') {
    state.itemFx.pop(e.id, 0.7); // 裂甲：重击感
  } else if (e.type === 'propCrack') {
    state.particles.spark(e.x, e.y, 3); // 玻璃砖裂纹出现时的细碎火花
  } else if (e.type === 'douse') {
    state.particles.puff(e.x, e.y);
    state.particles.splash(e.x, e.y); // 水花
    sfx.fuse(); // 呲——
  } else if (e.type === 'fireTick') {
    // 火焰火星 + 噼啪声
    for (let i = 0; i < 3; i++) state.particles.spark(e.x + (Math.random() - 0.5) * 16, e.y - Math.random() * 8, 1);
    sfx.crackle();
  } else if (e.type === 'propBreak') {
    state.particles.spark(e.x, e.y, 10);
    sfx.glassBreak();
    state.trauma = Math.min(1, state.trauma + 0.1);
  }
}

function handleEvents(events: RecordedEvent[]): void {
  for (const e of events) {
    applyEventPresentation(e, true);
    if (['explosion', 'knockout', 'ropeBreak', 'multiKill', 'armorCrack', 'pinStick', 'glueStick'].includes(e.type)) {
      state.lastEventTick = e.tick;
    }
  }
}

function render(): void {
  // trauma 震屏：trauma² 驱动、分层正弦采样（平滑不抖），附小幅滚转
  const t2 = state.trauma * state.trauma;
  const ts = performance.now() / 1000;
  const shakeX = 12 * t2 * (0.6 * Math.sin(ts * 23.7) + 0.4 * Math.sin(ts * 41.1 + 1.3));
  const shakeY = 8 * t2 * (0.6 * Math.sin(ts * 29.3 + 0.7) + 0.4 * Math.sin(ts * 47.9));
  const shakeRoll = 0.035 * t2 * Math.sin(ts * 19.1 + 2.1);
  let view: SceneView | null = null;
  const opts: DrawOptions = {
    particles: state.particles,
    shakeX,
    shakeY,
    shakeRoll,
    flash: state.flash,
    time: ts,
    zoom: state.zoomPunch,
    scorches: state.scorches,
    floatTexts: state.floatTexts,
    slowmoActive: state.slowmo > 0,
    itemFx: state.itemFx,
    panX: state.panX,
    panY: state.panY,
    grainStatic: reducedMotion,
  };

  if (state.mode === 'edit') {
    view = viewFromSpecs(editor.specs, editor.ropeList, editor.ropePicking ?? -1, editor.hoverIdx ?? -1);
    opts.showAim = true;
    opts.ghost = editor.ghost;
    // 绳子工具连接预览：第一选点 → 鼠标
    if (editor.tool === 'rope' && editor.ropePicking != null && editor.hoverPos) {
      const p = editor.specs[editor.ropePicking];
      if (p) opts.ropePreview = { ax: p.x, ay: p.y, bx: editor.hoverPos.x, by: editor.hoverPos.y };
    }
    opts.hoverDestructive = editor.tool === 'eraser';
    // 空场景中央引导
    if (editor.specs.length === 0) opts.centerHint = '从左侧工具箱选择物品 · 点击盒子摆放';
  } else if (state.mode === 'running' || (state.mode === 'report' && state.sim)) {
    view = viewFromSim(state.sim!);
    opts.recDot = state.mode === 'running';
    if (state.mode === 'running') {
      opts.showAim = true;
      // 弹道预览：runDrag 用的是 wx/wy（世界坐标起投点），换名成绘制要的 x/y
      if (runDrag) {
        const spd = Math.hypot(runDrag.vx, runDrag.vy);
        const waterZones = state.sim
          ? state.sim.world.bodies
              .filter((b) => b.alive && b.kind === 'prop' && b.data.waterZone)
              .map((b) => ({ x: b.x, y: b.y, radius: b.radius }))
          : [];
        const oilZones = state.sim
          ? state.sim.world.bodies
              .filter((b) => b.alive && b.kind === 'prop' && (b.data.oilZone ?? false) && b.data.propType === 'oil')
              .map((b) => ({ x: b.x, y: b.y, radius: b.radius }))
          : [];
        opts.throwPreview = {
          x: runDrag.wx,
          y: runDrag.wy,
          vx: runDrag.vx,
          vy: runDrag.vy,
          power: Math.min(1, spd / 750), // 拖拽力度（与 pointermove 限幅一致）
          waterZones,
          oilZones,
        };
      }
      // 运行中悬停高亮
      if (runHover) {
        opts.hoverId = runHover.id;
        opts.hoverKind = runHover.kind;
      }
    }
  } else if (state.mode === 'replay') {
    view = viewAtCursor();
    const frames = state.recorder?.frames;
    const t0 = state.replay?.startTick ?? frames?.[0].tick ?? 0;
    const t1 = frames?.[frames.length - 1].tick ?? 1;
    opts.replayWatermark = true;
    opts.replayProgress = Math.max(0, ((state.replay?.cursor ?? 0) - t0) / Math.max(1, t1 - t0));
  }
  if (view) {
    state.itemFx.observe(view.items, state.lastDt); // 着陆/撞击检测（表现层）
    drawScene(ctx, W, H, view, opts);
  }
  // 运行中画布外框环境光变暖（CSS 类驱动）
  canvas.classList.toggle('running', state.mode === 'running');
  // 运行中隐藏不适用的工具栏按钮（防误触打断实验，移动端也省空间）
  const midRun = state.mode === 'running';
  els.rerun.hidden = midRun;
  els.daily.hidden = midRun;
  els.clear.hidden = midRun;
  // 编辑模式：点选类工具悬停到可作用目标时光标变 pointer（可供性）
  if (state.mode === 'edit') {
    canvas.style.cursor = editor.hoverIdx != null ? 'pointer' : 'crosshair';
  }

  // 实况统计 HUD：玻璃拟态圆角芯片（仅运行中显示；报告卡承担最终数据展示）
  if (state.mode === 'running' && state.sim) {
    const st = state.sim.stats;
    const goalFn = getScenario(state.scenarioId).goal;
    const goal = goalFn && state.sim ? goalFn(state.sim) : null; // goal 是函数，需求值
    const throwCap = getScenario(state.scenarioId).maxThrows;
    const chipW = 244;
    const chipH = goal ? 50 : 32;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(12, 12, chipW, chipH, 9);
    ctx.fillStyle = 'rgba(12,15,21,0.62)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(126,200,255,0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 连锁数增长 → 数字脉冲放大（juice）
    if (st.chainMax > hudChainShown) {
      hudChainShown = st.chainMax;
      hudChainPopUntil = ts + 0.28;
    }
    const pop = Math.max(0, hudChainPopUntil - ts) / 0.28;
    ctx.fillStyle = '#ffd166';
    ctx.font = `bold ${15 + 5 * pop}px ui-monospace, monospace`;
    const throwInfo = throwCap ? `  投掷${st.throws ?? 0}/${throwCap}` : '';
    ctx.fillText(`💥${st.explosions}  连锁×${st.chainMax}  击倒${st.knockouts}${throwInfo}`, 24, 34);
    if (goal) {
      ctx.fillStyle = goal.done ? '#9fe6a0' : 'rgba(215,221,230,0.75)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('目标：' + goal.label + (goal.done ? ' ✓' : ''), 24, 51);
    }
    ctx.restore();
  }
}
// ---- 启动 ----
// PWA：注册 Service Worker（离线可玩；仅 https/localhost 环境可用）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // file:// 或不受支持的环境：静默放弃
  });
}

// 关页/切后台前保存自由实验布置
window.addEventListener('pagehide', saveFreeLayout);

const fromHash = experimentFromHash(location.hash);
if (fromHash) {
  state.seed = fromHash.seed;
  editor.clear();
  loadEntitiesIntoEditor(fromHash.entities);
  state.runExperiment = { ...fromHash, custom: true };
  els.scenario.value = 'free';
  editor.onStatus('已加载分享的实验 —— 点「重放这场事故」或自行修改后点燃');
} else {
  let lastScenario = 'case1';
  try {
    lastScenario = getScenario(localStorage.getItem('bbl-last-scenario') || 'case1').id;
  } catch {}
  loadScenario(lastScenario);
}
refreshScenarioLabels();

els.replayShare.hidden = !fromHash;

// 调试句柄：自动化试玩与问题排查用
declare global {
  interface Window {
    __lab?: {
      editor: Editor;
      state: GameState;
      readonly sim: Simulation | null;
      specs: () => EntitySpec[];
      events: () => RecordedEvent[];
      renderNow: () => void;
      fastForward: (seconds: number) => boolean;
    };
  }
}

window.__lab = {
  editor,
  state,
  get sim(): Simulation | null {
    return state.sim;
  },
  specs: () => editor.specs.map((s) => ({ ...s })),
  events: () => (state.sim ? state.sim.eventLog.map((e) => ({ ...e })) : []),
  // 强制同步渲染一帧（节流标签页里截图前调用）
  renderNow() {
    render();
  },
  // 测试钩子：绕过实时时序，同步推进 N 秒的模拟（走完整管线：录制/特效/报告触发）
  fastForward(seconds: number): boolean {
    if (state.mode !== 'running' || !state.sim) return false;
    const target = state.sim.tick + Math.round(seconds * 60);
    let guard = 0;
    while (state.mode === 'running' && state.sim.tick < target && guard++ < 60 * 600) {
      stepOnce();
      if (state.sim.tick - state.lastEventTick > 180) finishRun();
    }
    return true;
  },
};

// ---- 场景目标达成徽章 ----
function markGoalDone(id: string): void {
  try {
    localStorage.setItem('bbl-goal-' + id, '1');
  } catch {}
  refreshScenarioLabels();
}

function refreshScenarioLabels(): void {
  for (const opt of els.scenario.options) {
    const sc = SCENARIOS.find((s) => s.id === opt.value);
    if (!sc) continue;
    let done = false;
    try {
      done = localStorage.getItem('bbl-goal-' + sc.id) === '1';
    } catch {}
    opt.textContent = (done && sc.goal ? '✓ ' : '') + sc.label;
  }
}

// ---- 键盘快捷键：空格=点燃/再来一次/跳过回放，R=再来一次，N=新实验，Esc=结束/继续改造 ----
window.addEventListener('keydown', (ev) => {
  const tag = (ev.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (ev.code === 'Space') {
    ev.preventDefault();
    if (state.mode === 'edit') startRun(false);
    else if (state.mode === 'report') startRun(true);
    else if (state.mode === 'replay') finishReplay();
  } else if (ev.key === 'r' || ev.key === 'R') {
    if (state.runExperiment && state.mode !== 'running') startRun(true);
  } else if (ev.key === 'n' || ev.key === 'N') {
    state.seed = (Math.random() * 0x7fffffff) | 0;
    state.runExperiment = null;
    toast('新种子 #' + state.seed.toString(36).toUpperCase());
    if (state.mode !== 'edit') backToEdit();
  } else if (ev.key === 'm' || ev.key === 'M') {
    els.mute?.click(); // 静音开关
  } else if (ev.key === 'f' || ev.key === 'F') {
    toggleFullscreen();
  } else if (ev.key === 'Escape') {
    if (helpEl && !helpEl.hidden) closeHelp();
    else if (state.mode === 'running') finishRun();
    else if (state.mode === 'replay') finishReplay();
    else if (state.mode === 'report') backToEdit();
  }
});

requestAnimationFrame(frame);
