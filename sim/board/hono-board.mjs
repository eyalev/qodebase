#!/usr/bin/env node
// E3 (a), docs/board/PLAN.md: in the Hono replay (sim/hono/replay.mjs), PRs that could not be
// written on their wave's starting main "needed an earlier PR of the wave". If every PR had
// announced its intent + files on a board when work STARTED, how many of those needs were
// visible in advance (the needed PR was already announced and touches the same files), so the
// later PR could be stacked/ordered instead of bounced? Zero tokens: git + the GitHub API
// (PR createdAt and first commit date, cached) + the replay's trace.
//
//   node sim/board/hono-board.mjs [--repo ~/projects/github/honojs/hono] [--waves 10,50,100]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => { if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return a; }, []));
const REPO = (args.repo || join(homedir(), 'projects/github/honojs/hono')).replace(/^~/, homedir());
const WAVES = String(args.waves || '10,50,100').split(',').map(Number);
const TRACE = join(homedir(), '.local/share/qbsim-bench/hono-replay-trace.jsonl');
const SINCE = args.since || '2026-10-07T21:55'; // the replay batch run after the out-of-order fixes (395cbb5)
const OUT = join(HERE, 'out'); mkdirSync(OUT, { recursive: true });
const git = (a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();

// The same 500 changes the replay used (newest first-parent commits of origin/main, oldest first).
const lines = git(['log', '--first-parent', '--format=%H%x09%P%x09%at%x09%s', 'origin/main', '-n', '500']).split('\n');
const prs = lines.map((l) => { const [sha, parents, at, subject] = l.split('\t'); const m = /\(#(\d+)\)\s*$/.exec(subject); return { sha, parent: parents.split(' ')[0], mergedAt: +at * 1000, subject, pr: m ? +m[1] : null }; }).reverse();
prs.forEach((p, i) => { p.idx = i; p.files = new Set(git(['diff', '--name-only', p.parent, p.sha]).split('\n').filter(Boolean)); });
const byPr = new Map(prs.filter((p) => p.pr).map((p) => [p.pr, p]));

// When did work on each PR start? min(PR createdAt, first commit authoredDate), from GitHub (cached).
const cacheF = join(OUT, 'hono-pr-starts.json');
const cache = existsSync(cacheF) ? JSON.parse(readFileSync(cacheF, 'utf8')) : {};
const missing = [...byPr.keys()].filter((n) => !cache[n]);
for (let i = 0; i < missing.length; i += 40) {
  const batch = missing.slice(i, i + 40);
  const q = `query { repository(owner:"honojs", name:"hono") { ${batch.map((n) => `p${n}: pullRequest(number:${n}) { createdAt commits(first:1) { nodes { commit { authoredDate } } } }`).join(' ')} } }`;
  const r = JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${q}`], { encoding: 'utf8', maxBuffer: 16 << 20 }));
  for (const n of batch) {
    const x = r.data.repository[`p${n}`];
    if (!x) { cache[n] = { missing: true }; continue; }
    const first = x.commits.nodes[0]?.commit.authoredDate;
    cache[n] = { createdAt: x.createdAt, firstCommit: first ?? null };
  }
  writeFileSync(cacheF, JSON.stringify(cache, null, 1));
}
const startOf = (p) => {
  const c = cache[p.pr];
  if (!c || c.missing) return null;
  return Math.min(Date.parse(c.createdAt), c.firstCommit ? Date.parse(c.firstCommit) : Infinity);
};

// The replay's "needs an earlier PR" events (first per PR per W), from the post-fix batch.
const needs = new Map(); // W -> Map(pr -> {wave, files})
for (const l of readFileSync(TRACE, 'utf8').split('\n')) {
  if (!l) continue;
  const d = JSON.parse(l);
  if (d.ts < SINCE || d.event !== 'depends' || !WAVES.includes(d.W)) continue;
  if (!needs.has(d.W)) needs.set(d.W, new Map());
  const m = needs.get(d.W);
  if (!m.has(d.pr)) m.set(d.pr, { wave: d.wave, files: d.files || [] });
}

const report = { generated: new Date().toISOString(), method: {}, waves: {} };
for (const W of WAVES) {
  const m = needs.get(W) || new Map();
  const rows = [];
  for (const [prNo, ev] of m) {
    const p = byPr.get(prNo);
    if (!p) continue;
    const confFiles = ev.files.filter((f) => !f.startsWith('('));
    const files = confFiles.length ? new Set(confFiles) : p.files; // absorbed cases: the PR's own files
    // The needed change: the nearest earlier change (history order, within the last W PRs + direct
    // pushes between them) that touches one of those files.
    const lo = Math.max(0, p.idx - W * 2);
    let need = null;
    for (let i = p.idx - 1; i >= lo; i--) { const q = prs[i]; if ([...q.files].some((f) => files.has(f))) { need = q; break; } }
    const sP = startOf(p), sQ = need?.pr ? startOf(need) : null;
    let verdict;
    if (!need) verdict = 'no earlier change on those files found';
    else if (!need.pr) verdict = 'needed a direct push (no PR, not announceable)';
    else if (sP == null || sQ == null) verdict = 'start time unknown';
    else verdict = sQ <= sP ? 'visible' : 'not visible (needed PR started later)';
    rows.push({ pr: prNo, need: need ? (need.pr ? `#${need.pr}` : `push ${need.sha.slice(0, 7)}`) : null, files: [...files].slice(0, 3), verdict,
      leadH: sP != null && sQ != null ? +((sP - sQ) / 3.6e6).toFixed(1) : null });
  }
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const leads = rows.filter((r) => r.verdict === 'visible').map((r) => r.leadH).sort((a, b) => a - b);
  report.waves[W] = {
    prsNeedingEarlier: rows.length, visible: count('visible'), notVisible: count('not visible (needed PR started later)'),
    neededDirectPush: count('needed a direct push (no PR, not announceable)'), noneFound: count('no earlier change on those files found'), unknown: count('start time unknown'),
    visibleLeadHoursMedian: leads.length ? leads[Math.floor(leads.length / 2)] : null, rows,
  };
  const s = report.waves[W];
  console.log(`W=${W}: ${s.prsNeedingEarlier} PRs needed an earlier change; visible on a board ${s.visible}, not visible (needed PR started later) ${s.notVisible}, needed a direct push ${s.neededDirectPush}, no earlier change found ${s.noneFound}, unknown ${s.unknown}; median head start when visible ${s.visibleLeadHoursMedian} h`);
}
report.method = {
  needs: `sim/hono/replay.mjs 'depends' events since ${SINCE} (first per PR per W)`,
  neededChange: 'nearest earlier change in history order touching the PR\'s conflicting files (its own files when the conflict was an absorbed patch), within the last 2W changes',
  start: 'min(PR createdAt, first commit authoredDate) from the GitHub API (cached in sim/board/out/hono-pr-starts.json)',
  visible: 'the needed PR had started (been announceable) at or before the later PR started; files only, not symbols',
};
writeFileSync(join(OUT, 'hono-board.json'), JSON.stringify(report, null, 1));
appendFileSync(join(homedir(), '.local/share/qbsim-bench/board.jsonl'), JSON.stringify({ ts: report.generated, event: 'hono_board', waves: Object.fromEntries(Object.entries(report.waves).map(([w, s]) => [w, { ...s, rows: undefined }])) }) + '\n');
