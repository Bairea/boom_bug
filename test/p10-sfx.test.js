import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sfx } from '../src/ui/sounds.js';

// 假 AudioContext：记录节点创建与连接
function fakeCtx() {
  const stats = { sources: 0, oscillators: 0, gains: 0, filters: 0, started: 0 };
  const param = (v = 1) => ({
    value: v,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const node = (extra) => ({
    connect(dest) {
      return dest;
    },
    start() {
      stats.started++;
    },
    stop() {},
    ...extra,
  });
  const ctx = {
    stats,
    state: 'running',
    currentTime: 0,
    sampleRate: 8000,
    destination: {},
    resume() {
      ctx.state = 'running';
    },
    createBuffer(len, n) {
      return { getChannelData: () => new Float32Array(n) };
    },
    createBufferSource() {
      stats.sources++;
      return node({ buffer: null, playbackRate: param(1) });
    },
    createOscillator() {
      stats.oscillators++;
      return node({ type: '', frequency: param() });
    },
    createGain() {
      stats.gains++;
      return node({ gain: param() });
    },
    createBiquadFilter() {
      stats.filters++;
      return node({ type: '', frequency: param(), Q: param() });
    },
  };
  return ctx;
}

test('音效: 爆炸/点燃/击倒/断裂各司其职且可静音', () => {
  const ctx = fakeCtx();
  const sfx = new Sfx(() => ctx);
  sfx.explosion(70);
  sfx.fuse();
  sfx.knockout();
  sfx.ropeBreak();
  sfx.stick();
  assert.ok(ctx.stats.sources >= 2, '爆炸+嘶嘶需要噪声源');
  assert.ok(ctx.stats.oscillators >= 3, '低频咚/金属叮/绳崩需要振荡器');
  assert.ok(ctx.stats.started >= 5, '所有源都应 start');

  // 节流：短时间重复爆炸不应翻倍
  const before = ctx.stats.started;
  sfx.explosion(70);
  assert.equal(ctx.stats.started, before, '40ms 内的爆炸应被节流');

  // 静音后不再创建任何东西
  sfx.muted = true;
  const b2 = ctx.stats.started;
  sfx.explosion(70);
  sfx.knockout();
  assert.equal(ctx.stats.started, b2, '静音应完全不发声');
});

test('音效: 无音频工厂时优雅空转（Node 无头环境安全）', () => {
  const sfx = new Sfx(null);
  sfx.explosion(55);
  sfx.fuse();
  sfx.knockout();
  sfx.ropeBreak();
  sfx.stick();
  assert.equal(sfx.ctx, null);
});
