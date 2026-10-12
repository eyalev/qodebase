#!/usr/bin/env node
// BUN3: replay Bun's port (oven-sh/bun#30412) with REAL patches on real content: Bun's method (agents own line
// ranges, commit straight onto one shared tree, no check) vs the same plus a fast per-crate check before each
// commit. Scripted agents, no model calls. Input: sim/bun/bun3-prep.mjs output (one segment).
//
//   node sim/bun/bun3.mjs --data out/bun3-cde.json.gz --method bun|check --agents 64 [--checkS 60] [--seed 1]
//   node sim/bun/bun3.mjs --data out/bun3-cde.json.gz --validate      1 agent, history order: must end on history's files
//
// What is real: each task is one real commit; landing applies its real hunks to the shared tree as it is at that
// moment (git-apply semantics: the hunk's old lines must be found, at an offset if lines moved; fuzz 0), so a
// conflict is a real one created by the new order. Ownership: each file is cut into parts (ceil(touches / 10), at
// most 16: qb4's fit to Bun's real phase times); a task holds the parts its hunks fall in from start to commit.
// Timing (qb4's calibration, sim/bun/swarm.mjs): work = 400 s median x (1 + 0.3 ln files), lognormal 0.6; commits
// one at a time (2 s); cde: phase gate (c+d, then a 15-min full check, then e).
// Conflicts: the agent redoes it on the current tree (0.3 x its work), the hunks then apply where they fit and a hunk
// that still fits nowhere is counted as lost (Bun's real "lost work" fixes).
// Breaks: --breaks real (tail: sim/bun/bun3-breaks.json, the culprit's crates are red from its commit until its fix
// commits; the fix cannot start before the culprit lands; --borderline includes the 3 unclear ones) or
// --breaks model (cde: MODELLED, p 0.01 per commit, red for 600 s; history has no breaks there: main did not compile
// until the end of d). check: the per-crate check fails on a culprit that is compileDetectable (real) or with
// pCatch 0.9 (model) when the break is in a crate the commit touches: the agent fixes it (0.35 x work), nothing turns red.
import { readFileSync, appendFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULTS = { workMedS: 400, workSigma: 0.6, perFileLog: 0.3, commitS: 2, gateS: 900, touchesPerRange: 10, maxRanges: 16,
  reworkF: 0.3, fixF: 0.35, checkS: 60, pBreak: 0.01, pCatch: 0.9, fixMainS: 600, seed: 1 };

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const crateOf = (p) => { const m = /^src\/([^/]+)\//.exec(p); return m ? m[1] : p.split('/')[0]; };

// Apply one file's hunks to `lines` (array). Returns { lines, ok, lost } — git-apply semantics, offset search, fuzz 0.
export function applyHunks(lines, hunks) {
  let out = lines.slice(), delta = 0, ok = true, lost = 0;
  for (const h of hunks) {
    const old = h.lines.filter((l) => l[0] === ' ' || l[0] === '-').map((l) => l.slice(1));
    const neu = h.lines.filter((l) => l[0] === ' ' || l[0] === '+').map((l) => l.slice(1));
    const want = Math.max(0, (h.ol === 0 ? h.os : h.os - 1) + delta);
    const fits = (at) => at >= 0 && at + old.length <= out.length && old.every((l, i) => out[at + i] === l);
    let at = -1;
    if (fits(want)) at = want;
    else for (let d = 1; d <= out.length && at < 0; d++) { if (fits(want - d)) at = want - d; else if (fits(want + d)) at = want + d; }
    if (at < 0) { ok = false; lost++; continue; }
    out.splice(at, old.length, ...neu);
    delta = at - (h.ol === 0 ? h.os : h.os - 1) + (neu.length - old.length);
  }
  return { lines: out, ok, lost };
}

export function load(path) { return JSON.parse(gunzipSync(readFileSync(path)).toString()); }

export function run(data, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const rnd = mulberry32(cfg.seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const tasks = data.tasks.map((t, i) => ({ ...t, i }));
  const tree = new Map(Object.entries(data.files).map(([p, s]) => [p, s == null ? null : s.split('\n')]));
  // ownership parts per file
  const touches = new Map();
  for (const t of tasks) for (const d of t.diffs) touches.set(d.path, (touches.get(d.path) || 0) + 1);
  const parts = (p) => Math.min(cfg.maxRanges, Math.max(1, Math.ceil((touches.get(p) || 1) / cfg.touchesPerRange)));
  const baseLen = (p) => Math.max(1, (data.files[p] || '').split('\n').length);
  for (const t of tasks) {
    const c = new Set();
    for (const d of t.diffs) {
      const n = parts(d.path);
      if (n === 1 || !d.hunks.length) { c.add(`${d.path}#0`); continue; }
      for (const h of d.hunks) c.add(`${d.path}#${Math.min(n - 1, Math.floor(((h.os - 1) / baseLen(d.path)) * n))}`);
    }
    t.claims = [...c];
    t.work = cfg.workMedS * (1 + cfg.perFileLog * Math.log(Math.max(1, t.diffs.length))) * Math.exp(cfg.workSigma * normal());
    t.crateSet = new Set(t.crates);
  }
  // breaks
  const culpritOf = new Map(), fixOf = new Map(); // culprit sha -> entry, fix sha -> culprit sha
  if (cfg.breaks === 'real') {
    const B = JSON.parse(readFileSync(join(HERE, 'bun3-breaks.json'), 'utf8')).entries.filter((e) => e.kind === 'strict' || cfg.borderline);
    const full = (s) => tasks.find((t) => t.sha.startsWith(s))?.sha;
    for (const e of B) { const c = full(e.culprit), f = full(e.fix); if (c && f) { culpritOf.set(c, { ...e, fixSha: f }); fixOf.set(f, c); } }
  }
  // cde: everything before the first phase-e commit (c, d and the b/untagged commits between them), a 15-min full
  // check, then the rest. tail: one group.
  const firstE = tasks.findIndex((x) => x.phase === 'e');
  for (const x of tasks) x.group = data.seg === 'cde' && !cfg.noGates && firstE >= 0 && x.i >= firstE ? 1 : 0;
  const groups = data.seg === 'cde' && !cfg.noGates ? [0, 1] : [0];

  // event loop
  const heap = []; let seq = 0, t = 0;
  const less = (a, b) => a.t < b.t || (a.t === b.t && a.s < b.s);
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p])) { [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } else break; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  const at = (dt, fn) => push({ t: t + dt, s: seq++, fn });

  const held = new Set(); let free = cfg.validate ? 1 : cfg.agents, g = 0, open = [], landedInGroup = 0, commitBusy = false;
  const commitQ = [], landedSet = new Set();
  const red = new Map(); // crate -> { since, until(null = until fix), culprit }
  const m = { landed: 0, conflicts: 0, lostHunks: 0, reworkS: 0, workS: 0, checkS: 0, caught: 0, breaks: 0, redCrateS: 0, landedOnRed: 0, idleS: 0, fixS: 0 };
  let groupTasks = [];
  function openGroup() {
    groupTasks = tasks.filter((x) => x.group === groups[g]);
    open = groupTasks.slice(); landedInGroup = 0; pump();
  }
  const ready = (x) => x.claims.every((c) => !held.has(c)) && (!fixOf.has(x.sha) || landedSet.has(fixOf.get(x.sha)));
  function pump() {
    while (free > 0) {
      let k = -1;
      if (cfg.validate) k = open.length ? 0 : -1;
      else for (let i = 0; i < open.length && i < 4000; i++) if (ready(open[i])) { k = i; break; }
      if (k < 0 || (cfg.validate && !ready(open[0]))) return;
      const x = open.splice(k, 1)[0]; free--;
      for (const c of x.claims) held.add(c);
      x.start = t;
      const w = x.work + (cfg.method === 'check' ? cfg.checkS : 0);
      m.workS += x.work; if (cfg.method === 'check') m.checkS += cfg.checkS;
      at(w, () => { commitQ.push(x); pumpCommit(); });
    }
  }
  function pumpCommit() {
    if (commitBusy || !commitQ.length) return;
    const x = commitQ.shift(); commitBusy = true;
    at(cfg.commitS, () => { commitBusy = false; land(x); pumpCommit(); });
  }
  function isBreak(x) {
    if (cfg.breaks === 'real') return culpritOf.get(x.sha) || null;
    if (cfg.breaks === 'model') return rnd() < cfg.pBreak ? { compileDetectable: rnd() < cfg.pCatch, model: true } : null;
    return null;
  }
  function land(x) {
    // the per-crate check (in the agent's own box, already timed) catches a detectable break in its crates
    const br = x.brChecked ? null : isBreak(x);
    x.brChecked = true;
    if (br && cfg.method === 'check' && br.compileDetectable) {
      m.caught++; const d = x.work * cfg.fixF; m.fixS += d;
      return at(d + cfg.checkS, () => { commitQ.push(x); pumpCommit(); });
    }
    // apply the real patch to the tree as it is now
    let conflict = false;
    for (const d of x.diffs) {
      if (d.binary) continue;
      const cur = tree.get(d.path);
      if (!d.hunks.length) continue;
      if (cur == null) { // new file (or apply onto missing): take the patch's new side
        if (d.hunks.length === 1 && d.hunks[0].os === 0) { tree.set(d.path, d.hunks[0].lines.filter((l) => l[0] === '+').map((l) => l.slice(1))); continue; }
        conflict = true; m.lostHunks += d.hunks.length; continue;
      }
      const r = applyHunks(cur, d.hunks);
      if (!r.ok) { conflict = true; m.lostHunks += r.lost; }
      tree.set(d.path, r.lines);
    }
    if (conflict) { m.conflicts++; const d = x.work * cfg.reworkF; m.reworkS += d; x.reworked = (x.reworked || 0) + 1; }
    const finish = () => {
      m.landed++; landedInGroup++; landedSet.add(x.sha); x.landedAt = t;
      for (const c of x.claims) held.delete(c);
      free++;
      for (const cr of x.crateSet) if (red.has(cr)) m.landedOnRed++;
      if (br) { m.breaks++; for (const cr of x.crateSet) if (!red.has(cr)) red.set(cr, { since: t, culprit: x.sha, until: br.model ? t + cfg.fixMainS : null }); if (br.model) at(cfg.fixMainS, () => heal(x.sha)); }
      if (fixOf.has(x.sha)) heal(fixOf.get(x.sha));
      if (landedInGroup === groupTasks.length) { g++; if (g < groups.length) at(cfg.gateS, openGroup); else done = t; }
      pump();
    };
    if (conflict) at(x.work * cfg.reworkF, finish); else finish();
  }
  function heal(culprit) { for (const [cr, r] of red) if (r.culprit === culprit) { m.redCrateS += t - r.since; red.delete(cr); } }

  let done = null;
  openGroup();
  while (heap.length) { const e = pop(); t = e.t; e.fn(); }
  for (const [, r] of red) m.redCrateS += t - r.since; // never healed
  // compare with history's files at the end
  let same = 0, differ = 0;
  for (const [p, want] of Object.entries(data.final)) { const got = tree.get(p); const g2 = got == null ? null : got.join('\n'); if (g2 === want) same++; else differ++; }
  const hours = (done ?? t) / 3600;
  return { method: cfg.method, agents: cfg.validate ? 1 : cfg.agents, seed: cfg.seed, seg: data.seg, breakModel: cfg.breaks || 'none', borderline: !!cfg.borderline, checkS: cfg.method === 'check' ? cfg.checkS : 0,
    hours: +hours.toFixed(2), landed: m.landed, of: tasks.length, conflicts: m.conflicts, lostHunks: m.lostHunks,
    reworkShare: +((m.reworkS + m.fixS) / (m.workS + m.reworkS + m.fixS + m.checkS)).toFixed(4), checkShare: +(m.checkS / (m.workS + m.reworkS + m.fixS + m.checkS)).toFixed(4),
    agentHours: +((m.workS + m.reworkS + m.fixS + m.checkS) / 3600).toFixed(1), breaks: m.breaks, caught: m.caught,
    redCrateMin: Math.round(m.redCrateS / 60), landedOnRed: m.landedOnRed, filesSameAsHistory: same, filesDiffer: differ };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const has = (k) => process.argv.includes(`--${k}`);
  const data = load(a('data'));
  const r = run(data, { method: a('method', 'bun'), agents: Number(a('agents', 64)), seed: Number(a('seed', 1)), checkS: Number(a('checkS', 60)),
    breaks: a('breaks', data.seg === 'cde' ? 'model' : 'real'), borderline: has('borderline'), validate: has('validate'), noGates: has('no-gates') });
  console.log(JSON.stringify(r));
  if (a('out')) appendFileSync(a('out'), JSON.stringify({ ts: new Date().toISOString(), ...r }) + '\n');
}
