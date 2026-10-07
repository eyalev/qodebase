#!/usr/bin/env node
// Migration swarm: N agents carry out ONE big mechanical goal on a real repo (Hono: move
// src/utils/ to src/lib/, see migration.mjs), task by task, under four ways of working.
// Real files, real git (commits, `git merge-tree`), a real type check (tsgo, tests included)
// on every agent's own change and on main after every landing. Virtual clock; no model calls.
//
//   node sim/swarm/run.mjs --agents 10,100,1000 --policies ffa,phases,stack,intent
//
// Timing is calibrated on Bun's Zig->Rust port (sim/bun/calibration.json, qb5): ~3.3 commits
// per agent-hour at full speed (a task takes ~18 min), and its bulk phases ran on one shared
// tree with file ownership and a green check between phases.
// Writes public/sim/runs/swarm-<policy>-<agents>.json (run viewer) and one JSON line per run
// to ~/.local/share/qbsim-bench/swarm.jsonl (trace: swarm-trace.jsonl).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openRepo } from '../real/git.mjs';
import { lineDiff } from '../real/project.mjs';
import { buildMigration, SPEC_RE, resolveSpec } from './migration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, '../../public/sim/runs');
const OUT = join(HERE, 'out');
const LOG = join(homedir(), '.local/share/qbsim-bench'); mkdirSync(LOG, { recursive: true });
const TRACE = join(LOG, 'swarm-trace.jsonl');
const trace = (o) => appendFileSync(TRACE, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');

export const POLICIES = {
  ffa: {
    label: 'Free-for-all',
    about: 'Every agent takes any open task, works on a branch from the current main, checks its own change (type check) and lands it when it passes; a git conflict at landing means redo on the new main. A task whose prerequisites have not landed fails its own check: the agent gives it back and it is retried later.',
    pick: 'any', branch: true, ownCheck: true,
  },
  phases: {
    label: 'Phases with gates (Bun)',
    about: "Bun's way: one shared tree, each file owned by one agent (no branches, no merges). Phase 1 moves the modules, phase 2 points every importer at them, phase 3 deletes the shims; main may be red inside a phase, and the next phase starts only when the check is green.",
    pick: 'phase', branch: false, ownCheck: false,
  },
  stack: {
    label: 'Dependency map + stacking',
    about: 'Tasks declare what they need (from the import graph). An agent only takes a task whose needs are done, landed or not: it builds on the unlanded ones (a stack) and the queue lands it right after them. Git conflicts at landing: redo.',
    pick: 'ready', branch: true, ownCheck: true, stack: 'text',
  },
  intent: {
    label: 'Stacking + land by intent',
    about: 'As stacking, but the codemod is the intent: a stack is built by replaying the needed codemods (no text merges), and a git conflict at landing (the shared jsr.json) is resolved by re-running the codemod on the latest main and checking it, not by an agent redoing it.',
    pick: 'ready', branch: true, ownCheck: true, stack: 'replay', replayOnLand: true,
  },
};

const DEFAULTS = {
  workMedS: 18 * 60, // Bun: ~3.3 commits per agent-hour at full speed (calibration.json rate)
  workSigma: 0.5,
  lookFactor: 0.25, // an agent that finds nothing to do yet gives up after a quarter of a task
  redoFactor: 0.3, // redoing a codemod on a newer main
  backoffS: 300, // a task given back is retried after 5 min
  landS: 30, // merge queue: one landing (merge + push)
  sharedCommitS: 5, // shared tree (phases): a commit
  gateS: 300, // phase gate: full check + tests before the next phase
  maxAttempts: 40,
  maxHours: 48,
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the repo and the type check (shared by every run) ----
const SRC = (process.env.HONO || join(homedir(), 'projects/github/honojs/hono'));
const CONFIGS = ['package.json', 'tsconfig.base.json', 'tsconfig.build.json', 'tsconfig.spec.json'];
function seedFiles() {
  const dirty = execFileSync('git', ['-C', SRC, 'status', '--porcelain', '--', 'src', 'jsr.json', ...CONFIGS], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`${SRC} has local changes:\n${dirty}`);
  const list = execFileSync('git', ['-C', SRC, 'ls-files', 'src', 'jsr.json', ...CONFIGS], { encoding: 'utf8' }).trim().split('\n');
  const sha = execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { sha, files: new Map(list.map((p) => [p, readFileSync(join(SRC, p), 'utf8')])) };
}

function makeChecker(repo, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(SRC, 'node_modules'), join(dir, 'node_modules'));
  const mat = new Map(); // path -> blob sha on disk
  const cache = new Map(); // tree sha -> Set of error keys
  const stats = { checks: 0, scans: 0, cached: 0, ms: 0 };
  // Fast path: an import that does not resolve is what most failed attempts hit (lib/X not
  // moved yet, a shim deleted too early). Scanning every relative import takes milliseconds;
  // tsgo (0.3-1 s here) runs only when they all resolve. Keys use tsgo's own TS2307 wording.
  const specsOf = new Map(); // blob sha -> relative specifiers
  function unresolved(snap) {
    const out = new Set();
    for (const [p, sha] of snap) {
      if (!/\.tsx?$/.test(p)) continue;
      if (!specsOf.has(sha)) specsOf.set(sha, [...new Set([...repo.text(sha).matchAll(SPEC_RE)].map((m) => m[3]))]);
      for (const spec of specsOf.get(sha)) if (!resolveSpec(p, spec, (x) => snap.has(x)) && !/\.(json|css|svg)$/.test(spec)) out.add(`${p} TS2307 Cannot find module '${spec}' or its corresponding type declarations.`);
    }
    return out;
  }
  const baseUnresolved = { set: null };
  function errors(snap) {
    const tree = repo.tree(snap);
    if (cache.has(tree)) { stats.cached++; return cache.get(tree); }
    const t0 = performance.now();
    const un = unresolved(snap);
    if (!baseUnresolved.set) baseUnresolved.set = un; // the starting tree's own (vi.mock of virtual paths etc.)
    const extra = [...un].filter((k) => !baseUnresolved.set.has(k));
    if (extra.length) { const keys = new Set(extra); cache.set(tree, keys); stats.scans++; stats.ms += performance.now() - t0; return keys; }
    for (const [p, sha] of snap) {
      if (mat.get(p) === sha) continue;
      const f = join(dir, p); mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, repo.text(sha)); mat.set(p, sha);
    }
    for (const p of [...mat.keys()]) if (!snap.has(p)) { try { unlinkSync(join(dir, p)); } catch {} mat.delete(p); }
    const r = spawnSync(join(SRC, 'node_modules/.bin/tsgo'), ['-p', 'tsconfig.spec.json', '--noEmit', '--incremental', '--tsBuildInfoFile', join(dir, '.tsbuildinfo')], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 });
    // "src/x.ts(12,3): error TS2305: …" -> key without the position
    const keys = new Set((r.stdout + r.stderr).split('\n').map((l) => /^(\S+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(l)).filter(Boolean).map((m) => `${m[1]} ${m[2]} ${m[3]}`));
    cache.set(tree, keys);
    stats.checks++; stats.ms += performance.now() - t0;
    return keys;
  }
  return { errors, stats };
}
const added = (before, after) => [...after].filter((k) => !before.has(k));

// ---- one run ----
export function runSwarm(opts, shared) {
  const cfg = { ...DEFAULTS, agents: 10, seed: 1, ...opts };
  const pol = POLICIES[cfg.policy];
  if (!pol) throw new Error(`policy: ${Object.keys(POLICIES).join(', ')}`);
  const name = `swarm-${cfg.policy}-${cfg.agents}${cfg.seed === 1 ? '' : `-s${cfg.seed}`}`; // other seeds: robustness runs, not in the viewer's list
  const { repo, check, root, mig, T0 } = shared;
  const rnd = mulberry32(cfg.seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const logn = (med, sigma) => med * Math.exp(sigma * normal());
  const wall0 = performance.now();
  const checks0 = { ...check.stats };

  // event loop
  const heap = []; let seq = 0, t = 0;
  const less = (a, b) => a.t < b.t || (a.t === b.t && a.s < b.s);
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p])) { [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } else break; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  const at = (dt, fn) => push({ t: t + dt, s: seq++, fn });

  const tasks = mig.tasks.map((x) => ({ ...x, status: 'todo', notBefore: 0, attempts: 0, events: [], conflicts: [], fails: [], files: [], redo: false }));
  const byId = (id) => tasks[id - 1];
  const baseErrs = check.errors(root.snap);
  let main = { sha: root.sha, snap: root.snap };
  let mainNew = new Set(); // errors main has that the starting tree did not
  const history = [], series = [];
  const m = { landed: 0, dropped: 0, conflicts: 0, blocked: 0, redos: 0, replayedOnLand: 0, breaks: 0, stackConflicts: 0, bothSides: 0, bothConflicted: 0, usefulS: 0, blockedS: 0, redoneS: 0, gateWaitS: 0 };
  let redS = 0, redFrom = null, phase = 1, gateOpen = true, finishS = null;
  const idle = new Set();
  const queue = []; let queueBusy = false, landing = null;
  const stateCount = Object.create(null);
  const ev = (x, what, extra) => x.events.push(extra !== undefined ? [Math.round(t), what, extra] : [Math.round(t), what]);
  const setState = (x, s) => { if (x.state) stateCount[x.state]--; x.state = s; if (s) stateCount[s] = (stateCount[s] || 0) + 1; if (s) ev(x, s); };
  const read = (snap) => (p) => (snap.has(p) ? repo.text(snap.get(p)) : null);
  const applyTo = (snap, out) => { const s = new Map(snap); for (const [p, v] of out) { if (v == null) s.delete(p); else s.set(p, repo.blob(v)); } return s; };

  // ---- picking work ----
  const available = (x) => x.status === 'todo' && x.notBefore <= t;
  const ready = (x) => x.needs.every((n) => ['queued', 'landed'].includes(byId(n).status));
  function pick() {
    let c;
    if (pol.pick === 'any') c = tasks.filter(available);
    else if (pol.pick === 'phase') c = gateOpen ? tasks.filter((x) => available(x) && x.phase === phase) : [];
    else c = tasks.filter((x) => available(x) && ready(x));
    if (!c.length) return null;
    // Redo first (its agent already knows it), else at random: a swarm does not plan the order.
    const redo = c.filter((x) => x.redo);
    const from = redo.length ? redo : c;
    return from[Math.floor(rnd() * from.length)];
  }
  function agentFree(a) {
    if (finishS != null) return;
    const x = pick();
    if (!x) { idle.add(a); return; }
    idle.delete(a);
    attempt(a, x);
  }
  function wakeIdle() { for (const a of [...idle]) { const x = pick(); if (!x) break; idle.delete(a); attempt(a, x); } }

  // ---- an attempt ----
  function stackedBase(x) {
    // Needs that are queued but not landed, in queue order (a change is queued only after its own needs).
    // The change being landed right now is out of the queue but not landed yet: include it.
    const pend = [...(landing ? [landing] : []), ...queue].filter((q) => x.needs.includes(q.id));
    if (!pend.length) return { sha: main.sha, snap: main.snap, on: [] };
    if (pol.stack === 'replay') {
      let snap = main.snap;
      for (const q of pend) { const out = mig.apply(q, read(snap)); if (out) snap = applyTo(snap, out); }
      return { sha: repo.commit(repo.tree(snap), [main.sha], `stack for #${x.id}: ${pend.map((q) => '#' + q.id).join(' ')}`, T0 + t * 1000), snap, on: pend.map((q) => q.id) };
    }
    let cur = main.sha;
    for (const q of pend) {
      const r = repo.merge(cur, q.commit, q.base.sha);
      if (r.conflicts.length) return { conflict: r.conflicts, on: pend.map((q) => q.id) };
      cur = repo.commit(r.tree, [cur], `stack for #${x.id}: + #${q.id}`, T0 + t * 1000);
    }
    return { sha: cur, snap: repo.readTree(repo.treeOf(cur)), on: pend.map((q) => q.id) };
  }

  function attempt(a, x) {
    x.status = 'active'; x.agent = a; x.attempts++;
    if (x.created == null) x.created = t;
    ev(x, 'asked', x.attempts === 1 ? x.text : `attempt ${x.attempts}`);
    const dur = logn(cfg.workMedS, cfg.workSigma) * (x.redo ? cfg.redoFactor : 1);
    setState(x, x.redo ? 'rework' : 'work');
    if (!pol.branch) {
      // Shared tree: the agent edits the live files it owns and commits; nothing to merge.
      at(dur, () => {
        if (!mig.apply(x, read(main.snap))) return giveBack(a, x, dur, 'nothing to do on the shared tree yet');
        m.usefulS += dur;
        // The edit is applied to the tree as it is at commit time (others commit meanwhile).
        at(cfg.sharedCommitS, () => {
          const out = mig.apply(x, read(main.snap));
          if (!out) { ev(x, 'nothing left to commit'); return land(x, main.snap, 'nothing left to commit'); }
          x.base = { ...main }; x.files = [...out.keys()];
          land(x, applyTo(main.snap, out), 'committed to the shared tree');
        });
        agentFree(a);
      });
      return;
    }
    const base = pol.stack ? stackedBase(x) : { sha: main.sha, snap: main.snap, on: [] };
    if (base.conflict) {
      m.stackConflicts++;
      return at(dur * cfg.lookFactor, () => giveBack(a, x, dur * cfg.lookFactor, `its stack does not merge: ${base.conflict.slice(0, 2).join(', ')}`));
    }
    const out = mig.apply(x, read(base.snap));
    if (!out) return at(dur * cfg.lookFactor, () => giveBack(a, x, dur * cfg.lookFactor, 'nothing to do on this main yet'));
    const cand = applyTo(base.snap, out);
    if (base.on.length) ev(x, 'stacked on', base.on.map((i) => '#' + i));
    at(dur, () => {
      if (pol.ownCheck) {
        const bad = added(check.errors(base.snap), check.errors(cand));
        if (bad.length) { x.fails.push(...bad.slice(0, 3)); return giveBack(a, x, dur, 'its own type check fails', bad.slice(0, 3)); }
      }
      x.base = base; x.files = [...out.keys()]; x.cand = cand; x.workS = dur;
      x.commit = repo.commit(repo.tree(cand), [base.sha], `#${x.id} ${x.text}`, T0 + t * 1000);
      x.status = 'queued'; x.redo = false;
      setState(x, 'mergeWait');
      queue.push(x);
      trace({ event: 'queued', run: name, t: Math.round(t), task: x.id, key: x.key, stackedOn: base.on });
      pumpQueue(); wakeIdle();
      agentFree(a);
    });
  }

  function giveBack(a, x, spent, why, detail) {
    m.blocked++; m.blockedS += spent;
    ev(x, why, detail);
    trace({ event: 'blocked', run: name, t: Math.round(t), task: x.id, key: x.key, why, detail });
    if (x.attempts >= cfg.maxAttempts) { drop(x, `gave up after ${x.attempts} attempts`); agentFree(a); return; }
    x.status = 'todo'; x.notBefore = t + cfg.backoffS;
    setState(x, 'claimWait');
    at(cfg.backoffS + 1, wakeIdle);
    agentFree(a);
  }
  function drop(x, why) {
    m.dropped++; x.status = 'dropped'; setState(x, null); x.state = 'dropped'; ev(x, 'dropped', why);
    trace({ event: 'dropped', run: name, t: Math.round(t), task: x.id, key: x.key, why });
    maybeDone();
  }

  // ---- landing ----
  function pumpQueue() {
    if (queueBusy) return;
    const i = queue.findIndex((q) => q.needs.every((n) => byId(n).status === 'landed' || byId(n).status === 'dropped'));
    if (i < 0) return;
    const x = queue.splice(i, 1)[0];
    queueBusy = true; landing = x;
    at(cfg.landS, () => { queueBusy = false; landing = null; landFromQueue(x); pumpQueue(); });
  }
  function landFromQueue(x) {
    const r = repo.merge(main.sha, x.commit, x.base.sha);
    // Files this change touched that main also changed since its base: the denominator of
    // "git merges a file changed on both sides cleanly" (Bun measured 0.84, calibration.json).
    const both = x.files.filter((p) => x.base.snap.get(p) !== main.snap.get(p));
    m.bothSides += both.length; m.bothConflicted += both.filter((p) => r.conflicts.includes(p)).length;
    if (both.length) trace({ event: 'both_sides', run: name, task: x.id, files: both, conflicts: r.conflicts });
    if (!r.conflicts.length) return land(x, repo.readTree(r.tree), 'merged');
    m.conflicts++; x.conflicts.push(...r.conflicts);
    ev(x, 'conflict', r.conflicts.slice(0, 5));
    if (pol.replayOnLand) {
      const out = mig.apply(x, read(main.snap));
      if (out) {
        const snap = applyTo(main.snap, out);
        const bad = added(check.errors(main.snap), check.errors(snap));
        if (!bad.length) { m.replayedOnLand++; x.files = [...out.keys()]; x.base = { ...main }; return land(x, snap, 'replayed on main: no text merge'); }
        ev(x, 'replay failed the type check', bad.slice(0, 3));
      } else ev(x, 'replay found nothing to do');
    }
    // Redo: back to the backlog, first in line, redone on the new main.
    m.redos++; m.redoneS += x.workS || 0;
    x.status = 'todo'; x.redo = true; x.notBefore = t;
    setState(x, 'claimWait');
    wakeIdle();
  }
  function land(x, snap, how) {
    const before = mainNew;
    const sha = repo.commit(repo.tree(snap), [main.sha], `Land #${x.id} (${how}): ${x.text}`, T0 + t * 1000);
    main = { sha, snap };
    mainNew = new Set(added(baseErrs, check.errors(snap)));
    const broke = added(before, mainNew);
    if (broke.length) { m.breaks++; x.fails.push(...broke.slice(0, 3)); ev(x, 'broke the check on main', broke.slice(0, 3)); }
    if (mainNew.size && redFrom == null) redFrom = t;
    if (!mainNew.size && redFrom != null) { redS += t - redFrom; redFrom = null; }
    m.landed++; x.status = 'landed'; x.landedAt = Math.round(t); x.landSha = sha;
    if (pol.branch) m.usefulS += x.workS || 0;
    x.diff = x.files.slice(0, 6).map((p) => ({ p, lines: lineDiff(x.base.snap.has(p) ? repo.text(x.base.snap.get(p)) : '', snap.has(p) ? repo.text(snap.get(p)) : '').slice(0, 80) }));
    setState(x, null); x.state = 'landed'; ev(x, 'landed', `${sha.slice(0, 7)}${how === 'merged' ? '' : ' · ' + how}`);
    history.push({ t: Math.round(t), sha, ids: [x.id], kind: 'land', ...(broke.length ? { broke: broke.slice(0, 3) } : {}) });
    trace({ event: 'landed', run: name, t: Math.round(t), task: x.id, key: x.key, how, red: mainNew.size, broke: broke.length });
    if (pol.pick === 'phase') maybeGate();
    maybeDone();
    wakeIdle(); pumpQueue();
  }

  function maybeGate() {
    if (!gateOpen) return;
    if (tasks.some((x) => x.phase === phase && !['landed', 'dropped'].includes(x.status))) return;
    if (phase === 3) return;
    gateOpen = false;
    const from = t;
    // The gate: wait for the full check to be green, then open the next phase.
    at(cfg.gateS, () => {
      m.gateWaitS += t - from;
      if (mainNew.size) { trace({ event: 'gate_red', run: name, phase, errors: [...mainNew].slice(0, 5) }); console.error(`  ${name}: phase ${phase} gate is red (${mainNew.size} errors); stopping`); finishS = t; return; }
      history.push({ t: Math.round(t), sha: main.sha, ids: [], kind: 'gate', phase });
      trace({ event: 'gate', run: name, t: Math.round(t), phase });
      phase++; gateOpen = true; wakeIdle();
    });
  }
  function maybeDone() {
    if (finishS == null && tasks.every((x) => ['landed', 'dropped'].includes(x.status))) finishS = t;
  }

  for (let a = 0; a < cfg.agents; a++) at(rnd() * 30, () => agentFree(a));
  const end = cfg.maxHours * 3600;
  let lastSample = -1e9, lastLog = performance.now();
  while (heap.length && finishS == null && heap[0].t <= end) {
    const e = pop(); t = e.t; e.fn();
    if (t - lastSample >= 60) {
      lastSample = t;
      series.push({ t: Math.round(t), landed: m.landed, conflicts: m.conflicts, red: mainNew.size ? 1 : 0, states: { ...stateCount } });
    }
    if (performance.now() - lastLog > 10000) { lastLog = performance.now(); process.stderr.write(`  ${name}: ${Math.round(t / 60)} simulated min, ${m.landed}/${tasks.length} landed, ${check.stats.checks - checks0.checks} checks\n`); }
  }
  const T = finishS ?? t;
  if (redFrom != null) redS += T - redFrom;
  series.push({ t: Math.round(T), landed: m.landed, conflicts: m.conflicts, red: mainNew.size ? 1 : 0, states: { ...stateCount } });
  repo.setRef(`refs/heads/${name}`, main.sha);

  const agentS = cfg.agents * T;
  const stats = {
    tasks: tasks.length, landed: m.landed, dropped: m.dropped, finished: finishS != null && !m.dropped, finishS: Math.round(T),
    finalErrors: mainNew.size, conflicts: m.conflicts, blocked: m.blocked, redos: m.redos, replayedOnLand: m.replayedOnLand, stackConflicts: m.stackConflicts,
    bothSidesFiles: m.bothSides, pCleanBothSides: m.bothSides ? +(1 - m.bothConflicted / m.bothSides).toFixed(3) : null,
    breaks: m.breaks, redS: Math.round(redS), redShare: +(redS / Math.max(T, 1)).toFixed(3), gateWaitS: Math.round(m.gateWaitS),
    usefulH: +(m.usefulS / 3600).toFixed(1), wastedH: +((m.blockedS + m.redoneS) / 3600).toFixed(1), blockedH: +(m.blockedS / 3600).toFixed(1), redoneH: +(m.redoneS / 3600).toFixed(1),
    idleShare: +(1 - (m.usefulS + m.blockedS + m.redoneS) / Math.max(agentS, 1)).toFixed(3),
    checks: check.stats.checks - checks0.checks, scans: check.stats.scans - checks0.scans, wallS: +((performance.now() - wall0) / 1000).toFixed(1),
    // run-viewer fields
    landedPerHour: Math.round(m.landed / Math.max(T / 3600, 0.01)), testFails: m.blocked, reverts: 0, leadReplays: 0, reworkShare: +(m.redoneS / Math.max(m.usefulS + m.redoneS, 1)).toFixed(3),
  };
  const lat = tasks.filter((x) => x.landedAt != null).map((x) => x.landedAt - x.created).sort((a, b) => a - b);
  stats.p50S = lat[Math.floor(lat.length * 0.5)] ?? null; stats.p90S = lat[Math.floor(lat.length * 0.9)] ?? null;
  const paths = [...new Set([...root.snap.keys(), ...tasks.flatMap((x) => x.files)])].sort();
  const pathIdx = new Map(paths.map((p, i) => [p, i]));
  const bundle = {
    meta: {
      name, policy: cfg.policy, label: pol.label, about: `${pol.about} The goal: move Hono's src/utils/ (27 modules) to src/lib/ — ${tasks.length} tasks (moves, import rewrites in ${tasks.filter((x) => x.kind === 'use').length} files, shim deletions), dependencies from the import graph, a real type check (tsgo, tests included). No model calls.`,
      agents: cfg.agents, reviewers: 0, leads: 0, hours: +(T / 3600).toFixed(3), seed: cfg.seed, startedAt: new Date(T0).toISOString(), generatedAt: new Date().toISOString(),
      git: `${OUT.replace(/^.*\/forq\//, '')}/${shared.repoName} (${name} = ${main.sha.slice(0, 10)}; hono ${shared.honoSha.slice(0, 10)})`,
    },
    stats, paths,
    changes: tasks.map((x) => ({
      id: x.id, agent: x.agent ?? null, kind: x.kind, text: x.text, created: Math.round(x.created ?? 0), needs: x.needs,
      files: x.files.map((p) => pathIdx.get(p)), events: x.events, tries: x.attempts, landedAt: x.landedAt ?? null,
      sha: x.landSha?.slice(0, 10) ?? null, commit: x.commit?.slice(0, 10) ?? null, conflicts: [...new Set(x.conflicts)], fails: [...new Set(x.fails)],
      reverted: false, diff: x.landedAt != null ? x.diff : null, state: x.state ?? x.status,
    })),
    history, series,
  };
  return { bundle, stats, name };
}

const summary = (name, stats) => {
  const h = (s) => `${(s / 3600).toFixed(1)} h`;
  return `${name}: ${stats.finished ? 'done in' : 'NOT done after'} ${h(stats.finishS)}; ${stats.landed}/${stats.tasks} landed, ${stats.dropped} dropped; agent time useful ${stats.usefulH} h, wasted ${stats.wastedH} h (blocked ${stats.blockedH}, redone ${stats.redoneH}), idle ${Math.round(stats.idleShare * 100)}%; ${stats.conflicts} conflicts, ${stats.redos} redos, ${stats.replayedOnLand} replayed; files changed on both sides ${stats.bothSidesFiles}, clean ${stats.pCleanBothSides}; ${stats.breaks} landings broke the check, main red ${h(stats.redS)} (${Math.round(stats.redShare * 100)}%); gates ${h(stats.gateWaitS)}; ${stats.checks} type checks + ${stats.scans} import scans, ${stats.wallS} s`;
};

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
  const policies = String(args.policies || Object.keys(POLICIES).join(',')).split(',');
  const agentsList = String(args.agents || '10,100,1000').split(',').map(Number);
  mkdirSync(OUT, { recursive: true }); mkdirSync(RUNS, { recursive: true });
  const repoName = `hono-${agentsList.join('_')}.git`; // one repo per process: parallel runs never share loose objects
  const repo = openRepo(join(OUT, repoName));
  const { sha: honoSha, files } = seedFiles();
  const T0 = Date.parse('2026-10-08T09:00:00Z');
  const snap0 = new Map([...files].map(([p, text]) => [p, repo.blob(text)]));
  const root = { sha: repo.commit(repo.tree(snap0), [], `Hono ${honoSha.slice(0, 10)}: src/, jsr.json and configs`, T0), snap: snap0 };
  repo.setRef('refs/heads/main', root.sha);
  const mig = buildMigration(files);
  const check = makeChecker(repo, join(OUT, `wt-${process.pid}`));
  console.log(`${mig.tasks.length} tasks: ${['move', 'use', 'unshim'].map((k) => `${mig.tasks.filter((x) => x.kind === k).length} ${k}`).join(', ')}; ${mig.tasks.reduce((s, x) => s + x.needs.length, 0)} needs; starting tree has ${check.errors(snap0).size} type errors (not counted)`);
  const indexPath = join(RUNS, 'index.json');
  const seeds = String(args.seed || 1).split(',').map(Number);
  for (const seed of seeds) for (const agents of agentsList) for (const policy of policies) {
    const { bundle, stats, name } = runSwarm({ policy, agents, seed }, { repo, check, root, mig, T0, honoSha, repoName });
    const json = JSON.stringify(bundle);
    appendFileSync(join(LOG, 'swarm.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'swarm_run', name, policy, agents, seed, ...stats }) + '\n');
    console.log(summary(name, stats));
    if (seed !== 1) continue;
    writeFileSync(join(RUNS, `${name}.json`), json);
    const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : [];
    const entry = { name, policy: `swarm-${policy}`, label: `Migration: ${bundle.meta.label}`, agents, hours: bundle.meta.hours, stats, bytes: json.length };
    const i = index.findIndex((x) => x.name === name); if (i >= 0) index[i] = entry; else index.push(entry);
    index.sort((a, b) => a.agents - b.agents || a.name.localeCompare(b.name));
    writeFileSync(indexPath, JSON.stringify(index, null, 1));
  }
  rmSync(join(OUT, `wt-${process.pid}`), { recursive: true, force: true });
}
