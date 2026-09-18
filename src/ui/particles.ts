// 粒子与震屏：纯表现层，允许用 Math.random（不参与模拟确定性）。
// R89：加法混合辉光（lighter）+ 预渲染辉光精灵（有 DOM 时）+ 余烬/碎片新粒子。

interface ParticleBase {
  x: number;
  y: number;
  life: number;
  age: number;
}
interface SparkParticle extends ParticleBase {
  type: 'spark';
  vx: number;
  vy: number;
}
interface SmokeParticle extends ParticleBase {
  type: 'smoke';
  vx: number;
  vy: number;
  r: number;
  warm: number; // 0=冷灰 1=火场暖灰
}
interface FlashParticle extends ParticleBase {
  type: 'flash';
  r: number;
}
interface RingParticle extends ParticleBase {
  type: 'ring';
  r: number;
  vr: number;
  blue?: boolean; // 时间涟漪（慢镜头触发）
}
interface EmberParticle extends ParticleBase {
  type: 'ember';
  vx: number;
  vy: number;
  r: number;
  seed: number;
}
interface DebrisParticle extends ParticleBase {
  type: 'debris';
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vrot: number;
  hue: number; // 0=纸屑暖白 1=玻璃青
}
interface DustParticle extends ParticleBase {
  type: 'dust';
  vx: number;
  vy: number;
  r: number;
}
interface ConfettiParticle extends ParticleBase {
  type: 'confetti';
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vrot: number;
  color: string;
  sway: number;
}
interface DropParticle extends ParticleBase {
  type: 'drop';
  vx: number;
  vy: number;
  r: number;
}
interface BitParticle extends ParticleBase {
  type: 'bit';
  vx: number;
  vy: number;
  len: number;
  rot: number;
  vrot: number;
  color: string;
}
interface MoteParticle extends ParticleBase {
  type: 'mote';
  vx: number;
  vy: number;
  r: number;
  seed: number;
}
type Particle =
  | SparkParticle
  | SmokeParticle
  | FlashParticle
  | RingParticle
  | EmberParticle
  | DebrisParticle
  | DustParticle
  | ConfettiParticle
  | DropParticle
  | BitParticle
  | MoteParticle;

// ---- 辉光精灵：有 DOM 时预渲染径向渐变小图（避免每帧建渐变/shadowBlur）----
const glowCache = new Map<string, CanvasGradient | HTMLCanvasElement>();

function glowSprite(ctx: CanvasRenderingContext2D, color: string, r: number): CanvasGradient | HTMLCanvasElement {
  const key = color;
  const hit = glowCache.get(key);
  if (hit) return hit;
  let made: CanvasGradient | HTMLCanvasElement;
  if (typeof document !== 'undefined') {
    const size = 64;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const c = cv.getContext('2d');
    if (c) {
      const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, color);
      g.addColorStop(0.35, color.replace(')', ',0.35)').replace('rgb', 'rgba'));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, size, size);
      made = cv;
    } else {
      made = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    }
  } else {
    // Node 测试环境：直接给渐变（假 ctx 会处理）
    made = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  }
  glowCache.set(key, made);
  return made;
}

function drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(x, y);
  ctx.fillStyle = glowSprite(ctx, color, r) as unknown as CanvasPattern;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export class Particles {
  list: Particle[] = [];
  shake = 0;

  add(p: Particle): void {
    if (this.list.length > 600) this.list.splice(0, this.list.length - 600);
    this.list.push(p);
  }

  explosion(x: number, y: number, power: number): void {
    const r = 6 + power * 0.18;
    this.add({ type: 'flash', x, y, r: r * 0.8, life: 0.14, age: 0 });
    this.add({ type: 'ring', x, y, r: r * 0.4, vr: r * 7, life: 0.45, age: 0 });
    const n = Math.min(30, (10 + power * 0.28) | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 240;
      this.add({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.35 + Math.random() * 0.4,
        age: 0,
      });
    }
    // 余烬：慢速上飘、闪烁
    for (let i = 0; i < 5; i++) {
      this.add({
        type: 'ember',
        x: x + (Math.random() - 0.5) * r,
        y: y + (Math.random() - 0.5) * r * 0.6,
        vx: (Math.random() - 0.5) * 26,
        vy: -24 - Math.random() * 40,
        r: 0.8 + Math.random() * 1.2,
        life: 0.7 + Math.random() * 0.7,
        age: 0,
        seed: Math.random() * 10,
      });
    }
    // 碎片：炮仗纸屑/碎壳
    const nd = Math.min(10, (4 + power * 0.06) | 0);
    for (let i = 0; i < nd; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 200;
      this.add({
        type: 'debris',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 120,
        r: 0.9 + Math.random() * 1.4,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 18,
        life: 0.5 + Math.random() * 0.5,
        age: 0,
        hue: Math.random(),
      });
    }
    for (let i = 0; i < 7; i++) {
      this.add({
        type: 'smoke',
        x: x + (Math.random() - 0.5) * r,
        y: y + (Math.random() - 0.5) * r,
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 30,
        r: 3 + Math.random() * 5,
        life: 0.9 + Math.random() * 0.6,
        age: 0,
        warm: 0.7,
      });
    }
    this.shake = Math.min(14, this.shake + 3 + power * 0.09);
  }

  spark(x: number, y: number, n = 6): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 90;
      this.add({
        type: 'spark',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 0.3 + Math.random() * 0.25,
        age: 0,
      });
    }
  }

  puff(x: number, y: number): void {
    for (let i = 0; i < 4; i++) {
      this.add({
        type: 'smoke',
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 20,
        vy: -10 - Math.random() * 15,
        r: 2 + Math.random() * 3,
        life: 0.5 + Math.random() * 0.3,
        age: 0,
        warm: 0,
      });
    }
  }

  // 火箭尾迹烟：飞行中的冲天炮/窜天猴尾部冒烟（每两 tick 调一次）
  rocketTrail(x: number, y: number): void {
    this.add({
      type: 'smoke',
      x: x + (Math.random() - 0.5) * 2,
      y: y + (Math.random() - 0.5) * 2,
      vx: (Math.random() - 0.5) * 8,
      vy: 6 + Math.random() * 10,
      r: 1.2 + Math.random() * 1.4,
      life: 0.45 + Math.random() * 0.35,
      age: 0,
      warm: 0.35,
    });
  }

  // 地面扬尘：贴地横铺的尘浪（大爆炸贴地时调用，floorY 为地面世界坐标）
  dust(x: number, floorY: number): void {
    for (let i = 0; i < 8; i++) {
      const dir = i < 4 ? -1 : 1;
      this.add({
        type: 'dust',
        x: x + dir * Math.random() * 4,
        y: floorY - Math.random() * 2,
        vx: dir * (30 + Math.random() * 70),
        vy: -8 - Math.random() * 22,
        r: 2 + Math.random() * 4,
        life: 0.5 + Math.random() * 0.4,
        age: 0,
      });
    }
  }

  // 新纪录彩带：从顶部落下的旋转纸屑（报告弹出时调用）
  confetti(W: number): void {
    const colors = ['#ffd166', '#ff7840', '#7ec8ff', '#9fe6a0', '#f472a0'];
    for (let i = 0; i < 44; i++) {
      this.add({
        type: 'confetti',
        x: Math.random() * W,
        y: -8 - Math.random() * 60,
        vx: (Math.random() - 0.5) * 26,
        vy: 60 + Math.random() * 90,
        r: 1.2 + Math.random() * 1.6,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 14,
        color: colors[i % colors.length],
        sway: Math.random() * 9,
        life: 2.2 + Math.random() * 1.2,
        age: 0,
      });
    }
  }

  // 环境微尘：台灯光束里缓慢漂浮的微粒（每帧小概率补充，cap 内自灭）
  mote(W: number, H: number): void {
    if (this.list.length > 560) return;
    this.add({
      type: 'mote',
      x: Math.random() * W,
      y: Math.random() * H * 0.75,
      vx: (Math.random() - 0.5) * 5,
      vy: -2 - Math.random() * 4,
      r: 0.35 + Math.random() * 0.55,
      seed: Math.random() * 10,
      life: 3 + Math.random() * 3,
      age: 0,
    });
  }

  // 冰霜滑痕：冰面高速滑行时脚下溅起的冷色微粒
  frost(x: number, y: number): void {
    for (let i = 0; i < 2; i++) {
      this.add({
        type: 'drop',
        x: x + (Math.random() - 0.5) * 3,
        y,
        vx: (Math.random() - 0.5) * 40,
        vy: -14 - Math.random() * 22,
        r: 0.45 + Math.random() * 0.5,
        life: 0.25 + Math.random() * 0.15,
        age: 0,
      });
    }
  }

  // 水花：浇灭/落水时的蓝白水滴上溅（douse 事件调用）
  splash(x: number, y: number): void {
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const sp = 60 + Math.random() * 140;
      this.add({
        type: 'drop',
        x: x + (Math.random() - 0.5) * 5,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: 0.6 + Math.random() * 1,
        life: 0.4 + Math.random() * 0.3,
        age: 0,
      });
    }
  }

  // 气球爆：红色橡胶碎片四散
  rubberPop(x: number, y: number): void {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 150;
      this.add({
        type: 'bit',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        len: 1.2 + Math.random() * 1.4,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 20,
        color: i % 3 === 0 ? '#ff9a8a' : '#d85046',
        life: 0.5 + Math.random() * 0.3,
        age: 0,
      });
    }
  }

  // 绳子断裂：两截绳段翻着飞出去
  ropeBits(x: number, y: number): void {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 110;
      this.add({
        type: 'bit',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        len: 1.6 + Math.random() * 2,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 16,
        color: '#c9a86a',
        life: 0.6 + Math.random() * 0.3,
        age: 0,
      });
    }
  }

  // 时间涟漪：慢镜头聚光灯触发时从爆点扩散的蓝环
  timeRing(x: number, y: number): void {
    this.add({ type: 'ring', x, y, r: 4, vr: 55, life: 0.9, age: 0, blue: true });
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 26);
    for (const p of this.list) {
      p.age += dt;
      if (p.type === 'spark') {
        p.vy += 700 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.type === 'smoke') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += 6 * dt;
      } else if (p.type === 'ring') {
        p.r += p.vr * dt;
      } else if (p.type === 'ember') {
        p.vy -= 26 * dt; // 热浮力
        p.x += p.vx * dt + Math.sin(p.age * 9 + p.seed) * 14 * dt;
        p.y += p.vy * dt;
      } else if (p.type === 'debris') {
        p.vy += 620 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
      } else if (p.type === 'dust') {
        p.vy += 60 * dt;
        p.vx *= 1 - 1.6 * dt; // 地面摩擦
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += 9 * dt;
      } else if (p.type === 'confetti') {
        p.vy = Math.min(p.vy, 150);
        p.x += (p.vx + Math.sin(p.age * 5 + p.sway) * 34) * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
      } else if (p.type === 'drop') {
        p.vy += 760 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.type === 'bit') {
        p.vy += 620 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
      } else if (p.type === 'mote') {
        p.x += (p.vx + Math.sin(p.age * 1.7 + p.seed) * 3) * dt;
        p.y += p.vy * dt;
      }
    }
    this.list = this.list.filter((p) => p.age < p.life);
  }

  draw(ctx: CanvasRenderingContext2D, s: number): void {
    for (const p of this.list) {
      const k = 1 - p.age / p.life;
      ctx.save();
      if (p.type === 'flash') {
        // 三层加法闪光：白核 → 橙圈 → 大范围辉光
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(p.x * s, p.y * s, 0, p.x * s, p.y * s, p.r * s);
        g.addColorStop(0, `rgba(255,252,238,${0.95 * k})`);
        g.addColorStop(0.3, `rgba(255,190,90,${0.75 * k})`);
        g.addColorStop(0.7, `rgba(255,110,40,${0.32 * k})`);
        g.addColorStop(1, 'rgba(255,80,30,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x * s, p.y * s, p.r * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,244,${0.9 * k})`;
        ctx.beginPath();
        ctx.arc(p.x * s, p.y * s, p.r * 0.34 * s * k, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'ring') {
        // 双描边冲击环：外柔内锐（蓝=时间涟漪，金=爆炸冲击波），随生命衰减
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.strokeStyle = p.blue ? 'rgba(126,200,255,0.3)' : 'rgba(255,200,130,0.3)';
        ctx.lineWidth = 4.5 * s * k;
        ctx.beginPath();
        ctx.arc(p.x * s, p.y * s, p.r * s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = p.blue ? 'rgba(190,230,255,0.9)' : 'rgba(255,235,190,0.85)';
        ctx.lineWidth = 1.2 * s * k;
        ctx.stroke();
      } else if (p.type === 'spark') {
        // 火花：渐冷色拖尾 + 头部辉光
        const heat = k * k;
        const col = heat > 0.6 ? '#fff3c4' : heat > 0.3 ? '#ffb347' : '#ff7840';
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = col;
        ctx.globalAlpha = k;
        ctx.lineWidth = 1.4 * s;
        ctx.beginPath();
        ctx.moveTo(p.x * s, p.y * s);
        ctx.lineTo((p.x - p.vx * 0.03) * s, (p.y - p.vy * 0.03) * s);
        ctx.stroke();
        drawGlow(ctx, p.x * s, p.y * s, 2.6 * s, 'rgb(255,180,80)', k * 0.85);
      } else if (p.type === 'ember') {
        const flicker = 0.55 + 0.45 * Math.sin(p.age * 22 + p.seed * 7);
        drawGlow(ctx, p.x * s, p.y * s, 1.9 * s * p.r, 'rgb(255,140,60)', k * 0.75 * flicker);
        ctx.globalAlpha = k * flicker;
        ctx.fillStyle = '#ffd9a0';
        ctx.beginPath();
        ctx.arc(p.x * s, p.y * s, 0.5 * p.r * s, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'debris') {
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.translate(p.x * s, p.y * s);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.hue < 0.55 ? '#e8c15a' : p.hue < 0.8 ? '#c0392b' : 'rgba(170,215,245,0.9)';
        ctx.fillRect(-p.r * s, -p.r * 0.45 * s, p.r * 2 * s, p.r * 0.9 * s);
      } else if (p.type === 'dust') {
        ctx.globalAlpha = k * 0.16;
        ctx.fillStyle = '#8a8378';
        ctx.beginPath();
        ctx.ellipse(p.x * s, p.y * s, p.r * s, p.r * 0.5 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'confetti') {
        ctx.globalAlpha = Math.min(1, k * 2.2);
        ctx.translate(p.x * s, p.y * s);
        ctx.rotate(p.rot);
        ctx.scale(1, 0.4 + 0.6 * Math.abs(Math.sin(p.age * 7 + p.sway))); // 翻面闪动
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.r * s, -p.r * 0.55 * s, p.r * 2 * s, p.r * 1.1 * s);
      } else if (p.type === 'drop') {
        ctx.globalAlpha = k;
        ctx.fillStyle = '#bfe3ff';
        ctx.beginPath();
        ctx.ellipse(p.x * s, p.y * s, p.r * 0.55 * s, p.r * s, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'bit') {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.translate(p.x * s, p.y * s);
        ctx.rotate(p.rot);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 0.6 * s;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-p.len * s, 0);
        ctx.quadraticCurveTo(0, p.len * 0.35 * s, p.len * s, 0);
        ctx.stroke();
      } else if (p.type === 'mote') {
        // 微尘：极淡的暖白光点（加法混合，闪烁）
        const tw = 0.5 + 0.5 * Math.sin(p.age * 2.4 + p.seed * 5);
        drawGlow(ctx, p.x * s, p.y * s, 1.4 * s * p.r + 0.5 * s, 'rgb(255,238,210)', 0.1 + tw * 0.14);
      } else if (p.type === 'smoke') {
        // 径向渐变烟团：中心浓、边缘散（比实心圆柔和）
        ctx.globalAlpha = k * (0.3 + p.warm * 0.14);
        const sg = ctx.createRadialGradient(p.x * s, p.y * s, 0, p.x * s, p.y * s, p.r * s);
        const tone = p.warm > 0.4 ? '107, 91, 78' : '102, 102, 102';
        sg.addColorStop(0, `rgba(${tone}, 0.85)`);
        sg.addColorStop(0.7, `rgba(${tone}, 0.4)`);
        sg.addColorStop(1, `rgba(${tone}, 0)`);
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(p.x * s, p.y * s, p.r * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
