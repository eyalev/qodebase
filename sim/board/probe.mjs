#!/usr/bin/env node
// W8a (docs/board/TASKS.md, sim.md (g)): a throughput-probing controller (BBR-like) vs fixed team sizes,
// on qb9's s3 profile with a long backlog, recalibrated on the real s3 runs (E6-results.md). Zero tokens.
//   node sim/board/probe.mjs [seeds]
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { cell, run } from './calls.mjs';

// s3 recalibrated (E6: A20 594 s / 170 agent-min, E20 451 / 131, E8 544 / 70): one laptop runs every agent, so a
// call slows 4% per other agent building (slowPerAgent), and a rebase costs 0.5 s more per commit landed since
// its base; work x1.1 E4's. Sim: A20 551 / 152, E20 447 / 124, E8 580 / 71.
export const S3CAL = { tasks: 60, dupPairs: 10, needs: 12, farPairs: 10, farRecognition: 0.1, staggerS: 1, workMedS: 26 * 1.1, slowPerAgent: 0.04, rebasePerCommitS: 0.5 };
// The long backlog: 2.5x s3 (150 tasks, 25 far-worded pairs, 30 needs).
export const LONG = { ...S3CAL, tasks: 150, dupPairs: 25, needs: 30, farPairs: 25 };
export const PROBE = { start: 8, step: 2, min: 2, tickS: 30, evalS: 240, windowS: 240, eff: 0.2, holdS: 180, fall: 0.25, drop: 1 }; // tuned in the sim (sim.md (g))

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = +process.argv[2] || 100;
  const rows = [];
  const capMed = (cond, o) => { const xs = []; for (let s = 1; s <= seeds; s++) xs.push(run(cond, s, o).capMed); xs.sort((a, b) => a - b); return xs[xs.length >> 1]; };
  const show = (label, cond, o, extra = '') => {
    const c = cell(cond, seeds, o); const r = { label, cond, wallS: c.wallS.med, wallLo: c.wallS.lo, wallHi: c.wallS.hi, agentMin: Math.round(c.agentS.med / 60), wastedMin: Math.round(c.wastedS.med / 60), dups: c.dupBuiltTwice.med, rejected: c.rejected.med, cap: o.probe || o.aimd ? capMed(cond, o) : o.agents };
    rows.push(r); r.product = Math.round(r.wallS * r.agentMin / 1000); console.log(cond, label.padEnd(26), `wall ${r.wallS} [${r.wallLo}-${r.wallHi}]`, `agent-min ${r.agentMin}`, `wasted ${r.wastedMin}`, `dups ${r.dups}`, `rej ${r.rejected}`, `cap ${r.cap}`, `wall x agent-min ${r.product}k`, extra);
  };
  const which = process.argv[3] || 'all';
  for (const cond of 'AE') {
    if (which === 'all' || which === 'fixed') for (const n of [4, 6, 8, 12, 16, 20, 30, 40]) show(`fixed ${n}`, cond, { ...LONG, agents: n });
    if (which === 'all' || which === 'probe') for (const max of [20, 40]) show(`probe (pool ${max})`, cond, { ...LONG, agents: max, probe: PROBE });
  }
  appendFileSync(homedir() + '/.local/share/qbsim-bench/board.jsonl', JSON.stringify({ ts: new Date().toISOString(), event: 'probe_w8', seeds, rows }) + '\n');
}
