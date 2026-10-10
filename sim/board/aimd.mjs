#!/usr/bin/env node
// W7 (docs/board/PLAN2.md, sim.md (f)): congestion control for agents, AIMD on the board's live thrash
// (rejected pushes + 3 x dropped work per minute) vs a fixed 20, on qb9's s3 profile. Zero tokens.
//   node sim/board/aimd.mjs [seeds]
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { cell, run } from './calls.mjs';
const S3 = { agents: 20, tasks: 60, dupPairs: 10, needs: 12, workMedS: 26 * 1.6, farPairs: 10, farRecognition: 0.1, staggerS: 1 };
const rows = [];
const seeds = +process.argv[2] || 100;
const capMed = (cond, over) => { const xs = []; for (let s = 1; s <= seeds; s++) xs.push(run(cond, s, over).capMed); xs.sort((a, b) => a - b); return xs[xs.length >> 1]; };
const vs = [
  ['spec: +1/min', { start: 4, add: 1, lo: 1, hi: 3, min: 2 }],
  ['+1 per 20 s', { start: 4, add: 1, lo: 1, hi: 3, min: 2, tickS: 20 }],
  ['slow start, 30 s', { start: 4, add: 1, lo: 1, hi: 3, min: 2, tickS: 30, slowStart: true }],
  ['slow start, 30 s, hi 4', { start: 4, add: 1, lo: 1.5, hi: 4, min: 2, tickS: 30, slowStart: true }],
  ['slow start, 30 s, hi 6', { start: 4, add: 1, lo: 2, hi: 6, min: 4, tickS: 30, slowStart: true }],
];
for (const cond of 'ADE') {
  const f = cell(cond, seeds, S3);
  rows.push({ cond, v: 'fixed 20', wallS: f.wallS.med, agentMin: +(f.agentS.med / 60).toFixed(0), dups: f.dupBuiltTwice.med });
  console.log(cond, 'fixed 20', f.wallS.med, (f.agentS.med / 60).toFixed(0), f.dupBuiltTwice.med, f.rejected.med, f.wasted.med);
  for (const [l, a] of vs) { const o = { ...S3, aimd: a }; const c = cell(cond, seeds, o); console.log(cond, l, c.wallS.med, `[${c.wallS.lo}-${c.wallS.hi}]`, (c.agentS.med / 60).toFixed(0), c.dupBuiltTwice.med, c.rejected.med, c.wasted.med, 'cap', capMed(cond, o)); }
  for (const n of [4, 6, 8, 10, 14]) { const c = cell(cond, seeds, { ...S3, agents: n }); console.log(cond, `fixed ${n}`, c.wallS.med, (c.agentS.med / 60).toFixed(0), c.dupBuiltTwice.med, c.rejected.med, c.wasted.med); }
}
appendFileSync(homedir() + '/.local/share/qbsim-bench/board.jsonl', JSON.stringify({ ts: new Date().toISOString(), event: 'aimd_w7', seeds, rows }) + '\n');
