// Import closure of a test file at a commit, read straight from git (no checkout): how much of
// OpenClaw a standalone fix-lane starter would have to carry. Relative imports are followed;
// workspace packages (`@openclaw/*`) are followed into packages/, the root package (`openclaw/*`) into src/;
// everything else counts as an npm dependency.
//   node sim/openclaw/closure.mjs <commit> <file> [<file>...]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const GD = path.join(process.env.OPENCLAW_DATA || path.join(os.homedir(), 'projects/github/openclaw/data'), 'main.git');
const env = { ...process.env, GIT_NO_LAZY_FETCH: '1' };
const [commit, ...starts] = process.argv.slice(2);
const files = new Set(execFileSync('git', ['--git-dir', GD, 'ls-tree', '-r', '--name-only', commit], { env, maxBuffer: 1 << 28 }).toString().split('\n'));
const show = (f) => { try { return execFileSync('git', ['--git-dir', GD, 'show', `${commit}:${f}`], { env, maxBuffer: 1 << 26 }).toString(); } catch { return ''; } };
// Workspace package name -> dir, from every packages/*/package.json and extensions/*/package.json.
const pkgDirs = {};
for (const f of files) if (/^(packages|extensions)\/[^/]+\/package\.json$/.test(f)) { try { const n = JSON.parse(show(f)).name; if (n) pkgDirs[n] = path.dirname(f); } catch {} }
const resolve = (from, spec) => {
  let base;
  if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  // The root package `openclaw` exports ./plugin-sdk/* etc. from dist/, which is built from src/.
  else if (spec === 'openclaw' || spec.startsWith('openclaw/')) base = 'src/' + (spec.slice('openclaw/'.length) || 'index');
  else { const m = Object.keys(pkgDirs).sort((a, b) => b.length - a.length).find((n) => spec === n || spec.startsWith(n + '/')); if (!m) return null; base = path.posix.join(pkgDirs[m], spec.slice(m.length).replace(/^\//, '') || 'src/index'); if (!spec.slice(m.length)) base = pkgDirs[m] + '/src/index'; }
  const stem = base.replace(/\.(m|c)?js$/, '');
  for (const c of [base, stem + '.ts', stem + '.tsx', stem + '.mts', stem + '.js', stem + '.mjs', stem + '/index.ts', stem + '/index.js', base + '.ts']) if (files.has(c)) return c;
  return 'UNRESOLVED:' + spec;
};
const seen = new Set(), npm = new Set(), unresolved = new Set(); const q = [...starts];
while (q.length) {
  const f = q.pop(); if (seen.has(f)) continue; seen.add(f);
  const src = show(f);
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^import\s+['"]([^'"]+)['"]|vi\.mock\(\s*['"]([^'"]+)['"]/gm)) {
    const spec = m[1] || m[2] || m[3] || m[4];
    if (spec.startsWith('node:') || /^(fs|path|os|url|crypto|util|events|stream|child_process|http|https|net|zlib|assert|buffer|module|readline|tty|worker_threads|dns|timers|perf_hooks|v8|vm|process|string_decoder|async_hooks|sqlite)(\/|$)/.test(spec)) continue;
    const r = resolve(f, spec);
    if (r === null) npm.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    else if (r.startsWith('UNRESOLVED:')) unresolved.add(r.slice(11));
    else q.push(r);
  }
}
const top = {}; for (const f of seen) { const k = f.split('/').slice(0, 2).join('/'); top[k] = (top[k] || 0) + 1; }
console.log(JSON.stringify({ commit: commit.slice(0, 9), starts, files: seen.size, npm_deps: [...npm].sort(), unresolved: [...unresolved].slice(0, 10), unresolved_n: unresolved.size, by_dir: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 12) }));
