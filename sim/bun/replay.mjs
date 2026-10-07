#!/usr/bin/env node
// Replay every merge of oven-sh/bun#30412 with `git merge-tree` and count real
// text conflicts, per file kind and hot/cold. Needs the file contents the merges
// touch: the base / ours / theirs blobs of files BOTH sides changed to different
// results (a file changed on one side merges without its contents), plus added
// and deleted files for rename detection.
//
//   node sim/bun/replay.mjs --fetch     # list + fetch the missing blobs (stops above --max-gb, default 2)
//   node sim/bun/replay.mjs             # replay (no network) and add `merge_replay` to calibration.json
//
// Read-only on Bun's history: merge-tree writes loose objects into the clone and
// nothing else. Run analyze.mjs first (the hot-file list comes from its output).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const REPO = opt('--repo', join(homedir(), 'projects/github/oven-sh/bun-pr30412'));
const RANGE = '0d9b296af33f..refs/pr/30412';
const CAL = join(dirname(fileURLToPath(import.meta.url)), 'calibration.json');
const MAX_BYTES = +opt('--max-gb', 2) * 2 ** 30;
const Z = '0'.repeat(40);

// Git 2.43 ignores GIT_NO_LAZY_FETCH, so the guard is GIT_ALLOW_PROTOCOL=file: a
// missing blob is then an error instead of a silent one-by-one download. Only the
// explicit --fetch batches may reach GitHub.
const git = (a, o = {}) => execFileSync('git', ['-C', REPO, ...a],
  { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(o.lazy ? {} : { GIT_ALLOW_PROTOCOL: 'file' }) }, input: o.input });
const raw = (a, b) => { const m = new Map(); for (const l of git(['diff', '--raw', '--no-renames', '--no-abbrev', a, b]).split('\n')) {
  if (!l) continue; const [meta, p] = l.split('\t'); const f = meta.split(' '); m.set(p, { from: f[2], to: f[3] }); } return m; };
const packBytes = () => readdirSync(join(REPO, '.git/objects/pack')).filter(f => f.endsWith('.pack'))
  .reduce((a, f) => a + statSync(join(REPO, '.git/objects/pack', f)).size, 0);

// ---------- merges and the blobs they need ----------
const merges = git(['log', '--merges', '--format=%H %P %ct%x09%s', RANGE]).trim().split('\n').map(l => {
  const [head, subject] = l.split('\t'); const [sha, p1, p2, ct] = head.split(' ');
  return { sha, p1, p2, ct: +ct, subject };
}).reverse();
const need = new Set();
for (const m of merges) {
  m.base = git(['merge-base', m.p1, m.p2]).trim();
  const d1 = raw(m.base, m.p1), d2 = raw(m.base, m.p2);
  m.content = [...d1.keys()].filter(f => d2.has(f) && d1.get(f).to !== d2.get(f).to);
  for (const f of m.content) for (const o of [d1.get(f).from, d1.get(f).to, d2.get(f).to]) if (o !== Z) need.add(o);
  // rename detection (git merge's default, so we keep it) pairs files deleted on
  // one side with files added on it: it needs both sides' added and deleted blobs
  for (const d of [d1, d2]) for (const x of d.values()) if (x.from === Z || x.to === Z) for (const o of [x.from, x.to]) if (o !== Z) need.add(o);
  // criss-cross history: ort first merges the merge bases into a virtual one, so it
  // also needs every blob that differs between the bases (one merge here)
  const bases = git(['merge-base', '--all', m.p1, m.p2]).trim().split('\n');
  for (const b of bases.slice(1)) for (const [f, d] of raw(bases[0], b)) {
    for (const o of [d.from, d.to]) if (o !== Z) need.add(o);
    for (const x of bases.slice(1)) { const o = git(['ls-tree', x, '--', f]).split(' ')[2]?.split('\t')[0]; if (o) need.add(o); }
  }
}
// local objects only (--batch-all-objects never fetches)
const present = new Set(git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)']).split('\n'));
const missing = [...need].filter(o => !present.has(o));
console.log(`${merges.length} merges; ${merges.filter(m => m.content.length).length} need a text merge; ${need.size} blobs needed, ${missing.length} missing`);

if (args.includes('--fetch')) {
  const before = packBytes();
  for (let i = 0; i < missing.length; i += 500) {
    const used = packBytes() - before;
    if (used > MAX_BYTES) { console.log(`stopped: ${(used / 2 ** 20).toFixed(1)} MiB fetched, over the cap`); process.exit(2); }
    // what git's own promisor fetch runs, in batches instead of one blob at a time
    git(['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '-q', '--no-tags', '--no-write-fetch-head',
      '--recurse-submodules=no', '--filter=blob:none', '--stdin', 'origin'], { lazy: true, input: missing.slice(i, i + 500).join('\n') + '\n' });
    console.log(`  fetched ${Math.min(i + 500, missing.length)}/${missing.length}, ${((packBytes() - before) / 2 ** 20).toFixed(1)} MiB so far`);
  }
  console.log(`fetch done: ${((packBytes() - before) / 2 ** 20).toFixed(1)} MiB for ${missing.length} blobs`);
  process.exit(0);
}
if (missing.length) { console.log('blobs missing: run with --fetch first'); process.exit(1); }

// ---------- replay ----------
const cal = JSON.parse(readFileSync(CAL, 'utf8'));
const HOT = new Set(cal.hot_files.top_1pct_files || []);
if (!HOT.size) throw new Error('run analyze.mjs first (hot_files.top_1pct_files)');
const kindOf = f => /Cargo\.(toml|lock)$/.test(f) ? 'cargo' : /(^|\/)(lib|mod)\.rs$/.test(f) ? 'module_root'
  : /\.rs$/.test(f) ? 'rs' : /\.zig$/.test(f) ? 'zig' : /\.(md|tsv|txt)$/.test(f) ? 'docs' : /^test\//.test(f) ? 'test' : 'other';
const lsTree = sha => { const m = new Map(); for (const l of git(['ls-tree', '-r', '--full-tree', sha]).split('\n')) {
  if (!l) continue; const [meta, p] = l.split('\t'); m.set(p, meta.split(' ')[2]); } return m; };

const rows = [];
const byKind = {}, byHeat = { hot: [0, 0], cold: [0, 0] };
const resolution = { took_ours: 0, took_theirs: 0, new_text: 0, deleted: 0 };
let autoKept = 0, autoChanged = 0;
for (const m of merges) {
  if (!m.content.length) { rows.push({ sha: m.sha.slice(0, 10), content_files: 0, conflicted: [] }); continue; }
  let out, conflicted = [];
  try { out = git(['merge-tree', '--write-tree', '--name-only', '--no-messages', m.p1, m.p2]); }
  catch (e) { if (e.status !== 1) throw e; out = e.stdout; }
  const [tree, ...rest] = out.trim().split('\n');
  conflicted = [...new Set(rest.filter(Boolean))];
  const C = new Set(conflicted);
  // what the agent committed vs git's own result, ours, theirs
  const actual = lsTree(m.sha), auto = lsTree(tree), ours = lsTree(m.p1), theirs = lsTree(m.p2);
  for (const f of m.content) {
    const k = kindOf(f), clean = !C.has(f);
    (byKind[k] ||= [0, 0])[0]++; if (clean) byKind[k][1]++;
    const h = HOT.has(f) ? 'hot' : 'cold'; byHeat[h][0]++; if (clean) byHeat[h][1]++;
    if (clean) { if (actual.get(f) === auto.get(f)) autoKept++; else autoChanged++; }
    else { const a = actual.get(f);
      if (a === undefined) resolution.deleted++; else if (a === ours.get(f)) resolution.took_ours++;
      else if (a === theirs.get(f)) resolution.took_theirs++; else resolution.new_text++; }
  }
  rows.push({ sha: m.sha.slice(0, 10), at: new Date(m.ct * 1000).toISOString(), content_files: m.content.length,
    conflicted, subject: m.subject.slice(0, 120) });
}
const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : null;
const needing = rows.filter(r => r.content_files);
const totalFiles = needing.reduce((a, r) => a + r.content_files, 0);
const totalConf = needing.reduce((a, r) => a + r.conflicted.length, 0);
const conflicts = Object.values(resolution).reduce((a, b) => a + b, 0);
const replay = {
  note: 'git merge-tree --write-tree on every merge, renames on like git merge (ort, git ' + git(['version']).trim().split(' ')[2] + '). "content file" = changed on both sides to different results; clean = git merged it by itself.',
  merges: rows.length, merges_needing_text_merge: needing.length,
  merges_with_conflicts: needing.filter(r => r.conflicted.length).length,
  pct_of_all_merges_with_conflicts: pct(needing.filter(r => r.conflicted.length).length, rows.length),
  pct_of_text_merges_with_conflicts: pct(needing.filter(r => r.conflicted.length).length, needing.length),
  content_files: totalFiles, conflicted_files: totalConf,
  p_clean_all: +((byHeat.hot[1] + byHeat.cold[1]) / totalFiles).toFixed(3),
  conflicted_files_not_content_files: totalConf - (totalFiles - byHeat.hot[1] - byHeat.cold[1]), // modify/delete, add/add, rename
  p_clean_hot: byHeat.hot[0] ? +(byHeat.hot[1] / byHeat.hot[0]).toFixed(3) : null,
  p_clean_cold: byHeat.cold[0] ? +(byHeat.cold[1] / byHeat.cold[0]).toFixed(3) : null,
  hot_definition: `top 1% of files by commits touching them (${HOT.size} files)`,
  content_files_hot_cold: { hot: byHeat.hot[0], cold: byHeat.cold[0] },
  p_clean_by_kind: Object.fromEntries(Object.entries(byKind).map(([k, [n, c]]) => [k, { files: n, p_clean: +(c / n).toFixed(3) }])),
  p_clean_by_merge_size: (() => { const B = {}; for (const r of needing) {
      const k = r.content_files <= 3 ? '1-3' : r.content_files <= 10 ? '4-10' : r.content_files <= 50 ? '11-50' : '>50';
      const b = B[k] ||= { merges: 0, with_conflicts: 0, files: 0, conflicted: 0 };
      b.merges++; b.files += r.content_files; b.conflicted += r.conflicted.length; if (r.conflicted.length) b.with_conflicts++; }
    for (const b of Object.values(B)) b.p_clean = +(1 - b.conflicted / b.files).toFixed(3);
    return B; })(),
  agents_named_same_count_in_subject: needing.filter(r => r.conflicted.length && +(r.subject.match(/(\d+) (conflicts|resolved)/)?.[1]) === r.conflicted.length).length,
  conflicts_per_conflicted_merge: (() => { const xs = needing.filter(r => r.conflicted.length).map(r => r.conflicted.length).sort((a, b) => a - b);
    return { p50: xs[Math.floor(xs.length / 2)] ?? null, max: xs.at(-1) ?? null }; })(),
  how_agents_resolved_conflicts: { ...resolution, pct_took_one_side_whole: pct(resolution.took_ours + resolution.took_theirs, conflicts) },
  clean_files_agent_kept_gits_result: pct(autoKept, autoKept + autoChanged),
  conflicted_merges: needing.filter(r => r.conflicted.length).map(r => ({ sha: r.sha, at: r.at, content_files: r.content_files,
    conflicted: r.conflicted.length, files: r.conflicted.slice(0, 12), subject: r.subject })),
};
cal.merge_replay = replay;
writeFileSync(CAL, JSON.stringify(cal, null, 1) + '\n');
const { conflicted_merges, ...head } = replay;
console.log(JSON.stringify(head, null, 1));
