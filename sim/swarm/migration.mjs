// The migration: move every module of Hono's src/utils/ to src/lib/, the way a team (or a
// swarm) would do it without a big-bang commit:
//   move(X)    (one module, or one import cycle of them) create src/lib/X.ts, leave src/utils/X.ts as a one-line re-export ("shim"),
//              point jsr.json's export at the new file (jsr.json: one shared file, one line
//              per module, adjacent lines: the hot file)
//   use(F)     rewrite every import of a utils module in file F (source or test) to src/lib/
//   unshim(X)  delete the shim once nothing imports it any more
// Each task is a codemod: an intent that can be applied to any version of the tree. Applied
// to the version an agent started from it is the agent's change; applied to the latest main
// it is "land by intent". needs/provides come from the import graph, not from guessing:
//   move(X) needs move(Y) for every utils module Y that X imports (lib/X imports ./Y)
//   use(F)  needs move(X) for every X it imports
//   unshim(X) needs use(F) for every F that imports X, and move(Z) for utils modules Z that do
// No model calls.
import { dirname, join, normalize, relative } from 'node:path';

const FROM = 'src/utils/', TO = 'src/lib/';
export const SHIM_MARK = '// moved to src/lib/ (migration shim)';
const EXTS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
// import x from '…' · export * from '…' · import '…' · import('…') · vi.mock('…')
export const SPEC_RE = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|doMock|importActual)\(\s*)(['"])(\.\.?\/[^'"\n]*)\2/g;

const isTest = (p) => /\.test\.tsx?$/.test(p);
export const libPath = (p) => TO + p.slice(FROM.length);

// Resolve a relative specifier the way TypeScript's bundler resolution would.
export function resolveSpec(fromFile, spec, exists) {
  const b = normalize(join(dirname(fromFile), spec));
  for (const e of EXTS) if (exists(b + e)) return { path: b + e, form: e.includes('index') ? 'index' : e ? 'ext' : 'exact' };
  return null;
}
function specFor(fromFile, target, form) {
  let t = target;
  if (form === 'index') t = dirname(target);
  else if (form === 'ext') t = target.replace(/\.tsx?$/, '');
  let r = relative(dirname(fromFile), t);
  if (!r.startsWith('.')) r = './' + r;
  return r;
}

// Rewrite the relative imports of a file that lives at `cur` and will live at `dest`.
// Anything that resolves to a utils module points at its lib/ copy; everything else keeps
// its target (re-expressed relative to `dest` when the file moves).
export function rewriteImports(text, cur, dest, ctx) {
  let changed = false;
  const out = text.replace(SPEC_RE, (all, pre, q, spec) => {
    const r = resolveSpec(cur, spec, ctx.exists);
    if (!r) return all;
    const target = ctx.modules.has(r.path) ? libPath(r.path) : r.path;
    if (target === r.path && dest === cur) return all;
    const ns = specFor(dest, target, r.form);
    if (ns === spec) return all;
    changed = true;
    return `${pre}${q}${ns}${q}`;
  });
  return changed ? out : null;
}

export function buildMigration(files /* Map path -> text */) {
  const modules = new Set([...files.keys()].filter((p) => p.startsWith(FROM) && /\.tsx?$/.test(p) && !isTest(p)));
  const virtual = new Set([...files.keys(), ...[...modules].map(libPath)]);
  const ctx = { modules, exists: (p) => virtual.has(p) };
  // Import graph of the starting tree: who imports which utils module.
  const importers = new Map([...modules].map((m) => [m, new Set()]));
  for (const [p, text] of files) {
    if (!/\.tsx?$/.test(p)) continue;
    for (const m of text.matchAll(SPEC_RE)) {
      const r = resolveSpec(p, m[3], (x) => files.has(x));
      if (r && modules.has(r.path) && r.path !== p) importers.get(r.path).add(p);
    }
  }
  // Modules that import each other (Hono: jwt/jws <-> jwt/types) cannot move one at a time:
  // lib/X would import a lib/Y that does not exist yet. Each cycle is one move task.
  const deps = new Map([...modules].map((m) => [m, [...modules].filter((y) => importers.get(y).has(m))]));
  const group = new Map(); // module -> its cycle (strongly connected component)
  {
    let index = 0; const idx = new Map(), low = new Map(), stack = [], on = new Set();
    const visit = (v) => {
      idx.set(v, index); low.set(v, index); index++; stack.push(v); on.add(v);
      for (const w of deps.get(v)) {
        if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
      }
      if (low.get(v) === idx.get(v)) { const c = []; let w; do { w = stack.pop(); on.delete(w); c.push(w); } while (w !== v); c.sort(); for (const x of c) group.set(x, c); }
    };
    for (const v of [...modules].sort()) if (!idx.has(v)) visit(v);
  }
  const tasks = [];
  const byKey = new Map();
  const add = (t) => { t.id = tasks.length + 1; tasks.push(t); byKey.set(t.key, t); return t; };
  const short = (p) => p.replace(/^src\//, '');
  const moveKey = (m) => `move:${group.get(m)[0]}`;
  for (const m of [...modules].sort()) {
    const g = group.get(m);
    if (g[0] !== m) continue;
    add({ key: moveKey(m), kind: 'move', phase: 1, targets: g, target: m, text: g.length === 1 ? `Move ${short(m)} to ${short(libPath(m))} (shim left behind)` : `Move ${g.map(short).join(' + ')} to src/lib/ together (they import each other)` });
  }
  const users = new Set();
  for (const [m, imps] of importers) for (const f of imps) if (!modules.has(f)) users.add(f);
  for (const f of [...users].sort()) add({ key: `use:${f}`, kind: 'use', phase: 2, targets: [f], target: f, text: `Point ${short(f)}'s imports at src/lib/` });
  for (const m of [...modules].sort()) add({ key: `unshim:${m}`, kind: 'unshim', phase: 3, targets: [m], target: m, text: `Delete the shim ${short(m)}` });
  for (const t of tasks) {
    const needs = new Set();
    if (t.kind !== 'unshim') { for (const [m, imps] of importers) if (t.targets.some((x) => imps.has(x))) needs.add(moveKey(m)); }
    else for (const f of importers.get(t.target)) needs.add(modules.has(f) ? moveKey(f) : `use:${f}`);
    needs.delete(t.key);
    t.needs = [...needs].map((k) => byKey.get(k).id);
  }
  // A codemod: (read, has) of some tree -> Map(path -> text | null for delete), or null when
  // there is nothing (yet) to do on that tree.
  const apply = (t, read) => {
    if (t.kind === 'move') {
      const out = new Map();
      let jsr = read('jsr.json');
      for (const m of t.targets) {
        const src = read(m);
        if (src == null || src.startsWith(SHIM_MARK)) return null;
        const dest = libPath(m);
        out.set(dest, rewriteImports(src, m, dest, ctx) ?? src);
        out.set(m, `${SHIM_MARK}\nexport * from '${specFor(m, dest, 'ext')}'\n`);
        const from = `"./${m}"`, to = `"./${dest}"`;
        if (jsr != null && jsr.includes(from)) { jsr = jsr.replace(from, to); out.set('jsr.json', jsr); }
      }
      return out;
    }
    if (t.kind === 'use') {
      const src = read(t.target);
      if (src == null) return null;
      const next = rewriteImports(src, t.target, t.target, ctx);
      return next == null ? null : new Map([[t.target, next]]);
    }
    const src = read(t.target);
    if (src == null || !src.startsWith(SHIM_MARK)) return null; // not moved yet (or gone)
    return new Map([[t.target, null]]);
  };
  return { tasks, modules, importers, apply, ctx };
}
