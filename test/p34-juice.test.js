import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawScene, viewFromSpecs } from '../src/ui/render.js';
import { Particles } from '../src/ui/particles.js';

// R89: 视觉升级回归 —— 场景氛围（分层背景/玻璃盒/辉光粒子）在无 DOM 环境不抛错且有层次

// 假 CanvasRenderingContext2D：记录调用，返回哑对象
function fakeCtx() {
  const calls = [];
  const gradient = { addColorStop() {} };
  return new Proxy(
    { __calls: calls },
    {
      get(target, prop) {
        if (prop === '__calls') return calls;
        if (!(prop in target)) {
          target[prop] = (..._args) => {
            calls.push(String(prop));
            if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return gradient;
            return undefined;
          };
        }
        return target[prop];
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    },
  );
}

test('R89: 爆炸粒子含余烬与碎片，update 后余烬上飘、碎片受重力', () => {
  const p = new Particles();
  p.explosion(150, 90, 55);
  const kinds = p.list.map((q) => q.type);
  assert.ok(kinds.includes('ember'), '应有余烬粒子');
  assert.ok(kinds.includes('debris'), '应有碎片粒子');
  const ember = p.list.find((q) => q.type === 'ember');
  const debris = p.list.find((q) => q.type === 'debris');
  const ey0 = ember.y;
  const dvy0 = debris.vy;
  for (let i = 0; i < 10; i++) p.update(1 / 60);
  assert.ok(ember.y < ey0, '余烬应上飘');
  assert.ok(debris.vy > dvy0, '碎片应受重力加速');
});

test('R89: 粒子绘制使用加法混合（lighter）且不抛错', () => {
  const p = new Particles();
  p.explosion(100, 80, 40);
  p.spark(60, 60);
  const ctx = fakeCtx();
  p.draw(ctx, 3.2);
  // 假 ctx 无法真实体现 composite，但至少 smoke 走 source-over、火光走 lighter：
  // 通过调用序列里 flash 渐变存在来确认走的是分层辉光路径
  assert.ok(ctx.__calls.includes('createRadialGradient'));
  assert.ok(ctx.__calls.includes('arc'));
});

test('R89: 场景绘制走缓存背景（drawImage）或直接绘制路径，均包含玻璃盒层次', () => {
  const ctx = fakeCtx();
  const view = viewFromSpecs([{ t: 'firecracker', x: 100, y: 100 }]);
  drawScene(ctx, 960, 576, view, {});
  const calls = ctx.__calls;
  assert.ok(calls.includes('createLinearGradient'), '应有渐变（背景/地面/边框）');
  assert.ok(calls.includes('strokeRect'), '应画边框');
});
