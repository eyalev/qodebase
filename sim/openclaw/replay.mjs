// Replay OpenClaw's real landing stream (30 days of main, from git) through landing policies.
// No model calls, offline. docs/openclaw/PLAN.md phase 1, step 3.
//   node sim/openclaw/replay.mjs [--since 2026-09-08] [--bad 0.002,0.01,0.03] [--seed 1]
//
// Every change is ready to land at the moment it really landed on main (their merge time),
// with the files it really touched. Policies:
//   theirs      lands at once (no queue, linear history); main runs CI per push, with
//               cancel-in-progress at the observed rate; a bad change reaches main and stays
//               red until the next fix lands (we assume the next change on the same files).
//   train:N:K   qodebase's merge queue: up to N ready changes per train, K trains in flight
//               (each stacked on the one before), CI once per train on the exact main it will
//               produce; a red train is split in halves until the bad change is out (bisect);
//               the bad change bounces back to its author and never reaches main.
// What is measured, per policy: main CI runs and runner minutes, time from ready to landed,
// changes that reach main untested-as-combined, red-main minutes, bounced changes.
// "bad" = probability a change, combined with what landed since its own CI ran, breaks main.
// Their main push CI is the only real signal for it (see flow.json ci.main_fail_pct), so it is
// a sweep, not a fact.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA = process.env.OPENCLAW_DATA || path.join(os.homedir(), 'projects/github/openclaw/data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const SINCE = opt('since', '2026-09-08T00:00:00Z');
const BADS = opt('bad', '0.002,0.01,0.03').split(',').map(Number);
const SEED = +opt('seed', 1);
const MIN = 60e3, H = 3600e3;
const flow = JSON.parse(fs.readFileSync(path.join(DATA, 'flow.json'), 'utf8'));

// Seeded RNG (mulberry32) so a run is repeatable.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- the real stream ----
const env = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: 'file' };
const raw = execFileSync('git', ['--git-dir', path.join(DATA, 'main.git'), 'log', `--since=${SINCE}`, '--first-parent', '--format=C\t%H\t%ct\t%s', '--name-only', '--no-renames'], { env, maxBuffer: 1 << 30 }).toString();
const changes = [];
for (const l of raw.split('\n')) {
  if (l.startsWith('C\t')) { const [, sha, ct, s] = l.split('\t'); changes.push({ sha, ready: +ct * 1000, pr: +(s.match(/\(#(\d+)\)\s*$/)?.[1] || 0) || null, files: [] }); }
  else if (l.trim()) changes.at(-1).files.push(l.trim());
}
changes.reverse();

// PR head time (when its own CI last ran) → how stale its tested base was at landing.
const prHead = new Map();
const prFile = path.join(DATA, 'prs.jsonl');
if (fs.existsSync(prFile)) for (const l of fs.readFileSync(prFile, 'utf8').split('\n')) {
  if (!l) continue; const p = JSON.parse(l); const c = p.lastCommit?.nodes?.[0]?.commit?.committedDate; if (p.mergedAt && c) prHead.set(p.number, Date.parse(c));
}

// ---- CI model from their own runs ----
const runs = fs.readFileSync(path.join(DATA, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
// A train must pass the full check a PR gets (their push-to-main run is a lighter one), so
// trains draw their CI time from successful pull_request runs unless --train-ci main.
const TRAIN_CI = opt('train-ci', 'pr');
const mainRuns = runs.filter((r) => (TRAIN_CI === 'main' ? r.event === 'push' && r.branch === 'main' : r.event === 'pull_request') && r.conclusion === 'success');
const ciWall = mainRuns.map((r) => Date.parse(r.updated_at) - Date.parse(r.run_started_at || r.created_at)).filter((x) => x > 0).sort((a, b) => a - b);
const cancelledShare = (flow.ci.main_cancelled_pct || 0) / 100;
const runnerPerMainRun = flow.ci.runner_min_per_run_by_conclusion?.success?.mean ?? flow.ci.runner_min_per_run?.mean ?? null;
const sampleWall = (r) => ciWall[Math.floor(r() * ciWall.length)];

// ---- stale-base overlap (theirs): files of this change touched on main after its PR head ----
function staleOverlap() {
  const lastTouch = new Map(); let known = 0, overlap = 0;
  for (const c of changes) {
    const h = c.pr && prHead.get(c.pr);
    if (h) { known++; if (c.files.some((f) => (lastTouch.get(f) || 0) > h)) overlap++; }
    for (const f of c.files) lastTouch.set(f, c.ready);
  }
  return { prs_with_head_time: known, landed_after_same_file_changed_since_their_ci: overlap, pct: known ? +((100 * overlap) / known).toFixed(1) : null };
}

function q(xs, p) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
const days = (changes.at(-1).ready - changes[0].ready) / 864e5;

function theirs(bad, r) {
  // Every push runs CI on main; a share is cancelled by the next push (observed).
  const runsN = Math.round(changes.length * (1 - cancelledShare));
  // A bad change turns main red until the next change that touches one of its files lands (the fix).
  // Red stretches overlap when two bad changes are in flight: count the union, not the sum.
  const spans = []; let bads = 0;
  for (let i = 0; i < changes.length; i++) {
    if (r() >= bad) continue; bads++;
    const fs_ = new Set(changes[i].files);
    let j = i + 1; while (j < changes.length && !changes[j].files.some((f) => fs_.has(f))) j++;
    spans.push([changes[i].ready, j < changes.length ? changes[j].ready : changes.at(-1).ready]);
  }
  let redMs = 0, end = -Infinity;
  for (const [a, b] of spans) { if (b <= end) continue; redMs += b - Math.max(a, end); end = b; }
  return { policy: 'theirs', main_ci_runs_per_day: +(runsN / days).toFixed(0), runner_hours_per_day: runnerPerMainRun ? +((runsN * runnerPerMainRun) / days / 60).toFixed(0) : null, wait_min_p50: 0, wait_min_p90: 0, bad_on_main: bads, bounced: 0, red_main_hours_per_day: +(redMs / H / days).toFixed(1) };
}

function trains(N, K, bad, r) {
  // Event loop over ready times; K lanes; a train takes up to N queued changes.
  const isBad = changes.map(() => r() < bad);
  let qi = 0; const queue = []; const lanes = Array(K).fill(0); // lane free-at times
  const waits = []; let ciRuns = 0, bounced = 0, trainsN = 0, sizes = [];
  let now = changes[0].ready, lastLanded = 0;
  while (qi < changes.length || queue.length) {
    const lane = lanes.indexOf(Math.min(...lanes));
    now = Math.max(now, lanes[lane]);
    while (qi < changes.length && changes[qi].ready <= now) queue.push(qi++);
    if (!queue.length) { now = changes[qi].ready; continue; }
    const train = queue.splice(0, N); trainsN++; sizes.push(train.length);
    // Bisect: one run for the train; if red, halves until each bad change is isolated.
    let runsThis = 0, wall = 0;
    const test = (part) => { runsThis++; const w = sampleWall(r); const red = part.some((i) => isBad[i]); return { w, red }; };
    const first = test(train); wall += first.w;
    const good = [];
    if (!first.red) good.push(...train);
    else {
      const split = (part, depth) => {
        if (part.length === 1) { if (isBad[part[0]]) bounced++; else good.push(part[0]); return 0; }
        const a = part.slice(0, part.length >> 1), b = part.slice(part.length >> 1);
        const ta = test(a), tb = test(b); // both halves in parallel lanes: wall = the slower
        let w = Math.max(ta.w, tb.w);
        if (ta.red) w += split(a, depth + 1); else good.push(...a);
        if (tb.red) w += split(b, depth + 1); else good.push(...b);
        return w;
      };
      wall += split(train, 0);
    }
    ciRuns += runsThis;
    // Stacked trains land in order: never before the previous train landed.
    const landed = Math.max(now + wall, lastLanded); lastLanded = landed;
    lanes[lane] = now + wall;
    for (const i of good) waits.push(landed - changes[i].ready);
  }
  return { policy: `train:${N}:${K}`, trains: trainsN, train_size_p50: q(sizes, 0.5), main_ci_runs_per_day: +(ciRuns / days).toFixed(0), runner_hours_per_day: runnerPerMainRun ? +((ciRuns * runnerPerMainRun) / days / 60).toFixed(0) : null, wait_min_p50: +(q(waits, 0.5) / MIN).toFixed(1), wait_min_p90: +(q(waits, 0.9) / MIN).toFixed(1), wait_min_max: +(Math.max(...waits) / MIN).toFixed(0), bad_on_main: 0, bounced, red_main_hours_per_day: 0 };
}

const out = { since: SINCE, train_ci: TRAIN_CI, changes: changes.length, days: +days.toFixed(1), per_hour: +(changes.length / days / 24).toFixed(1), ci_wall_min_p50: +(q(ciWall, 0.5) / MIN).toFixed(1), ci_wall_min_p90: +(q(ciWall, 0.9) / MIN).toFixed(1), cancelled_share: cancelledShare, runner_min_per_main_run: runnerPerMainRun, stale_overlap: staleOverlap(), results: [] };
for (const bad of BADS) {
  const row = { bad, policies: [] };
  row.policies.push(theirs(bad, rng(SEED)));
  for (const [N, K] of [[4, 1], [8, 1], [16, 1], [8, 2], [8, 4]]) row.policies.push(trains(N, K, bad, rng(SEED)));
  out.results.push(row);
}
fs.writeFileSync(path.join(DATA, 'replay.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, results: undefined }, null, 1));
for (const row of out.results) {
  console.log(`\nbad=${row.bad}`);
  console.table(row.policies.map(({ policy, main_ci_runs_per_day, runner_hours_per_day, wait_min_p50, wait_min_p90, wait_min_max, bounced, bad_on_main, red_main_hours_per_day, train_size_p50 }) => ({ policy, main_ci_runs_per_day, runner_hours_per_day, wait_min_p50, wait_min_p90, wait_min_max, train_size_p50, bounced, bad_on_main, red_main_hours_per_day })));
}
