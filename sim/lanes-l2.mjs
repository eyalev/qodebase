#!/usr/bin/env node
// L1 predictions for qb5's L2 cells (sim/real with lanes): the fast sim shaped like that project: agents/10 folders
// of 8 files on a 1/(i+1) curve, the cross share measured from sim/real's own randomOp (root files shared: 34% of
// changes are cross-area; split per folder: 8.5%), its coordinated lane (trains of 4 over at most 8 lanes, tests
// x1.5), 2 h runs measured over the 2nd hour (as L2), and 16 h (last 8 h) for where it settles.
// No door onto main and no main CI here (L2 has both). node sim/lanes-l2.mjs > sim/lanes/l2-cells.jsonl
import { createSim } from '../public/sim/engine.js';
function run({ agents, lanes, cross, ctl, seed, hours, big }) {
  const sim = createSim({ seed, policy: 'intents', policyOverride: { claims: 'none', pickFree: 0 }, pRisky: 0, agentsPerRepo: agents,
    files: (agents / 10) * 8 + 6, filesPerModule: 8, ...(lanes > 1 ? { pHot: 0 } : {}),
    lanes: lanes > 1 ? lanes : (ctl ? 1 : 0), crossShare: cross, laneCtl: ctl, coordBatch: big ? 16 : 4, coordMaxLanes: big ? 256 : 8 });
  sim.runUntil((hours / 2) * 3600); const a = { ...sim.metrics }; sim.runUntil(hours * 3600);
  const s = sim.snapshot({ files: false }), b = s.metrics, n = b.merged - a.merged;
  return { perH: Math.round(n / (hours / 2)), coll: n ? (b.conflicts - a.conflicts) / n : 0, awake: s.lanes ? s.lanes.awakeShare : 1, cq: s.lanes ? s.lanes.coordQueue : 0, usd: n ? (b.cost - a.cost) / n : 0 };
}
for (const agents of [500, 2000]) for (const lanes of [1, 8, 32]) for (const hot of lanes === 1 ? ['-'] : ['shared', 'split']) for (const ctl of [false, true]) {
  const cross = hot === 'shared' ? 0.34 : hot === 'split' ? 0.085 : 0;
  const out = { agents, lanes, hot, ctl, cross };
  for (const [k, o] of [['h2', { hours: 2 }], ['h16', { hours: 16 }], ['h16big', { hours: 16, big: true }]]) {
    if (k === 'h16big' && lanes === 1) continue;
    const rs = [1, 2, 3].map((seed) => run({ agents, lanes, cross, ctl, seed, ...o }));
    const m = (f) => rs.reduce((s, r) => s + r[f], 0) / rs.length;
    out[k] = { perH: Math.round(m('perH')), range: [Math.min(...rs.map((r) => r.perH)), Math.max(...rs.map((r) => r.perH))], coll: +m('coll').toFixed(2), awake: +m('awake').toFixed(2), coordQueue: Math.round(m('cq')), usd: +m('usd').toFixed(2) };
  }
  console.log(JSON.stringify(out));
}
