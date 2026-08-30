// 主循环与游戏状态机：edit → running → report →(replay)→ report。

import { Simulation, DT } from '../sim/sim.js';
import { VIEW_W, VIEW_H, drawScene, viewFromSim, viewFromSpecs } from './render.js';
import { Particles } from './particles.js';
import { Editor } from './editor.js';
import { Recorder, buildReport, SNAPSHOT_INTERVAL } from '../game/replay.js';
import { SCENARIOS, getScenario } from '../game/scenario.js';
import { toHash, experimentFromHash } from '../game/encode.js';
import { Sfx } from './sounds.js';
import { createRecords } from '../game/records.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const els = {
  status: document.getElementById('status'),
  ignite: document.getElementById('btn-ignite'),
  rerun: document.getElementById('btn-rerun'),
  newSeed: document.getElementById('btn-newseed'),
  share: document.getElementById('btn-share'),
  replayShare: document.getElementById('btn-replay-share'),
  end: document.getElementById('btn-end'),
  scenario: document.getElementById('scenario'),
  report: document.getElementById('report'),
  reportBody: document.getElementById('report-body'),
  reportTitle: document.getElementById('report-title'),
  toast: document.getElementById('toast'),
  toolButtons: [...document.querySelectorAll('[data-tool]')],
};

const state = {
  mode: 'edit', // edit | running | report | replay
  seed: 20260830,
  scenarioId: 'free',
  sim: null,
  recorder: null,
  particles: new Particles(),
  lastEventTick: 0,
  lastExplosionSeen: -1,
  report: null,
  runExperiment: null, // {seed,width,height,entities,commands} 本次运行的输入
  replay: null, // 回放游标
  slowmo: 0, // 慢镜头剩余秒数（表现层）
  zoomPunch: 1, // 镜头推近系数（表现层）
};

const editor = new Editor(canvas);
editor.onStatus = (msg) => (els.status.textContent = msg);

// 音效：首个用户手势（点燃/点击画布）后创建 AudioContext
const sfx = new Sfx(
  typeof window !== 'undefined' && window.AudioContext
    ? () => new AudioContext()
    : null
);
// 本机最佳战绩
const records = createRecords();
els.mute = document.getElementById('btn-mute');
els.mute?.addEventListener('click', () => {
  sfx.muted = !sfx.muted;
  els.mute.textContent = sfx.muted ? '🔇' : '🔊';
  if (!sfx.muted) sfx.ensure();
});
// 首次任意画布交互时预热音频（自动播放策略要求手势）
canvas.addEventListener(
  'pointerdown',
  () => sfx.ensure(),
  { once: true }
);

// ---- 工具箱 ----
for (const btn of els.toolButtons) {
  btn.addEventListener('click', () => {
    editor.tool = btn.dataset.tool;
    els.toolButtons.forEach((b) => b.classList.toggle('active', b === btn));
    editor.onStatus('工具：' + btn.title);
  });
}
document.getElementById('fix-scarab')?.addEventListener('change', (e) => {
  editor.fixScarab = e.target.checked;
});

// ---- 场景 ----
for (const sc of SCENARIOS) {
  const opt = document.createElement('option');
  opt.value = sc.id;
  opt.textContent = sc.label;
  els.scenario.appendChild(opt);
}
els.scenario.addEventListener('change', () => {
  loadScenario(els.scenario.value);
});

function loadScenario(id) {
  const sc = getScenario(id);
  state.scenarioId = id;
  state.seed = sc.seed;
  els.scenario.value = id;
  editor.clear();
  loadEntitiesIntoEditor(sc.entities);
  state.mode = 'edit';
  editor.locked = false;
  hideReport();
  editor.onStatus(sc.desc);
}

// 把实体列表装入编辑器（绳子索引对换算成编辑器的绳子表）
function loadEntitiesIntoEditor(entities) {
  entities.forEach((e) => editor.addSpec(e.t, e.x, e.y, e));
  for (const e of entities) {
    for (const [a, b] of e.ropes ?? []) editor.ropeList.push({ a, b });
  }
}

// ---- 运行控制 ----
function startRun(useRecordedCommands = false) {
  // 重跑/重放：完整复用上一次（或分享码）的输入，保证同一灾难；新跑：从编辑器取当前布置
  const prev = useRecordedCommands && state.runExperiment ? state.runExperiment : null;
  const entities = prev ? prev.entities : editor.buildEntities(true);
  const commands = prev ? prev.commands : [];
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
  state.zoomPunch = 1;
  state.mode = 'running';
  editor.locked = true;
  hideReport();
  editor.onStatus('实验进行中：点未点燃的爆炸物随时点火；空白处拖拽可扔进点燃的炮仗！');
  els.ignite.disabled = true;
  els.end.hidden = false;
}

function finishRun() {
  state.mode = 'report';
  editor.locked = false;
  state.report = buildReport(state.sim, getScenario(state.scenarioId));
  // 本机最佳：分享来的自定义实验记入 custom 键
  const key = state.runExperiment?.custom ? 'custom' : state.scenarioId;
  const { best, isNew } = records.update(key, state.report.counts);
  state.report.best = best;
  state.report.isNewRecord = isNew;
  showReport(state.report);
  els.ignite.disabled = false;
  els.end.hidden = true;
}

function backToEdit() {
  state.mode = 'edit';
  editor.locked = false;
  state.sim = null;
  state.report = null;
  hideReport();
  els.ignite.disabled = false;
  editor.onStatus('回到编辑：调整布置后再次点燃');
}

function toggleIgnite() {
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
  toast('新种子 #' + state.seed.toString(36).toUpperCase() + '（虫子行为将不同）');
  if (state.mode !== 'edit') backToEdit();
});
els.share.addEventListener('click', () => {
  if (!state.runExperiment || !state.sim) return toast('先跑一次实验再分享');
  const exp = {
    ...state.runExperiment,
    commands: state.sim.commandLog.map((c) => ({ tick: c.tick, id: c.id, op: 'ignite' })),
  };
  const url = location.origin + location.pathname + toHash(exp);
  navigator.clipboard?.writeText(url).then(
    () => toast('分享链接已复制 ✓ 对方打开就是同一个实验'),
    () => toast('复制失败，请手动复制地址栏链接')
  );
});
els.replayShare?.addEventListener('click', () => startRun(true)); // 分享码重放 = 带命令重跑模拟

// 报告浮层按钮
document.getElementById('btn-overlay-replay')?.addEventListener('click', () => startReplay());
document.getElementById('btn-overlay-rerun')?.addEventListener('click', () => {
  if (state.runExperiment) startRun(true);
});
document.getElementById('btn-overlay-edit')?.addEventListener('click', backToEdit);

// ---- 运行中输入：点未点燃爆炸物=点燃；空白处拖拽=扔进点燃的炮仗 ----
let runDrag = null; // {wx, wy, vx, vy} 世界坐标起投点与当前投掷速度

function canvasWorld(ev) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - rect.left) / rect.width) * VIEW_W,
    y: ((ev.clientY - rect.top) / rect.height) * VIEW_H,
  };
}

canvas.addEventListener('pointerdown', (ev) => {
  if (state.mode !== 'running' || !state.sim || ev.button !== 0) return;
  const { x, y } = canvasWorld(ev);
  for (const b of state.sim.world.bodies) {
    if (b.alive && b.kind === 'explosive' && !b.data.lit && Math.hypot(b.x - x, b.y - y) < 6) {
      state.sim.playerIgnite(b.id);
      state.particles.spark(b.x, b.y, 4);
      editor.onStatus('点燃！');
      return;
    }
  }
  runDrag = { wx: x, wy: y, vx: 0, vy: 0 };
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
    state.sim.playerThrow(d.wx, d.wy, d.vx, d.vy);
    sfx.whoosh();
    editor.onStatus('扔进去一根点着的炮仗 💣');
  }
});

// ---- 报告 ----
function showReport(rep) {
  const c = rep.counts;
  const sc = rep.goal;
  els.reportTitle.innerHTML = `THE INCIDENT · ${rep.id}<div style="font-size:13px;color:var(--dim);font-family:system-ui;margin-top:2px">《${rep.title}》</div>`;
  const rows = [
    ['爆炸次数', c.explosions],
    ['最大连锁', '×' + c.chainMax],
    ['击倒玩具', c.knockouts + (c.koByType.roach ? `（蟑螂×${c.koByType.roach}）` : '')],
    ['意外事件', c.unexpected],
    ['绳子断裂', c.ropesBroken],
    ['大头针命中', c.pins],
    ['胶水粘附', c.glues],
    ['一爆多杀', c.multiKills],
    ['装甲裂纹', c.cracks],
    ['实验时长', rep.duration.toFixed(1) + 's'],
  ];
  let html = rows.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
  if (rep.best) {
    html += `<div class="goal" style="color:#9fd0ff;border-color:rgba(126,200,255,0.3);background:rgba(126,200,255,0.07)">本机最佳 · 连锁×${rep.best.chain} · 击倒 ${rep.best.knockouts}${rep.isNewRecord ? ' 🎉 新纪录！' : ''}</div>`;
  }
  if (sc) {
    html += `<div class="goal ${sc.done ? 'done' : ''}">目标「${sc.label}」：${sc.done ? '达成 ✓' : '未达成'}`;
    if (sc.bonus) html += ` · ${sc.bonus}`;
    html += '</div>';
  }
  if (rep.timeline.length) {
    html +=
      '<div class="timeline">' +
      rep.timeline
        .map((t) => `<span>${t.t.toFixed(2)}s · ${causeName(t.cause)}${t.depth ? ` · 连锁${t.depth}` : ''}</span>`)
        .join('') +
      '</div>';
  }
  els.reportBody.innerHTML = html;
  els.report.hidden = false;
  // 报告卡内加一个分享入口（生成刚才这场事故的分享码）
  const shareInReport = document.getElementById('btn-overlay-share');
  if (shareInReport && !shareInReport._wired) {
    shareInReport._wired = true;
    shareInReport.addEventListener('click', () => els.share.click());
  }
}

function causeName(c) {
  return { fuse: '引信', impact: '撞击', burnout: '燃尽' }[c] ?? c;
}

function hideReport() {
  els.report.hidden = true;
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

// ---- 回放 ----
function startReplay() {
  if (!state.recorder?.frames.length) return;
  state.mode = 'replay';
  state.replay = {
    idx: 0,
    cursor: state.recorder.frames[0].tick,
    flashes: state.sim.eventLog.filter((e) => e.type === 'explosion'),
    flashSeen: 0,
    lastFlashTick: -1,
  };
  hideReport();
}

function stepReplay(dt) {
  const rp = state.replay;
  const frames = state.recorder.frames;
  rp.cursor += dt * 60 * 0.5; // 0.5 倍速
  // 到达的爆炸事件 → 粒子
  while (rp.flashSeen < rp.flashes.length && rp.flashes[rp.flashSeen].tick <= rp.cursor) {
    const e = rp.flashes[rp.flashSeen++];
    state.particles.explosion(e.x, e.y, e.power);
  }
  if (rp.cursor >= frames[frames.length - 1].tick + 30) {
    state.mode = 'report';
    showReport(state.report);
    return;
  }
  rp.interp = frames;
}

// 快照插值
function viewAtCursor() {
  const frames = state.recorder.frames;
  const t = state.replay.cursor;
  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].tick <= t) i++;
  const f0 = frames[i];
  const f1 = frames[Math.min(i + 1, frames.length - 1)];
  const k = f1.tick > f0.tick ? Math.min(1, (t - f0.tick) / (f1.tick - f0.tick)) : 0;
  const map1 = new Map(f1.bodies.map((b) => [b[0], b]));
  const items = [];
  for (const b of f0.bodies) {
    const b1 = map1.get(b[0]) ?? b;
    if (b[5] === 1) continue; // 已消耗
    items.push({
      t: b[6],
      kind: b[1],
      x: b[2] + (b1[2] - b[2]) * k,
      y: b[3] + (b1[3] - b[3]) * k,
      angle: b[4] + (b1[4] - b[4]) * k,
      aim: null,
      lit: false,
      burning: false,
      acc: [],
      knocked: b[5] === 2,
      frozen: b[5] === 3,
    });
  }
  // 绳子：用 f0 帧端点近似画（断裂的不画）
  const ropeViews = [];
  for (const r of state.sim.world.ropes) {
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

function tick() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // 连锁慢镜头：真实时间变慢，模拟 tick 内容不变（不破坏确定性）
  if (state.slowmo > 0) {
    state.slowmo = Math.max(0, state.slowmo - dt);
    state.zoomPunch += (1 - state.zoomPunch) * Math.min(1, dt * 3);
  } else {
    state.zoomPunch += (1 - state.zoomPunch) * Math.min(1, dt * 6);
  }
  const scale = state.slowmo > 0 ? 0.35 : 1;
  acc += dt * scale;

  if (state.mode === 'running') {
    let steps = 0;
    while (acc >= DT && steps < 4) {
      acc -= DT;
      steps++;
      stepOnce();
    }
    const quiet = state.sim.tick - state.lastEventTick > 180;
    if (quiet) finishRun();
  } else {
    acc = 0;
    state.particles.update(dt);
    if (state.mode === 'replay') stepReplay(dt);
  }

  render();
}

function stepOnce() {
  state.sim.step();
  state.recorder.record(state.sim);
  handleEvents(state.sim.eventsThisStep);
  state.particles.update(DT);
}

function frame(now) {
  tick();
  requestAnimationFrame(frame);
}
setInterval(tick, 250); // 后台兜底驱动

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'explosion') {
      state.particles.explosion(e.x, e.y, e.power);
      sfx.explosion(e.power);
      // 镜头推近一点，随时间回弹
      state.zoomPunch = Math.min(1.08, state.zoomPunch + e.power / 2600);
      // 连锁 ≥2 或一爆多杀 → 慢镜头欣赏失控瞬间
      if (e.depth >= 2) state.slowmo = Math.max(state.slowmo, 0.7);
    } else if (e.type === 'knockout') {
      state.particles.spark(e.x, e.y, 8);
      sfx.knockout();
    } else if (e.type === 'multiKill') {
      state.slowmo = Math.max(state.slowmo, 0.9);
    } else if (e.type === 'pinStick' || e.type === 'glueStick') {
      state.particles.puff(e.x, e.y);
      sfx.stick();
    } else if (e.type === 'ropeBreak') {
      state.particles.spark(e.x, e.y, 4);
      sfx.ropeBreak();
    } else if (e.type === 'ignite') {
      state.particles.spark(e.x, e.y, 2);
      sfx.fuse();
    } else if (e.type === 'slimeBurn') {
      state.particles.puff(e.x, e.y);
    } else if (e.type === 'propBreak') {
      state.particles.spark(e.x, e.y, 10);
      sfx.glassBreak();
    }
    if (['explosion', 'knockout', 'ropeBreak', 'multiKill', 'armorCrack', 'pinStick', 'glueStick'].includes(e.type)) {
      state.lastEventTick = e.tick;
    }
  }
}

function render() {
  const shake = state.particles.shake;
  const shakeX = (Math.random() - 0.5) * shake;
  const shakeY = (Math.random() - 0.5) * shake;
  let view;
  let opts = {
    particles: state.particles,
    shakeX,
    shakeY,
    time: performance.now() / 1000,
    zoom: state.zoomPunch,
  };

  if (state.mode === 'edit') {
    view = viewFromSpecs(editor.specs, editor.ropeList);
    opts.showAim = true;
    opts.ghost = editor.ghost;
  } else if (state.mode === 'running' || (state.mode === 'report' && state.sim)) {
    view = viewFromSim(state.sim);
    opts.recDot = state.mode === 'running';
    if (state.mode === 'running') {
      opts.showAim = true;
      if (runDrag) opts.throwPreview = { ...runDrag };
    }
  } else if (state.mode === 'replay') {
    view = viewAtCursor();
    const frames = state.recorder.frames;
    const t0 = frames[0].tick;
    const t1 = frames[frames.length - 1].tick;
    opts.replayWatermark = true;
    opts.replayProgress = (state.replay.cursor - t0) / Math.max(1, t1 - t0);
  }
  drawScene(ctx, W, H, view, opts);

  // 实况统计 HUD
  if ((state.mode === 'running' || state.mode === 'report') && state.sim) {
    const st = state.sim.stats;
    ctx.fillStyle = 'rgba(10,12,16,0.55)';
    ctx.fillRect(12, 12, 236, 30);
    ctx.fillStyle = '#ffd166';
    ctx.font = 'bold 15px ui-monospace, monospace';
    ctx.fillText(`💥${st.explosions}  连锁×${st.chainMax}  击倒${st.knockouts}`, 22, 33);
  }
}

// ---- 启动 ----
const fromHash = experimentFromHash(location.hash);
if (fromHash) {
  state.seed = fromHash.seed;
  editor.clear();
  loadEntitiesIntoEditor(fromHash.entities);
  state.runExperiment = { ...fromHash, custom: true };
  els.scenario.value = 'free';
  editor.onStatus('已加载分享的实验 —— 点「重放这场事故」或自行修改后点燃');
} else {
  loadScenario('case1'); // 默认进案例1，开门见山
}

els.replayShare.hidden = !fromHash;
// 调试句柄：自动化试玩与问题排查用
window.__lab = {
  editor,
  state,
  get sim() {
    return state.sim;
  },
  specs: () => editor.specs.map((s) => ({ ...s })),
  events: () => (state.sim ? state.sim.eventLog.map((e) => ({ ...e })) : []),
  // 测试钩子：绕过实时时序，同步推进 N 秒的模拟（走完整管线：录制/特效/报告触发）
  fastForward(seconds) {
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

// ---- 键盘快捷键：空格=点燃/再来一次，R=再来一次，N=新实验，Esc=结束/继续改造 ----
window.addEventListener('keydown', (ev) => {
  const tag = ev.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (ev.code === 'Space') {
    ev.preventDefault();
    if (state.mode === 'edit') startRun(false);
    else if (state.mode === 'report') startRun(true);
  } else if (ev.key === 'r' || ev.key === 'R') {
    if (state.runExperiment && state.mode !== 'running') startRun(true);
  } else if (ev.key === 'n' || ev.key === 'N') {
    state.seed = (Math.random() * 0x7fffffff) | 0;
    state.runExperiment = null;
    toast('新种子 #' + state.seed.toString(36).toUpperCase());
    if (state.mode !== 'edit') backToEdit();
  } else if (ev.key === 'Escape') {
    if (state.mode === 'running') finishRun();
    else if (state.mode === 'report') backToEdit();
  }
});

requestAnimationFrame(frame);
