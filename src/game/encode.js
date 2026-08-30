// 分享码：把一整个实验（种子+布置+运行中命令）压成一段 URL hash。
// 确定性模拟保证：拿到码的人重建出同一场事故（PRD §16 的 Replay Code）。

const VERSION = 1;

// entities: [{t,x,y,angle,acc,fixed,delay,ropes:[[ai,bi]]}]
// commands: 运行期玩家命令
//   {tick, op:'ignite', id}  → [tick,'i',id]
//   {tick, op:'throw', x,y,vx,vy} → [tick,'t',x,y,vx,vy]
export function encodeExperiment({ seed, width, height, entities, commands = [] }) {
  const e = entities.map((s) => [
    s.t,
    +s.x.toFixed(1),
    +s.y.toFixed(1),
    s.angle != null ? +s.angle.toFixed(3) : null,
    s.acc?.length ? s.acc : null,
    s.fixed ? 1 : null,
    s.delay != null ? +s.delay.toFixed(2) : null,
    s.ropes?.length ? s.ropes : null,
  ]);
  const c = commands.map((cmd) =>
    cmd.op === 'throw'
      ? [cmd.tick, 't', +cmd.x.toFixed(1), +cmd.y.toFixed(1), Math.round(cmd.vx), Math.round(cmd.vy)]
      : [cmd.tick, 'i', cmd.id]
  );
  return b64urlEncode(JSON.stringify({ v: VERSION, s: seed >>> 0, w: width, h: height, e, c }));
}

export function decodeExperiment(code) {
  const obj = JSON.parse(b64urlDecode(code));
  if (obj.v !== VERSION) throw new Error(`不支持的分享码版本: ${obj.v}`);
  return {
    seed: obj.s,
    width: obj.w,
    height: obj.h,
    entities: obj.e.map((row) => ({
      t: row[0],
      x: row[1],
      y: row[2],
      angle: row[3] ?? undefined,
      acc: row[4] ?? [],
      fixed: row[5] === 1,
      delay: row[6] ?? undefined,
      ropes: row[7] ?? undefined,
    })),
    commands: obj.c.map(decodeCommand),
  };
}

function decodeCommand(row) {
  if (row.length === 2) return { tick: row[0], op: 'ignite', id: row[1] }; // v1 旧码
  if (row[1] === 't') return { tick: row[0], op: 'throw', x: row[2], y: row[3], vx: row[4], vy: row[5] };
  return { tick: row[0], op: 'ignite', id: row[2] };
}

export function experimentFromHash(hash) {
  const m = /[#&]e=([A-Za-z0-9_-]+)/.exec(hash ?? '');
  return m ? decodeExperiment(m[1]) : null;
}

export function toHash(experiment) {
  return `#e=${encodeExperiment(experiment)}`;
}

// ---- base64url（无填充，URL 安全） ----
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
