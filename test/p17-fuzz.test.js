import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/sim.js';
import { Rng } from '../src/sim/rng.js';
import { SCENARIOS } from '../src/game/scenario.js';

const TYPES = ['roach', 'locust', 'scarab', 'snail', 'fly', 'firecracker', 'skyrocket', 'bottle', 'brick', 'glass', 'sponge', 'water'];
const TIPS_POOL = [[], ['toothpick'], ['pin'], ['glue'], ['pin', 'glue'], ['toothpick', 'pin']];

// 随机布置生成器（种子化，测试本身可复现）
function randomEntities(rng, n) {
  const ents = [];
  for (let i = 0; i < n; i++) {
    const t = rng.pick(TYPES);
    const e = {
      t,
      x: +rng.range(10, 290).toFixed(1),
      y: +rng.range(10, 176).toFixed(1),
    };
    if (['firecracker', 'skyrocket', 'bottle'].includes(t)) {
      e.angle = +rng.range(-Math.PI, Math.PI).toFixed(3);
      e.acc = rng.pick(TIPS_POOL);
      e.delay = +rng.range(0, 3).toFixed(2);
    }
    if (t === 'scarab' && rng.float() < 0.5) e.fixed = true;
    ents.push(e);
  }
  // 随机绳子
  if (ents.length >= 2 && rng.float() < 0.4) {
    const a = rng.int(0, ents.length - 1);
    const b = rng.int(0, ents.length - 1);
    if (a !== b) ents[0].ropes = [[a, b]];
  }
  return ents;
}

function assertSane(sim, tag) {
  for (const b of sim.world.bodies) {
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), `${tag}: ${b.kind} 位置 NaN/Inf`);
    assert.ok(Number.isFinite(b.vx) && Number.isFinite(b.vy), `${tag}: ${b.kind} 速度 NaN/Inf`);
    assert.ok(b.x >= -50 && b.x <= 350 && b.y >= -50 && b.y <= 230, `${tag}: ${b.kind} 位置严重越界 (${b.x},${b.y})`);
    if (b.data?.hp != null) assert.ok(Number.isFinite(b.data.hp), `${tag}: hp NaN`);
  }
  for (const p of sim.world.slime) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.age), `${tag}: 黏液数据异常`);
  }
  for (const r of sim.world.ropes) {
    assert.ok(typeof r.broken === 'boolean', `${tag}: 绳状态异常`);
  }
}

test('R20: 模糊测试 60 个随机实验 × 10 秒 —— 无 NaN、无越界、无崩溃', () => {
  const rng = new Rng(20260831);
  for (let i = 0; i < 60; i++) {
    const ents = randomEntities(rng, rng.int(3, 16));
    const sim = new Simulation({ seed: rng.int(1, 0x7fffffff), entities: ents });
    sim.runFor(10);
    assertSane(sim, `fuzz#${i}`);
  }
});

test('R20: 全部预设场景 × 5 种子 —— 无 NaN、可正常终局', () => {
  for (const sc of SCENARIOS) {
    for (let s = 0; s < 5; s++) {
      let i = 0;
      const ents = sc.entities.map((e) => ({
        ...e,
        delay: ['firecracker', 'skyrocket', 'bottle'].includes(e.t) ? +(0.15 + i++ * 0.35).toFixed(2) : undefined,
      }));
      const sim = new Simulation({ seed: sc.seed + s * 7919, entities: ents });
      sim.runFor(10);
      assertSane(sim, `${sc.id}#${s}`);
    }
  }
});

test('R20: 确定性在大规模模糊下依然成立（3 组双跑）', () => {
  const rng = new Rng(777);
  for (let i = 0; i < 3; i++) {
    const ents = randomEntities(rng, 12);
    const seed = rng.int(1, 0x7fffffff);
    const a = new Simulation({ seed, entities: ents });
    const b = new Simulation({ seed, entities: ents });
    a.runFor(6);
    b.runFor(6);
    assert.equal(a.stateChecksum(), b.stateChecksum(), `fuzz pair ${i} 失去确定性`);
  }
});
