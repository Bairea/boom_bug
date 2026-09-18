// 确定性数学收敛层：模拟层所有三角/距离计算唯一入口。
//
// 为什么存在：ECMA-262 只精确规定 + - * / % sqrt 与 abs/floor/ceil/round/trunc/
// min/max/sign/imul 的结果（IEEE 754 roundTiesToEven 或逐字规范）；
// Math.sin/cos/atan2/hypot 由各引擎自由实现 —— V8/SpiderMonkey/JavaScriptCore
// 在同一输入上可差 1+ ULP。1 ULP 在连续积分里无所谓，但喂进布尔判定
// （是否引爆 / 是否受惊 / 是否打滑）就是蝴蝶效应入口，分享码跨浏览器即失效。
//
// 规则：本文件只允许使用规格化运算。任何引擎逐位一致。
// 精度目标 ≤1e-12（gameplay 只需要 0.01），由 test/p29 对照 Math.* 与位级冻结向量守护。

// 常量按位模式构造（逐位写明，避免十进制转写误差；类型数组无 DOM 依赖，Node/浏览器通用）
const _f64 = new Float64Array(1);
const _u32 = new Uint32Array(_f64.buffer);
function fromBits(hi: number, lo: number): number {
  _u32[0] = lo >>> 0;
  _u32[1] = hi >>> 0;
  return _f64[0];
}

const TWO_PI = fromBits(0x401921fb, 0x54442d18); // fl(2π)
const PI = fromBits(0x400921fb, 0x54442d18);
const HALF_PI = fromBits(0x3ff921fb, 0x54442d18);
const QUARTER_PI = fromBits(0x3fe921fb, 0x54442d18);
// Cody–Waite 双常数 2π：hi 保留 33 位有效位（尾数低 20 位清零），
// 使 k·hi 对 |k|≤2^18 精确成立；lo = 2π−hi 精确可得。规约误差 ≤1e-16（|x|≲4e5 内）。
const TWO_PI_HI = fromBits(0x401921fb, 0x54400000);
const TWO_PI_LO = TWO_PI - TWO_PI_HI; // 精确（差值仅 20 位有效位）
const INV_TWO_PI = 1 / TWO_PI;

// fdlibm k_sin.c 极小极大多项式系数（[-π/4,π/4] 上误差 <1 ulp，跨语言公版常量）
const SIN_S1 = -1.66666666666666324348e-1;
const SIN_S2 = 8.33333333332248946124e-3;
const SIN_S3 = -1.98412698298579493134e-4;
const SIN_S4 = 2.75573137070700676789e-6;
const SIN_S5 = -2.50507602534068634195e-8;
const SIN_S6 = 1.58969099521155010221e-10;

// fdlibm k_cos.c 同上
const COS_C1 = 4.16666666666666019037e-2;
const COS_C2 = -1.38888888888741095749e-3;
const COS_C3 = 2.48015872894767294178e-5;
const COS_C4 = -2.75573143513906633035e-7;
const COS_C5 = 2.0875723212981748279e-9;
const COS_C6 = -1.13596475577881948265e-11;

// √(x²+y²)。缩放到最大分量再还原：比值 ∈[0,1] 不溢出，×hi 不下溢
// （naive 的 x*x 在 x>1e154 溢出 / x<1e-162 下溢归零，缩放版全部免疫）。
export function dhypot(x: number, y: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const hi = ax > ay ? ax : ay;
  if (hi === 0) return 0;
  const r = (ax / hi) * (ax / hi) + (ay / hi) * (ay / hi);
  return hi * Math.sqrt(r);
}

// [0,π/4] 上的 sin 核心：x + x³·(S1 + z·(S2 + …))，fdlibm 排布保精度
function dsinCore(x: number): number {
  const z = x * x;
  const r = SIN_S2 + z * (SIN_S3 + z * (SIN_S4 + z * (SIN_S5 + z * SIN_S6)));
  return x + x * z * (SIN_S1 + z * r);
}

// [0,π/4] 上的 cos 核心：1 − z/2 + z²·(C1 + …)，fdlibm/musl 的 w+((1−w)−hz+zr) 排布
function dcosCore(x: number): number {
  const z = x * x;
  const r = z * (COS_C1 + z * (COS_C2 + z * (COS_C3 + z * (COS_C4 + z * (COS_C5 + z * COS_C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

// sin。规约链全部用精确运算：Cody–Waite 双常数取余（|参数|≲4e5 时误差 ≤1e-16 rad，
// 更大参数仍确定但误差随 |k|·2^-53 增长），再对称折叠到 [0,π/4]。
export function dsin(angle: number): number {
  if (Number.isNaN(angle) || !Number.isFinite(angle)) return NaN;
  const k = Math.round(angle * INV_TWO_PI);
  let x = angle - k * TWO_PI_HI - k * TWO_PI_LO; // x ∈ [-π, π]
  if (x > PI) x -= TWO_PI;
  else if (x < -PI) x += TWO_PI;
  const s = x < 0 ? -1 : 1;
  let ax = x < 0 ? -x : x; // ax ∈ [0, π]
  if (ax > HALF_PI) ax = PI - ax; // sin(π−a)=sin(a)
  if (ax > QUARTER_PI) return s * dcosCore(HALF_PI - ax) + 0; // sin(a)=cos(π/2−a)；+0 规范化负零
  return s * dsinCore(ax) + 0;
}

// cos。复用 sin 全链路，只多一次精确加法（误差 ≤0.5 ulp）。
export function dcos(angle: number): number {
  return dsin(angle + HALF_PI);
}

// [0,1] 上的 atan：两次半角折叠 atan(z)=2·atan(z/(1+√(1+z²))) 把参数压进
// [0, tan(π/16)≈0.199]，奇幂泰勒截断到 t²¹ 项（余项 <1e-16）。
function datanUnit(z: number): number {
  if (z === 0) return 0;
  if (z === Infinity) return HALF_PI;
  let t = z / (1 + Math.sqrt(1 + z * z));
  t = t / (1 + Math.sqrt(1 + t * t));
  const t2 = t * t;
  const p =
    1 +
    t2 *
      (-1 / 3 +
        t2 *
          (1 / 5 +
            t2 *
              (-1 / 7 +
                t2 *
                  (1 / 9 + t2 * (-1 / 11 + t2 * (1 / 13 + t2 * (-1 / 15 + t2 * (1 / 17 + t2 * (-1 / 19 + t2 * (1 / 21))))))))));
  return 4 * t * p;
}

// atan2。有意偏离 Math.atan2 的两个特例（模拟层不依赖其符号细节）：
// y=x=±0 一律返回 0。其余特例（x=0 / 无穷大）与 Math.atan2 一致。
export function ddatan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;
  const ay = y < 0 ? -y : y;
  const ax = x < 0 ? -x : x;
  let base: number; // base ∈ [0, π/2]
  if (!Number.isFinite(ax) && !Number.isFinite(ay))
    base = QUARTER_PI; // 双无穷
  else if (!Number.isFinite(ay))
    base = HALF_PI; // y=±∞, x 有限
  else if (!Number.isFinite(ax))
    base = 0; // x=±∞, y 有限
  else if (ax >= ay) base = datanUnit(ay / ax);
  else base = HALF_PI - datanUnit(ax / ay);
  if (x < 0) base = PI - base;
  return y < 0 ? -base : base;
}
