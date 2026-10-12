#!/usr/bin/env node
// Summary of sim/lanes/grid.jsonl (L1): seed means per cell; saturation = fewest agents reaching 90% of the most
// that setup ever lands. node sim/lanes-summary.mjs [grid.jsonl] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'sim/lanes/grid.jsonl';
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const key = (r) => JSON.stringify({ lanes: r.lanes, cross: r.cross, ctl: !!r.ctl, pick: r.pick || 0, coord: r.coord, small: r.coordBatch === 4 ? 1 : 0, zipf: r.zipf, claims: r.claims || 0, risky: r.risky || 0 });
const cells = new Map();
for (const r of rows) {
  const k = key(r) + '|' + r.agents;
  if (!cells.has(k)) cells.set(k, []);
  cells.get(k).push(r);
}
const mean = (xs, f) => xs.reduce((s, x) => s + (f(x) ?? 0), 0) / xs.length;
const agg = [...cells.entries()].map(([k, xs]) => ({ setup: JSON.parse(k.split('|')[0]), agents: +k.split('|')[1], n: xs.length,
  landedPerH: Math.round(mean(xs, (x) => x.landedPerH)), collisions: +mean(xs, (x) => x.collisionsPerLanded).toFixed(2),
  wasted: +mean(xs, (x) => x.wasted).toFixed(3), red: +mean(xs, (x) => x.red).toFixed(4), usd: +mean(xs, (x) => x.usdPerLanded).toFixed(2),
  p50Min: +(mean(xs, (x) => x.p50S) / 60).toFixed(1), awake: +mean(xs, (x) => x.awake).toFixed(2), coordQueue: Math.round(mean(xs, (x) => x.coordQueue)) }));
const setups = new Map();
for (const a of agg) { const k = JSON.stringify(a.setup); if (!setups.has(k)) setups.set(k, []); setups.get(k).push(a); }
const out = [];
for (const [k, xs] of setups) {
  xs.sort((a, b) => a.agents - b.agents);
  const max = Math.max(...xs.map((x) => x.landedPerH));
  const sat = xs.find((x) => x.landedPerH >= 0.9 * max);
  out.push({ setup: JSON.parse(k), maxPerH: max, saturatesAt: sat.agents, curve: xs });
}
if (process.argv.includes('--json')) writeFileSync(process.argv[process.argv.indexOf('--json') + 1], JSON.stringify(out, null, 1));
const f = (s) => `L${s.lanes} x${s.cross * 100}% ${s.ctl ? (s.pick ? 'ctl-pick' : 'ctl') : 'fixed'}${s.coord === 'locks' ? ' locks' : ''}${s.small ? ' small-x' : ''} z${s.zipf}${s.claims ? ' claims' : ''}${s.risky ? ' risky5%' : ''}`;
for (const o of out.sort((a, b) => JSON.stringify(a.setup).localeCompare(JSON.stringify(b.setup))))
  console.log(f(o.setup).padEnd(28), 'max', String(o.maxPerH).padStart(6), '/h at', String(o.saturatesAt).padStart(5), '|', o.curve.map((c) => `${c.agents}:${c.landedPerH}${o.setup.ctl ? `(${Math.round(c.awake * 100)}%)` : ''}`).join(' '));
