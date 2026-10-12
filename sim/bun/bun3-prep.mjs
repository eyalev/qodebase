#!/usr/bin/env node
// BUN3 prep (runs on a VM with a FULL clone of oven-sh/bun + refs/pr/30412): exports the real patches of one
// segment of Bun's port so sim/bun/bun3.mjs can replay them with real content, no git calls per landing.
//
//   node sim/bun/bun3-prep.mjs --repo /opt/bun --seg cde|tail --out sim/bun/out/bun3-cde.json.gz
//
// Writes { seg, base, files: {path: text at base | null}, final: {path: text after the segment's last
// commit, in history}, tasks: [{ sha, parent, phase, at, subject, crates, diffs: [{ path, binary, hunks:
// [{ os, ol, ns, nl, lines }] }] }] } where lines are the hunk's lines with their ' ', '-', '+' prefix (-U3).
// Tasks are the segment's non-merge commits from sim/bun/tasks.json, in commit-time order.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const REPO = arg('repo', '/opt/bun'), SEG = arg('seg', 'cde'), OUT = arg('out', join(HERE, `out/bun3-${SEG}.json.gz`));
const PHASES = SEG === 'cde' ? ['c', 'd', 'e'] : [SEG];
const git = (args, input) => execFileSync('git', ['-C', REPO, ...args], { maxBuffer: 1 << 30, input }).toString();

const D = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'));
const short = D.tasks.filter((t) => PHASES.includes(t.phase)).sort((a, b) => a.at - b.at);
// full shas, parents and subjects in one call
const info = git(['log', '--no-walk=unsorted', '--format=%H %P%x09%s', ...short.map((t) => t.sha)]).trim().split('\n');
const byShort = new Map(info.map((l) => { const [hp, s] = l.split('\t'); const [h, p] = hp.split(' '); return [h.slice(0, 10), { sha: h, parent: p, subject: s }]; }));

const crateOf = (p) => { const m = /^src\/([^/]+)\//.exec(p); return m ? m[1] : p.split('/')[0]; };
function parseDiff(text) {
  const diffs = []; let cur = null, h = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) { cur = { path: line.split(' b/').slice(1).join(' b/'), binary: false, hunks: [] }; diffs.push(cur); h = null; continue; }
    if (!cur) continue;
    if (line.startsWith('Binary files')) { cur.binary = true; continue; }
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) { h = { os: +m[1], ol: m[2] == null ? 1 : +m[2], ns: +m[3], nl: m[4] == null ? 1 : +m[4], lines: [] }; cur.hunks.push(h); continue; }
    if (h && (line[0] === ' ' || line[0] === '-' || line[0] === '+')) h.lines.push(line);
    else if (h && line.startsWith('\\')) h.lines.push(line);
  }
  return diffs;
}

const tasks = [];
for (const t of short) {
  const i = byShort.get(t.sha);
  if (!i) { console.error('missing', t.sha); continue; }
  const diffs = parseDiff(git(['diff', '-U3', '--no-color', '--no-renames', '--no-ext-diff', i.parent, i.sha]));
  tasks.push({ sha: i.sha, parent: i.parent, phase: t.phase, at: t.at, subject: i.subject, crates: [...new Set(diffs.map((d) => crateOf(d.path)))], diffs });
  if (tasks.length % 500 === 0) console.error(`${tasks.length}/${short.length}`);
}
const base = tasks[0].parent, last = tasks.at(-1).sha;
const paths = [...new Set(tasks.flatMap((t) => t.diffs.map((d) => d.path)))];
function contents(rev) {
  const out = {};
  const r = execFileSync('git', ['-C', REPO, 'cat-file', '--batch'], { input: paths.map((p) => `${rev}:${p}`).join('\n') + '\n', maxBuffer: 1 << 31 });
  let off = 0;
  for (const p of paths) {
    const nl = r.indexOf(10, off), head = r.subarray(off, nl).toString();
    if (head.endsWith('missing')) { out[p] = null; off = nl + 1; continue; }
    const size = +head.split(' ')[2];
    out[p] = r.subarray(nl + 1, nl + 1 + size).toString();
    off = nl + 1 + size + 1;
  }
  return out;
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, gzipSync(JSON.stringify({ seg: SEG, base, last, files: contents(base), final: contents(last), tasks })));
console.error(`wrote ${OUT}: ${tasks.length} tasks, ${paths.length} files, base ${base.slice(0, 10)}, last ${last.slice(0, 10)}`);
