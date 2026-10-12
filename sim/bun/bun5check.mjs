#!/usr/bin/env node
// BUN5 check on Bun's real patches: when the port is cut one owner per file (sim/bun/modules.mjs, qb4), do the
// orders it uses respect what the real commits needed from OTHER files?
//
//   node sim/bun/bun5check.mjs --data out/bun3-cde.json.gz [--modules sim/bun/modules.json]
//
// A "need": a commit adds Rust code in file X that uses a name (fn/struct/enum/trait/type/const/static/union/mod/
// macro_rules) first defined in the segment by a commit (the same or an earlier one) in another file Y. Names that
// already exist in the base tree, or that the segment defines in more than one file, are skipped (ambiguous).
// Criteria (qb4, modules.mjs):
//   interfaces-first: met if Y == X, or Y in uses(X), or crate(Y) is a transitive crate dependency of crate(X)
//   strict:           met if Y is reachable from X through uses (the cycle-merged graph: same cycle counts)
// Files not in modules.json (renamed or deleted before the tip): crate by directory, no uses.
// Also checks, as a sanity line, that replaying each file's own hunks in history order rebuilds every file.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, applyDiff } from './bun3.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const data = load(arg('data'));
const M = JSON.parse(readFileSync(arg('modules', join(HERE, 'modules.json')), 'utf8'));

// ---- the graph ----
const crateByDir = Object.entries(M.crates).map(([c, v]) => [v.dir.replace(/\/$/, '') + '/', c]).sort((a, b) => b[0].length - a[0].length);
const crateOf = (p) => M.modules[p]?.crate ?? crateByDir.find(([d]) => p.startsWith(d))?.[1] ?? null;
const usesOf = (p) => M.modules[p]?.uses ?? [];
const crateDeps = new Map();
const crateClosure = (c) => {
  if (crateDeps.has(c)) return crateDeps.get(c);
  const out = new Set(); crateDeps.set(c, out);
  const st = [...(M.crates[c]?.deps || [])];
  while (st.length) { const d = st.pop(); if (out.has(d)) continue; out.add(d); st.push(...(M.crates[d]?.deps || [])); }
  return out;
};
const reach = new Map();
const reachable = (x) => { // files reachable from x through uses (transitive)
  if (reach.has(x)) return reach.get(x);
  const out = new Set(); const st = [...usesOf(x)];
  while (st.length) { const y = st.pop(); if (out.has(y)) continue; out.add(y); st.push(...usesOf(y)); }
  reach.set(x, out); return out;
};

// ---- names ----
const DEF = /\b(?:fn|struct|enum|trait|type|const|static|union|mod)\s+([A-Za-z_][A-Za-z0-9_]*)|\bmacro_rules!\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const IDENT = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
const isRs = (p) => p.endsWith('.rs');
const baseNames = new Set();
for (const [p, s] of Object.entries(data.files)) if (s && isRs(p)) for (const m of s.matchAll(DEF)) baseNames.add(m[1] || m[2]);
const defs = new Map(); // name -> { file, i } (first definition in the segment); ambiguous -> null
data.tasks.forEach((t, i) => {
  for (const d of t.diffs) if (isRs(d.path)) for (const h of d.hunks) for (const l of h.lines) {
    if (l[0] !== '+') continue;
    for (const m of l.slice(1).matchAll(DEF)) {
      const n = m[1] || m[2]; if (baseNames.has(n) || n.length < 3) continue;
      const cur = defs.get(n);
      if (cur === undefined) defs.set(n, { file: d.path, i }); else if (cur && cur.file !== d.path) defs.set(n, null);
    }
  }
});
let ambiguous = 0; for (const v of defs.values()) if (v === null) ambiguous++;

// ---- needs ----
const seen = new Set(), rows = [];
data.tasks.forEach((t, i) => {
  for (const d of t.diffs) if (isRs(d.path)) for (const h of d.hunks) for (const l of h.lines) {
    if (l[0] !== '+') continue;
    const code = l.slice(1).replace(/\/\/.*$/, '').replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (const m of code.matchAll(IDENT)) {
      const def = defs.get(m[0]);
      if (!def || def.file === d.path || def.i > i) continue;
      const k = `${d.path}|${def.file}|${m[0]}`; if (seen.has(k)) continue; seen.add(k);
      const X = d.path, Y = def.file, cX = crateOf(X), cY = crateOf(Y);
      const iface = Y === X || usesOf(X).includes(Y) || (cX && cY && crateClosure(cX).has(cY));
      const strict = reachable(X).has(Y);
      rows.push({ X, Y, name: m[0], sameCommit: def.i === i, sameCrate: cX === cY, cX, cY, iface, strict, inModules: !!M.modules[X] && !!M.modules[Y] });
    }
  }
});

// ---- sanity: each file's own hunks in history order rebuild it ----
const files = new Map(Object.entries(data.files).map(([p, s]) => [p, s == null ? null : s.split('\n')]));
let applied = 0, failed = 0;
for (const t of data.tasks) for (const d of t.diffs) { if (d.binary || !d.hunks.length) continue; const r = applyDiff(files.get(d.path) ?? null, d); if (r.ok) applied++; else failed++; files.set(d.path, r.lines); }
let same = 0, differ = 0;
for (const [p, want] of Object.entries(data.final)) { const g = files.get(p); if ((g == null ? null : g.join('\n')) === want) same++; else differ++; }

const n = rows.length, cnt = (f) => rows.filter(f).length, pct = (k) => `${k} (${((100 * k) / Math.max(1, n)).toFixed(1)}%)`;
const ifaceV = rows.filter((r) => !r.iface), strictV = rows.filter((r) => !r.strict);
const out = {
  seg: data.seg, commits: data.tasks.length, namesDefined: defs.size - ambiguous, namesAmbiguous: ambiguous,
  needs: n, needsSameCommit: cnt((r) => r.sameCommit), needsSameCrate: cnt((r) => r.sameCrate), needsBothInModules: cnt((r) => r.inModules),
  interfacesFirst: { met: n - ifaceV.length, violated: ifaceV.length, sameCrateMissingUse: ifaceV.filter((r) => r.sameCrate).length, otherCrateNotDep: ifaceV.filter((r) => !r.sameCrate).length, fileNotInModules: ifaceV.filter((r) => !r.inModules).length },
  strict: { met: n - strictV.length, violated: strictV.length, sameCrate: strictV.filter((r) => r.sameCrate).length, otherCrate: strictV.filter((r) => !r.sameCrate).length, fileNotInModules: strictV.filter((r) => !r.inModules).length },
  perFileReplay: { hunksApplied: applied, failed, filesSameAsHistory: same, filesDiffer: differ },
  examples: { interfacesFirstViolated: ifaceV.slice(0, 8).map((r) => `${r.X} uses ${r.name} from ${r.Y}${r.sameCrate ? ' (same crate)' : ` (${r.cX} -> ${r.cY})`}`) },
};
console.log(JSON.stringify(out, null, 1));
console.error(`needs ${n}; interfaces-first violated ${pct(ifaceV.length)}; strict violated ${pct(strictV.length)}`);
