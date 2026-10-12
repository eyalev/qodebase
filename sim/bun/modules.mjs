#!/usr/bin/env node
// BUN5 (docs/board/sim.md (k)): Bun's c+d+e work re-cut by module. One owner's task per file (a Rust module), so
// BUN3's content chains (per line, hence per file) run inside one agent. Order from the real structure at the PR's
// tip: crates and their dependencies (Cargo.toml), modules (mod declarations walked from each crate's lib.rs,
// #[path] honoured) and the modules each one uses (use crate::/super::/self::/bun_<crate>::, longest module prefix).
//   node sim/bun/modules.mjs --graph       build sim/bun/modules.json from the clone (needs the tip's .rs blobs)
//   node sim/bun/modules.mjs --one 'order=interfaces,agents=64'
//   node sim/bun/modules.mjs --sweep        -> sim/bun/bun5-sweep.jsonl
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(homedir(), 'projects/github/oven-sh/bun-pr30412'), TIP = 'refs/pr/30412';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));

// ---------------- the graph ----------------
if (args.graph) {
  const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' } });
  const all = git('ls-tree', '-r', '--name-only', TIP).split('\n').filter(Boolean);
  const exists = new Set(all);
  const show = (p) => git('show', `${TIP}:${p}`);
  // crates: src/<x>/Cargo.toml with a [package] name; lib path from [lib] (default lib.rs / src/lib.rs)
  const crates = new Map(); // name -> {dir, root, deps}
  for (const p of all.filter((x) => x.startsWith('src/') && x.endsWith('/Cargo.toml'))) {
    const t = show(p), dir = posix.dirname(p);
    const name = (t.match(/^\s*name\s*=\s*"([^"]+)"/m) || [])[1];
    if (!name) continue;
    const lib = (t.match(/\[lib\][^[]*?path\s*=\s*"([^"]+)"/s) || [])[1];
    const root = lib ? posix.join(dir, lib) : exists.has(`${dir}/lib.rs`) ? `${dir}/lib.rs` : `${dir}/src/lib.rs`;
    const depSec = t.split(/^\[/m).filter((s) => /^dependencies\]/.test(s)).join('\n');
    const deps = [...depSec.matchAll(/^\s*(bun_[\w-]+)/gm)].map((m) => m[1].replace(/-/g, '_'));
    crates.set(name.replace(/-/g, '_'), { dir, root, deps });
  }
  // modules: walk mod declarations from each root
  const modFile = new Map(); // file -> {crate, path: ['a','b']}
  const byPath = new Map(); // crate -> Map('a::b' -> file)
  const text = new Map();
  const read = (f) => { if (!text.has(f)) text.set(f, exists.has(f) ? show(f) : null); return text.get(f); };
  for (const [cname, c] of crates) {
    const map = new Map(); byPath.set(cname, map);
    const walk = (file, mpath) => {
      if (modFile.has(file)) return;
      const src = read(file); if (src == null) return;
      modFile.set(file, { crate: cname, path: mpath }); map.set(mpath.join('::'), file);
      const base = posix.basename(file), d = posix.dirname(file);
      const childDir = base === 'lib.rs' || base === 'mod.rs' || file === c.root ? d : posix.join(d, base.replace(/\.rs$/, ''));
      for (const m of src.matchAll(/(#\[path\s*=\s*"([^"]+)"\]\s*(?:#\[[^\]]*\]\s*)*)?(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][\w]*)\s*;/g)) {
        const name = m[3];
        let target = m[2] ? posix.normalize(posix.join(d, m[2])) : null;
        if (!target) target = exists.has(`${childDir}/${name}.rs`) ? `${childDir}/${name}.rs` : `${childDir}/${name}/mod.rs`;
        if (exists.has(target)) walk(target, [...mpath, name]);
      }
    };
    walk(c.root, []);
  }
  // uses: longest module prefix of each path a module names
  const uses = new Map();
  const resolve = (cname, segs) => { const map = byPath.get(cname); if (!map) return null; for (let k = segs.length; k >= 0; k--) { const f = map.get(segs.slice(0, k).join('::')); if (f) return f; } return null; };
  for (const [file, me] of modFile) {
    const src = read(file), out = new Set();
    const add = (head, rest) => {
      const segs = rest.split('::').map((s) => s.trim()).filter((s) => /^[A-Za-z_]\w*$/.test(s));
      let cname = me.crate, base = [];
      if (head === 'crate') base = [];
      else if (head === 'self') base = me.path;
      else if (head === 'super') base = me.path.slice(0, -1);
      else if (crates.has(head)) cname = head;
      else return;
      const f = resolve(cname, [...base, ...segs]);
      if (f && f !== file) out.add(f);
    };
    // use statements (brace groups expanded one level) and fully qualified paths in code
    for (const m of src.matchAll(/\buse\s+([^;]+);/g)) {
      const u = m[1].replace(/\s+/g, '');
      const g = u.match(/^(\w+)::((?:\w+::)*)\{(.*)\}$/);
      if (g) { for (const item of g[3].split(',')) add(g[1], g[2] + item.replace(/\{.*$/, '')); }
      else { const h = u.match(/^(\w+)::(.*)$/); if (h) add(h[1], h[2]); }
    }
    for (const m of src.matchAll(/\b(crate|bun_\w+)::((?:\w+::)*\w+)/g)) add(m[1], m[2]);
    uses.set(file, [...out]);
  }
  const out = { tip: TIP, crates: Object.fromEntries([...crates].map(([k, v]) => [k, { dir: v.dir, deps: v.deps.filter((d) => crates.has(d)) }])),
    modules: Object.fromEntries([...modFile].map(([f, m]) => [f, { crate: m.crate, uses: uses.get(f) }])) };
  writeFileSync(join(HERE, 'modules.json'), JSON.stringify(out));
  const nUses = [...uses.values()].reduce((s, u) => s + u.length, 0);
  console.log(`${crates.size} crates, ${modFile.size} modules reached from lib.rs (of ${all.filter((x) => x.endsWith('.rs') && x.startsWith('src/')).length} .rs under src/), ${nUses} use edges -> sim/bun/modules.json`);
  process.exit(0);
}

// ---------------- the sim ----------------
export function run(opts = {}) {
  const cfg = { order: 'interfaces', agents: 64, seed: 1, workMedS: 65, workSigma: 0.6, perFileLog: 0.3, phi: 0.2, finalCheckS: 900, ...opts };
  const D = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'));
  const G = JSON.parse(readFileSync(join(HERE, 'modules.json'), 'utf8'));
  let a = cfg.seed >>> 0 || 1;
  const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const logn = (med, sig) => med * Math.exp(sig * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()));
  // BUN3's window: first phase-c commit to last phase-e commit
  const c0 = D.tasks.findIndex((t) => t.phase === 'c'); let e1 = 0; D.tasks.forEach((t, i) => { if (t.phase === 'e') e1 = i; });
  const seg = D.tasks.slice(c0, e1 + 1);
  const work = new Map(); // file -> seconds
  let commits = 0;
  for (const t of seg) {
    if (!t.f.length) continue; commits++;
    const w = logn(cfg.workMedS * (1 + cfg.perFileLog * Math.log(Math.max(1, t.f.length))), cfg.workSigma);
    for (const f of t.f) { const p = D.files[f]; work.set(p, (work.get(p) || 0) + w / t.f.length); }
  }
  const files = [...work.keys()];
  const M = G.modules;
  // a file not reached from lib.rs (deleted or renamed before the tip) still belongs to the crate whose dir holds it
  const dirs = Object.entries(G.crates).map(([c, v]) => [v.dir + '/', c]).sort((p, q) => q[0].length - p[0].length);
  const crateOf = (f) => M[f]?.crate ?? (dirs.find(([d]) => f.startsWith(d)) || [])[1] ?? null;
  // tasks
  const T = []; const add = (x) => { x.id = T.length; x.next = []; x.deps = 0; T.push(x); return x; };
  const edge = (from, to) => { from.next.push(to.id); to.deps++; };
  if (cfg.order === 'interfaces') {
    // interface(m) waits for every interface of the crates m's crate depends on (a barrier per crate);
    // impl(m) waits for its own interface and the interfaces of the modules it uses (that changed in this window).
    const I = new Map(), Im = new Map();
    for (const f of files) {
      const rs = f.endsWith('.rs') && !!crateOf(f);
      I.set(f, add({ kind: 'interface', file: f, s: rs ? cfg.phi * work.get(f) : 0 }));
      Im.set(f, add({ kind: 'impl', file: f, s: rs ? (1 - cfg.phi) * work.get(f) : work.get(f) }));
      edge(I.get(f), Im.get(f));
    }
    const barrier = new Map(); // crate -> a zero-length task after all its interfaces
    for (const c of Object.keys(G.crates)) barrier.set(c, add({ kind: 'barrier', crate: c, s: 0 }));
    for (const f of files) { const c = crateOf(f); if (c) edge(I.get(f), barrier.get(c)); }
    for (const f of files) { const c = crateOf(f); if (!c) continue; for (const d of G.crates[c].deps) edge(barrier.get(d), I.get(f)); }
    for (const f of files) for (const u of M[f]?.uses || []) if (I.has(u)) edge(I.get(u), Im.get(f));
  } else {
    // strict: a module waits for every module it uses to be done; cycles merged (Tarjan) into one owner's task.
    const nodes = files, idx = new Map(nodes.map((f, i) => [f, i]));
    const adj = nodes.map((f) => (M[f]?.uses || []).filter((u) => idx.has(u)).map((u) => idx.get(u)));
    let n = 0; const ix = new Array(nodes.length).fill(-1), low = [], on = [], st = [], comp = new Array(nodes.length).fill(-1); let nc = 0;
    const strong = (v0) => { // iterative Tarjan
      const stack = [[v0, 0]]; ix[v0] = low[v0] = n++; st.push(v0); on[v0] = true;
      while (stack.length) {
        const top = stack[stack.length - 1], [v, i] = top;
        if (i < adj[v].length) { top[1]++; const w = adj[v][i]; if (ix[w] < 0) { ix[w] = low[w] = n++; st.push(w); on[w] = true; stack.push([w, 0]); } else if (on[w]) low[v] = Math.min(low[v], ix[w]); }
        else { stack.pop(); if (stack.length) { const p = stack[stack.length - 1][0]; low[p] = Math.min(low[p], low[v]); } if (low[v] === ix[v]) { let w; do { w = st.pop(); on[w] = false; comp[w] = nc; } while (w !== v); nc++; } }
      }
    };
    for (let v = 0; v < nodes.length; v++) if (ix[v] < 0) strong(v);
    const C = Array.from({ length: nc }, () => add({ kind: 'module', files: [], s: 0 }));
    nodes.forEach((f, v) => { C[comp[v]].files.push(f); C[comp[v]].s += work.get(f); });
    const seen = new Set();
    nodes.forEach((f, v) => { for (const w of adj[v]) { if (comp[w] === comp[v]) continue; const k = comp[w] + ':' + comp[v]; if (seen.has(k)) continue; seen.add(k); edge(C[comp[w]], C[comp[v]]); } });
  }
  // critical path (longest remaining path) per task, for priority and as a bound
  const order = []; { const indeg = T.map((x) => x.deps); const q = T.filter((x) => !x.deps).map((x) => x.id); while (q.length) { const v = q.pop(); order.push(v); for (const w of T[v].next) if (--indeg[w] === 0) q.push(w); } }
  if (order.length !== T.length) throw new Error('cycle in task graph');
  for (let i = order.length - 1; i >= 0; i--) { const x = T[order[i]]; x.rest = x.s + Math.max(0, ...x.next.map((w) => T[w].rest)); }
  const critical = Math.max(...T.map((x) => x.rest));
  // schedule: free agents take the ready task with the longest remaining path
  const ready = T.filter((x) => !x.deps); let free = cfg.agents, t = 0, busyS = 0, maxBusy = 0, running = [];
  const heap = []; // [end, id]
  const push = (e) => { heap.push(e); heap.sort((p, q) => p[0] - q[0]); };
  let done = 0;
  const start = () => {
    ready.sort((p, q) => q.rest - p.rest);
    while (ready.length && (free > 0 || ready[0].s === 0)) {
      const x = ready.shift();
      if (x.s > 0) { free--; busyS += x.s; }
      push([t + x.s, x.id, x.s > 0]);
    }
    maxBusy = Math.max(maxBusy, cfg.agents - free);
  };
  start();
  while (heap.length) {
    const [end, id, usedAgent] = heap.shift(); t = end; done++;
    if (usedAgent) free++;
    for (const w of T[id].next) if (--T[w].deps === 0) ready.push(T[w]);
    start();
  }
  const finishedS = t + cfg.finalCheckS;
  const biggest = Math.max(...T.map((x) => x.s));
  return { order: cfg.order, agents: cfg.agents, seed: cfg.seed, phi: cfg.order === 'interfaces' ? cfg.phi : null,
    finishedH: +(finishedS / 3600).toFixed(2), criticalPathH: +((critical + cfg.finalCheckS) / 3600).toFixed(2),
    agentHours: +(busyS / 3600).toFixed(1), widthMax: maxBusy, tasks: T.filter((x) => x.s > 0).length, commits, files: files.length,
    biggestTaskH: +(biggest / 3600).toFixed(2), idleShare: +(1 - busyS / (cfg.agents * t || 1)).toFixed(3), vsBun3: +(26.2 / (finishedS / 3600)).toFixed(2) };
}

if (args.one) {
  const o = Object.fromEntries(String(args.one).split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, isNaN(+v) ? v : +v]));
  console.log(run(o));
}
if (args.sweep) {
  const out = join(HERE, 'bun5-sweep.jsonl');
  for (const order of ['interfaces', 'strict']) for (const agents of [64, 640, 6400, 1e6]) for (const seed of [1, 2, 3])
    for (const phi of order === 'interfaces' ? [0.1, 0.2, 0.3] : [null]) appendFileSync(out, JSON.stringify(run({ order, agents, seed, ...(phi ? { phi } : {}) })) + '\n');
  console.log('->', out);
}
