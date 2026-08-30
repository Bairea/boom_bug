// 主循环与游戏状态机：edit → running → report →(replay)→ report。

import { Simulation, DT } from '../sim/sim.js';
import { VIEW_W, VIEW_H, drawScene, viewFromSim, viewFromSpecs } from './render.js';
import { Particles } from './particles.js';
import { Editor } from './editor.js';
import { Recorder, buildReport, SNAPSHOT_INTERVAL } from '../game/replay.js';
import { SCENARIOS, getScenario } from '../game/scenario.js';
import { toHash, experimentFromHash } from '../game/encode.js';

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
};

const editor = new Editor(canvas);
editor.onStatus = (msg) => (els.status.textContent = msg);

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
  state.mode = 'running';
  hideReport();
  editor.onStatus('实验进行中……（点击未点燃的爆炸物可以随时点火）');
  els.ignite.disabled = true;
  els.end.hidden = false;
}

function finishRun() {
  state.mode = 'report';
  state.report = buildReport(state.sim, getScenario(state.scenarioId));
  showReport(state.report);
  els.ignite.disabled = false;
  els.end.hidden = true;
}

function backToEdit() {
  state.mode = 'edit';
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

// 画布点击 → 运行中点燃
canvas.addEventListener('click', (ev) => {
  if (state.mode !== 'running' || !state.sim) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * VIEW_W;
  const y = ((ev.clientY - rect.top) / rect.height) * VIEW_H;
  for (const b of state.sim.world.bodies) {
    if (b.alive && b.kind === 'explosive' && !b.data.lit) {
      if (Math.hypot(b.x - x, b.y - y) < 6) {
        state.sim.playerIgnite(b.id);
        state.particles.spark(b.x, b.y, 4);
        editor.onStatus('点燃！');
        return;
      }
    }
  }
});

// ---- 报告 ----
function showReport(rep) {
  const c = rep.counts;
  const sc = rep.goal;
  els.reportTitle.textContent = `THE INCIDENT · ${rep.id}`;
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
let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;

  if (state.mode === 'running') {
    let steps = 0;
    while (acc >= DT && steps < 4) {
      acc -= DT;
      steps++;
      state.sim.step();
      state.recorder.record(state.sim);
      handleEvents(state.sim.eventsThisStep);
      state.particles.update(DT);
    }
    const quiet = state.sim.tick - state.lastEventTick > 180;
    if (quiet) finishRun();
  } else {
    acc = 0;
    state.particles.update(dt);
    if (state.mode === 'replay') stepReplay(dt);
  }

  render();
  requestAnimationFrame(frame);
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'explosion') state.particles.explosion(e.x, e.y, e.power);
    else if (e.type === 'knockout') state.particles.spark(e.x, e.y, 8);
    else if (e.type === 'pinStick' || e.type === 'glueStick') state.particles.puff(e.x, e.y);
    else if (e.type === 'ropeBreak') state.particles.spark(e.x, e.y, 4);
    else if (e.type === 'ignite') state.particles.spark(e.x, e.y, 2);
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
  let opts = { particles: state.particles, shakeX, shakeY, time: performance.now() / 1000 };

  if (state.mode === 'edit') {
    view = viewFromSpecs(editor.specs, editor.ropeList);
    opts.showAim = true;
    opts.ghost = editor.ghost;
  } else if (state.mode === 'running' || (state.mode === 'report' && state.sim)) {
    view = viewFromSim(state.sim);
    opts.recDot = state.mode === 'running';
    if (state.mode === 'running') opts.showAim = true;
  } else if (state.mode === 'replay') {
    view = viewAtCursor();
    const frames = state.recorder.frames;
    const t0 = frames[0].tick;
    const t1 = frames[frames.length - 1].tick;
    opts.replayWatermark = true;
    opts.replayProgress = (state.replay.cursor - t0) / Math.max(1, t1 - t0);
  }
  drawScene(ctx, W, H, view, opts);
}

// ---- 启动 ----
const fromHash = experimentFromHash(location.hash);
if (fromHash) {
  state.seed = fromHash.seed;
  editor.clear();
  loadEntitiesIntoEditor(fromHash.entities);
  state.runExperiment = fromHash;
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
};
requestAnimationFrame(frame);
