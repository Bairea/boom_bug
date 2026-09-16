// WebAudio 合成音效：零素材，纯表现层。
// 音频上下文工厂可注入（Node 无头测试用假工厂）。

type CtxFactory = () => AudioContext;

export class Sfx {
  private _create: CtxFactory | null;
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  private _noise: AudioBuffer | null = null;
  private _lastAt: Record<string, number | undefined> = {}; // 按类型节流

  constructor(createCtx: CtxFactory | null = null) {
    this._create = createCtx;
  }

  ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && this._create) {
      try {
        this.ctx = this._create();
        // 主音量总线 0.5：多音叠加时防爆音
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
      }
    }
    if (!this.ctx) return null;
    if (this.ctx.state === 'suspended') this.ctx.resume?.();
    return this.ctx;
  }

  private _out(ac: AudioContext, node: AudioNode): AudioNode {
    node.connect(this.master ?? ac.destination);
    return node;
  }

  // 复用一条白噪声缓冲
  private _noiseBuffer(ac: AudioContext): AudioBuffer {
    if (!this._noise) {
      const len = Math.floor(ac.sampleRate * 0.5);
      this._noise = ac.createBuffer(1, len, ac.sampleRate);
      const data = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return this._noise;
  }

  private _throttled(name: string, minGap: number): boolean {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (this._lastAt[name] != null && now - this._lastAt[name]! < minGap) return true;
    this._lastAt[name] = now;
    return false;
  }

  // 爆炸：白噪声爆发（低通扫频）+ 低频"咚"
  explosion(power = 55): void {
    const ac = this.ensure();
    if (!ac || this._throttled('exp', 0.04)) return;
    const t0 = ac.currentTime;
    const vol = Math.min(0.55, 0.25 + power / 260);

    const src = ac.createBufferSource();
    src.buffer = this._noiseBuffer(ac);
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, t0);
    filter.frequency.exponentialRampToValueAtTime(90, t0 + 0.4);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
    src
      .connect(filter)
      .connect(gain)
      .connect(this.master ?? ac.destination);
    src.start(t0);
    src.stop(t0 + 0.5);

    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t0);
    osc.frequency.exponentialRampToValueAtTime(36, t0 + 0.28);
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(vol * 0.9, t0);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    osc.connect(g2).connect(this.master ?? ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  }

  // 点燃：短促嘶嘶
  fuse(): void {
    const ac = this.ensure();
    if (!ac || this._throttled('fuse', 0.08)) return;
    const t0 = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = this._noiseBuffer(ac);
    src.playbackRate.value = 2.4;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    src
      .connect(hp)
      .connect(gain)
      .connect(this.master ?? ac.destination);
    src.start(t0);
    src.stop(t0 + 0.2);
  }

  // 投掷破空：短促带通噪声扫频
  whoosh(): void {
    const ac = this.ensure();
    if (!ac || this._throttled('whoosh', 0.1)) return;
    const t0 = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = this._noiseBuffer(ac);
    src.playbackRate.value = 1.6;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, t0);
    bp.frequency.exponentialRampToValueAtTime(2400, t0 + 0.16);
    bp.Q.value = 1.2;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.linearRampToValueAtTime(0.16, t0 + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    src
      .connect(bp)
      .connect(gain)
      .connect(this.master ?? ac.destination);
    src.start(t0);
    src.stop(t0 + 0.22);
  }

  // 玻璃碎裂：高频脆响
  glassBreak(): void {
    const ac = this.ensure();
    if (!ac || this._throttled('glass', 0.08)) return;
    const t0 = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = this._noiseBuffer(ac);
    src.playbackRate.value = 2.2;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4500;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.22, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    src
      .connect(hp)
      .connect(gain)
      .connect(this.master ?? ac.destination);
    src.start(t0);
    src.stop(t0 + 0.32);
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2400, t0);
    osc.frequency.exponentialRampToValueAtTime(900, t0 + 0.18);
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(0.1, t0);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    osc.connect(g2).connect(this.master ?? ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.22);
  }

  // 火焰噼啪：极短低通噪声
  crackle(): void {
    const ac = this.ensure();
    if (!ac || this._throttled('crackle', 0.3)) return;
    const t0 = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = this._noiseBuffer(ac);
    src.playbackRate.value = 0.8;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.07, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    src
      .connect(lp)
      .connect(gain)
      .connect(this.master ?? ac.destination);
    src.start(t0);
    src.stop(t0 + 0.1);
  }

  // 新纪录号角：三连上行音
  fanfare(): void {
    const ac = this.ensure();
    if (!ac) return;
    const t0 = ac.currentTime;
    [523, 659, 784].forEach((f, i) => {
      const osc = ac.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const gain = ac.createGain();
      const st = t0 + i * 0.11;
      gain.gain.setValueAtTime(0.0001, st);
      gain.gain.linearRampToValueAtTime(0.12, st + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, st + 0.22);
      osc.connect(gain).connect(this.master ?? ac.destination);
      osc.start(st);
      osc.stop(st + 0.24);
    });
  }

  // 击倒（玩具故障）：下滑的金属叮
  knockout(): void {
    const ac = this.ensure();
    if (!ac || this._throttled('ko', 0.06)) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(190, t0 + 0.22);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.14, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
    osc.connect(gain).connect(this.master ?? ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.26);
  }

  // 绳断：低音崩
  ropeBreak(): void {
    const ac = this.ensure();
    if (!ac) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, t0);
    osc.frequency.exponentialRampToValueAtTime(70, t0 + 0.16);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.2, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    osc.connect(gain).connect(this.master ?? ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  // 钉住/粘附：短 tick
  stick(): void {
    const ac = this.ensure();
    if (!ac || this._throttled('stick', 0.06)) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1500;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    osc.connect(gain).connect(this.master ?? ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }
}
