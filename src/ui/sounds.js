// WebAudio 合成音效：零素材，纯表现层。
// 音频上下文工厂可注入（Node 无头测试用假工厂）。

export class Sfx {
  constructor(createCtx = null) {
    this._create = createCtx;
    this.ctx = null;
    this.muted = false;
    this._noise = null;
    this._lastAt = {}; // 按类型节流
  }

  ensure() {
    if (this.muted) return null;
    if (!this.ctx && this._create) {
      try {
        this.ctx = this._create();
      } catch {
        this.ctx = null;
      }
    }
    if (!this.ctx) return null;
    if (this.ctx.state === 'suspended') this.ctx.resume?.();
    return this.ctx;
  }

  // 复用一条白噪声缓冲
  _noiseBuffer(ac) {
    if (!this._noise) {
      const len = Math.floor(ac.sampleRate * 0.5);
      this._noise = ac.createBuffer(1, len, ac.sampleRate);
      const data = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return this._noise;
  }

  _throttled(name, minGap) {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (this._lastAt[name] != null && now - this._lastAt[name] < minGap) return true;
    this._lastAt[name] = now;
    return false;
  }

  // 爆炸：白噪声爆发（低通扫频）+ 低频"咚"
  explosion(power = 55) {
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
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(t0);
    src.stop(t0 + 0.5);

    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t0);
    osc.frequency.exponentialRampToValueAtTime(36, t0 + 0.28);
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(vol * 0.9, t0);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    osc.connect(g2).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  }

  // 点燃：短促嘶嘶
  fuse() {
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
    src.connect(hp).connect(gain).connect(ac.destination);
    src.start(t0);
    src.stop(t0 + 0.2);
  }

  // 投掷破空：短促带通噪声扫频
  whoosh() {
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
    src.connect(bp).connect(gain).connect(ac.destination);
    src.start(t0);
    src.stop(t0 + 0.22);
  }

  // 玻璃碎裂：高频脆响
  glassBreak() {
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
    src.connect(hp).connect(gain).connect(ac.destination);
    src.start(t0);
    src.stop(t0 + 0.32);
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2400, t0);
    osc.frequency.exponentialRampToValueAtTime(900, t0 + 0.18);
    const g2 = ac.createGain();
    g2.gain.setValueAtTime(0.1, t0);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    osc.connect(g2).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.22);
  }

  // 击倒（玩具故障）：下滑的金属叮
  knockout() {
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
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.26);
  }

  // 绳断：低音崩
  ropeBreak() {
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
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.2);
  }

  // 钉住/粘附：短 tick
  stick() {
    const ac = this.ensure();
    if (!ac || this._throttled('stick', 0.06)) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1500;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.08);
  }
}
