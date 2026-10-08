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
const BADS = opt('bad', '0.01,0.025,0.04').split(',').map(Number);
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
for (const prFile of ['prs.jsonl', 'prs-days.jsonl'].map((f) => path.join(DATA, f))) if (fs.existsSync(prFile)) for (const l of fs.readFileSync(prFile, 'utf8').split('\n')) {
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

// A suite run: `shards` jobs costing `runnerMin` runner-minutes and `wall()` ms. Each shard fails
// transiently with probability `flake` (their measured rate); failing shards are retried up to
// `retries` times (each retry costs that shard's share and half a wall). Returns whether it ends
// red because of flakes alone.
function suiteRun(suite, r, acc) {
  acc.runs++; acc.runnerMin += suite.runnerMin; let w = suite.wall(r);
  const perShard = suite.runnerMin / suite.shards;
  let failing = 0; for (let s = 0; s < suite.shards; s++) if (r() < suite.flake) failing++;
  for (let k = 0; k < suite.retries && failing; k++) { acc.runnerMin += failing * perShard; w += suite.wall(r) * 0.5; let still = 0; for (let s = 0; s < failing; s++) if (r() < suite.flake) still++; failing = still; }
  return { w, flakyRed: failing > 0 };
}

// Bisect a red set: halves in parallel, down to single changes. Returns wall ms; pushes results.
function bisect(part, isBad, suite, r, acc, out) {
  if (part.length === 1) { (isBad[part[0]] ? out.bad : out.falseRed).push(part[0]); return 0; }
  const x = part.slice(0, part.length >> 1), y = part.slice(part.length >> 1);
  // Bisect re-runs only the shards that failed (suite.bisectWith), not the whole suite.
  const bs = suite.bisectWith || suite;
  const tx = suiteRun(bs, r, acc), ty = suiteRun(bs, r, acc);
  const xr = x.some((i) => isBad[i]) || tx.flakyRed, yr = y.some((i) => isBad[i]) || ty.flakyRed;
  let w = Math.max(tx.w, ty.w), wx = 0, wy = 0;
  if (xr) wx = bisect(x, isBad, suite, r, acc, out); else out.good.push(...x);
  if (yr) wy = bisect(y, isBad, suite, r, acc, out); else out.good.push(...y);
  return w + Math.max(wx, wy);
}

// Pre-merge speculative trains (a merge queue): up to K trains in flight, each tested on top of
// the one before it, up to N changes each. The head lands when green; a red head is bisected,
// its bad changes bounce (and, after flakes, some good ones: false_bounces), and every train
// behind it is thrown away and rebuilt (half its CI counted as wasted).
function trains(N, K, bad, r, suite) {
  const isBad = changes.map(() => r() < bad);
  const acc = { runs: 0, runnerMin: 0 };
  let qi = 0, now = changes[0].ready; const queue = []; let inflight = [];
  const waits = []; let bounced = 0, falseBounced = 0, rebuilt = 0, trainsN = 0; const sizes = [];
  const start = () => {
    while (inflight.length < K && queue.length) {
      const t0 = inflight.length ? Math.max(now, inflight.at(-1).start) : now;
      const part = queue.splice(0, N); trainsN++; sizes.push(part.length);
      const res = suiteRun(suite, r, acc);
      // A train includes everything ahead of it: it is red if any change in it or ahead is bad.
      inflight.push({ part, start: t0, end: t0 + res.w, red: part.some((i) => isBad[i]) || res.flakyRed });
    }
  };
  while (qi < changes.length || queue.length || inflight.length) {
    while (qi < changes.length && changes[qi].ready <= now) queue.push(qi++);
    start();
    const head = inflight[0];
    const nextArrival = qi < changes.length ? changes[qi].ready : Infinity;
    if (!head) { now = nextArrival; continue; }
    if (head.end > now) { now = Math.min(head.end, inflight.length < K ? nextArrival : Infinity); continue; }
    inflight.shift();
    if (!head.red) { for (const i of head.part) waits.push(now - changes[i].ready); continue; }
    const out = { good: [], bad: [], falseRed: [] };
    now += bisect(head.part, isBad, suite, r, acc, out);
    bounced += out.bad.length; falseBounced += out.falseRed.length;
    for (const i of out.good) waits.push(now - changes[i].ready);
    // Everything behind the red head was tested on the wrong base: rebuild it.
    for (const t of inflight) { acc.runnerMin -= suite.runnerMin / 2; rebuilt++; }
    queue.unshift(...inflight.flatMap((t) => t.part)); inflight = [];
  }
  return { policy: `queue N${N} K${K} ${suite.name}`, trains: trainsN, train_size_p50: q(sizes, 0.5), ci_runs_per_day: +(acc.runs / days).toFixed(0), landing_runner_hours_per_day: +(acc.runnerMin / 60 / days).toFixed(0), wait_min_p50: +(q(waits, 0.5) / MIN).toFixed(1), wait_min_p90: +(q(waits, 0.9) / MIN).toFixed(1), wait_min_max: +(Math.max(...waits) / MIN).toFixed(0), bounced_bad: bounced, bounced_false: falseBounced, rebuilt_trains: rebuilt, bad_reaching_main: 0, red_main_h_per_day: 0 };
}

// Land, then verify: changes land at once (their way); every `every` minutes the suite runs on
// main covering what landed since the last run; a red run is bisected over that batch and the
// bad change is reverted. Red main lasts from the bad landing to its revert.
function landThenVerify(everyMin, bad, r, suite) {
  const isBad = changes.map(() => r() < bad);
  const acc = { runs: 0, runnerMin: 0 };
  let qi = 0; const reds = []; let reverted = 0, falseReverts = 0;
  for (let t = changes[0].ready + everyMin * MIN; qi < changes.length; t += everyMin * MIN) {
    const batch = []; while (qi < changes.length && changes[qi].ready <= t) batch.push(qi++);
    if (!batch.length) continue;
    const res = suiteRun(suite, r, acc);
    const red = batch.some((i) => isBad[i]) || res.flakyRed;
    if (!red) continue;
    const out = { good: [], bad: [], falseRed: [] };
    const w = res.w + bisect(batch, isBad, suite, r, acc, out);
    for (const i of out.bad) { reverted++; reds.push([changes[i].ready, t + w]); }
    falseReverts += out.falseRed.length;
  }
  reds.sort((a, b) => a[0] - b[0]);
  let redMs = 0, end = -Infinity; for (const [a, b] of reds) { if (b <= end) continue; redMs += b - Math.max(a, end); end = b; }
  return { policy: `land+verify every ${everyMin}m ${suite.name}`, ci_runs_per_day: +(acc.runs / days).toFixed(0), landing_runner_hours_per_day: +(acc.runnerMin / 60 / days).toFixed(0), wait_min_p50: 0, wait_min_p90: 0, bounced_bad: reverted, bounced_false: falseReverts, bad_reaching_main: reverted, red_main_h_per_day: +(redMs / H / days).toFixed(1) };
}

// Their way, measured (not simulated): push-to-main CI is near-free and tests almost nothing;
// the hourly full suite finds breaks after they land.
function theirs(bad) {
  const fs_ = flow.ci.full_suite_on_main || {};
  return { policy: 'theirs (measured)', trains: 0, ci_runs_per_day: flow.ci.runner_hours_per_day_est?.by_event?.push?.runs_per_day, landing_runner_hours_per_day: (flow.ci.runner_hours_per_day_est?.by_event?.push?.runner_hours_per_day || 0) + (flow.ci.runner_hours_per_day_est?.by_event?.schedule?.runner_hours_per_day || 0), wait_min_p50: 0, wait_min_p90: 0, bounced_bad: 0, bounced_false: 0, bad_reaching_main: Math.round(bad * changes.length), red_main_h_per_day: null, note: `full suite on main green ${fs_.all_green}/${fs_.runs} hourly runs; ${fs_.new_persistent_breaks_per_day} new persistent breaks/day` };
}

// Suites, calibrated from their jobs (flow.json): the full hourly suite and a PR-sized scope.
const schedWall = runs.filter((x) => x.event === 'schedule' && x.conclusion !== 'cancelled').map((x) => Date.parse(x.updated_at) - Date.parse(x.run_started_at || x.created_at)).filter((x) => x > 0).sort((x, y) => x - y);
const fsm = flow.ci.full_suite_on_main, rbe = flow.ci.runner_min_per_run_by_event, jbe = flow.ci.jobs_per_run_by_event;
// Upper bound: the hourly run's non-repeating shard failures include breaks fixed within the hour.
// PR runs (40% red over ~64 shards) put the real flake rate at or below ~0.8%. --flake overrides.
const flake = opt('flake', null) != null ? +opt('flake') : (fsm?.transient_failure_per_shard_pct ?? 3) / 100;
const RETRIES = +opt('retries', 1);
// One shard's wall time, from the full suite's jobs; a break fails ~2.4 shards (flow.json).
const shardWall = fs.readFileSync(path.join(DATA, 'jobs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => j.event === 'schedule').flatMap((j) => j.jobs).filter((x) => x.started_at && x.completed_at && x.conclusion !== 'skipped').map((x) => Date.parse(x.completed_at) - Date.parse(x.started_at)).filter((x) => x > 0).sort((x, y) => x - y);
const SHARDS_PER_BREAK = 3;
const shardSuite = (perShardMin) => ({ name: 'failing-shards', shards: SHARDS_PER_BREAK, runnerMin: SHARDS_PER_BREAK * perShardMin, flake, retries: RETRIES, wall: (r) => shardWall[Math.floor(r() * shardWall.length)] });
const SHARD_BISECT = opt('bisect', 'shards') === 'shards';
const SUITES = [
  { name: 'full', shards: fsm?.jobs_per_run ?? 162, runnerMin: rbe?.schedule?.mean ?? 900, flake, retries: RETRIES, wall: (r) => schedWall[Math.floor(r() * schedWall.length)] },
  { name: 'pr-scope', shards: jbe?.pull_request?.p50 ?? 64, runnerMin: rbe?.pull_request?.mean ?? 123, flake, retries: RETRIES, wall: (r) => sampleWall(r) },
];
if (SHARD_BISECT) for (const su of SUITES) su.bisectWith = shardSuite(su.runnerMin / su.shards);

const out = { since: SINCE, train_ci: TRAIN_CI, flake_per_shard: flake, retries: RETRIES, bisect: SHARD_BISECT ? 'failing shards only' : 'whole suite', shard_wall_min_p50: +(q(shardWall, 0.5) / MIN).toFixed(1), full_wall_min_p50: +(q(schedWall, 0.5) / MIN).toFixed(1), changes: changes.length, days: +days.toFixed(1), per_hour: +(changes.length / days / 24).toFixed(1), ci_wall_min_p50: +(q(ciWall, 0.5) / MIN).toFixed(1), ci_wall_min_p90: +(q(ciWall, 0.9) / MIN).toFixed(1), cancelled_share: cancelledShare, runner_min_per_main_run: runnerPerMainRun, stale_overlap: staleOverlap(), results: [] };
for (const bad of BADS) {
  const row = { bad, policies: [] };
  row.policies.push(theirs(bad));
  for (const suite of SUITES) for (const [N, K] of [[8, 2], [16, 4], [32, 4], [32, 8]]) row.policies.push(trains(N, K, bad, rng(SEED), suite));
  for (const every of [60, 20]) row.policies.push(landThenVerify(every, bad, rng(SEED), SUITES[0]));
  out.results.push(row);
}
fs.writeFileSync(path.join(DATA, 'replay.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, results: undefined }, null, 1));
for (const row of out.results) {
  console.log(`\nbad=${row.bad}`);
  console.table(row.policies.map(({ note, ...x }) => x));
}
