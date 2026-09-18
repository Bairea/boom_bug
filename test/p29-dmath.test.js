// P29：确定性数学层 dmath 的守护测试。
//
// 背景：ECMA-262 只精确规定 + - * / % sqrt 与 abs/floor/round/min/max 等的结果；
// Math.sin/cos/atan2/hypot 由各引擎自由实现（V8/SpiderMonkey/JSC 可差 1+ ULP），
// 而 sim 层这些值直接喂布尔判定（是否引爆/受惊/打滑）—— 1 ULP 就是分享码跨浏览器
// 演化出不同事故的入口。dmath 只用规格化运算，跨引擎逐位一致。
//
// 四道防线：
//   1. 位级冻结向量 —— 任何引擎跑本测试都应得到同一批 64 位模式（跨引擎可复现）
//   2. 精度对照 Math.* —— 保证确定性没有牺牲正确性（|err| ≤ 1e-11）
//   3. sin²+cos²=1 自洽 —— 不依赖 Math 参照，专抓规约/多项式/折叠错误
//   4. 静态扫描 —— 禁止 sim 层与编辑器再引入引擎相关数学

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dhypot, dsin, dcos, ddatan2 } from '../src/sim/dmath.js';
import { Simulation } from '../src/sim/sim.js';
import { SCENARIOS } from '../src/game/scenario.js';

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function bits(v) {
  f64[0] = v;
  return u32[1].toString(16).padStart(8, '0') + u32[0].toString(16).padStart(8, '0');
}

const FN = { dhypot, dsin, dcos, ddatan2 };

// 由当前实现生成后冻结；若未来改动算法导致任何一条漂移，必须有意识地重估
// （重新生成 + 在 commit message 里说明对分享码兼容性的影响）。
const GOLDEN = [
  'dhypot|3,4|4014000000000000',
  'dhypot|5e-324,0|0000000000000001',
  'dhypot|1e+200,1e+200|697d8f9811335b57',
  'dhypot|0,0|0000000000000000',
  'dhypot|-3,4|4014000000000000',
  'dhypot|1e-200,2e-200|167b62b60ac37e38',
  'dsin|0|0000000000000000',
  'dsin|1.7|3fefbbb7d72f98b6',
  'dsin|-2.5|bfe326af0dcfcab0',
  'dsin|3.141592653589793|0000000000000000',
  'dsin|6.283185307179586|0000000000000000',
  'dsin|100.125|bfd946216f45101b',
  'dsin|75600.25|3fea4b599f20cc9f',
  'dsin|-1e-9|be112e0be826d695',
  'dcos|0|3ff0000000000000',
  'dcos|0.5|3fec1528065b7d50',
  'dcos|1.5707963267948966|0000000000000000',
  'dcos|-2.5|bfe9a2f7ef858b7e',
  'dcos|300.75|3fe54a2c9f4b90ee',
  'dcos|316227.7|3fd32a45377d0e2d',
  'ddatan2|0,0|0000000000000000',
  'ddatan2|1,1|3fe921fb54442d19',
  'ddatan2|3,-4|4003fc176b7a8560',
  'ddatan2|-1,2|bfddac670561bb4f',
  'ddatan2|0,-1|400921fb54442d18',
  'ddatan2|10000000000,-3|3ff921fb5458cac0',
  'ddatan2|-1e-9,-1|c00921fb5421d100',
  'ddatan2|5,1e-300|3ff921fb54442d18',
];

test('P29: 位级冻结向量 —— 跨引擎必须逐位一致', () => {
  for (const row of GOLDEN) {
    const [fn, argStr, want] = row.split('|');
    const args = argStr.split(',').map(Number);
    assert.equal(bits(FN[fn](...args)), want, `${fn}(${args}) 位模式漂移`);
  }
});

test('P29: 精度对照 Math.*（|x|≤100 逐点 + 大参数抽点，err ≤ 1e-11）', () => {
  let worst = 0;
  for (let x = -100; x <= 100; x += 0.0137) {
    worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
  }
  for (const x of [1e5, -75600.25, 12345.678, 316227.7]) {
    worst = Math.max(worst, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
  }
  assert.ok(worst <= 1e-11, `sin/cos 最大误差 ${worst.toExponential(3)}`);
});

test('P29: ddatan2 精度对照 Math.atan2（全象限扫掠，err ≤ 1e-11）', () => {
  let worst = 0;
  for (let t = -3.5; t <= 3.5; t += 0.0131) {
    for (const r of [1e-6, 0.3, 1, 7, 300]) {
      const y = Math.sin(t) * r;
      const x = Math.cos(t) * r;
      worst = Math.max(worst, Math.abs(ddatan2(y, x) - Math.atan2(y, x)));
    }
  }
  assert.ok(worst <= 1e-11, `ddatan2 最大误差 ${worst.toExponential(3)}`);
});

test('P29: sin²+cos²=1 自洽（不依赖 Math 参照，抓规约/折叠错误）', () => {
  let worst = 0;
  for (let x = -100; x <= 100; x += 0.0137) {
    worst = Math.max(worst, Math.abs(dsin(x) * dsin(x) + dcos(x) * dcos(x) - 1));
  }
  for (const x of [1e5, -75600.25, 316227.7, 12345.678]) {
    worst = Math.max(worst, Math.abs(dsin(x) * dsin(x) + dcos(x) * dcos(x) - 1));
  }
  assert.ok(worst <= 1e-9, `sin²+cos²−1 最大偏差 ${worst.toExponential(3)}`);
});

test('P29: dhypot 精确性与缩放边界（3-4-5 精确命中 / 极小不下溢 / 极大不溢出）', () => {
  assert.equal(dhypot(3, 4), 5);
  assert.equal(dhypot(5e-324, 0), 5e-324); // naive x*x 会把它归零
  assert.ok(Number.isFinite(dhypot(1e200, 1e200))); // naive x*x 会溢出
  assert.equal(dhypot(0, 0), 0);
  let worst = 0;
  for (let x = -100; x <= 100; x += 0.5) {
    worst = Math.max(worst, Math.abs(dhypot(x * 1e3, x * 700) - Math.hypot(x * 1e3, x * 700)));
  }
  assert.ok(worst <= 1e-9, `dhypot 最大误差 ${worst.toExponential(3)}`);
});

test('P29: ddatan2 特例与 Math.atan2 一致（零/无穷，除双零有意归 0）', () => {
  assert.equal(ddatan2(0, -1), Math.PI);
  assert.equal(ddatan2(0, 1), 0);
  assert.equal(ddatan2(1, 0), Math.PI / 2);
  assert.equal(ddatan2(-1, 0), -Math.PI / 2);
  assert.equal(ddatan2(0, 0), 0); // 有意偏离：±0,±0 一律 0（sim 不依赖其符号）
  assert.ok(Number.isNaN(ddatan2(NaN, 1)));
  assert.equal(ddatan2(Infinity, Infinity), Math.PI / 4);
});

test('P29: 静态扫描 —— sim 层与编辑器禁止引擎相关数学（ hypot/sin/cos/…( 带调用括号）', () => {
  const forbidden =
    /Math\.(hypot|sin|cos|tan|asin|acos|atan2|atan|pow|exp|log|log2|log10|expm1|log1p|cbrt|sinh|cosh|tanh|asinh|acosh|atanh|random)\s*\(/;
  // sim 全目录 + editor（它算出的 angle 会进分享码）。
  // render/particles/main 的 Math.* 是纯视觉（不影响确定性），不在守护范围。
  const targets = ['../src/sim/'];
  const files = [];
  for (const dir of targets) {
    const base = fileURLToPath(new URL(dir, import.meta.url));
    for (const f of readdirSync(base).filter((n) => n.endsWith('.ts'))) files.push([base + f, dir + f]);
  }
  files.push([fileURLToPath(new URL('../src/ui/editor.ts', import.meta.url)), '../src/ui/editor.ts']);
  const offenders = files.filter(([path]) => forbidden.test(readFileSync(path, 'utf8'))).map(([, label]) => label);
  assert.deepEqual(offenders, [], `以下文件仍在使用引擎相关数学: ${offenders.join(', ')}`);
});

// P29 基线：dmath 上线前抓取的全场景校验和（27 组）。冻结它保证确定性数学替换
// 对 gameplay 零漂移；若算法变更导致漂移，必须解释哪个布尔判定翻转了。
//
// 漂移记录：
// - R74 dmath：27/27 逐位一致（零漂移）。
// - R81 绳子速度冲量（solveRopes 拉紧时传力，气球吊装依赖）：仅 case1 三组变化
//   —— 唯一带绳预设；A/B 实测 20 种子达成率 10/20 → 10/20 不变，属连锁时序的
//   位级漂移，非行为回归。
// - R83 苍蝇逐腥（stepFly 被附近爆炸物吸引）+ 新增 case9：case5 三组变化
//   （唯一带苍蝇预设；达成率 8/10 反而更友好）；case9 三组为新增基线。
const CK_BASELINE = [
  ['free', 20260830, 2166136261],
  ['free', 20268749, 2166136261],
  ['free', 20276668, 2166136261],
  ['case1', 4103, 2100297224],
  ['case1', 12022, 3056731504],
  ['case1', 19941, 1728872888],
  ['case2', 777, 2762880751],
  ['case2', 8696, 3522197435],
  ['case2', 16615, 1860383897],
  ['case3', 909, 2039507572],
  ['case3', 8828, 2039507572],
  ['case3', 16747, 2039507572],
  ['case4', 1234, 441730377],
  ['case4', 9153, 441730377],
  ['case4', 17072, 441730377],
  ['case5', 555, 2214228834],
  ['case5', 8474, 2579223231],
  ['case5', 16393, 1316712791],
  ['case6', 4242, 1260649481],
  ['case6', 12161, 1260649481],
  ['case6', 20080, 1260649481],
  ['case7', 707, 3175674340],
  ['case7', 8626, 2757715373],
  ['case7', 16545, 3676219655],
  ['case8', 808, 2733113757],
  ['case8', 8727, 2733113757],
  ['case8', 16646, 2733113757],
  ['case9', 9021, 1919548182],
  ['case9', 16940, 1948086640],
  ['case9', 24859, 1526322116],
];

test('P29: 全场景基线冻结 —— dmath 对 gameplay 零漂移（27 组校验和）', () => {
  const byId = new Map(SCENARIOS.map((sc) => [sc.id, sc]));
  for (const [id, seed, ck] of CK_BASELINE) {
    const sim = new Simulation({ seed, entities: byId.get(id).entities });
    sim.runFor(10);
    assert.equal(sim.stateChecksum(), ck, `${id}@${seed} 校验和漂移 —— dmath 改动影响了模拟结果`);
  }
});
