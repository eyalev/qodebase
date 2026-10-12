#!/usr/bin/env node
// BUN1: Bun's Zig->Rust port (oven-sh/bun#30412) as a task stream for the swarm sim (sim/bun/swarm.mjs).
// One task per real non-merge commit: its phase (from the subject), stream, files touched, time. Read from the
// blobless clone (names and trees only, never the network). node sim/bun/tasks.mjs -> sim/bun/tasks.json
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(homedir(), 'projects/github/oven-sh/bun-pr30412');
const RANGE = '0d9b296af33f..refs/pr/30412';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'tasks.json');
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' } });

const rows = [];
for (const rec of git('log', '--reverse', '--topo-order', '--no-renames', '--name-only', '--format=%x1e%H%x1f%P%x1f%at%x1f%s', RANGE).split('\x1e').slice(1)) {
  const [head, ...rest] = rec.split('\n');
  const [sha, p, at, subject] = head.split('\x1f');
  if (p.split(' ').length !== 1) continue; // merges are not work
  const m = subject.match(/^phase-([a-z])\w*(\(([^)]*)\))?/i);
  const t = subject.match(/^([A-Za-z][\w./-]*)(\([^)]*\))?:/);
  rows.push({ sha: sha.slice(0, 10), at: +at, phase: m ? m[1].toLowerCase() : 'tail', stream: m ? m[0].toLowerCase() : t ? t[0].slice(0, -1).toLowerCase() : '(untagged)', files: rest.filter(Boolean) });
}
// Phases f, g, h and untagged work ran as a parallel tail after e (calibration.json "phases").
for (const r of rows) if ('fgh'.includes(r.phase)) r.phase = 'tail';
const paths = [...new Set(rows.flatMap((r) => r.files))].sort();
const idx = new Map(paths.map((p, i) => [p, i]));
const tasks = rows.map((r) => ({ sha: r.sha, at: r.at, phase: r.phase, stream: r.stream, f: r.files.map((p) => idx.get(p)) }));
writeFileSync(OUT, JSON.stringify({ source: { repo: 'oven-sh/bun', pr: 30412, range: RANGE, license: 'MIT', note: 'non-merge commits in order; f = indexes into files' }, files: paths, tasks }));
const by = {}; for (const t of tasks) by[t.phase] = (by[t.phase] || 0) + 1;
console.log(`${tasks.length} tasks, ${paths.length} files -> ${OUT}`, by);
