#!/usr/bin/env node
// Code collision dial: prediction before qb6's runs (sim.md (m)). Monte Carlo over the real task orders
// (sim/kata/seed-N/kata-tasks-dialD.json): A agents take tasks in order; a task takes T (lognormal); a finished task
// lands at the Lander's next round (every R s) plus a push. A task is STALE when another task on the same function
// landed after it read main: its change no longer applies to the file and must be replayed (redone on the new main,
// another T), and a replayed task can go stale again. A replay can drop a requirement with probability pLost.
//   node sim/kata/predict.mjs [--seed 1] [--agents 100] [--t 15] [--round 5] [--push 3] [--pLost 0.03] [--runs 20]
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SEED = arg('seed', '1'), RUNS = +arg('runs', 20);
const rng = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const lognorm = (r, med, sig) => { const u = Math.max(1e-9, r()), v = r(); return med * Math.exp(sig * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); };

function once(list, P, seed) {
  const r = rng(seed);
  const lastLand = new Map();          // fn -> time of its last landing
  let t = 0, i = 0, lost = 0, stale = 0, replays = 0, staleClustered = 0;
  const free = Array.from({ length: P.agents }, () => 0);   // when each agent is free
  const lands = [];
  // Event loop over agents: the earliest free agent takes the next task.
  const queue = [];   // tasks waiting for landing: {task, readAt, doneAt, tries}
  const work = (task, start, tries) => {
    const readAt = start, doneAt = start + lognorm(r, P.t, 0.5);
    const landAt = Math.ceil(doneAt / P.round) * P.round + P.push;
    return { task, readAt, doneAt, landAt, tries };
  };
  const pending = [];
  while (i < list.length || pending.length) {
    // Next event: an agent takes a task, or the earliest pending landing.
    const a = free.indexOf(Math.min(...free));
    const nextLand = pending.length ? pending.reduce((m, p) => (p.landAt < m.landAt ? p : m)) : null;
    if (i < list.length && (!nextLand || free[a] <= nextLand.landAt)) {
      const w = work(list[i++], free[a], 0); w.agent = a; free[a] = w.doneAt; pending.push(w); continue;
    }
    // Land (or find stale) the earliest finished task.
    pending.splice(pending.indexOf(nextLand), 1);
    const p = nextLand, f = p.task.fn;
    if ((lastLand.get(f) ?? -1) > p.readAt) {
      // Stale: replay on the new main (the same agent, at landing time), up to 3 tries.
      stale++; if (p.task.group) staleClustered++;
      if (p.tries < 3) { replays++; if (r() < P.pLost) lost++; const w = work(p.task, Math.max(p.landAt, free[p.agent]), p.tries + 1); w.agent = p.agent; free[p.agent] = w.doneAt; pending.push(w); continue; }
    }
    lastLand.set(f, p.landAt); lands.push(p.landAt); t = Math.max(t, p.landAt);
  }
  return { wallS: t, stale, staleClustered, replays, lost, landed: lands.length };
}

const P = { agents: +arg('agents', 100), t: +arg('t', 15), round: +arg('round', 5), push: +arg('push', 3), pLost: +arg('pLost', 0.03) };
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const rows = [];
for (const dial of [0, 30, 60]) {
  const f = path.join(HERE, `seed-${SEED}`, `kata-tasks-dial${dial}.json`);
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rs = Array.from({ length: RUNS }, (_, k) => once(d.list, P, 1000 + k));
  rows.push({ dial, tasks: d.list.length, clustered: d.clusteredTasks, staleTasks: med(rs.map((x) => x.stale)), staleInClusters: med(rs.map((x) => x.staleClustered)),
    replays: med(rs.map((x) => x.replays)), requirementLost: med(rs.map((x) => x.lost)), wallS: Math.round(med(rs.map((x) => x.wallS))) });
}
console.log(JSON.stringify({ params: P, runs: RUNS, rows }, null, 1));
