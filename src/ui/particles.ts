// 粒子与震屏：纯表现层，允许用 Math.random（不参与模拟确定性）。

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
}
interface FlashParticle extends ParticleBase {
  type: 'flash';
  r: number;
}
interface RingParticle extends ParticleBase {
  type: 'ring';
  r: number;
  vr: number;
}
type Particle = SparkParticle | SmokeParticle | FlashParticle | RingParticle;

export class Particles {
  list: Particle[] = [];
  shake = 0;

  add(p: Particle): void {
    if (this.list.length > 500) this.list.splice(0, this.list.length - 500);
    this.list.push(p);
  }

  explosion(x: number, y: number, power: number): void {
    const r = 6 + power * 0.18;
    this.add({ type: 'flash', x, y, r: r * 0.8, life: 0.12, age: 0 });
    this.add({ type: 'ring', x, y, r: r * 0.4, vr: r * 7, life: 0.45, age: 0 });
    const n = Math.min(26, (10 + power * 0.25) | 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 220;
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
    for (let i = 0; i < 6; i++) {
      this.add({
        type: 'smoke',
        x: x + (Math.random() - 0.5) * r,
        y: y + (Math.random() - 0.5) * r,
        vx: (Math.random() - 0.5) * 30,
        vy: -20 - Math.random() * 30,
        r: 3 + Math.random() * 5,
        life: 0.9 + Math.random() * 0.6,
        age: 0,
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
      });
    }
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
      }
    }
    this.list = this.list.filter((p) => p.age < p.life);
  }

  draw(ctx: CanvasRenderingContext2D, s: number): void {
    for (const p of this.list) {
      const k = 1 - p.age / p.life;
      ctx.save();
      if (p.type === 'flash') {
        ctx.globalAlpha = k * 0.9;
        const g = ctx.createRadialGradient(p.x * s, p.y * s, 0, p.x * s, p.y * s, p.r * s);
        g.addColorStop(0, '#fff8e0');
        g.addColorStop(0.4, '#ffb347');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x * s, p.y * s, p.r * s, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'ring') {
        ctx.globalAlpha = k * 0.7;
        ctx.strokeStyle = '#ffd9a0';
        ctx.lineWidth = 2 * s * k;
        ctx.beginPath();
        ctx.arc(p.x * s, p.y * s, p.r * s, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'spark') {
        ctx.globalAlpha = k;
        ctx.strokeStyle = Math.random() < 0.5 ? '#ffb347' : '#ff7840';
        ctx.lineWidth = 1.4 * s;
        ctx.beginPath();
        ctx.moveTo(p.x * s, p.y * s);
        ctx.lineTo((p.x - p.vx * 0.03) * s, (p.y - p.vy * 0.03) * s);
        ctx.stroke();
      } else if (p.type === 'smoke') {
        ctx.globalAlpha = k * 0.25;
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(p.x * s, p.y * s, p.r * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
