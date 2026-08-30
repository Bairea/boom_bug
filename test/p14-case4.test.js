import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTitle } from '../src/game/replay.js';
import { Simulation } from '../src/sim/sim.js';
import { SCENARIOS } from '../src/game/scenario.js';

const base = { chainMax: 1, knockouts: 0, multiKills: 0, explosions: 0, ropesBroken: 0 };

test('R14: 事故标题规则覆盖各种战局', () => {
  assert.equal(makeTitle({ ...base }, []), '什么都没发生……再来一次？');
  assert.equal(makeTitle({ ...base, chainMax: 5, explosions: 9, knockouts: 4 }, [{ type: 'knockout', bugType: 'roach' }]), '本世纪连锁惨案 ×5');
  assert.equal(makeTitle({ ...base, multiKills: 2, explosions: 3, knockouts: 5 }, []), '连环车祸现场');
  assert.equal(makeTitle({ ...base, explosions: 2 }, []), '只炸坏了氛围');
  assert.equal(makeTitle({ ...base, explosions: 1, knockouts: 1 }, [{ type: 'knockout', bugType: 'locust' }]), '我本来只想炸一只蝗虫');
  assert.equal(makeTitle({ ...base, explosions: 6, knockouts: 7 }, []), '虫虫灭绝日');
  assert.equal(makeTitle({ ...base, explosions: 3, knockouts: 3, ropesBroken: 1 }, []), '绳子营救行动失败');
  assert.equal(makeTitle({ ...base, explosions: 3, knockouts: 3 }, []), '大型失控现场');
});

test('R14: 案例4 黏液保龄球馆可玩且结构合法', () => {
  const sc = SCENARIOS.find((s) => s.id === 'case4');
  assert.ok(sc, '案例4 应存在');
  for (const e of sc.entities) {
    assert.ok(e.x > 0 && e.x < 300 && e.y > 0 && e.y < 180);
  }
  // 一局完整模拟：结构不炸、目标判定可用
  const sim = new Simulation({ seed: sc.seed, entities: sc.entities });
  sim.runFor(6);
  const goal = sc.goal(sim);
  assert.equal(typeof goal.done, 'boolean');
  assert.equal(goal.done, false, '球瓶阵固定，不投掷不应达成');
  // 投掷直击球瓶阵 → 一爆双响应达成
  sim.playerThrow(60, 168, 480, 25);
  sim.runFor(3);
  assert.equal(sc.goal(sim).done, true, '直掷球瓶阵应一爆双响');
});
