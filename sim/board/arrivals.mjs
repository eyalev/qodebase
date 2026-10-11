#!/usr/bin/env node
// W9a (docs/board/TASKS.md, sim.md (h)): tasks arrive during the run (Poisson), some of them reworded duplicates
// of work already landed or in progress. none (A) / board + upfront dedupe only (E) / board + per-arrival dedupe.
// Zero tokens.   node sim/board/arrivals.mjs [seeds]
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { run } from './calls.mjs';
import { S3CAL } from './probe.mjs';

// ~10 agents (W9b): 30 tasks at the start (5 far-worded pairs, as s2), then n more over overS, dupShare of them
// rewording something already landed or being built.
export const W9 = { ...S3CAL, agents: 10, tasks: 30, dupPairs: 5, needs: 6, farPairs: 5 };
const seeds = +process.argv[2] || 200;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const rows = [];
const conds = [['none (no board)', 'A', {}], ['board + upfront dedupe', 'E', {}], ['board + per-arrival dedupe', 'E', { perArrivalDedupe: true }]];
for (const [lbl, arrive] of [['30 arrive over 10 min, 30% reworded dups', { n: 30, overS: 600, dupShare: 0.3 }], ['30 over 10 min, 50% dups', { n: 30, overS: 600, dupShare: 0.5 }], ['60 over 20 min, 30% dups', { n: 60, overS: 1200, dupShare: 0.3 }]]) {
  console.log(`-- ${lbl}`);
  for (const [name, cond, extra] of conds) {
    const rs = []; for (let s = 1; s <= seeds; s++) rs.push(run(cond, s, { ...W9, arrive, ...extra }));
    const med = (k) => q(rs.map((r) => r[k] || 0), 0.5), lo = (k) => q(rs.map((r) => r[k] || 0), 0.1), hi = (k) => q(rs.map((r) => r[k] || 0), 0.9);
    const row = { scenario: lbl, name, wallS: med('wallS'), agentMin: Math.round(med('agentS') / 60), wastedMin: Math.round(med('wastedS') / 60), dupArrivals: med('dupArrivals'), builtTwice: med('dupBuiltTwice'), builtTwiceRange: [lo('dupBuiltTwice'), hi('dupBuiltTwice')], closedAsDup: med('closedAsDup'), aliases: med('aliases'), wasted: med('wasted'), unfinished: rs.filter((r) => r.unitsLeft).length };
    rows.push(row);
    console.log(name.padEnd(28), `wall ${row.wallS} [${lo('wallS')}-${hi('wallS')}]`, `agent-min ${row.agentMin}`, `wasted-min ${row.wastedMin}`, `dup arrivals ${row.dupArrivals}`, `built twice ${row.builtTwice} [${row.builtTwiceRange.join('-')}]`, `closed ${row.closedAsDup}`, `aliases ${row.aliases}`, row.unfinished ? `unfinished ${row.unfinished}` : '');
  }
}
appendFileSync(homedir() + '/.local/share/qbsim-bench/board.jsonl', JSON.stringify({ ts: new Date().toISOString(), event: 'arrivals_w9', seeds, rows }) + '\n');
