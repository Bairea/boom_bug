// Canvas 渲染：玩具实验室风格（PRD §19 极简美术 + "实验录像"感）。
// 不持有状态：每帧从视图模型重画。视图模型来自 specs(编辑) 或 sim(运行)。

import { BUGS, EXPLOSIVES, PROP, BUG_TYPES, PROP_TYPES } from '../game/catalog.js';

export const VIEW_W = 300;
export const VIEW_H = 180;

// ---- 视图模型 ----
export function viewFromSim(sim) {
  const items = [];
  for (const b of sim.world.bodies) {
    if (!b.alive) continue;
    items.push({
      t: b.data.etype ?? b.data.bugType ?? b.data.propType,
      kind: b.kind,
      x: b.x,
      y: b.y,
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
      onFire: !!b.data.burning,
    });
  }
  const slime = sim.world.slime.map((p) => ({ ...p }));
  const ropes = sim.world.ropes
    .filter((r) => !r.broken)
    .map((r) => {
      const a = sim.world.byId(r.aId);
      const b = sim.world.byId(r.bId);
      return a && b && a.alive && b.alive ? { ax: a.x, ay: a.y, bx: b.x, by: b.y } : null;
    })
    .filter(Boolean);
  return { items, ropes, slime };
}

export function viewFromSpecs(specs, ropeList = []) {
  const items = specs.map((s) => ({
    t: s.t,
    kind: BUG_TYPES.includes(s.t) ? 'bug' : s.t === 'brick' || s.t === 'glass' || s.t === 'sponge' || s.t === 'water' ? 'prop' : 'explosive',
    x: s.x,
    y: s.y,
    radius: (BUGS[s.t] ?? PROP[s.t] ?? EXPLOSIVES[s.t] ?? {}).radius ?? 3,
    angle: s.angle ?? (s.t === 'skyrocket' ? -Math.PI / 2 : 0),
    aim: s.angle,
    lit: false,
    acc: s.acc ?? [],
    fixed: s.fixed,
    hp: (BUGS[s.t] ?? {}).hp,
    maxHp: (BUGS[s.t] ?? {}).hp,
  }));
  const ropes = ropeList
    .map(({ a, b }) => {
      const A = specs[a];
      const B = specs[b];
      return A && B ? { ax: A.x, ay: A.y, bx: B.x, by: B.y } : null;
    })
    .filter(Boolean);
  return { items, ropes };
}

// ---- 主绘制 ----
export function drawScene(ctx, W, H, view, opts = {}) {
  const s = W / VIEW_W; // 世界→屏幕缩放
  const time = opts.time ?? 0;
  ctx.clearRect(0, 0, W, H);

  // 背景：实验桌
  ctx.fillStyle = '#20242c';
  ctx.fillRect(0, 0, W, H);
  drawGrid(ctx, W, H, s);

  // 盒子
  const ox = (W - VIEW_W * s) / 2;
  const oy = (H - VIEW_H * s) / 2;
  const zoom = opts.zoom ?? 1;
  const cx = (VIEW_W * s) / 2;
  const cy = (VIEW_H * s) / 2;
  ctx.save();
  ctx.translate(ox + (opts.shakeX ?? 0), oy + (opts.shakeY ?? 0));
  if (zoom !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);
  }

  ctx.fillStyle = 'rgba(140,180,220,0.07)';
  ctx.fillRect(0, 0, VIEW_W * s, VIEW_H * s);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, (VIEW_H - 3) * s, VIEW_W * s, 3 * s); // 底部玻璃厚度感

  // 蜗牛黏液（画在物体脚下）
  for (const p of view.slime ?? []) drawSlime(ctx, p, s);

  // 爆炸焦痕（战损记忆，纯表现层）
  for (const sc of opts.scorches ?? []) {
    const fade = Math.max(0, 1 - sc.age / sc.ttl);
    ctx.fillStyle = `rgba(12, 10, 8, ${0.5 * fade})`;
    ctx.beginPath();
    ctx.ellipse(sc.x * s, sc.y * s, sc.r * s, sc.r * 0.36 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 绳子
  for (const r of view.ropes) drawRope(ctx, r, s);

  // 物体（阴影 → 本体）
  for (const it of view.items) drawShadow(ctx, it, s);
  for (const it of view.items) drawItem(ctx, it, s, time);

  // 瞄准线（编辑模式未点燃的定向爆炸物）
  if (opts.showAim) {
    for (const it of view.items) {
      if ((it.t === 'bottle' || it.t === 'skyrocket') && it.aim != null && !it.lit) {
        drawAim(ctx, it, s);
      }
    }
  }

  // 幽灵预览
  if (opts.ghost) {
    ctx.globalAlpha = 0.45;
    drawItem(ctx, opts.ghost, s, time);
    if (opts.ghost.t === 'bottle' || opts.ghost.t === 'skyrocket') drawAim(ctx, opts.ghost, s);
    ctx.globalAlpha = 1;
  }

  // 投掷预览（运行中拖拽扔炮仗）
  if (opts.throwPreview) drawThrowPreview(ctx, opts.throwPreview, s);

  // 慢镜头视觉提示：边缘泛蓝光晕
  if (opts.slowmoActive) {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H * s);
    g.addColorStop(0, 'rgba(126,200,255,0.16)');
    g.addColorStop(0.2, 'rgba(126,200,255,0)');
    g.addColorStop(0.8, 'rgba(126,200,255,0)');
    g.addColorStop(1, 'rgba(126,200,255,0.16)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W * s, VIEW_H * s);
  }

  // 盒子边框
  ctx.strokeStyle = 'rgba(190,220,255,0.75)';
  ctx.lineWidth = Math.max(2, 1.2 * s);
  ctx.strokeRect(0, 0, VIEW_W * s, VIEW_H * s);
  // 四角螺丝
  ctx.fillStyle = 'rgba(190,220,255,0.5)';
  for (const [cx, cy] of [
    [1.5, 1.5],
    [VIEW_W - 1.5, 1.5],
    [1.5, VIEW_H - 1.5],
    [VIEW_W - 1.5, VIEW_H - 1.5],
  ]) {
    ctx.beginPath();
    ctx.arc(cx * s, cy * s, 0.9 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // 粒子
  if (opts.particles) opts.particles.draw(ctx, s);

  ctx.restore();

  // HUD
  if (opts.recDot) {
    ctx.fillStyle = '#ff5555';
    ctx.beginPath();
    ctx.arc(W - 74, 26, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px ui-monospace, monospace';
    ctx.fillText('REC', W - 62, 31);
  }
  if (opts.replayWatermark) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 34px ui-monospace, monospace';
    ctx.fillText('⟲ REPLAY', 24, 52);
    if (opts.replayProgress != null) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(ox, H - 10, VIEW_W * s, 4);
      ctx.fillStyle = '#7ec8ff';
      ctx.fillRect(ox, H - 10, VIEW_W * s * opts.replayProgress, 4);
    }
  }
}

function drawGrid(ctx, W, H, s) {
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
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

function drawShadow(ctx, it, s) {
  if (it.t === 'brick') return;
  const floorY = VIEW_H * s;
  const h = Math.max(0, floorY - it.y * s);
  const w = it.kind === 'bug' ? 2.6 : 2.2;
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0.04, 0.2 - h / (140 * s))})`;
  ctx.beginPath();
  ctx.ellipse(it.x * s, floorY - 1.5 * s, w * s * (1 + h / (260 * s)), 0.7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawItem(ctx, it, s, time) {
  ctx.save();
  ctx.translate(it.x * s, it.y * s);
  if (it.t === 'roach') drawRoach(ctx, it, s, time);
  else if (it.t === 'locust') drawLocust(ctx, it, s, time);
  else if (it.t === 'scarab') drawScarab(ctx, it, s, time);
  else if (it.t === 'snail') drawSnail(ctx, it, s, time);
  else if (it.t === 'fly') drawFly(ctx, it, s, time);
  else if (it.t === 'firecracker') drawFirecracker(ctx, it, s, time);
  else if (it.t === 'skyrocket') drawSkyrocket(ctx, it, s, time);
  else if (it.t === 'bottle') drawBottle(ctx, it, s, time);
  else if (it.t === 'brick') drawBrick(ctx, it, s);
  else if (it.t === 'glass') drawGlass(ctx, it, s);
  else if (it.t === 'sponge') drawSponge(ctx, it, s);
  else if (it.t === 'water') drawWater(ctx, it, s, time);
  else if (it.t === 'giftbox') drawGiftbox(ctx, it, s);
  else if (it.t === 'wood') drawWood(ctx, it, s);
  else if (it.t === 'ice') drawIce(ctx, it, s);
  else if (it.t === 'metal') drawMetal(ctx, it, s);
  else if (it.t === 'debris') drawDebris(ctx, it, s);
  ctx.restore();
  // 受损血条
  if (it.kind === 'bug' && it.hp != null && it.hp < it.maxHp && !it.knocked) {
    const w = 8 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(it.x * s - w / 2, (it.y - 7) * s, w, 1.6 * s);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(it.x * s - w / 2, (it.y - 7) * s, (w * Math.max(0, it.hp)) / it.maxHp, 1.6 * s);
  }
}

function knockedTint(ctx, it, s, draw) {
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

function drawRoach(ctx, it, s, time) {
  const r = 2.6 * s;
  // 活着时朝向固定（顶视角靠腿动表现移动），被击倒后随物理角度翻滚
  ctx.rotate(it.knocked ? it.angle : 0);
  const wig = it.speed > 12 ? Math.sin(time * 20) * 0.35 : 0;
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
    // 身体
    ctx.fillStyle = it.knocked ? '#8c7a5f' : '#8a5a2b';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.35, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
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
  });
}

function drawLocust(ctx, it, s, time) {
  const r = 2.4 * s;
  knockedTint(ctx, it, s, () => {
    ctx.rotate(it.knocked ? it.angle : -0.35);
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

function drawScarab(ctx, it, s, time) {
  const r = 5 * s;
  knockedTint(ctx, it, s, () => {
    // 壳
    ctx.fillStyle = '#39424f';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    // 装甲高光
    ctx.fillStyle = '#4d5a6b';
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, -r * 0.25, r * 0.75, r * 0.45, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // 中缝 + 铆钉
    ctx.strokeStyle = '#232a33';
    ctx.lineWidth = 0.5 * s;
    ctx.beginPath();
    ctx.moveTo(-r * 1.05, 0);
    ctx.lineTo(r * 1.05, 0);
    ctx.stroke();
    ctx.fillStyle = '#232a33';
    for (const [rx, ry] of [
      [-0.6, -0.4],
      [0.6, -0.4],
      [-0.6, 0.4],
      [0.6, 0.4],
    ]) {
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
    }
  });
}

function drawFuse(ctx, it, s, time) {
  if (!it.lit) return;
  // 引信火花
  const fx = -3.2 * s;
  const jx = (Math.random() - 0.5) * 1.4 * s;
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.moveTo(fx, -2.4 * s);
  ctx.lineTo(fx + jx, -3.6 * s);
  ctx.stroke();
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(fx + jx, -3.8 * s, (0.7 + Math.random() * 0.5) * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawFirecracker(ctx, it, s, time) {
  ctx.rotate(it.angle ?? 0);
  ctx.fillStyle = '#c0392b';
  roundRect(ctx, -1.7 * s, -1.1 * s, 3.4 * s, 2.2 * s, 0.5 * s);
  ctx.fill();
  ctx.fillStyle = '#e8c15a';
  ctx.fillRect(-0.5 * s, -1.1 * s, 1 * s, 2.2 * s);
  ctx.strokeStyle = '#8a6d3b';
  ctx.lineWidth = 0.4 * s;
  ctx.beginPath();
  ctx.moveTo(-1.7 * s, 0);
  ctx.quadraticCurveTo(-2.6 * s, -1 * s, -3.2 * s, -2.4 * s);
  ctx.stroke();
  drawFuse(ctx, it, s, time);
}

function drawThrusterFlame(ctx, s, len) {
  const g = ctx.createLinearGradient(0, 0, 0, len * s);
  g.addColorStop(0, '#fff3c4');
  g.addColorStop(0.5, '#ffb347');
  g.addColorStop(1, 'rgba(255,90,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-0.9 * s, 0);
  ctx.quadraticCurveTo(0, len * s * (0.9 + Math.random() * 0.25), 0.9 * s, 0);
  ctx.fill();
}

function drawSkyrocket(ctx, it, s, time) {
  // 未点燃：立在地面；飞行：沿 angle 方向
  const a = it.lit ? it.angle ?? -Math.PI / 2 : -Math.PI / 2;
  ctx.rotate(a + Math.PI / 2);
  if (it.burning) drawThrusterFlame(ctx, s, 6);
  ctx.fillStyle = '#8d99a6';
  roundRect(ctx, -1 * s, -3.2 * s, 2 * s, 5 * s, 0.8 * s);
  ctx.fill();
  ctx.fillStyle = '#d64541';
  ctx.beginPath();
  ctx.moveTo(0, -4.6 * s);
  ctx.lineTo(-1 * s, -2.9 * s);
  ctx.lineTo(1 * s, -2.9 * s);
  ctx.fill();
  // 尾杆
  ctx.strokeStyle = '#a5713d';
  ctx.lineWidth = 0.5 * s;
  ctx.beginPath();
  ctx.moveTo(0, 1.8 * s);
  ctx.lineTo(0, 4.6 * s);
  ctx.stroke();
  drawFuse(ctx, it, s, time);
}

function drawBottle(ctx, it, s, time) {
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

function drawTip(ctx, it, s) {
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

function drawBrick(ctx, it, s) {
  const w = 9 * s;
  ctx.fillStyle = '#a5713d';
  roundRect(ctx, -w, -w * 0.66, w * 2, w * 1.32, 1 * s);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.4 * s;
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.lineTo(w, 0);
  ctx.moveTo(-w * 0.33, -w * 0.66);
  ctx.lineTo(-w * 0.33, 0);
  ctx.moveTo(w * 0.33, 0);
  ctx.lineTo(w * 0.33, w * 0.66);
  ctx.stroke();
}

function drawGlass(ctx, it, s) {
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

function drawWater(ctx, it, s, time) {
  const w = it.radius * s;
  const wob = Math.sin(time * 2.2) * 1.2 * s;
  ctx.fillStyle = 'rgba(70, 140, 200, 0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 2 * s, w, w * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(120, 190, 235, 0.4)';
  ctx.beginPath();
  ctx.ellipse(-w * 0.15, (2.6 + wob * 0.04) * s, w * 0.62, w * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(190, 230, 255, 0.7)';
  ctx.lineWidth = 0.45 * s;
  ctx.beginPath();
  ctx.ellipse(0, 2 * s, w, w * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
}
function drawGiftbox(ctx, it, s) {
  const w = 8 * s;
  ctx.fillStyle = it.cracked ? '#d8788a' : '#d4526e';
  roundRect(ctx, -w, -w * 0.8, w * 2, w * 1.6, 1.2 * s);
  ctx.fill();
  ctx.fillStyle = '#f5d06a';
  ctx.fillRect(-w * 0.22, -w * 0.8, w * 0.44, w * 1.6);
  ctx.fillRect(-w, -w * 0.12, w * 2, w * 0.28);
  ctx.beginPath();
  ctx.arc(-w * 0.3, -w * 0.85, w * 0.24, 0, Math.PI * 2);
  ctx.arc(w * 0.3, -w * 0.85, w * 0.24, 0, Math.PI * 2);
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


function drawWood(ctx, it, s, time) {
  const w = 10 * s;
  ctx.fillStyle = it.onFire ? '#8a5a2b' : '#9c6b3d';
  roundRect(ctx, -w, -w * 0.35, w * 2, w * 0.7, 1.5 * s);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,40,15,0.6)';
  ctx.lineWidth = 0.4 * s;
  for (const gx of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(gx * w, -w * 0.3);
    ctx.lineTo(gx * w, w * 0.3);
    ctx.stroke();
  }
  if (it.onFire) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.9);
    g.addColorStop(0, 'rgba(255,170,60,0.55)');
    g.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.9 * (0.85 + Math.sin(time * 22) * 0.15), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawIce(ctx, it, s) {
  const w = 12 * s;
  ctx.fillStyle = 'rgba(190, 230, 250, 0.5)';
  ctx.beginPath();
  ctx.ellipse(0, 1 * s, w, w * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230, 250, 255, 0.85)';
  ctx.lineWidth = 0.5 * s;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, -w * 0.05);
  ctx.lineTo(-w * 0.15, -w * 0.16);
  ctx.moveTo(w * 0.1, w * 0.12);
  ctx.lineTo(w * 0.5, w * 0.02);
  ctx.stroke();
}

function drawMetal(ctx, it, s) {
  const w = 9 * s;
  const g = ctx.createLinearGradient(0, -w * 0.5, 0, w * 0.5);
  g.addColorStop(0, '#b8c2cc');
  g.addColorStop(1, '#7d8894');
  ctx.fillStyle = g;
  roundRect(ctx, -w, -w * 0.5, w * 2, w, 1.5 * s);
  ctx.fill();
  ctx.fillStyle = '#59626c';
  for (const [px, py] of [
    [-0.75, -0.28],
    [0.75, -0.28],
    [-0.75, 0.28],
    [0.75, 0.28],
  ]) {
    ctx.beginPath();
    ctx.arc(px * w, py * w, 0.32 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSponge(ctx, it, s) {
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

function drawDebris(ctx, it, s) {
  ctx.fillStyle = 'rgba(170, 215, 245, 0.75)';
  ctx.beginPath();
  ctx.moveTo(0, -2.4 * s);
  ctx.lineTo(2 * s, 1.6 * s);
  ctx.lineTo(-1.8 * s, 1.8 * s);
  ctx.closePath();
  ctx.fill();
}

function drawSnail(ctx, it, s, time) {
  const r = 3 * s;
  const face = it.knocked ? 1 : Math.sign(it.speedX ?? 1);
  knockedTint(ctx, it, s, () => {
    // 腹足
    ctx.fillStyle = it.knocked ? '#9aa38a' : '#b7c98a';
    ctx.beginPath();
    ctx.ellipse(-face * r * 0.3, r * 0.45, r * 1.25, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // 壳（螺旋）
    ctx.fillStyle = it.knocked ? '#8d7f66' : '#c9a15f';
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
    // 眼触角
    if (!it.knocked) {
      ctx.strokeStyle = '#b7c98a';
      ctx.lineWidth = 0.3 * s;
      ctx.beginPath();
      ctx.moveTo(-face * r * 1.2, r * 0.2);
      ctx.lineTo(-face * r * 1.7, -r * 0.5);
      ctx.stroke();
      ctx.fillStyle = '#b7c98a';
      ctx.beginPath();
      ctx.arc(-face * r * 1.7, -r * 0.55, 0.22 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawFly(ctx, it, s, time) {
  const r = 2 * s;
  const dirX = it.speedX >= 0 ? 1 : -1;
  knockedTint(ctx, it, s, () => {
    // 翅膀（高频扇动）
    const flap = Math.sin(time * 60) * 0.8;
    ctx.fillStyle = 'rgba(200,220,255,0.5)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(-dirX * r * 0.3, side * r * 0.5, r * 0.9, r * (0.35 + Math.abs(flap) * 0.3), flap * side * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // 身体
    ctx.fillStyle = it.knocked ? '#7d8896' : '#4a4f58';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    // 复眼
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(dirX * r * 0.8, -r * 0.2, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSlime(ctx, p, s) {
  const fade = Math.max(0, 1 - p.age / p.ttl);
  ctx.fillStyle = `rgba(150, 220, 140, ${0.3 * fade})`;
  ctx.beginPath();
  ctx.ellipse(p.x * s, p.y * s, p.r * s, p.r * 0.42 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(190, 240, 170, ${0.22 * fade})`;
  ctx.beginPath();
  ctx.ellipse((p.x + p.r * 0.3) * s, (p.y - 1) * s, p.r * 0.55 * s, p.r * 0.26 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawRope(ctx, r, s) {
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

function drawAim(ctx, it, s) {
  const a = it.aim ?? 0;
  ctx.strokeStyle = 'rgba(126,200,255,0.8)';
  ctx.lineWidth = 0.5 * s;
  ctx.setLineDash([2 * s, 2 * s]);
  ctx.beginPath();
  ctx.moveTo(it.x * s, it.y * s);
  ctx.lineTo(it.x * s + Math.cos(a) * 16 * s, it.y * s + Math.sin(a) * 16 * s);
  ctx.stroke();
  ctx.setLineDash([]);
  // 箭头
  const ex = it.x * s + Math.cos(a) * 16 * s;
  const ey = it.y * s + Math.sin(a) * 16 * s;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(a - 0.4) * 2.4 * s, ey - Math.sin(a - 0.4) * 2.4 * s);
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(a + 0.4) * 2.4 * s, ey - Math.sin(a + 0.4) * 2.4 * s);
  ctx.stroke();
}

// 运行中拖拽投掷点燃炮仗的预览：起投点画一根点着的炮仗 + 重力弹道预测点
function drawThrowPreview(ctx, t, s) {
  const l = Math.hypot(t.vx, t.vy);
  if (l < 10) return;
  // 弹道预测：粗积分重力（与模拟同 g=560）
  let px = t.x;
  let py = t.y;
  let vx = t.vx;
  let vy = t.vy;
  const stepDt = 1 / 20;
  ctx.fillStyle = 'rgba(255,217,160,0.85)';
  for (let i = 0; i < 8; i++) {
    vy += 560 * stepDt;
    px += vx * stepDt;
    py += vy * stepDt;
    if (px < 2 || px > 298 || py < 2 || py > 178) break;
    ctx.globalAlpha = 0.8 - i * 0.09;
    ctx.beginPath();
    ctx.arc(px * s, py * s, 0.9 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 起投点：一根点着的炮仗
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.arc(t.x * s, t.y * s, 1.6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc((t.x + (t.vx / l) * 2.4) * s, (t.y + (t.vy / l) * 2.4) * s, 0.7 * s, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
