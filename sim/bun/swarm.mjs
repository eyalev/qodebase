#!/usr/bin/env node
// BUN2: re-run the COORDINATION of Bun's Zig->Rust port (oven-sh/bun#30412) at 64 / 640 / 6,400 agents.
// Work mocked, structure real: the real files, one task per real commit (sim/bun/tasks.json: phase, files), the
// phase gates (a | b | c+d | e | tail: the next group opens when every task of the last one has landed and a full
// check passed), agent work times calibrated so Bun's own method at 64 agents takes as long as the real phases
// d (9.7 h) and e (4.9 h). Four methods:
//   bun    one shared tree: an agent owns the files it edits (line ranges of the hot files: Bun's subjects say
//          "fix Blob.rs [3200,4000)"), commits straight onto the branch (a commit lock, one at a time), no tests
//          per commit
//   queue  a fork per agent, one merge queue: trains of up to 16 tested by a full check
//   lanes  a queue per crate (src/<crate>), tested by that crate's check; changes spanning crates go through a
//          coordinated lane (holds the lanes it touches, full check); a throughput controller per lane
//   split  lanes + Bun's hottest files (top 1% by commits) split into 8 parts, so edits to different parts do
//          not collide
// Conflicts: a file changed on main since the agent's base conflicts with p 0.16 (git merged 84% of such files by
// itself in Bun's real merges, calibration.json merge_replay); a conflicted change is reworked (0.3 x its work)
// and queued again. Breaks: p 0.01 per change; a check catches 90% (back to fix), the rest turn the lane red.
//   node sim/bun/swarm.mjs --one 'method=bun,agents=64'      one cell
//   node sim/bun/swarm.mjs --calibrate                        Bun's method at 64 vs the real phase times
//   node sim/bun/swarm.mjs --sweep [--out sim/bun/out/sweep.jsonl]
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'));
export const GROUPS = [['a'], ['b'], ['c', 'd'], ['e'], ['tail']];
export const DEFAULTS = {
  workMedS: 400, workSigma: 0.6, perFileLog: 0.3, // a task's work: median x (1 + 0.3 ln files), lognormal
  gateS: 900, // full check between phase groups (Bun: ~50 min from d's last commit to e's first, a slow tail included)
  commitS: 2, // bun: one commit at a time on the shared branch
  batch: 16, mergeS: 5, fullTestS: 300, laneTestS: 120, // a full cargo check ~5 min, one crate ~2 min
  pConflict: 0.16, reworkF: 0.3, pBreak: 0.01, pCatch: 0.9, fixF: 0.35, fixMainS: 600,
  // Line ranges: a file edited by many tasks is a big file that agents split by line ranges (Bun's "Blob.rs
  // [3200,4000)"): ceil(touches / touchesPerRange) parts, at most 16. Fitted so Bun's method at 64 agents takes the
  // real d and e times (--calibrate). bun: every file; split: the hottest 1% only; queue/lanes: whole files.
  touchesPerRange: 10, maxRanges: 16, hotShare: 0.01, massFiles: 50,
  // 'chain': within a phase, a task waits for the last earlier task that edited the same file part to be PUSHED
  // (stacked on it; for bun, committed). 'none': only the gates order work.
  dep: 'none',
  ctl: { start: 8, step: 2, grow: 0.5, min: 1, tickS: 30, evalS: 900, windowS: 900, eff: 0.1, holdS: 900, fall: 0.25 },
  hours: 2000,
};

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

export function run(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts, ctl: { ...DEFAULTS.ctl, ...(opts.ctl || {}) } };
  const { method, agents } = cfg;
  const rnd = mulberry32(cfg.seed || 1);
  const logn = (med, sig) => med * Math.exp(sig * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()));
  const R = cfg.maxRanges, files = DATA.files;
  // hot files: top 1% by commits touching them
  const touches = new Int32Array(files.length);
  for (const t of DATA.tasks) for (const f of t.f) touches[f]++;
  // (hot = top 1% of files by commits, as calibration.json)
  const hot = new Uint8Array(files.length);
  [...touches.keys()].sort((a, b) => touches[b] - touches[a]).slice(0, Math.ceil(files.length * cfg.hotShare)).forEach((f) => (hot[f] = 1));
  const crates = new Map(); const crateOf = new Int32Array(files.length);
  // Areas: crates (src/<crate>); method 'fine' also splits src/runtime (57% of commits) by module (src/runtime/<m>).
  files.forEach((p, i) => { const s = p.split('/'); const c = (method === 'fine' && s[0] === 'src' && s[1] === 'runtime' && s.length > 3 ? s.slice(0, 3) : s.slice(0, 2)).join('/'); if (!crates.has(c)) crates.set(c, crates.size); crateOf[i] = crates.get(c); });
  const parts = new Int32Array(files.length).fill(1);
  for (let f = 0; f < files.length; f++) {
    if (method === 'bun' || ((method === 'split' || method === 'fine') && hot[f])) parts[f] = Math.min(R, Math.max(1, Math.ceil(touches[f] / cfg.touchesPerRange)));
  }
  // A task's keys: file x part (its edit falls in one of the file's parts).
  const T = DATA.tasks.map((t, id) => {
    const keys = t.f.map((f) => f * R + (parts[f] > 1 ? hash(t.sha + f) % parts[f] : 0));
    const lanes = [...new Set(t.f.map((f) => crateOf[f]))];
    return { id, g: cfg.noGates ? 0 : GROUPS.findIndex((g) => g.includes(t.phase)), keys, nF: t.f.length, lanes, deps: 0, next: [], state: 'blocked',
      workS: logn(cfg.workMedS * (1 + cfg.perFileLog * Math.log(Math.max(1, t.f.length))), cfg.workSigma), base: null };
  });
  // within-phase chains on file regions (mass edits neither wait nor are waited for)
  if (cfg.dep === 'chain') {
    const last = new Map();
    for (const t of T) {
      if (t.nF > cfg.massFiles) continue;
      const seen = new Set();
      for (const k of t.keys) { const p = last.get(t.g + ':' + k); if (p !== undefined && !seen.has(p)) { seen.add(p); T[p].next.push(t.id); t.deps++; } last.set(t.g + ':' + k, t.id); }
    }
  }
  const groupLeft = GROUPS.map((_, g) => T.filter((t) => t.g === g).length);
  let gOpen = 0;

  // events
  const heap = []; let seq = 0, t = 0;
  const less = (a, b) => a.t < b.t || (a.t === b.t && a.s < b.s);
  const at = (dt, fn) => { const e = { t: t + dt, s: seq++, fn }; heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p])) { [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } else break; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };

  const m = { landed: 0, busyS: 0, reworkS: 0, collisions: 0, reworks: 0, breaks: 0, caught: 0, claimSkips: 0, gateS: 0, groupEnd: [], groupOpen: [0], trains: 0, coordTrains: 0 };
  const ver = new Int32Array(files.length * R);
  const owner = new Int32Array(files.length * R).fill(-1); // bun: who owns a region
  let ready = []; // task ids, real order
  const idle = []; // free agents
  let parkedS = 0, parked = 0, lastT = 0;

  // lanes (lanes/split): one unit per crate + the coordinated lane
  const useLanes = method === 'lanes' || method === 'split' || method === 'fine';
  const C = cfg.ctl;
  const mkUnit = (id) => ({ id, q: [], busy: false, locked: false, red: -1, inflight: 0, cap: useLanes && cfg.ctlOn !== false ? C.start : Infinity, landT: [], state: 'warm', since: 0, ref: 0, lastStep: 0 });
  const units = useLanes ? [...crates.keys()].map((_, i) => mkUnit(i)) : [mkUnit(0)];
  const coord = useLanes ? mkUnit(-1) : null;
  if (coord) { coord.wants = new Set(); coord.busyN = 0; }
  const unitOf = (task) => (!useLanes ? units[0] : task.lanes.length > 1 ? coord : units[task.lanes[0] ?? 0]);
  let commitBusy = false; const commitQ = [];

  function release(g) { for (const x of T) if (x.g === g && x.deps === 0 && x.state === 'blocked') { x.state = 'ready'; ready.push(x.id); } ready.sort((a, b) => a - b); }
  function landedTask(task) {
    task.state = 'landed'; m.landed++;
    releaseNext(task);
    if (--groupLeft[task.g] === 0 && task.g === gOpen) {
      m.groupEnd.push(t);
      at(cfg.gateS, () => { m.gateS += cfg.gateS; openNext(); });
    }
  }
  function openNext() {
    while (gOpen < GROUPS.length - 1) { gOpen++; m.groupOpen.push(t); release(gOpen); if (groupLeft[gOpen] > 0) break; m.groupEnd.push(t); }
    dispatch();
  }
  function releaseNext(task) {
    if (task.released) return; task.released = true;
    for (const n of task.next) { const x = T[n]; if (--x.deps === 0 && x.g <= gOpen && x.state === 'blocked') { x.state = 'ready'; insertReady(x.id); } }
    dispatch();
  }
  function insertReady(id) { let lo = 0, hi = ready.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ready[mid] < id) lo = mid + 1; else hi = mid; } ready.splice(lo, 0, id); }

  // an idle agent takes the first ready task it may take
  function acceptable(task) {
    if (method === 'bun') return task.keys.every((k) => owner[k] === -1);
    const u = unitOf(task); return u.inflight < u.cap;
  }
  function dispatch() {
    while (idle.length && ready.length) {
      let pick = -1;
      for (let i = 0; i < ready.length && i < 4000; i++) { if (acceptable(T[ready[i]])) { pick = i; break; } m.claimSkips++; }
      if (pick < 0) break;
      const task = T[ready.splice(pick, 1)[0]];
      const a = idle.pop();
      start(task, a);
    }
  }
  function start(task, a) {
    task.state = 'work'; task.agent = a;
    if (method === 'bun') for (const k of task.keys) owner[k] = task.id;
    else { unitOf(task).inflight++; task.base = Int32Array.from(task.keys, (k) => ver[k]); }
    work(task, task.workS, false);
  }
  function work(task, d, rework) {
    m.busyS += d; if (rework) m.reworkS += d;
    at(d, () => { if (method === 'bun') commitBun(task); else { releaseNext(task); toQueue(task); } });
  }
  // ---- bun: the shared branch ----
  function commitBun(task) { commitQ.push(task); pumpCommit(); }
  function pumpCommit() {
    if (commitBusy || !commitQ.length) return;
    const task = commitQ.shift(); commitBusy = true;
    at(logn(cfg.commitS, 0.5), () => {
      commitBusy = false;
      for (const k of task.keys) { ver[k]++; owner[k] = -1; }
      if (rnd() < cfg.pBreak) { m.breaks++; m.busyS += cfg.fixMainS; at(cfg.fixMainS, () => finish(task)); } // the agent fixes what it broke
      else finish(task);
      pumpCommit();
    });
  }
  function finish(task) { const a = task.agent; landedTask(task); idle.push(a); dispatch(); }
  // ---- queue / lanes ----
  function toQueue(task) {
    const u = unitOf(task);
    u.q.push(task);
    if (u === coord) pumpCoord(); else pumpLane(u);
  }
  const testOf = (u) => (u === coord || !useLanes ? cfg.fullTestS : cfg.laneTestS);
  function pumpLane(u) {
    if (u.busy || u.locked || !u.q.length || u.red > t || (coord && coord.wants.has(u.id))) return;
    const batch = u.q.splice(0, cfg.batch); u.busy = true; m.trains++;
    at(cfg.mergeS + testOf(u), () => { u.busy = false; landBatch(batch, [u]); if (coord) pumpCoord(); pumpLane(u); });
  }
  const laneFree = (l) => { const u = units[l]; return !u.busy && !u.locked && u.red <= t; };
  function pumpCoord() {
    coord.wants = new Set();
    if (coord.busyN || !coord.q.length) return;
    const batch = coord.q.slice(0, cfg.batch), ls = [...new Set(batch.flatMap((x) => x.lanes))];
    coord.wants = new Set(ls);
    if (!ls.every(laneFree)) return;
    coord.q.splice(0, batch.length); coord.busyN++; m.coordTrains++;
    for (const l of ls) units[l].locked = true;
    at(cfg.mergeS + cfg.fullTestS, () => {
      coord.busyN--; for (const l of ls) units[l].locked = false;
      landBatch(batch, ls.map((l) => units[l]), coord);
      pumpCoord(); for (const l of ls) pumpLane(units[l]);
    });
  }
  function landBatch(batch, lanesHit, viaUnit) {
    for (const task of batch) {
      let conflict = false;
      task.keys.forEach((k, i) => { if (ver[k] !== task.base[i] && rnd() < cfg.pConflict) conflict = true; });
      if (conflict) {
        m.collisions++; m.reworks++;
        task.base = Int32Array.from(task.keys, (k) => ver[k]);
        work(task, task.workS * cfg.reworkF, true); continue;
      }
      if (rnd() < cfg.pBreak) {
        m.breaks++;
        if (rnd() < cfg.pCatch) { m.caught++; work(task, task.workS * cfg.fixF, true); continue; }
        for (const u of lanesHit) u.red = Math.max(u.red, t) + cfg.fixMainS;
        for (const u of lanesHit) at(u.red - t + 0.01, () => { if (coord) pumpCoord(); pumpLane(u); });
      }
      for (const k of task.keys) ver[k]++;
      const u = viaUnit || unitOf(task); u.inflight--; u.landT.push(t);
      finish(task);
    }
  }
  // ---- the per-lane controller (lanes/split): W8's probe on each unit's landings ----
  function ctlTick() {
    for (const u of [...units, coord]) {
      while (u.landT.length && u.landT[0] <= t - C.windowS) u.landT.shift();
      const now = (u.landT.length * 60) / C.windowS, st = Math.max(C.step, Math.round(u.cap * C.grow)), before = u.cap;
      if (u.state === 'warm' && t - u.since >= C.evalS) { u.ref = now; u.cap += st; u.state = 'eval'; u.since = t; u.lastStep = st; }
      else if (u.state === 'eval' && t - u.since >= C.evalS) {
        if (now >= u.ref * (1 + (C.eff * u.lastStep) / Math.max(1, u.cap - u.lastStep))) { u.ref = now; u.cap += st; u.since = t; u.lastStep = st; }
        else { u.cap = Math.max(C.min, u.cap - u.lastStep); u.state = 'hold'; u.since = t; u.ref = now; }
      } else if (u.state === 'hold') {
        if (u.ref > 0 && now < u.ref * (1 - C.fall)) { u.cap = Math.max(C.min, u.cap - 1); u.ref = now; u.since = t; }
        else if (t - u.since >= C.holdS) { u.ref = now; u.cap += st; u.state = 'eval'; u.since = t; u.lastStep = st; }
      }
      u.cap = Math.min(u.cap, agents);
      if (u.cap > before) dispatch();
    }
    if (m.landed < T.length) at(C.tickS, ctlTick);
  }

  for (let a = 0; a < agents; a++) idle.push(a);
  release(0); if (groupLeft[0] === 0) openNext();
  if (useLanes && cfg.ctlOn !== false) at(C.tickS, ctlTick);
  dispatch();
  const tEnd = cfg.hours * 3600;
  let busyAgentsS = 0;
  while (heap.length && m.landed < T.length) {
    const e = pop(); if (e.t > tEnd) break;
    busyAgentsS += (agents - idle.length) * (e.t - t);
    t = e.t; e.fn();
  }
  const hours = t / 3600;
  return {
    method, agents, dep: cfg.dep, gates: !cfg.noGates, ctl: useLanes ? cfg.ctlOn !== false : null, seed: cfg.seed || 1,
    finishedH: +hours.toFixed(2), done: m.landed === T.length, landed: m.landed,
    agentHours: +(m.busyS / 3600).toFixed(1), reworkH: +(m.reworkS / 3600).toFixed(1),
    idleShare: +(1 - m.busyS / Math.max(1, agents * t)).toFixed(3),
    collisions: m.collisions, breaks: m.breaks, caught: m.caught,
    gateH: +(m.gateS / 3600).toFixed(2),
    phaseH: Object.fromEntries(GROUPS.map((g, i) => [g.join('+'), m.groupEnd[i] != null ? +((m.groupEnd[i] - m.groupOpen[i]) / 3600).toFixed(2) : null])),
    trains: m.trains, coordTrains: m.coordTrains,
  };
}

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
if (args.one) {
  const o = Object.fromEntries(String(args.one).split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, isNaN(+v) ? v : +v]));
  const t0 = performance.now(); console.log({ ...run(o), ms: Math.round(performance.now() - t0) });
}

// Bun's real phase times (calibration.json, bulk 5-95% of commit times): d 9.7 h, e 4.9 h, with ~64 agents.
if (args.calibrate) {
  for (const tpr of [5, 10, 25, 50]) for (const w of [300, 450, 600]) {
    const rs = [1, 2, 3].map((seed) => run({ method: 'bun', agents: 64, touchesPerRange: tpr, workMedS: w, seed }));
    const mean = (f) => (rs.reduce((s, r) => s + f(r), 0) / rs.length).toFixed(1);
    console.log(`touchesPerRange ${tpr} workMedS ${w}: c+d ${mean((r) => r.phaseH['c+d'])} h (real d 9.7), e ${mean((r) => r.phaseH.e)} h (real 4.9), b ${mean((r) => r.phaseH.b)} h (real 26), idle ${mean((r) => r.idleShare * 100)}%`);
  }
}

// The sweep: every method at 64 / 640 / 6,400 agents (3 seeds), the controller off as well for lane methods,
// unlimited agents (64,000) and no gates (how much the gates cap), and the rejected chain model for the record.
if (args.sweep) {
  const out = args.out || join(HERE, 'sweep.jsonl');
  mkdirSync(dirname(out), { recursive: true });
  const cells = [];
  for (const method of ['bun', 'queue', 'lanes', 'split', 'fine']) {
    for (const agents of [64, 640, 6400]) for (const seed of [1, 2, 3]) {
      cells.push({ method, agents, seed });
      if (method !== 'bun' && method !== 'queue') cells.push({ method, agents, seed, ctlOn: false });
      cells.push({ method, agents, seed, noGates: true });
    }
    cells.push({ method, agents: 64000, seed: 1 }, { method, agents: 64000, seed: 1, noGates: true });
    for (const agents of [64, 640, 6400]) cells.push({ method, agents, seed: 1, dep: 'chain' });
  }
  const t0 = Date.now();
  for (const c of cells) appendFileSync(out, JSON.stringify({ ...run(c), ctlOn: c.ctlOn !== false }) + '\n');
  console.log(`${cells.length} cells in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${out}`);
}
