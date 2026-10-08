// Phase 2a (no model, read-only): would PR-scoped tests catch the breaks the hourly full suite finds?
// For each NEW persistent break (a shard that fails in hourly run i, not in i-1, and again in i+1),
// read that job's log for the failing test files, then look at the commits that landed on main
// between run i-1 and run i: did any of them touch the failing test's area (what OpenClaw's
// `checks-node-changed-*` lanes select by changed files)?
//   node sim/openclaw/breaks.mjs [--sample 40] [--budget 400]
// Writes data/breaks.jsonl (one row per break, only extracted lines, never whole logs) and
// data/breaks-summary.json.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA = process.env.OPENCLAW_DATA || path.join(os.homedir(), 'projects/github/openclaw/data');
const REPO = 'openclaw/openclaw';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const SAMPLE = +opt('sample', 40), BUDGET = +opt('budget', 400);
const TOKEN = execFileSync('gh', ['auth', 'token']).toString().trim();
const readJsonl = (f) => fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const logReq = (o) => fs.appendFileSync(path.join(DATA, 'requests.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let spent = 0;

async function get(url, stream, raw = false) {
  for (let a = 0; a < 5; a++) {
    if (spent >= BUDGET) throw new Error('budget');
    const t0 = Date.now();
    const r = await fetch(url, { headers: { authorization: `bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'qodebase-openclaw-study/1 (read-only)' } });
    spent++;
    logReq({ api: 'rest', stream, status: r.status, ms: Date.now() - t0, url: url.replace('https://api.github.com', ''), remaining: +r.headers.get('x-ratelimit-remaining') || null });
    if (r.ok) return raw ? r.text() : r.json();
    if (r.status === 404 || r.status === 410) return null; // logs expire / not kept
    await sleep(2000 * 2 ** a);
  }
  return null;
}

// ---- the breaks, from the hourly runs' jobs ----
const runsById = new Map(readJsonl('runs.jsonl').map((r) => [r.id, r]));
const sched = readJsonl('jobs.jsonl').filter((j) => j.event === 'schedule').sort((a, b) => a.run_id - b.run_id);
const failed = sched.map((j) => new Set(j.jobs.filter((x) => x.conclusion === 'failure' && x.name !== 'openclaw/ci-gate').map((x) => x.name)));
const breaks = [];
for (let i = 1; i < sched.length - 1; i++) for (const name of failed[i]) if (!failed[i - 1].has(name) && failed[i + 1].has(name)) breaks.push({ run: sched[i].run_id, prev: sched[i - 1].run_id, name });
// Spread the sample over the week; one break per run first, so one bad hour does not dominate.
const byRun = new Map(); for (const b of breaks) (byRun.get(b.run) || byRun.set(b.run, []).get(b.run)).push(b);
const pick = []; for (let round = 0; pick.length < SAMPLE && round < 10; round++) for (const [, bs] of byRun) if (bs[round] && pick.length < SAMPLE) pick.push(bs[round]);

const out = path.join(DATA, 'breaks.jsonl');
const done = new Set(fs.existsSync(out) ? readJsonl('breaks.jsonl').map((b) => `${b.run}:${b.name}`) : []);
const jobIds = new Map(); // run -> Map(name -> id)
async function jobsOf(run) {
  if (jobIds.has(run)) return jobIds.get(run);
  const m = new Map();
  for (let p = 1; p <= 10; p++) {
    const j = await get(`https://api.github.com/repos/${REPO}/actions/runs/${run}/jobs?per_page=40&page=${p}`, 'breaks-jobs');
    if (!j) break; for (const x of j.jobs) m.set(x.name, x.id);
    if (j.jobs.length < 40) break;
  }
  jobIds.set(run, m); return m;
}

// Failing test files from a vitest/node log: "FAIL  path/x.test.ts", "❯ path/x.test.ts", "at ... (path:line)".
function failingFiles(log) {
  const files = new Set(); const lines = [];
  for (const l of log.split('\n')) {
    const s = l.replace(/^\S+Z /, '').replace(/\x1b\[[0-9;]*m/g, '');
    const m = s.match(/(?:FAIL|×|✗|❯)\s+([\w@./-]+\.(?:test|spec|e2e)\.[cm]?[jt]sx?)/);
    if (m) { files.add(m[1].replace(/^\.\//, '')); if (lines.length < 12) lines.push(s.slice(0, 200)); }
    else if (/error|Error:|AssertionError|Timed out|ETIMEDOUT|ECONNRESET|exit code|Process completed with exit code/.test(s) && lines.length < 12) lines.push(s.slice(0, 200));
  }
  return { files: [...files], lines };
}

// The area a test belongs to: extensions/<name>, apps/<name>, packages/<name>, ui, or src/<dir>.
const area = (f) => { const p = f.split('/'); if (['extensions', 'apps', 'packages', 'skills'].includes(p[0])) return p.slice(0, 2).join('/'); if (p[0] === 'src' && p.length > 2) return p.slice(0, 2).join('/'); return p[0]; };
const env = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: 'file' };
function landedBetween(prevSha, sha) {
  try {
    const raw = execFileSync('git', ['--git-dir', path.join(DATA, 'main.git'), 'log', '--first-parent', '--format=C\t%H\t%s', '--name-only', '--no-renames', `${prevSha}..${sha}`], { env, maxBuffer: 1 << 28 }).toString();
    const cs = []; for (const l of raw.split('\n')) { if (l.startsWith('C\t')) { const [, h, s] = l.split('\t'); cs.push({ sha: h, subj: s, files: [] }); } else if (l.trim()) cs.at(-1).files.push(l.trim()); }
    return cs;
  } catch { return null; }
}
// Lanes PR runs do not have (PR runs DO run checks-ui-e2e, so it is not here).
const PLATFORM = /windows|macos|ios|android|QA Smoke|docker|native|release|published-driver/i;
const verdictOf = (r) => (!r.log ? 'no-log' : PLATFORM.test(r.name) ? 'platform-only' : !r.failing_files?.length ? 'no-test-file (infra/timeout/build?)' : r.commits_touching_area?.length ? 'same-area-change-landed' : 'no-change-in-area');

if (!args.includes('--summary-only')) for (const b of pick) {
  if (done.has(`${b.run}:${b.name}`)) continue;
  let row = { ...b, platform_only: PLATFORM.test(b.name) };
  try {
    const ids = await jobsOf(b.run);
    const id = ids.get(b.name);
    const log = id ? await get(`https://api.github.com/repos/${REPO}/actions/jobs/${id}/logs`, 'breaks-logs', true) : null;
    const { files, lines } = log ? failingFiles(log) : { files: [], lines: [] };
    const run = runsById.get(b.run), prev = runsById.get(b.prev);
    const commits = run && prev ? landedBetween(prev.sha, run.sha) : null;
    const areas = new Set(files.map(area));
    const touching = commits ? commits.filter((c) => c.files.some((f) => files.includes(f) || areas.has(area(f)))) : [];
    // Stricter: the failing test file itself or its directory changed (what a path-based scope surely selects).
    const dirs = new Set(files.map((f) => path.dirname(f)));
    const touchingDir = commits ? commits.filter((c) => c.files.some((f) => files.includes(f) || dirs.has(path.dirname(f)))) : [];
    row = { ...row, job_id: id || null, log: !!log, failing_files: files, failing_areas: [...areas], first_lines: lines,
      commits_in_hour: commits ? commits.length : null, commits_touching_area: touching.map((c) => ({ sha: c.sha.slice(0, 9), subj: c.subj.slice(0, 100), pr: +(c.subj.match(/\(#(\d+)\)\s*$/)?.[1] || 0) || null })),
      commits_touching_dir: touchingDir.length,
      verdict: !log ? 'no-log' : row.platform_only ? 'platform-only' : !files.length ? 'no-test-file (infra/timeout/build?)' : touching.length ? 'same-area-change-landed' : 'no-change-in-area' };
  } catch (e) { row.error = String(e.message || e); }
  fs.appendFileSync(out, JSON.stringify(row) + '\n');
  console.error(`[breaks] ${b.name} run ${b.run}: ${row.verdict || row.error} (spent ${spent})`);
  if (row.error === 'budget') break;
}

const rows = readJsonl('breaks.jsonl').map((r) => ({ ...r, platform_only: PLATFORM.test(r.name), verdict: r.error ? r.verdict : verdictOf(r) }));
fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); // verdicts follow the current rule
const reqs = readJsonl('requests.jsonl').filter((r) => r.stream?.startsWith('breaks')).length;
const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
const testRows = rows.filter((r) => r.verdict === 'same-area-change-landed' || r.verdict === 'no-change-in-area');
const summary = { breaks_total: breaks.length, sampled: rows.length, verdicts: count(rows, (r) => r.verdict || 'error'), requests: reqs,
  of_test_breaks_same_dir_change: { n: testRows.filter((r) => r.commits_touching_dir > 0).length, of: testRows.length },
  note: 'same-area-change-landed = a changed-scope lane would plausibly have run the failing test on the culprit PR (upper bound: area, not import graph); no-change-in-area = scoped tests of that hour\'s changes would not select it; platform-only = Linux PR lanes do not run it' };
fs.writeFileSync(path.join(DATA, 'breaks-summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
