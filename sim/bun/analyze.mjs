#!/usr/bin/env node
// Bun Zig->Rust port (oven-sh/bun#30412): mine the agent commit history into
// calibration numbers for the qodebase sims. Read-only on the Bun clone, and
// blobless: every number here comes from commits and trees (tree diffs give
// file names and blob ids, never file contents), so nothing is fetched.
//
//   node sim/bun/analyze.mjs [--repo ~/projects/github/oven-sh/bun-pr30412]
//
// Writes sim/bun/calibration.json and prints a summary. Takes ~10-20 s.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const REPO = opt('--repo', join(homedir(), 'projects/github/oven-sh/bun-pr30412'));
const BASE = '0d9b296af33f', TIP = 'refs/pr/30412', RANGE = `${BASE}..${TIP}`;
const OUT = opt('--out', join(dirname(fileURLToPath(import.meta.url)), 'calibration.json'));

// GIT_NO_LAZY_FETCH: never let a blobless clone go to the network behind our back.
const git = (...a) => execFileSync('git', ['-C', REPO, ...a],
  { encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });

// ---------- load ----------
const commits = new Map(); // full sha -> {sha, parents, at, ct, author, subject, files}
for (const rec of git('log', '--topo-order', '--no-renames', '--name-only',
  '--format=%x1e%H%x1f%P%x1f%at%x1f%ct%x1f%an%x1f%s', RANGE).split('\x1e').slice(1)) {
  const [head, ...rest] = rec.split('\n');
  const [sha, p, at, ct, author, subject] = head.split('\x1f');
  commits.set(sha, { sha, parents: p ? p.split(' ') : [], at: +at, ct: +ct, author, subject,
    files: rest.filter(Boolean) });
}
const all = [...commits.values()];
const merges = all.filter(c => c.parents.length > 1);
const work = all.filter(c => c.parents.length === 1); // non-merge commits
const H = 3600, MIN = 60;

// ---------- helpers ----------
const q = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = xs => ({ n: xs.length, mean: +(xs.reduce((a, b) => a + b, 0) / (xs.length || 1)).toFixed(2),
  p50: q(xs, 0.5), p75: q(xs, 0.75), p90: q(xs, 0.9), p99: q(xs, 0.99), max: xs.length ? Math.max(...xs) : null });
const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : null;
const hourKey = t => new Date(Math.floor(t / H) * H * 1000).toISOString().slice(0, 13);

// Phase + stream from the subject: "phase-d(bun_runtime): ..." -> phase d, stream phase-d(bun_runtime).
function phaseOf(s) {
  const m = s.match(/^phase-([a-z])\w*(\(([^)]*)\))?/i);
  if (m) return { phase: m[1].toLowerCase(), stream: m[0].toLowerCase() };
  const t = s.match(/^([A-Za-z][\w./-]*)(\([^)]*\))?:/);
  return { phase: null, stream: t ? t[0].slice(0, -1).toLowerCase() : '(untagged)' };
}
for (const c of all) Object.assign(c, phaseOf(c.subject));

// ---------- branch inference ----------
// The tip's first-parent chain is the integration branch (claude/phase-a-port).
// A merge's second-parent side (commits not reachable from its first parent)
// belongs to the branch named in the merge subject. Oldest merge first, so a
// commit keeps the label of the first merge that brought it in.
function branchName(s) {
  let m = s.match(/Merge (?:remote-tracking )?branch '(?:origin\/)?([^']+)'(?: of \S+)?(?: into (\S+))?/)
    || s.match(/Merge (?:origin\/)?(claude\/[\w./-]+)/) || s.match(/merge ([\w./-]+)/i);
  if (m) { const b = m[1]; return m[2] && b === m[2] ? `${b} (parallel push)` : b; }
  if (/^sync/i.test(s)) return '(sync)';
  return '(other merge)';
}
const reach = (start, stop) => { // commits in range reachable from start, not passing stop set
  const out = new Set(), st = [start];
  while (st.length) { const s = st.pop(); if (out.has(s) || stop.has(s) || !commits.has(s)) continue; out.add(s); st.push(...commits.get(s).parents); }
  return out;
};
const ancestorsCache = new Map();
const ancestors = sha => { // full in-range ancestor set (memo, used for merges only)
  if (ancestorsCache.has(sha)) return ancestorsCache.get(sha);
  const r = reach(sha, new Set()); ancestorsCache.set(sha, r); return r;
};
const mainline = new Set();
for (let s = git('rev-parse', TIP).trim(); commits.has(s); s = commits.get(s).parents[0]) mainline.add(s);
const byTimeAsc = (a, b) => a.ct - b.ct;
const mergeInfo = [];
for (const m of [...merges].sort(byTimeAsc)) {
  const name = branchName(m.subject);
  const side = reach(m.parents[1], ancestors(m.parents[0]));
  for (const s of side) { const c = commits.get(s); if (!c.branch) c.branch = name; }
  mergeInfo.push({ m, name, side });
}
for (const c of all) if (!c.branch) c.branch = mainline.has(c.sha) ? 'claude/phase-a-port (mainline)' : '(unlabelled)';

// ---------- 1. rate over time, phases ----------
const t0 = Math.min(...work.map(c => c.at)), t1 = Math.max(...work.map(c => c.at));
const perHour = {};
for (const c of work) {
  const k = hourKey(c.at); (perHour[k] ||= { total: 0, phases: {} }).total++;
  const p = c.phase ? `phase-${c.phase}` : 'other'; perHour[k].phases[p] = (perHour[k].phases[p] || 0) + 1;
}
const hours = Object.keys(perHour).sort();
const hourly = hours.map(k => perHour[k].total);
// active hours = hours with >= 1 commit; fill empty hours for the span
const spanHours = Math.ceil((t1 - t0) / H);
const phases = {};
for (const c of work) {
  const p = c.phase ? `phase-${c.phase}` : 'other';
  const P = phases[p] ||= { commits: 0, first: c.at, last: c.at, files: [], streams: {} };
  P.commits++; P.first = Math.min(P.first, c.at); P.last = Math.max(P.last, c.at); P.files.push(c.files.length);
  P.streams[c.stream] = (P.streams[c.stream] || 0) + 1;
}
const phaseShape = Object.fromEntries(Object.entries(phases).sort((a, b) => a[1].first - b[1].first).map(([p, P]) => {
  const ts = work.filter(c => (c.phase ? `phase-${c.phase}` : 'other') === p).map(c => c.at).sort((a, b) => a - b);
  // the bulk: 5th..95th percentile of the phase's commit times
  return [p, { commits: P.commits, first: new Date(P.first * 1000).toISOString(), last: new Date(P.last * 1000).toISOString(),
    bulk_from: new Date(q(ts, 0.05) * 1000).toISOString(), bulk_to: new Date(q(ts, 0.95) * 1000).toISOString(),
    bulk_hours: +((q(ts, 0.95) - q(ts, 0.05)) / H).toFixed(1),
    files_per_commit: stats(P.files),
    top_streams: Object.entries(P.streams).sort((a, b) => b[1] - a[1]).slice(0, 8) }];
}));
// parallelism: per hour, how many phases / streams / branches had commits
const parallel = hours.map(k => {
  const cs = work.filter(c => hourKey(c.at) === k);
  return { hour: k, commits: cs.length, phases: new Set(cs.map(c => c.phase || 'other')).size,
    streams: new Set(cs.map(c => c.stream)).size, branches: new Set(cs.map(c => c.branch)).size };
});
// sustained rate = commits per hour in hours that had any work
const rate = { span_hours: spanHours, active_hours: hours.length, per_active_hour: stats(hourly),
  per_minute_peak_10min: (() => { // busiest 10-minute window
    const ts = work.map(c => c.at).sort((a, b) => a - b); let best = 0;
    for (let i = 0, j = 0; i < ts.length; i++) { while (ts[i] - ts[j] > 600) j++; best = Math.max(best, i - j + 1); }
    return best; })(),
  same_second_bursts: (() => { const n = {}; for (const c of work) n[c.at] = (n[c.at] || 0) + 1;
    return Object.values(n).filter(v => v > 1).length; })() };

// ---------- 2. files per commit ----------
const fpc = work.map(c => c.files.length);
const filesPerCommit = { ...stats(fpc), buckets: { '0': 0, '1': 0, '2-3': 0, '4-10': 0, '11-50': 0, '51-200': 0, '>200': 0 } };
for (const n of fpc) filesPerCommit.buckets[n === 0 ? '0' : n === 1 ? '1' : n <= 3 ? '2-3' : n <= 10 ? '4-10' : n <= 50 ? '11-50' : n <= 200 ? '51-200' : '>200']++;

// ---------- 3. hot files ----------
const touches = new Map(); // file -> [commit]
for (const c of work) for (const f of c.files) (touches.get(f) || touches.set(f, []).get(f)).push(c);
const fileCounts = [...touches.entries()].map(([f, cs]) => [f, cs.length]).sort((a, b) => b[1] - a[1]);
const totalTouches = fileCounts.reduce((a, [, n]) => a + n, 0);
const topShare = frac => { const k = Math.max(1, Math.round(fileCounts.length * frac)); const top = new Set(fileCounts.slice(0, k).map(x => x[0]));
  return { files: k, share_of_touches: pct(fileCounts.slice(0, k).reduce((a, [, n]) => a + n, 0), totalTouches),
    share_of_commits: pct(work.filter(c => c.files.some(f => top.has(f))).length, work.length) }; };
// excluding mass commits (> 50 files): they touch everything once and flatten the curve
const smallWork = work.filter(c => c.files.length <= 50);
const smallCounts = new Map(); for (const c of smallWork) for (const f of c.files) smallCounts.set(f, (smallCounts.get(f) || 0) + 1);
const sc = [...smallCounts.entries()].sort((a, b) => b[1] - a[1]); const scTotal = sc.reduce((a, [, n]) => a + n, 0);
const dirOf = f => f.split('/').slice(0, 2).join('/');
const dirCounts = {}; for (const [f, n] of fileCounts) dirCounts[dirOf(f)] = (dirCounts[dirOf(f)] || 0) + n;
const kindOf = f => /Cargo\.(toml|lock)$/.test(f) ? 'Cargo manifest/lock' : /(^|\/)(lib|mod)\.rs$/.test(f) ? 'lib.rs/mod.rs (module root)'
  : /\.rs$/.test(f) ? 'other .rs' : /\.zig$/.test(f) ? '.zig' : /\.(md|tsv|txt)$/.test(f) ? 'docs/notes' : /^test\//.test(f) ? 'test/' : 'other';
const hotKinds = {}; for (const [f] of fileCounts.slice(0, Math.max(1, Math.round(fileCounts.length * 0.01)))) hotKinds[kindOf(f)] = (hotKinds[kindOf(f)] || 0) + 1;
const hot = { distinct_files: fileCounts.length, file_touches: totalTouches,
  touches_per_file: stats(fileCounts.map(x => x[1])),
  top_0_1pct: topShare(0.001), top_1pct: topShare(0.01), top_10pct: topShare(0.1),
  top_1pct_without_mass_commits: (() => { const k = Math.max(1, Math.round(sc.length * 0.01));
    return { commits_considered: smallWork.length, files: k, share_of_touches: pct(sc.slice(0, k).reduce((a, [, n]) => a + n, 0), scTotal) }; })(),
  touched_once_pct: pct(fileCounts.filter(x => x[1] === 1).length, fileCounts.length),
  top_1pct_kinds: hotKinds,
  top_files: fileCounts.slice(0, 25).map(([f, n]) => ({ file: f, commits: n, branches: new Set(touches.get(f).map(c => c.branch)).size })),
  top_dirs: Object.entries(dirCounts).sort((a, b) => b[1] - a[1]).slice(0, 12) };

// ---------- 4. collisions in time ----------
// For each non-merge commit: does an earlier commit within N minutes touch one of
// its files? "any" = any commit, "other stream" = different phase stream tag,
// "other branch" = different inferred branch (truly parallel work trees).
const WINDOWS = [1, 5, 15, 30, 60, 120, 240, 480];
const sortedTouches = new Map([...touches].map(([f, cs]) => [f, [...cs].sort((a, b) => a.at - b.at)]));
const collide = (filter, maxFiles = Infinity) => Object.fromEntries(WINDOWS.map(N => {
  let hit = 0, n = 0;
  for (const c of work) {
    if (c.files.length === 0 || c.files.length > maxFiles) continue; n++;
    const found = c.files.some(f => sortedTouches.get(f).some(o => o !== c && o.at <= c.at && c.at - o.at <= N * MIN && o.files.length <= maxFiles && filter(c, o)));
    if (found) hit++;
  }
  return [`${N}m`, pct(hit, n)];
}));
const collisions = {
  note: '% of non-merge commits for which an earlier commit within N minutes touched at least one of the same files',
  any: collide(() => true),
  other_stream: collide((c, o) => c.stream !== o.stream),
  other_branch: collide((c, o) => c.branch !== o.branch),
  small_commits_only_any: collide(() => true, 10),
  small_commits_only_other_branch: collide((c, o) => c.branch !== o.branch, 10),
};

// ---------- 5. merges: overlap before merge, real content merges, follow-up fixes ----------
// For each merge: files changed on both sides since the merge base. A file is a
// "content merge" when both sides changed it to different blobs, and the merge
// result matches neither side (git or the agent had to combine text). All from
// tree ids, no blobs.
const lsTree = sha => { const m = new Map(); for (const l of git('ls-tree', '-r', '--full-tree', sha).split('\n')) { if (!l) continue; const [meta, p] = l.split('\t'); m.set(p, meta.split(' ')[2]); } return m; };
const rawDiff = (a, b) => { const m = new Map(); for (const l of git('diff', '--raw', '--no-renames', '--no-abbrev', a, b).split('\n')) { if (!l) continue; const [meta, p] = l.split('\t'); m.set(p, meta.split(' ')[3]); } return m; };
const LOSS_RE = /merge --(theirs|ours)|(lost|dropped|reintroduced|reverted) (in|by|via) |re-?appl(y|ied)|lost in .*race|fix(ed)? (the )?(bad |botched )?merge|merge (fix|fallout|resolution)/i;
const mergeRows = [];
for (const { m, name, side } of mergeInfo) {
  const [p1, p2] = m.parents;
  const base = (() => { try { return git('merge-base', p1, p2).trim(); } catch { return null; } })();
  let both = [], content = [], resolvedByHand = [];
  if (base) {
    const d1 = rawDiff(base, p1), d2 = rawDiff(base, p2);
    both = [...d1.keys()].filter(f => d2.has(f));
    content = both.filter(f => d1.get(f) !== d2.get(f));
    if (content.length) {
      const r = lsTree(m.sha), a = lsTree(p1), b = lsTree(p2);
      resolvedByHand = content.filter(f => r.get(f) !== a.get(f) && r.get(f) !== b.get(f));
    }
  }
  const conflictsInSubject = +(m.subject.match(/(\d+) conflicts?/)?.[1] || 0) || (/conflict/i.test(m.subject) ? 1 : 0);
  mergeRows.push({ sha: m.sha.slice(0, 10), at: new Date(m.ct * 1000).toISOString(), branch: name, into_mainline: mainline.has(m.sha),
    side_commits: side.size, side_files: new Set([...side].flatMap(s => commits.get(s).files)).size,
    both_sides_touched: both.length, both_changed_differently: content.length, merged_to_new_text: resolvedByHand.length,
    conflicts_named_in_subject: conflictsInSubject, subject: m.subject.slice(0, 160) });
}
// follow-up "lost work" commits: subject matches LOSS_RE; how soon after the nearest earlier merge
const mergeTimes = merges.map(m => m.ct).sort((a, b) => a - b);
const lossCommits = work.filter(c => LOSS_RE.test(c.subject)).map(c => {
  const prev = mergeTimes.filter(t => t <= c.ct).pop();
  return { sha: c.sha.slice(0, 10), minutes_after_merge: prev ? Math.round((c.ct - prev) / MIN) : null, subject: c.subject.slice(0, 160) };
});
const byBranch = {};
for (const r of mergeRows) { const B = byBranch[r.branch] ||= { merges: 0, side_commits: 0, content_merges: 0, hand_merged_files: 0 };
  B.merges++; B.side_commits += r.side_commits; B.content_merges += r.both_changed_differently > 0 ? 1 : 0; B.hand_merged_files += r.merged_to_new_text; }
const intoMain = mergeRows.filter(r => r.into_mainline);
const gaps = (() => { const ts = mergeRows.filter(r => r.into_mainline).map(r => Date.parse(r.at) / 1000).sort((a, b) => a - b);
  return ts.slice(1).map((t, i) => Math.round((t - ts[i]) / MIN)); })();
const mergeSummary = {
  merges: merges.length, into_mainline: intoMain.length,
  branches: Object.keys(byBranch).length,
  minutes_between_mainline_merges: stats(gaps),
  side_commits_per_merge: stats(mergeRows.map(r => r.side_commits)),
  side_files_per_merge: stats(mergeRows.map(r => r.side_files)),
  pct_merges_with_files_touched_on_both_sides: pct(mergeRows.filter(r => r.both_sides_touched).length, mergeRows.length),
  pct_merges_needing_a_content_merge: pct(mergeRows.filter(r => r.both_changed_differently).length, mergeRows.length),
  pct_merges_with_hand_or_auto_merged_text: pct(mergeRows.filter(r => r.merged_to_new_text).length, mergeRows.length),
  files_changed_differently_per_merge: stats(mergeRows.map(r => r.both_changed_differently)),
  merges_naming_conflicts_in_subject: mergeRows.filter(r => r.conflicts_named_in_subject).length,
  conflicts_named_total: mergeRows.reduce((a, r) => a + r.conflicts_named_in_subject, 0),
  parallel_push_merges: mergeRows.filter(r => r.branch.includes('(parallel push)')).length,
  lost_work_followups: lossCommits.length,
  lost_work_followups_per_100_merges: +(100 * lossCommits.length / merges.length).toFixed(1),
  by_branch: Object.entries(byBranch).sort((a, b) => b[1].merges - a[1].merges),
};

// ---------- 6. topology: how much went straight onto one shared branch ----------
// Bulk phases committed onto the integration branch directly, seconds apart,
// with author time == commit time (no rebase): many agents in one working tree,
// each owning files or line ranges ("Blob.rs [3200,4000)"), not a branch each.
const onMain = work.filter(c => mainline.has(c.sha));
const mainGaps = onMain.map(c => c.at).sort((a, b) => a - b).map((t, i, a) => i ? t - a[i - 1] : null).slice(1);
const perPhaseMain = {};
for (const c of work) { const p = c.phase ? `phase-${c.phase}` : 'other'; const P = perPhaseMain[p] ||= [0, 0]; P[0]++; if (mainline.has(c.sha)) P[1]++; }
const RANGE_CLAIM = /\[\d+, ?\d+\)/;
const topology = {
  pct_commits_straight_on_one_branch: pct(onMain.length, work.length),
  pct_mainline_not_rebased: pct(onMain.filter(c => c.at === c.ct).length, onMain.length),
  seconds_between_mainline_commits: stats(mainGaps),
  pct_on_mainline_by_phase: Object.fromEntries(Object.entries(perPhaseMain).map(([p, [n, m]]) => [p, pct(m, n)])),
  line_range_claims_in_subjects: work.filter(c => RANGE_CLAIM.test(c.subject)).length,
  line_range_claim_examples: work.filter(c => RANGE_CLAIM.test(c.subject)).slice(0, 3).map(c => c.subject.slice(0, 100)),
};

// ---------- 7. per-branch commit counts ----------
const branchCommits = {}; for (const c of work) branchCommits[c.branch] = (branchCommits[c.branch] || 0) + 1;

// ---------- write ----------
const out = {
  source: { repo: 'oven-sh/bun', pr: 30412, range: RANGE, tip: git('rev-parse', TIP).trim(), license: 'MIT',
    note: 'blobless fetch: file names and blob ids only, no line counts. Agents commit as "Jarred Sumner"; branches inferred from merge subjects, streams from subject prefixes.' },
  generated: new Date().toISOString(),
  totals: { commits: all.length, non_merge: work.length, merges: merges.length,
    authors: Object.fromEntries(Object.entries(all.reduce((a, c) => (a[c.author] = (a[c.author] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1])),
    first: new Date(t0 * 1000).toISOString(), last: new Date(t1 * 1000).toISOString() },
  rate, files_per_commit: filesPerCommit, lines_per_commit: null,
  lines_note: 'needs file contents (step 3, not fetched)',
  phases: phaseShape, topology, hot_files: hot, collisions, merges: mergeSummary,
  commits_by_branch: Object.entries(branchCommits).sort((a, b) => b[1] - a[1]),
  hourly: hours.map((k, i) => ({ hour: k, ...perHour[k], ...parallel[i] })),
  merge_rows: mergeRows, lost_work_commits: lossCommits,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

// ---------- summary ----------
const L = console.log;
L(`Bun #30412: ${all.length} commits (${work.length} non-merge, ${merges.length} merges), ${out.totals.first} .. ${out.totals.last}`);
L(`rate: ${spanHours} h span, ${hours.length} active hours; per active hour p50 ${rate.per_active_hour.p50}, p90 ${rate.per_active_hour.p90}, max ${rate.per_active_hour.max}; busiest 10 min: ${rate.per_minute_peak_10min}`);
L('phases (bulk = 5th..95th pct of commit times):');
for (const [p, P] of Object.entries(phaseShape)) L(`  ${p.padEnd(8)} ${String(P.commits).padStart(5)} commits  ${P.bulk_from.slice(5, 16)} .. ${P.bulk_to.slice(5, 16)} (${P.bulk_hours} h)  files/commit p50 ${P.files_per_commit.p50} p90 ${P.files_per_commit.p90}`);
L(`topology: ${topology.pct_commits_straight_on_one_branch}% of commits straight onto one branch (${topology.pct_mainline_not_rebased}% not rebased), p50 ${topology.seconds_between_mainline_commits.p50} s apart; on-branch by phase ${JSON.stringify(topology.pct_on_mainline_by_phase)}; line-range claims ${topology.line_range_claims_in_subjects}`);
L(`files/commit: p50 ${filesPerCommit.p50}, p90 ${filesPerCommit.p90}, p99 ${filesPerCommit.p99}, max ${filesPerCommit.max}; ${JSON.stringify(filesPerCommit.buckets)}`);
L(`hot files: ${hot.distinct_files} files; top 1% (${hot.top_1pct.files}) take ${hot.top_1pct.share_of_touches}% of touches and appear in ${hot.top_1pct.share_of_commits}% of commits (without >50-file commits: ${hot.top_1pct_without_mass_commits.share_of_touches}%); ${hot.touched_once_pct}% touched once`);
L('  top: ' + hot.top_files.slice(0, 8).map(x => `${x.file} (${x.commits})`).join(', '));
L('collisions (% commits with an earlier same-file commit within N min):');
for (const k of ['any', 'other_stream', 'other_branch', 'small_commits_only_any', 'small_commits_only_other_branch']) L(`  ${k.padEnd(32)} ${WINDOWS.map(N => `${N}m ${collisions[k][`${N}m`]}`).join('  ')}`);
L(`merges: ${merges.length} (${intoMain.length} into mainline, ${mergeSummary.branches} branches); mainline merge gap p50 ${mergeSummary.minutes_between_mainline_merges.p50} min`);
L(`  both sides touched a file: ${mergeSummary.pct_merges_with_files_touched_on_both_sides}%; needed a content merge: ${mergeSummary.pct_merges_needing_a_content_merge}%; result differs from both sides: ${mergeSummary.pct_merges_with_hand_or_auto_merged_text}%`);
L(`  conflicts named in subjects: ${mergeSummary.conflicts_named_total} in ${mergeSummary.merges_naming_conflicts_in_subject} merges; parallel pushes to one branch: ${mergeSummary.parallel_push_merges}; lost-work follow-ups: ${lossCommits.length}`);
L(`wrote ${OUT}`);
