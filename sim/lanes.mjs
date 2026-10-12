#!/usr/bin/env node
// L1 (docs/board/TASKS.md 'Lanes', docs/board/sim.md (i)): one landing queue vs N lanes, agents 10..10,000,
// cross-area share, a throughput controller per lane. Fast sim (public/sim/engine.js), zero tokens.
//   node sim/lanes.mjs --one 'lanes=16,agents=1000,cross=0.05,ctl=1'     one cell, printed
//   node sim/lanes.mjs --grid [--seeds 3] [--hours 4] [--out sim/lanes/grid.jsonl]
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSim } from '../public/sim/engine.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
const HOURS = Number(args.hours || 16);
// A big monorepo (20,000 files, 500 areas of 40 files), qodebase's landing: reviews, trains of 16 tested together,
// land by intent (replays), area leads. 16 simulated hours, measured over the last 8: cross-area cells keep
// falling for hours while agents pile up in the coordinated queue (4 h overstated them up to 2x).
// Coordinated lane: trains of up to 16 cross changes, over as many lanes as they touch (coordBatch 4 over at most
// 8 lanes, the engine default, is the 'small' sensitivity: its queue never drains).
// No file claims (qodebase's Landing has none: a conflict is replayed) and no risky changes for people to approve:
// two people approve ~80 an hour, a ceiling of its own (claims=1 and risky=0.05 show both).
export function cell({ lanes, agents, cross = 0, ctl = false, coord = 'one', zipf = 1.0, claims = 0, risky = 0, pick = 0, coordBatch = 16, coordMaxLanes = 256, seed = 1, hours = HOURS }) {
  const sim = createSim({ seed, policy: 'intents', policyOverride: claims ? null : { claims: 'none', pickFree: 0 }, pRisky: risky,
    repos: 1, agentsPerRepo: agents, files: 20000,
    lanes: lanes > 1 ? lanes : (ctl ? 1 : 0), crossShare: cross, laneCtl: ctl, ctlPick: !!pick, coord, coordBatch, coordMaxLanes, moduleZipf: zipf });
  sim.runUntil((hours / 2) * 3600);
  const a = { ...sim.metrics };
  sim.runUntil(hours * 3600);
  const s = sim.snapshot({ files: false }), b = s.metrics, h = hours / 2;
  const landed = b.merged - a.merged, think = (b.workS - a.workS) + (b.reworkS - a.reworkS);
  return { lanes, agents, cross, ctl, pick, coord, coordBatch, coordMaxLanes, zipf, claims, risky, seed, hours,
    landedPerH: Math.round(landed / h),
    collisionsPerLanded: landed ? +((b.conflicts - a.conflicts) / landed).toFixed(3) : null,
    wasted: think ? +(((b.discardedS - a.discardedS) + (b.reworkS - a.reworkS)) / think).toFixed(3) : 0,
    red: +(s.lanes ? s.lanes.red : s.redShare).toFixed(4), breaks: b.breaks - a.breaks,
    usdPerLanded: landed ? +((b.cost - a.cost) / landed).toFixed(2) : null,
    p50S: s.p50 && Math.round(s.p50),
    awake: s.lanes ? +s.lanes.awakeShare.toFixed(3) : 1,
    queued: s.mergeWait + (s.lanes ? s.lanes.coordQueue : 0), coordQueue: s.lanes?.coordQueue ?? 0,
    capSum: s.lanes?.caps ? s.lanes.caps.reduce((x, y) => x + y, 0) : null,
    where: Object.fromEntries(s.groups.filter(([, n]) => n).map(([k, n]) => [k, n])) };
}

if (args.one) {
  const o = Object.fromEntries(String(args.one).split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, k === 'coord' ? v : Number(v)]));
  const t0 = performance.now();
  console.log({ ...cell({ ...o, ctl: !!o.ctl }), ms: Math.round(performance.now() - t0) });
}

// ---- the grid: one child process per core, one JSON line per cell ----
export function gridCells(seeds = 2) {
  const cells = [];
  const add = (c) => { for (let seed = 1; seed <= seeds; seed++) cells.push({ ...c, seed }); };
  for (const zipf of [1.0, 0.5]) for (const lanes of [1, 4, 16, 64, 256]) for (const agents of [10, 30, 100, 300, 1000, 3000, 10000])
    for (const cross of lanes === 1 ? [0] : [0, 0.05, 0.2]) for (const ctl of [false, true]) add({ lanes, agents, cross, ctl, zipf });
  // sensitivities
  for (const lanes of [16, 64, 256]) for (const agents of [1000, 3000, 10000]) for (const cross of [0.05, 0.2]) {
    add({ lanes, agents, cross, coord: 'locks' }); add({ lanes, agents, cross, coordBatch: 4, coordMaxLanes: 8 }); }
  for (const lanes of [16, 256]) for (const agents of [1000, 10000]) add({ lanes, agents, cross: 0.05, ctl: true, pick: 1 });
  for (const lanes of [1, 16, 256]) for (const agents of [1000, 10000]) { add({ lanes, agents, cross: 0.05, claims: 1 }); add({ lanes, agents, cross: 0.05, risky: 0.05 }); }
  return cells;
}
if (args.grid) {
  const { fork } = await import('node:child_process');
  const { availableParallelism } = await import('node:os');
  const out = args.out || 'sim/lanes/grid.jsonl';
  mkdirSync(dirname(out), { recursive: true });
  const todo = gridCells(Number(args.seeds || 2)).sort((a, b) => b.agents * Math.max(1, b.lanes) - a.agents * Math.max(1, a.lanes));
  const n = Math.min(Number(args.jobs || availableParallelism()), todo.length);
  let done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: n }, () => new Promise((res) => {
    const w = fork(new URL(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const next = () => { const c = todo.shift(); if (!c) { w.kill(); return res(); } w.send(c); };
    w.on('message', (r) => { appendFileSync(out, JSON.stringify(r) + '\n'); if (++done % 50 === 0) console.log(`${done} cells, ${Math.round((Date.now() - t0) / 1000)} s`); next(); });
    next();
  })));
  console.log(`done: ${done} cells in ${Math.round((Date.now() - t0) / 1000)} s -> ${out}`);
}
if (args.worker) process.on('message', (c) => { const t0 = performance.now(); process.send({ ...cell(c), ms: Math.round(performance.now() - t0) }); });
