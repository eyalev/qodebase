// X2 backtest: replays real builds' landing times (sim/remaining-lands.json) through remainingTime every 15 s and
// counts how often the real time left fell inside the range. node sim/remaining-backtest.mjs
import fs from 'node:fs';
import { remainingTime } from '../public/lab/predict.js';
const { builds } = JSON.parse(fs.readFileSync(new URL('./remaining-lands.json', import.meta.url)));
for (const b of builds) {
  const end = b.lands[b.parts - 1]; let pre = [0, 0], post = [0, 0], up = 0, prevK = null;
  for (let t = 0; t < end; t += 15) {
    const landed = b.lands.filter((x) => x <= t).length;
    const r = remainingTime({ parts: b.parts, landed, elapsedS: t, estimate: { wallS: b.estimate }, firstLandS: landed ? b.lands[0] : null, lastLandS: landed ? b.lands[landed - 1] : null });
    const K = Math.round(r.midS / 60); if (prevK != null && K > prevK) up++; prevK = K;
    const c = landed ? post : pre; c[1]++; if (end - t >= r.leftS[0] && end - t <= r.leftS[1]) c[0]++;
  }
  const pct = ([a, n]) => (n ? `${a}/${n} (${Math.round((100 * a) / n)}%)` : '-');
  console.log(`${b.slug} parts ${b.parts}: before the first landing ${pct(pre)}, after ${pct(post)}; shown minutes went up on ${Math.round((100 * up) / (pre[1] + post[1]))}% of steps`);
}
