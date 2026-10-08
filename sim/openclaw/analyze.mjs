// OpenClaw's real flow as numbers (docs/openclaw/PLAN.md, phase 1). Offline: reads what
// fetch.mjs mirrored plus the blobless clone of main, never the network.
//   node sim/openclaw/analyze.mjs [--since 2026-09-08] [--out data/flow.json]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA = process.env.OPENCLAW_DATA || path.join(os.homedir(), 'projects/github/openclaw/data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const SINCE = opt('since', '2026-09-08T00:00:00Z');
const OUT = opt('out', path.join(DATA, 'flow.json'));

const readJsonl = (f) => { const p = path.join(DATA, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const uniqBy = (xs, k) => [...new Map(xs.map((x) => [x[k], x])).values()];
const t = (s) => (s ? Date.parse(s) : null);
const H = 3600e3, MIN = 60e3;
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const dist = (xs, unit = 1, digits = 1) => { const r = (v) => (v == null ? null : +(v / unit).toFixed(digits)); return { n: xs.length, p10: r(q(xs, 0.1)), p50: r(q(xs, 0.5)), p90: r(q(xs, 0.9)), mean: xs.length ? r(xs.reduce((a, b) => a + b, 0) / xs.length) : null }; };
const pct = (a, b) => (b ? +((100 * a) / b).toFixed(1) : null);
const count = (xs, f) => xs.reduce((m, x) => { for (const k of [].concat(f(x))) m[k] = (m[k] || 0) + 1; return m; }, {});
const top = (m, n = 15) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
const BOTS = /\[bot\]$|^clawsweeper$|^openclaw-barnacle$|^github-actions$|^roboclaw-bot$|^openclaw-release-bot$/;
const isBot = (login) => !login || BOTS.test(login);
const who = (e) => e.actor?.login || e.author?.login || null;

// ---------- main (git, offline) ----------
function mainCommits() {
  const env = { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: 'file' };
  const raw = execFileSync('git', ['--git-dir', path.join(DATA, 'main.git'), 'log', `--since=${SINCE}`, '--first-parent', '--format=C\t%H\t%ct\t%cn\t%an\t%s', '--name-only', '--no-renames'], { env, maxBuffer: 1 << 30 }).toString();
  const out = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('C\t')) { const [, sha, ct, cn, an, subj] = line.split('\t'); out.push({ sha, ts: +ct * 1000, cn, an, subj, pr: +(subj.match(/\(#(\d+)\)\s*$/)?.[1] || 0) || null, files: [] }); }
    else if (line.trim()) out.at(-1).files.push(line.trim());
  }
  return out.reverse(); // oldest first
}

function overlapWithin(commits, windowMs) {
  // For each commit: did another commit within `windowMs` before it touch any of the same files?
  const lastTouch = new Map(); let hit = 0, hitHot = 0;
  for (const c of commits) {
    let h = false;
    for (const f of c.files) { const lt = lastTouch.get(f); if (lt != null && c.ts - lt <= windowMs) { h = true; break; } }
    if (h) hit++;
    for (const f of c.files) lastTouch.set(f, c.ts);
  }
  return { commits: commits.length, with_same_file_commit_before: hit, pct: pct(hit, commits.length) };
}

const main = mainCommits();
const span = (main.at(-1).ts - main[0].ts) / 864e5;
const fileHits = count(main, (c) => c.files);
const mainStats = {
  commits: main.length, days: +span.toFixed(1), per_day: +(main.length / span).toFixed(0),
  via_pr: main.filter((c) => c.pr).length, direct_push: main.filter((c) => !c.pr).length,
  direct_push_by: top(count(main.filter((c) => !c.pr), (c) => c.an), 8),
  top_authors: top(count(main, (c) => c.an), 10),
  files_per_commit: dist(main.map((c) => c.files.length), 1, 0),
  per_hour: (() => { const m = count(main, (c) => Math.floor(c.ts / H)); const v = Object.values(m); return { active_hours: v.length, ...dist(v, 1, 0), max: Math.max(...v) }; })(),
  hot_files: top(fileHits, 20),
  same_file_within: { '10min': overlapWithin(main, 10 * MIN), '1h': overlapWithin(main, H), '6h': overlapWithin(main, 6 * H) },
  same_file_within_excl_changelog: overlapWithin(main.map((c) => ({ ...c, files: c.files.filter((f) => !/CHANGELOG|\.md$|pnpm-lock|package\.json$/.test(f)) })), H),
};

// ---------- PRs ----------
const prs = uniqBy(readJsonl('prs.jsonl'), 'number').filter((p) => p.createdAt >= SINCE);
const merged = prs.filter((p) => p.mergedAt), closedUnmerged = prs.filter((p) => p.state === 'CLOSED'), open = prs.filter((p) => p.state === 'OPEN');
function firstOther(p, pred) {
  const me = p.author?.login;
  const ev = (p.timelineItems?.nodes || []).filter((e) => e.createdAt && who(e) !== me && pred(e));
  return ev.length ? Math.min(...ev.map((e) => t(e.createdAt))) - t(p.createdAt) : null;
}
const prStats = {
  window: { since: SINCE, created: prs.length, merged: merged.length, closed_unmerged: closedUnmerged.length, open: open.length, drafts: prs.filter((p) => p.isDraft).length },
  pct_merged: pct(merged.length, prs.length - open.length),
  authors: { distinct: new Set(prs.map((p) => p.author?.login)).size, top_created: top(count(prs, (p) => p.author?.login || '?'), 10), top_merged: top(count(merged, (p) => p.author?.login || '?'), 10), bot_authored: prs.filter((p) => p.author?.__typename === 'Bot').length, association: count(prs, (p) => p.authorAssociation) },
  merged_by: top(count(merged, (p) => p.mergedBy?.login || '?'), 8),
  hours_to_merge: dist(merged.map((p) => t(p.mergedAt) - t(p.createdAt)), H, 2),
  hours_to_merge_by_maintainers: dist(merged.filter((p) => ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(p.authorAssociation)).map((p) => t(p.mergedAt) - t(p.createdAt)), H, 2),
  hours_to_merge_outside: dist(merged.filter((p) => !['MEMBER', 'OWNER', 'COLLABORATOR'].includes(p.authorAssociation)).map((p) => t(p.mergedAt) - t(p.createdAt)), H, 2),
  hours_to_close_unmerged: dist(closedUnmerged.map((p) => t(p.closedAt) - t(p.createdAt)), H, 2),
  closed_unmerged_by: top(count(closedUnmerged, (p) => { const c = (p.timelineItems?.nodes || []).find((e) => e.__typename === 'ClosedEvent'); return c ? who(c) || '?' : '(close beyond first 12 events)'; }), 8),
  minutes_to_first_bot_touch: dist(prs.map((p) => firstOther(p, (e) => isBot(who(e)))).filter((x) => x != null), MIN, 1),
  minutes_to_first_human_touch: { ...dist(prs.map((p) => firstOther(p, (e) => !isBot(who(e)))).filter((x) => x != null), MIN, 0), note: 'only within the first 12 timeline events; bots fill most of them' },
  files_per_pr: dist(prs.map((p) => p.files?.totalCount ?? p.changedFiles), 1, 0),
  lines_per_merged_pr: dist(merged.map((p) => p.additions + p.deletions), 1, 0),
  commits_per_pr: dist(prs.map((p) => p.commits?.totalCount || 0), 1, 0),
  force_pushed: pct(prs.filter((p) => p.timelineItems?.nodes?.some((e) => e.__typename === 'HeadRefForcePushedEvent')).length, prs.length),
  links_an_issue: { merged: pct(merged.filter((p) => p.closingIssuesReferences?.nodes?.length).length, merged.length), all: pct(prs.filter((p) => p.closingIssuesReferences?.nodes?.length).length, prs.length) },
  last_check_state_of_merged: count(merged, (p) => p.lastCommit?.nodes?.[0]?.commit?.statusCheckRollup?.state || 'none'),
  labels_top: top(count(prs, (p) => p.labels.nodes.map((l) => l.name)), 30),
  too_many_prs_label: prs.filter((p) => p.labels.nodes.some((l) => /too-many-prs/.test(l.name))).length,
};
// Max open PRs per author at any moment (the 20-per-author cap), from created/closed times.
{
  const ev = [];
  for (const p of prs) { ev.push([t(p.createdAt), 1, p.author?.login]); ev.push([t(p.closedAt || p.mergedAt) || Infinity, -1, p.author?.login]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cur = {}, peak = {};
  for (const [, d, a] of ev) { cur[a] = (cur[a] || 0) + d; peak[a] = Math.max(peak[a] || 0, cur[a]); }
  prStats.peak_open_per_author = top(peak, 10);
  prStats.authors_ever_over_20_open = Object.values(peak).filter((v) => v > 20).length;
}
// Concurrency on files: of merged PRs, how many had another PR merge into one of their files while they were open?
{
  const byFile = new Map();
  const ms = merged.map((p) => ({ n: p.number, c: t(p.createdAt), m: t(p.mergedAt), files: (p.files?.nodes || []).map((f) => f.path) })).sort((a, b) => a.m - b.m);
  for (const p of ms) for (const f of p.files) (byFile.get(f) || byFile.set(f, []).get(f)).push(p.m);
  let exposed = 0, exposedNoMeta = 0; const k = [];
  for (const p of ms) {
    let n = 0, nNoMeta = 0;
    for (const f of p.files) { const hits = byFile.get(f).filter((m) => m > p.c && m < p.m).length; n += hits; if (!/CHANGELOG|pnpm-lock|package\.json$/.test(f)) nNoMeta += hits; }
    if (n) exposed++; if (nNoMeta) exposedNoMeta++; k.push(n);
  }
  prStats.merged_while_open_same_file = { merged: ms.length, exposed: exposed, pct: pct(exposed, ms.length), pct_excl_changelog_lock: pct(exposedNoMeta, ms.length), other_merges_into_same_files: dist(k, 1, 0) };
}

// ---------- issues ----------
const issues = uniqBy(readJsonl('issues.jsonl'), 'number').filter((i) => i.createdAt >= SINCE);
const closed = issues.filter((i) => i.state === 'CLOSED');
const closeEv = (i) => (i.timelineItems?.nodes || []).filter((e) => e.__typename === 'ClosedEvent').at(-1);
const fixedBy = (i) => {
  const c = closeEv(i);
  if (c?.closer?.__typename === 'PullRequest' || c?.closer?.__typename === 'Commit') return c.closer.__typename;
  if (i.stateReason === 'COMPLETED' && (i.timelineItems?.nodes || []).some((e) => e.__typename === 'CrossReferencedEvent' && e.source?.mergedAt)) return 'merged PR referenced';
  return null;
};
const dup = (i) => i.stateReason === 'DUPLICATE' || i.labels.nodes.some((l) => /duplicate/i.test(l.name)) || (i.timelineItems?.nodes || []).some((e) => e.__typename === 'MarkedAsDuplicateEvent');
const issueStats = {
  window: { created: issues.length, closed: closed.length, open: issues.length - closed.length },
  per_day: +(issues.length / ((Date.now() - t(SINCE)) / 864e5)).toFixed(0),
  state_reason: count(closed, (i) => i.stateReason || 'none'),
  closed_by: top(count(closed, (i) => (closeEv(i) ? who(closeEv(i)) || '?' : '(beyond first 15 events)')), 10),
  closed_by_bot_pct: pct(closed.filter((i) => closeEv(i) && isBot(who(closeEv(i)))).length, closed.length),
  fixed: { by_pr_or_commit_or_ref: closed.filter(fixedBy).length, pct_of_closed: pct(closed.filter(fixedBy).length, closed.length), how: count(closed.filter(fixedBy), fixedBy) },
  duplicates: { n: issues.filter(dup).length, pct: pct(issues.filter(dup).length, issues.length) },
  hours_to_close: dist(closed.map((i) => t(i.closedAt) - t(i.createdAt)), H, 2),
  hours_to_close_not_planned: dist(closed.filter((i) => i.stateReason === 'NOT_PLANNED').map((i) => t(i.closedAt) - t(i.createdAt)), H, 2),
  hours_to_close_completed: dist(closed.filter((i) => i.stateReason === 'COMPLETED').map((i) => t(i.closedAt) - t(i.createdAt)), H, 2),
  minutes_to_first_triage_any: dist(issues.map((i) => firstOther(i, () => true)).filter((x) => x != null), MIN, 1),
  minutes_to_first_label: dist(issues.map((i) => firstOther(i, (e) => e.__typename === 'LabeledEvent')).filter((x) => x != null), MIN, 1),
  minutes_to_first_human: { ...dist(issues.map((i) => firstOther(i, (e) => !isBot(who(e)) && e.__typename !== 'CrossReferencedEvent')).filter((x) => x != null), MIN, 0), of: issues.length, note: 'within the first 15 timeline events only' },
  clawsweeper_labels: top(count(issues, (i) => i.labels.nodes.map((l) => l.name).filter((n) => n.startsWith('clawsweeper:'))), 20),
  priority: count(issues, (i) => i.labels.nodes.map((l) => l.name).filter((n) => /^P[0-3]$/.test(n))),
  open_needs_decision: issues.filter((i) => i.state === 'OPEN' && i.labels.nodes.some((l) => /needs-product-decision|needs-maintainer/.test(l.name))).length,
  authors_bot: issues.filter((i) => i.author?.__typename === 'Bot').length,
};

// ---------- CI ----------
const runs = uniqBy(readJsonl('runs.jsonl'), 'id');
const jobs = readJsonl('jobs.jsonl');
const done = runs.filter((r) => r.status === 'completed');
const dur = (r) => t(r.updated_at) - t(r.run_started_at || r.created_at);
const ciSpan = runs.length ? (Math.max(...runs.map((r) => t(r.created_at))) - Math.min(...runs.map((r) => t(r.created_at)))) / 864e5 : 0;
const runnerMin = jobs.map((j) => ({ ...j, min: j.jobs.reduce((a, x) => a + (x.started_at && x.completed_at ? (t(x.completed_at) - t(x.started_at)) / MIN : 0), 0) }));
const mainInSpan = main.filter((c) => c.ts >= Date.now() - ciSpan * 864e5).length;
const ciStats = {
  runs: runs.length, days: +ciSpan.toFixed(1), per_hour: +(runs.length / (ciSpan * 24)).toFixed(1),
  by_event: count(runs, (r) => r.event), by_conclusion: count(done, (r) => `${r.event}:${r.conclusion}`),
  wall_min_success: dist(done.filter((r) => r.conclusion === 'success').map(dur), MIN, 1),
  wall_min_failure: dist(done.filter((r) => r.conclusion === 'failure').map(dur), MIN, 1),
  pr_fail_pct: pct(done.filter((r) => r.event === 'pull_request' && r.conclusion === 'failure').length, done.filter((r) => r.event === 'pull_request' && ['success', 'failure'].includes(r.conclusion)).length),
  main_push_runs: runs.filter((r) => r.event === 'push' && r.branch === 'main').length,
  main_fail_pct: pct(done.filter((r) => r.event === 'push' && r.branch === 'main' && r.conclusion === 'failure').length, done.filter((r) => r.event === 'push' && r.branch === 'main' && ['success', 'failure'].includes(r.conclusion)).length),
  main_cancelled_pct: pct(done.filter((r) => r.event === 'push' && r.branch === 'main' && r.conclusion === 'cancelled').length, done.filter((r) => r.event === 'push' && r.branch === 'main').length),
  reruns: runs.filter((r) => r.run_attempt > 1).length,
  main_commits_in_span: mainInSpan,
  runs_per_main_commit: mainInSpan ? +(runs.length / mainInSpan).toFixed(2) : null,
  sampled_runs_with_jobs: runnerMin.length,
  jobs_per_run: dist(jobs.map((j) => j.jobs.length), 1, 0),
  runner_min_per_run: dist(runnerMin.map((j) => j.min), 1, 0),
  runner_min_per_run_by_conclusion: Object.fromEntries(['success', 'failure', 'cancelled'].map((c) => [c, dist(runnerMin.filter((j) => j.conclusion === c).map((j) => j.min), 1, 0)])),
};
if (runnerMin.length && mainInSpan) {
  const mean = runnerMin.reduce((a, j) => a + j.min, 0) / runnerMin.length;
  ciStats.runner_min_per_main_commit_est = +((mean * runs.length) / mainInSpan).toFixed(0);
  ciStats.runner_hours_per_day_est = +((mean * runs.length) / ciSpan / 60).toFixed(0);
}

// ---------- requests ----------
const reqs = readJsonl('requests.jsonl');
const requests = { total: reqs.length, by_api: count(reqs, (r) => `${r.api}:${r.stream}`), graphql_points: reqs.filter((r) => r.api === 'graphql').reduce((a, r) => a + (r.cost || 0), 0), non_200: reqs.filter((r) => r.status !== 200).length };

const flow = { generated: new Date().toISOString(), since: SINCE, main: mainStats, prs: prStats, issues: issueStats, ci: ciStats, requests };
fs.writeFileSync(OUT, JSON.stringify(flow, null, 1));
console.log(JSON.stringify(flow, null, 1));
