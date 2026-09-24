// Node 基线：与浏览器切片跑完全相同的输入（同 seed 同实体同命令流），输出最终统计与校验和
// —— 垂直切片的确定性对拍基准。切片页面上显示的 checksum 应与此处逐位一致。
//
// 用法：先 npm run build（tsc 产出 src/**/*.js），然后 node slice/baseline.mjs
import { Simulation } from '../src/sim/sim.js';
import { getScenario } from '../src/game/scenario.js';
import { buildEntitiesFor } from './case1-setup.js';

const sc = getScenario('case1');
const sim = new Simulation({
  seed: sc.seed,
  width: 300,
  height: 180,
  entities: buildEntitiesFor(sc.entities, { noAutoIgnite: sc.noAutoIgnite }),
});

// 与游戏收尾条件一致：3 秒（180 tick）无事件即结束，上限 60s
let lastEventTick = 0;
while (sim.tick - lastEventTick <= 180 && sim.tick < 3600) {
  sim.step();
  if (sim.eventsThisStep.length) lastEventTick = sim.tick;
}

const s = sim.stats;
const powers = sim.eventLog.filter((e) => e.type === 'explosion').map((e) => e.power);
console.log(
  `case1 seed=${sc.seed}  爆炸${s.explosions} · 连锁×${s.chainMax} · 击倒${s.knockouts} · ` +
    `一爆多杀${s.multiKills} · 断绳${s.ropesBroken}  tick=${sim.tick}`,
);
console.log(`checksum=${sim.stateChecksum()}`);
console.log(
  `爆炸威力分布: min=${Math.min(...powers).toFixed(2)} max=${Math.max(...powers).toFixed(2)} n=${powers.length}`,
);
console.log(
  `爆炸半径分布: ` +
    sim.eventLog
      .filter((e) => e.type === 'explosion')
      .map((e) => e.blastRadius)
      .sort((a, b) => a - b)
      .join(', '),
);
