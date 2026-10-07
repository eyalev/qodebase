#!/usr/bin/env node
// qodebase sim from a terminal.
//   node sim/cli.mjs --preset k1 --hours 2            compare every policy
//   node sim/cli.mjs --preset today --policy classic   one policy
//   --agents N --repos N --files N --seed N --out runs.jsonl (one JSON line per run)
import { appendFileSync } from 'node:fs';
import { POLICIES, PRESETS, runHeadless } from '../public/sim/engine.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const preset = PRESETS[args.preset || 'today'];
if (!preset) { console.error(`presets: ${Object.keys(PRESETS).join(', ')}`); process.exit(2); }
const hours = Number(args.hours || 2);
const base = {
  seed: Number(args.seed || 1),
  repos: Number(args.repos || preset.repos),
  agentsPerRepo: Number(args.agents || preset.agentsPerRepo),
  files: Number(args.files || preset.files),
};
const policies = args.policy ? [args.policy] : Object.keys(POLICIES);

const fmtS = (s) => (s == null ? '-' : s < 90 ? `${s.toFixed(0)} s` : s < 5400 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(1)} h`);
const rows = [];
for (const policy of policies) {
  const t0 = performance.now();
  const { snapshot: s } = runHeadless({ ...base, policy }, hours);
  const ms = performance.now() - t0;
  const m = s.metrics;
  const thinking = m.workS + m.reworkS;
  const row = {
    ts: new Date().toISOString(), event: 'sim_run', policy, ...base, hours,
    agents: s.totalAgents, merged: m.merged, mergedPerHour: Math.round(m.merged / hours),
    conflicts: m.conflicts, autoMerged: m.autoMerged, rebases: m.rebases, redos: m.redos, breaks: m.breaks,
    reworkShare: thinking ? +(m.reworkS / thinking).toFixed(3) : 0,
    p50S: s.p50 && Math.round(s.p50), p90S: s.p90 && Math.round(s.p90),
    waiting: Object.fromEntries(s.groups), mergeQueue: s.mergeWait,
    redShare: +s.redShare.toFixed(3),
    cost: Math.round(m.cost), costPerChange: m.merged ? +(m.cost / m.merged).toFixed(2) : null,
    events: s.events, wallMs: Math.round(ms),
  };
  rows.push(row);
  if (args.out) appendFileSync(args.out, JSON.stringify(row) + '\n');
}

console.log(`${preset.label}${args.agents ? ` (agents ${base.agentsPerRepo}/repo)` : ''}, ${hours} simulated h, seed ${base.seed}\n`);
const cols = [
  ['policy', (r) => POLICIES[r.policy].label],
  ['merged/h', (r) => r.mergedPerHour.toLocaleString()],
  ['p50 ask→merged', (r) => fmtS(r.p50S)],
  ['p90', (r) => fmtS(r.p90S)],
  ['conflicts', (r) => r.conflicts.toLocaleString()],
  ['rework', (r) => `${(r.reworkShare * 100).toFixed(0)}%`],
  ['queue now', (r) => r.mergeQueue.toLocaleString()],
  ['waiting review', (r) => (r.waiting['waiting for review'] || 0).toLocaleString()],
  ['waiting claim', (r) => (r.waiting['waiting for a claim'] || 0).toLocaleString()],
  ['main red', (r) => `${(r.redShare * 100).toFixed(1)}%`],
  ['$/change', (r) => (r.costPerChange == null ? '-' : `$${r.costPerChange}`)],
  ['sim time', (r) => `${(r.wallMs / 1000).toFixed(1)} s`],
];
const table = [cols.map((c) => c[0]), ...rows.map((r) => cols.map((c) => String(c[1](r))))];
const w = cols.map((_, i) => Math.max(...table.map((row) => row[i].length)));
for (const row of table) console.log(row.map((c, i) => c.padEnd(w[i])).join('  '));
