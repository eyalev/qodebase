// Is main whole after a run? Clone it with a short read token, git fsck, then the project's own tests on the
// final tree, and count the commits per lane.  node sim/cloud/verify.mjs [dir]   (key: ~/.config/qbsim/key)
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { check } from '../real/project.mjs';

const BASE = 'https://qbsim-cloud.forqdev.workers.dev';
const key = readFileSync(join(homedir(), '.config/qbsim/key'), 'utf8').trim();
const RUN = process.env.RUN || '';   // RUN=<runId>: an earlier run's main
const r = await fetch(`${BASE}/clone${RUN ? `?run=${RUN}` : ''}`, { headers: { 'x-sim-key': key, 'user-agent': 'qbsim-cli/1' } });
const { remote, token, error } = await r.json();
if (error) throw new Error(error);
const dir = process.argv[2] || mkdtempSync(join(tmpdir(), 'qbsim-verify-'));
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28 });
const auth = `http.extraHeader=Authorization: Basic ${Buffer.from(`x:${token}`).toString('base64')}`;
execFileSync('git', ['-c', auth, 'clone', '-q', remote, dir], { stdio: 'inherit' });
const fsck = (() => { try { git('fsck', '--no-progress'); return 'ok'; } catch (e) { return String(e.stdout || e.message).slice(0, 400); } })();
const files = new Map();
const walk = (d, pre) => { for (const n of readdirSync(d)) { if (n === '.git') continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p, pre + n + '/'); else files.set(pre + n, readFileSync(p, 'utf8')); } };
walk(dir, '');
const fails = check((p) => files.get(p) ?? null, () => files.keys());
const subjects = git('log', '--format=%s').trim().split('\n');
const bodies = git('log', '--format=%B%x00').split('\0');
const perLane = {};
for (const s of subjects) { const m = /^(L\d+|X):/.exec(s); const k = m ? m[1] : 'other'; perLane[k] = (perLane[k] || 0) + 1; }
const landedIds = bodies.flatMap((s) => [...s.matchAll(/#([A-Z0-9]+-\d+)/g)].map((m) => m[1]));
// The main door's subject counts each lane's changes ('C: land L0x5 L1x3'): their sum, for runs before ids were in the body.
const doorCount = subjects.filter((s) => s.startsWith('C: land')).reduce((a, s) => a + [...s.matchAll(/\b(?:L\d+|X)x(\d+)/g)].reduce((b, m) => b + Number(m[1]), 0), 0);
console.log(JSON.stringify({ fsck, files: files.size, testFails: fails.length, firstFails: fails.slice(0, 5), commits: subjects.length, perLane, doorCount, landedIds: landedIds.length, dupIds: landedIds.length - new Set(landedIds).size }));
if (!process.argv[2]) rmSync(dir, { recursive: true, force: true });
