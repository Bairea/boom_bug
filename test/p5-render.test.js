import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawScene, viewFromSim, viewFromSpecs } from '../src/ui/render.js';
import { Particles } from '../src/ui/particles.js';
import { Simulation } from '../src/sim/sim.js';
import { SCENARIOS } from '../src/game/scenario.js';

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
          target[prop] = (...args) => {
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
    }
  );
}

test('P5: 编辑视图渲染冒烟（含瞄准线/绳子/幽灵）', () => {
  const ctx = fakeCtx();
  const sc = SCENARIOS.find((s) => s.id === 'case1');
  const view = viewFromSpecs(sc.entities, sc.entities[10].ropes);
  drawScene(ctx, 960, 576, view, {
    showAim: true,
    ghost: { t: 'bottle', kind: 'explosive', x: 100, y: 80, angle: 0.5, aim: 0.5, acc: [] },
  });
  const calls = ctx.__calls;
  assert.ok(calls.length > 150, `应有大量绘制调用: ${calls.length}`);
  for (const need of ['strokeRect', 'ellipse', 'setLineDash', 'arc']) {
    assert.ok(calls.includes(need), `应包含 ${need}`);
  }
});

test('P5: 运行视图渲染冒烟（模拟中真实状态）', () => {
  const sc = SCENARIOS.find((s) => s.id === 'case1');
  const sim = new Simulation({ seed: sc.seed, entities: sc.entities });
  sim.runFor(2);
  const ctx = fakeCtx();
  const view = viewFromSim(sim);
  drawScene(ctx, 960, 576, view, { recDot: true, showAim: true });
  assert.ok(ctx.__calls.length > 100);
  assert.ok(view.items.length > 0);
  assert.ok(view.items.every((it) => it.t && Number.isFinite(it.x) && Number.isFinite(it.y)));
});

test('P5: 粒子系统更新与绘制不抛错且有衰减', () => {
  const p = new Particles();
  p.explosion(150, 90, 55);
  p.spark(100, 100);
  p.puff(120, 120);
  const before = p.list.length;
  assert.ok(before > 15, `爆炸应产生粒子: ${before}`);
  assert.ok(p.shake > 0, '应有震屏');
  for (let i = 0; i < 120; i++) p.update(1 / 60);
  const ctx = fakeCtx();
  p.draw(ctx, 3.2);
  assert.ok(p.list.length < before, '粒子应逐渐消亡');
});

test('P7: 三个案例预设的实体都在盒内且结构合法', () => {
  for (const sc of SCENARIOS) {
    for (const e of sc.entities) {
      assert.ok(e.x > 0 && e.x < 300 && e.y > 0 && e.y < 180, `${sc.id} 实体越界: ${e.t}`);
      if (e.ropes) {
        for (const [a, b] of e.ropes) {
          assert.ok(a < sc.entities.length && b < sc.entities.length, `${sc.id} 绳子索引越界`);
        }
      }
      if (e.acc) for (const a of e.acc) assert.ok(['toothpick', 'pin', 'glue'].includes(a));
    }
  }
});

test('P7: 案例目标判定函数可用', () => {
  const c1 = SCENARIOS.find((s) => s.id === 'case1');
  const sim = new Simulation({ seed: c1.seed, entities: c1.entities });
  sim.runFor(6);
  const goal = c1.goal(sim);
  assert.equal(typeof goal.done, 'boolean');
  assert.ok(goal.label.length > 0);
});
