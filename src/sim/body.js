// 圆形刚体：一切物体（虫、炮仗、配件挂点）的物理载体。
// 用圆形近似足够表达"玩具盒子"里的混乱，也让确定性可控。

let NEXT_ID = 1;
export function resetBodyIds() {
  NEXT_ID = 1;
}

export function createBody(opts = {}) {
  const radius = opts.radius ?? 3;
  const mass = opts.mass ?? 1;
  const isStatic = !!opts.static;
  return {
    id: NEXT_ID++,
    kind: opts.kind ?? 'prop',
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    vx: opts.vx ?? 0,
    vy: opts.vy ?? 0,
    angle: opts.angle ?? 0,
    angVel: 0,
    radius,
    mass,
    // static 的物体不受积分与冲量影响（invMass=0）
    invMass: isStatic ? 0 : 1 / Math.max(mass, 1e-6),
    restitution: opts.restitution ?? 0.35,
    friction: opts.friction ?? 0.85, // 地面滚动阻力（每秒衰减比例）
    drag: opts.drag ?? 0.1, // 空气阻力（每秒速度衰减比例）
    static: isStatic,
    alive: true,
    // 各类型自用数据（引信、AI 状态、配件…）
    data: opts.data ?? {},
  };
}

// 半隐式欧拉积分一步
export function integrateBody(b, dt, gravity) {
  if (b.static || (b.data && b.data.frozen)) return;
  b.vy += gravity * dt;
  const airKeep = Math.max(0, 1 - b.drag * dt);
  b.vx *= airKeep;
  b.vy *= airKeep;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.angle += b.angVel * dt;
  b.angVel *= Math.max(0, 1 - 3 * dt);
}
