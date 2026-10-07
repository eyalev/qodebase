#!/usr/bin/env node
// Replay a real repo's merged pull requests as if many had been opened at the same time.
//
// Each squash commit on main is exactly the patch a PR landed (parent -> commit). History
// is conflict-free because every author rebased before merging. Here, PRs come in waves
// of W: all W are authored against the same main S (the patch replayed onto S with a real
// three-way merge), then land in their original order onto a main that moved on.
//   - "depends"   the patch does not even apply to S: it needed an earlier PR of its wave
//   - "conflict"  it applied to S, but `git merge-tree` conflicts with what landed since
//   - "broken"    merged cleanly, but the type check (tsgo) shows errors main did not have
// W=1 is history itself (every PR authored on the latest main): it should show ~nothing,
// which checks the method. No model calls.
//
//   node sim/hono/replay.mjs --repo ~/projects/github/honojs/hono --prs 500 --waves 1,10,50,100
// Writes public/sim/runs/hono-w<W>.json (viewer) and one JSON line per PR outcome to
// ~/.local/share/qbsim-bench/hono-replay.jsonl.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => { if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]); return acc; }, []));
const REPO = (args.repo || join(homedir(), 'projects/github/honojs/hono')).replace(/^~/, homedir());
const NPRS = Number(args.prs || 500);
const MAX_RETRIES = 20; // per change, across the conflict/break redo paths; then it is dropped and counted
const STALL_WAVES = 3; // waves in a row with no landing before the earliest change is dropped
const WAVES = String(args.waves || '1,10,50,100').split(',').map(Number);
const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, '../../public/sim/runs');
const LOG = join(homedir(), '.local/share/qbsim-bench'); mkdirSync(LOG, { recursive: true });
const TRACE = join(LOG, 'hono-replay-trace.jsonl');
const trace = (o) => appendFileSync(TRACE, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');
const git = (a, opts = {}) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 << 20, ...opts }).trim();
const gitTry = (a) => spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
// "added\tremoved\tpath" per file, sorted: the shape of a diff, independent of its base.
const numstat = (a, b) => git(['diff', '--numstat', a, b]).split('\n').filter(Boolean).sort().join('\n');

// ---- the PRs: newest NPRS squash commits on main's first-parent line, oldest first ----
const lines = git(['log', '--first-parent', '--format=%H%x09%P%x09%at%x09%an%x09%s', 'origin/main', `-n`, String(NPRS * 2)]).split('\n');
const prs = [];
// Every commit on main's first-parent line is a change (a PR's squash commit, or a direct
// push such as a release bump); skipping direct pushes leaves later PRs unable to apply.
for (const l of lines.slice(0, NPRS)) {
  const [sha, parents, at, author, subject] = l.split('\t');
  const m = /\(#(\d+)\)\s*$/.exec(subject);
  prs.push({ sha, parent: parents.split(' ')[0], at: +at, author, subject, pr: m ? +m[1] : null });
}
prs.reverse();
for (const p of prs) { p.files = git(['diff', '--name-only', p.parent, p.sha]).split('\n').filter(Boolean); p.numstat = numstat(p.parent, p.sha); }
console.log(`${prs.length} changes (${prs.filter((p) => p.pr).length} PRs, ${prs.filter((p) => !p.pr).length} direct pushes), #${prs.find((p) => p.pr)?.pr} (${new Date(prs[0].at * 1000).toISOString().slice(0, 10)}) to #${[...prs].reverse().find((p) => p.pr)?.pr} (${new Date(prs.at(-1).at * 1000).toISOString().slice(0, 10)})`);

// ---- type check in a scratch worktree (node_modules shared with the clone) ----
function worktree(name) {
  const wt = join(REPO, '..', `.hono-replay-${name}`);
  if (!existsSync(wt)) { git(['worktree', 'add', '-q', '--detach', wt, prs[0].parent]); symlinkSync(join(REPO, 'node_modules'), join(wt, 'node_modules')); }
  return wt;
}
const errCache = new Map(); // tree -> Set of error keys
function typeErrors(wt, tree) {
  if (errCache.has(tree)) return errCache.get(tree);
  const t0 = Date.now();
  execFileSync('git', ['-C', wt, 'read-tree', '-u', '--reset', tree]);
  const r = spawnSync(join(REPO, 'node_modules/.bin/tsgo'), ['-p', 'tsconfig.build.json', '--noEmit'], { cwd: wt, encoding: 'utf8', maxBuffer: 64 << 20 });
  // "src/x.ts(12,3): error TS2305: Module has no exported member 'y'." -> key without the position
  const keys = new Set((r.stdout + r.stderr).split('\n').map((l) => /^(\S+?)\(\d+,\d+\): error (TS\d+): (.*)$/.exec(l)).filter(Boolean).map((m) => `${m[1]} ${m[2]} ${m[3]}`));
  errCache.set(tree, keys);
  trace({ event: 'typecheck', tree: tree.slice(0, 10), errors: keys.size, ms: Date.now() - t0 });
  return keys;
}
const newErrors = (before, after) => [...after].filter((k) => !before.has(k));

const treeOf = (c) => git(['rev-parse', `${c}^{tree}`]);
// Three-way: apply (base -> theirs) onto ours. -> { tree, conflicts }
function merge3(base, ours, theirs) {
  const r = gitTry(['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, ours, theirs]);
  if (r.status !== 0 && r.status !== 1) throw new Error(`merge-tree: ${r.stderr}`);
  const out = r.stdout.split('\n'), conflicts = [];
  for (let i = 1; i < out.length && out[i] !== ''; i++) conflicts.push(out[i]);
  return { tree: out[0].trim(), conflicts: r.status === 1 ? [...new Set(conflicts)] : [] };
}
const commitTree = (tree, parent, msg) => git(['commit-tree', tree, '-p', parent, '-m', msg]);

// ---- one replay with waves of W ----
function replay(W) {
  const wt = worktree(`w${W}`);
  const t0 = Date.now();
  let main = prs[0].parent;
  let mainErrs = typeErrors(wt, treeOf(main));
  const pending = prs.map((p, i) => ({ ...p, idx: i, events: [], deferrals: 0 }));
  const done = [];
  const history = [];
  let wave = 0, clock = 0, stall = 0;
  const counts = { landed: 0, depends: 0, conflict: 0, conflictRebased: 0, broken: 0, deferred: 0 };
  const conflictFiles = {}, brokenFiles = {};
  while (pending.length) {
    wave++;
    const landedBefore = counts.landed;
    const S = main, Serrs = mainErrs;
    // A wave is the next W pull requests; direct pushes between them (release bumps) are
    // not concurrent work: they ride along and land in order on the latest main.
    let nPR = 0, take = 0;
    while (take < pending.length && nPR < W) { if (pending[take].pr) nPR++; take++; }
    while (take < pending.length && !pending[take].pr) take++;
    const batch = pending.splice(0, Math.max(1, take));
    const back = []; // changes that go round again; re-queued in history order (prerequisites first)
    const authored = [];
    // Everyone in the wave writes their change against S.
    for (const p of batch) {
      p.events.push([clock, 'asked', p.subject]);
      if (!p.pr) { p.direct = true; authored.push(p); continue; }
      const a = merge3(p.parent, S, p.sha);
      // A clean merge can still lose part of the PR: when S lacks a change the PR builds on,
      // git takes "both sides removed it" as already done (PR #4757 reverted code that only
      // arrived with the next "Merge next"; authored on S it was empty and landed as nothing,
      // so main != history). The PR applies as written only if its diff on S has the same
      // per-file line counts as its real diff; otherwise it needed an earlier change.
      if (!a.conflicts.length && numstat(S, a.tree) !== p.numstat) {
        trace({ event: 'absorbed', W, wave, change: p.sha.slice(0, 10), pr: p.pr, real: p.numstat.slice(0, 200), onS: numstat(S, a.tree).slice(0, 200) });
        a.conflicts = ['(part of the change already absorbed on this main)'];
      }
      if (a.conflicts.length) {
        trace({ event: 'depends', W, wave, change: p.sha.slice(0, 10), pr: p.pr, deferrals: p.deferrals, files: a.conflicts.slice(0, 3) });
        // Waiting for an earlier PR is not a retry: it lands once that one has. Only a stall
        // (no landing for STALL_WAVES waves) ends it, so the run still ends.
        counts.depends++; p.waitsEarlier = (p.waitsEarlier || 0) + 1; p.overlapped = true;
        p.events.push([clock, 'depends', a.conflicts.slice(0, 5)]);
        back.push(p);
        continue;
      }
      p.authoredTree = a.tree; p.base = S;
      p.events.push([clock, 'work']);
      authored.push(p);
    }
    // ...then they land in their original order onto a main that keeps moving.
    clock += 300; // a wave's work takes ~5 min of simulated time
    for (const p of authored) {
      clock += 10;
      p.events.push([clock, 'mergeWait']);
      if (p.direct) {
        // A direct push (release bump, or code a maintainer committed straight to main)
        // lands in history order: it waits for everything before it.
        if (pending.some((q) => q.idx < p.idx) || back.some((q) => q.idx < p.idx)) {
          p.waits = (p.waits || 0) + 1;
          trace({ event: 'direct_waits', W, wave, change: p.sha.slice(0, 10), waits: p.waits });
          back.push(p); continue;
        }
        const d = merge3(p.parent, main, p.sha);
        if (d.conflicts.length) { p.state = 'dropped'; p.events.push([clock, 'dropped', 'direct push did not apply']); done.push(p); trace({ event: 'direct_dropped', W, wave, change: p.sha.slice(0, 10), files: d.conflicts.slice(0, 3) }); continue; }
        main = commitTree(d.tree, main, `Direct push ${p.sha.slice(0, 7)}: ${p.subject}`);
        mainErrs = typeErrors(wt, d.tree);
        counts.landed++; p.landedAt = clock; p.landSha = main; p.state = 'landed';
        p.events.push([clock, 'landed', main.slice(0, 7)]);
        history.push({ t: clock, sha: main, ids: [p.idx + 1], kind: 'land' });
        done.push(p); continue;
      }
      // A direct push earlier in history that has not landed yet (e.g. "Merge next") is a
      // barrier: landing past it reorders two changes that may not commute (a revert landed
      // before the merge that re-adds what it reverted, and main ended up != history).
      if (pending.some((q) => !q.pr && q.idx < p.idx) || back.some((q) => !q.pr && q.idx < p.idx)) {
        p.waits = (p.waits || 0) + 1;
        trace({ event: 'pr_waits_direct', W, wave, change: p.sha.slice(0, 10), pr: p.pr, waits: p.waits });
        p.events.push([clock, 'waits for an earlier direct push']);
        back.push(p); continue;
      }
      const tip = commitTree(p.authoredTree, p.base, `${p.pr ? `PR #${p.pr}` : p.sha.slice(0, 7)} as written on ${p.base.slice(0, 7)}`);
      let r = merge3(p.base, main, tip), how = 'merged';
      if (r.conflicts.length) {
        counts.conflict++; p.overlapped = true;
        for (const f of r.conflicts) conflictFiles[f] = (conflictFiles[f] || 0) + 1;
        p.conflicts = r.conflicts;
        p.events.push([clock, 'conflict', r.conflicts.slice(0, 5)]);
        // Redo: the author rebases the original change onto today's main.
        r = merge3(p.parent, main, p.sha);
        if (r.conflicts.length) {
          counts.deferred++; p.deferrals++;
          trace({ event: 'conflict_deferred', W, wave, change: p.sha.slice(0, 10), pr: p.pr, deferrals: p.deferrals, files: p.conflicts.slice(0, 3) });
          if (p.deferrals > MAX_RETRIES) { p.state = 'dropped'; p.events.push([clock, 'dropped', 'kept conflicting']); done.push(p); continue; }
          p.events.push([clock, 'rework']); back.push(p); continue;
        }
        counts.conflictRebased++; how = 'rebased';
      }
      const errs = typeErrors(wt, r.tree);
      // Only counterfactual breaks count: errors this change also added in the real history
      // (main was briefly red there too) are not caused by the concurrency.
      const histAdded = new Set(newErrors(typeErrors(wt, treeOf(p.parent)), typeErrors(wt, treeOf(p.sha))));
      const added = newErrors(mainErrs, errs).filter((k) => !histAdded.has(k));
      if (added.length) {
        counts.broken++; p.overlapped = true;
        for (const k of added) { const f = k.split(' ')[0]; brokenFiles[f] = (brokenFiles[f] || 0) + 1; }
        p.fails = added.slice(0, 3);
        p.events.push([clock, 'train tests failed', added.slice(0, 3)]);
        // Bounced: re-authored on a newer main next wave.
        p.deferrals++;
        trace({ event: 'broken', W, wave, change: p.sha.slice(0, 10), pr: p.pr, deferrals: p.deferrals, errors: added.slice(0, 3) });
        if (p.deferrals > MAX_RETRIES) { p.state = 'dropped'; p.events.push([clock, 'dropped', 'kept breaking the build']); done.push(p); continue; }
        back.push(p); continue;
      }
      main = commitTree(r.tree, main, `Land ${p.pr ? `#${p.pr}` : p.sha.slice(0, 7)} (${how}): ${p.subject}`);
      mainErrs = errs;
      counts.landed++;
      p.landedAt = clock; p.landSha = main; p.state = 'landed';
      trace({ event: 'landed', W, wave, change: p.sha.slice(0, 10), pr: p.pr, how, errors: errs.size });
      p.events.push([clock, 'landed', main.slice(0, 7)]);
      history.push({ t: clock, sha: main, ids: [p.idx + 1], kind: 'land' });
      done.push(p);
    }
    back.sort((x, y) => x.idx - y.idx);
    pending.unshift(...back);
    // Stall guard: if STALL_WAVES waves in a row land nothing, the earliest change can never
    // apply; drop it (counted, traced) so the run ends.
    stall = counts.landed === landedBefore ? stall + 1 : 0;
    if (stall >= STALL_WAVES && pending.length) {
      const p = pending.shift(); p.state = 'dropped'; p.events.push([clock, 'dropped', 'never applied (stalled)']); done.push(p);
      trace({ event: 'stall_dropped', W, wave, change: p.sha.slice(0, 10), pr: p.pr }); stall = 0;
    }
    if (wave % 25 === 0) process.stderr.write(`  W=${W}: wave ${wave}, ${counts.landed}/${prs.length} landed\n`);
  }
  counts.prsAffected = done.filter((p) => p.overlapped && p.pr).length;
  counts.prs = prs.filter((p) => p.pr).length;
  const finalOk = git(['rev-parse', `${main}^{tree}`]) === treeOf(prs.at(-1).sha);
  return { W, counts, conflictFiles, brokenFiles, done, history, wallS: (Date.now() - t0) / 1000, sameAsHistory: finalOk, finalMain: main };
}

// ---- viewer bundle ----
function bundle(r) {
  const paths = [...new Set(prs.flatMap((p) => p.files))].sort();
  const pathIdx = new Map(paths.map((p, i) => [p, i]));
  const diffOf = (p) => {
    const out = [];
    for (const f of p.files.slice(0, 6)) {
      const d = gitTry(['diff', '--unified=2', p.parent, p.sha, '--', f]).stdout.split('\n').slice(4, 70);
      out.push({ p: f, lines: d.map((l) => (l.startsWith('@@') ? '…' : l)) });
    }
    return out;
  };
  const changes = r.done.sort((a, b) => a.idx - b.idx).map((p) => ({
    id: p.idx + 1, agent: p.author, kind: p.pr ? `PR #${p.pr}` : 'direct push', text: p.subject, created: p.events[0][0], files: p.files.map((f) => pathIdx.get(f)),
    events: p.events, tries: p.deferrals + 1, landedAt: p.landedAt ?? null, sha: p.landSha?.slice(0, 10) ?? null, commit: p.sha.slice(0, 10),
    conflicts: p.conflicts || [], fails: p.fails || [], reverted: false, diff: p.state === 'landed' ? diffOf(p) : null, state: p.state,
  }));
  const end = Math.max(...r.history.map((h) => h.t), 1);
  const series = [];
  for (let t = 0; t <= end; t += 60) {
    const states = {};
    for (const c of changes) { let s = null; for (const e of c.events) if (e[0] <= t && ['work', 'mergeWait', 'landed', 'dropped'].includes(e[1])) s = e[1]; if (s && s !== 'landed' && s !== 'dropped') states[s] = (states[s] || 0) + 1; }
    series.push({ t, landed: changes.filter((c) => c.landedAt != null && c.landedAt <= t).length, states });
  }
  const c = r.counts;
  return {
    meta: {
      name: `hono-w${r.W}`, policy: 'replay', label: `Hono, real PRs, ${r.W === 1 ? 'one at a time (history)' : `${r.W} at once`}`, agents: r.W, reviewers: 0, leads: 0,
      hours: +(end / 3600).toFixed(3), modules: 0, filesPerModule: 0, startedAt: new Date(prs[0].at * 1000).toISOString(), generatedAt: new Date().toISOString(),
      git: `${REPO.replace(homedir(), '~')} (replay main ${r.finalMain.slice(0, 10)})`,
      about: `The last ${prs.length} changes on honojs/hono's main (${prs.filter((p) => p.pr).length} pull requests, ${prs.filter((p) => !p.pr).length} direct pushes such as release bumps), replayed ${r.W === 1 ? 'in order, each written on the latest main: history itself' : `in waves of ${r.W} pull requests, all written against the same main, then landed in their original order (direct pushes land in order on the latest main)`}. Real three-way merges; a type check (tsgo) after every landing counts only errors that the real history did not have. No model calls.`,
    },
    stats: {
      landed: c.landed, landedPerHour: Math.round(c.landed / Math.max(end / 3600, 0.01)), conflicts: c.conflict, testFails: c.broken, breaks: 0, reverts: 0,
      redos: c.conflictRebased, leadReplays: 0, replayedOnLand: 0, dropped: r.done.filter((p) => p.state === 'dropped').length, reworkShare: 0,
      p50S: null, p90S: null, replay: { ...c, wallS: r.wallS, sameAsHistory: r.sameAsHistory },
    },
    paths, changes, history: r.history, series,
  };
}

const index = existsSync(join(RUNS, 'index.json')) ? JSON.parse(readFileSync(join(RUNS, 'index.json'), 'utf8')) : [];
for (const W of WAVES) {
  const r = replay(W);
  const b = bundle(r);
  const json = JSON.stringify(b);
  writeFileSync(join(RUNS, `${b.meta.name}.json`), json);
  const entry = { name: b.meta.name, policy: 'replay', label: b.meta.label, agents: W, hours: b.meta.hours, stats: b.stats, bytes: json.length };
  const i = index.findIndex((x) => x.name === entry.name); if (i >= 0) index[i] = entry; else index.push(entry);
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([f, n]) => `${f} ${n}`).join(', ');
  appendFileSync(join(LOG, 'hono-replay.jsonl'), JSON.stringify({ ts: new Date().toISOString(), event: 'hono_replay', W, prs: prs.length, ...r.counts, wallS: r.wallS, sameAsHistory: r.sameAsHistory, conflictFiles: r.conflictFiles, brokenFiles: r.brokenFiles }) + '\n');
  console.log(`W=${W}: ${r.counts.prsAffected} of ${r.counts.prs} PRs ran into another (${Math.round(100 * r.counts.prsAffected / r.counts.prs)}%); attempts: ${r.counts.depends} needed an earlier PR of their wave, ${r.counts.conflict} git conflicts (${r.counts.conflictRebased} fixed by rebasing), ${r.counts.broken} merged clean but broke the type check; final tree = history: ${r.sameAsHistory}; ${r.wallS.toFixed(0)} s`);
  if (Object.keys(r.conflictFiles).length) console.log(`  conflicts: ${top(r.conflictFiles)}`);
  if (Object.keys(r.brokenFiles).length) console.log(`  breaks:    ${top(r.brokenFiles)}`);
}
index.sort((a, b) => a.agents - b.agents || a.name.localeCompare(b.name));
writeFileSync(join(RUNS, 'index.json'), JSON.stringify(index, null, 1));
for (const W of WAVES) { const wt = join(REPO, '..', `.hono-replay-w${W}`); gitTry(['worktree', 'remove', '--force', wt]); }
