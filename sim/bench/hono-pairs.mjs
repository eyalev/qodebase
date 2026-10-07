#!/usr/bin/env node
// The merge-prediction bench (conflicts.mjs) on real code: pairs of real honojs/hono
// changes, both written against the same main S. Ground truth from tools:
//   text      `git merge-tree` of the two (base S) conflicts
//   semantic  merges cleanly, but tsgo on the result shows errors S and each change alone did not
// Then Jev / Clef-flash are asked the same merge-v1 questions from the two diffs.
//
//   node sim/bench/hono-pairs.mjs [--n 80] [--window 50] [--providers jev,clef-flash]
// One JSON line per (pair, provider) in ~/.local/share/qbsim-bench/runs.jsonl.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { provider } from '../../../../2026-09/desk/scripts/system-one.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
const REPO = join(homedir(), 'projects/github/honojs/hono');
const N = Number(args.n || 80), WINDOW = Number(args.window || 50);
const PROVIDERS = String(args.providers || 'jev,clef-flash').split(',');
const QV = 'merge-v1-diff-only-real';
const QUESTIONS = {
  text: { type: 'noul', instructions: 'Merging these two changes with git will produce a text conflict: they edit the same or directly adjacent lines of the same file.' },
  semantic: { type: 'noul', instructions: 'Even if git merges these two changes cleanly, the merged code will be broken: one change renames or removes something (a function, type, export or parameter) that the other change uses.' },
};
const LOG = join(homedir(), '.local/share/qbsim-bench'); mkdirSync(LOG, { recursive: true });
const git = (a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const gitTry = (a) => spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(Number(args.seed || 1));

const chain = git(['log', '--first-parent', '--format=%H %P', 'origin/main', '-n', '500']).split('\n').map((l) => { const [sha, p] = l.split(' '); return { sha, parent: p }; }).reverse();
function merge3(base, ours, theirs) {
  const r = gitTry(['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, ours, theirs]);
  const out = r.stdout.split('\n'), conflicts = [];
  for (let i = 1; i < out.length && out[i] !== ''; i++) conflicts.push(out[i]);
  return { tree: out[0].trim(), conflicts: r.status === 1 ? conflicts : [] };
}
const wt = join(REPO, '..', '.hono-bench');
if (!existsSync(wt)) { git(['worktree', 'add', '-q', '--detach', wt, chain[0].parent]); symlinkSync(join(REPO, 'node_modules'), join(wt, 'node_modules')); }
const errCache = new Map();
function errors(tree) {
  if (errCache.has(tree)) return errCache.get(tree);
  execFileSync('git', ['-C', wt, 'read-tree', '-u', '--reset', tree]);
  const r = spawnSync(join(REPO, 'node_modules/.bin/tsgo'), ['-p', 'tsconfig.build.json', '--noEmit'], { cwd: wt, encoding: 'utf8', maxBuffer: 64 << 20 });
  const keys = new Set((r.stdout + r.stderr).split('\n').map((l) => /^(\S+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(l)).filter(Boolean).map((m) => `${m[1]} ${m[2]} ${m[3]}`));
  errCache.set(tree, keys); return keys;
}
const treeOf = (c) => git(['rev-parse', `${c}^{tree}`]);

// Windows of WINDOW changes all written against the window's first parent S.
const candidates = [];
for (let w = 0; w + WINDOW <= chain.length; w += WINDOW) {
  const S = chain[w].parent;
  const authored = [];
  for (const c of chain.slice(w, w + WINDOW)) {
    const a = merge3(c.parent, S, c.sha);
    if (a.conflicts.length) continue;
    const tip = git(['commit-tree', a.tree, '-p', S, '-m', 'as written on S']);
    const files = git(['diff', '--name-only', S, tip]).split('\n').filter(Boolean);
    if (files.length && files.length <= 25) authored.push({ c, tip, tree: a.tree, files });
  }
  for (let i = 0; i < authored.length; i++) for (let j = i + 1; j < authored.length; j++) {
    const share = authored[i].files.some((f) => authored[j].files.includes(f));
    if (share || rnd() < 0.02) candidates.push({ S, a: authored[i], b: authored[j], share });
  }
}
console.log(`${candidates.length} candidate pairs (${candidates.filter((c) => c.share).length} share a file)`);

const diffOf = (S, tip) => gitTry(['diff', '--unified=2', S, tip]).stdout.split('\n').slice(0, 160).join('\n');
const pairs = [];
for (const k of candidates.sort(() => rnd() - 0.5)) {
  const m = merge3(k.S, k.a.tip, k.b.tip);
  let semantic = null;
  if (!m.conflicts.length) {
    const base = errors(treeOf(k.S));
    const alone = new Set([...errors(k.a.tree), ...errors(k.b.tree)]);
    semantic = [...errors(m.tree)].some((e) => !base.has(e) && !alone.has(e));
  }
  pairs.push({ ...k, text: m.conflicts.length > 0, semantic, conflictFiles: m.conflicts });
  // Keep every positive; stop when the sample is big enough.
  const pos = pairs.filter((p) => p.text || p.semantic).length;
  if (pairs.length >= N && pos >= 5) break;
  if (pairs.length >= N * 3) break;
}
const keep = [...pairs.filter((p) => p.text || p.semantic), ...pairs.filter((p) => !p.text && !p.semantic)].slice(0, N);
console.log(`${keep.length} pairs: ${keep.filter((p) => p.text).length} text conflicts, ${keep.filter((p) => p.semantic).length} clean-but-broken, ${keep.filter((p) => p.semantic === false).length} fine`);

const results = [];
for (const prov of PROVIDERS) {
  const call = provider(prov);
  for (const p of keep) {
    const state = { changeA: { diff: diffOf(p.S, p.a.tip) }, changeB: { diff: diffOf(p.S, p.b.tip) } };
    let r, err = null;
    try { r = await call(state, QUESTIONS, { timeout: 60000 }); } catch (e) { err = String(e).slice(0, 300); }
    const row = { ts: new Date().toISOString(), event: 'merge_bench_real', question_version: QV, provider: prov, model: r?.model ?? null, repo: 'honojs/hono', a: p.a.c.sha.slice(0, 10), b: p.b.c.sha.slice(0, 10), share: p.share, textConflict: p.text, semantic: p.semantic, conflictFiles: p.conflictFiles, pText: r?.answers?.text?.noul ?? null, pSemantic: r?.answers?.semantic?.noul ?? null, ms: r?.ms ?? null, usage: r?.usage ?? null, err };
    appendFileSync(join(LOG, 'runs.jsonl'), JSON.stringify(row) + '\n');
    results.push(row); process.stderr.write(err ? 'x' : '.');
  }
  process.stderr.write(` ${prov}\n`);
}

function auc(rows, pk, yk) { const pos = rows.filter((r) => r[yk]).map((r) => r[pk]), neg = rows.filter((r) => !r[yk]).map((r) => r[pk]); if (!pos.length || !neg.length) return null; let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0; return s / (pos.length * neg.length); }
function wilson(k, n) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
const pct = (x) => `${Math.round(x * 100)}%`;
for (const prov of PROVIDERS) {
  const rows = results.filter((r) => r.provider === prov && !r.err);
  console.log(`\n${prov} (${rows[0]?.model ?? '?'}): ${rows.length} answered, ${results.filter((r) => r.provider === prov && r.err).length} failed, median ${rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? '-'} ms`);
  for (const [q, pk, yk, sel] of [['text conflict', 'pText', 'textConflict', () => true], ['clean but broken', 'pSemantic', 'semantic', (r) => r.semantic !== null]]) {
    const rs = rows.filter(sel); if (!rs.length) continue;
    const k = rs.filter((r) => (r[pk] >= 0.5) === !!r[yk]).length, [lo, hi] = wilson(k, rs.length), a = auc(rs, pk, yk);
    console.log(`  ${q.padEnd(17)} n=${rs.length} (${rs.filter((r) => r[yk]).length} true)  AUC ${a == null ? '-' : a.toFixed(2)}  right at 0.5: ${k}/${rs.length} = ${pct(k / rs.length)} [${pct(lo)}-${pct(hi)}]`);
    const bins = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]];
    console.log(`  ${''.padEnd(17)} ${bins.map(([l, h]) => { const b = rs.filter((r) => r[pk] >= l && r[pk] < h); return `p${l.toFixed(1)}-${Math.min(h, 1).toFixed(1)}: ${b.filter((r) => r[yk]).length}/${b.length}`; }).join('  ')}`);
  }
}
gitTry(['worktree', 'remove', '--force', wt]);
