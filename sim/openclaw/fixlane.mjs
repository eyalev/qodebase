// Phase 2c prep (no model calls): pick closed OpenClaw issues whose fix is one small merged PR
// that adds or changes a test, pin each to the fix's parent commit, and verify locally that the
// fix's test fails at the parent and passes at the fix. docs/openclaw/PLAN.md.
//   node sim/openclaw/fixlane.mjs candidates            # from mirrored data, offline -> data/fixlane-candidates.json
//   node sim/openclaw/fixlane.mjs verify [--n 10]       # needs data/fixlane-wt (a full worktree + pnpm install)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA = process.env.OPENCLAW_DATA || path.join(os.homedir(), 'projects/github/openclaw/data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const readJsonl = (f) => (fs.existsSync(path.join(DATA, f)) ? fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
// Areas as in breaks.mjs: extensions/<x>, packages/<x>, src/<dir>, ui, ...
const area = (f) => { const p = f.split('/'); if (['extensions', 'apps', 'packages', 'skills'].includes(p[0])) return p.slice(0, 2).join('/'); if (p[0] === 'src' && p.length > 2) return p.slice(0, 2).join('/'); return p[0]; };

function candidates() {
  const prs = new Map([...readJsonl('prs-days.jsonl'), ...readJsonl('prs.jsonl')].map((p) => [p.number, p]));
  const issues = [...new Map(readJsonl('issues.jsonl').map((i) => [i.number, i])).values()];
  // How many issues does each PR claim to close (one PR fixing many issues is not a clean task).
  const out = [], why = {};
  const no = (k) => { why[k] = (why[k] || 0) + 1; };
  for (const i of issues) {
    if (i.state !== 'CLOSED' || i.author?.__typename === 'Bot') continue;
    const tl = i.timelineItems?.nodes || [];
    const closer = tl.filter((e) => e.__typename === 'ClosedEvent').at(-1)?.closer;
    if (closer?.__typename !== 'PullRequest') { no('not closed by a PR'); continue; }
    const mergedRefs = new Set(tl.filter((e) => e.__typename === 'CrossReferencedEvent' && e.source?.mergedAt).map((e) => e.source.number));
    mergedRefs.add(closer.number);
    if (mergedRefs.size !== 1) { no('more than one merged PR linked'); continue; }
    const p = prs.get(closer.number);
    if (!p || !p.mergedAt || !p.mergeCommit?.oid) { no('PR not in mirror or not merged'); continue; }
    if ((p.closingIssuesReferences?.nodes || []).length > 1) { no('PR closes several issues'); continue; }
    const files = (p.files?.nodes || []).map((f) => f.path);
    if (p.files?.totalCount > files.length) { no('file list truncated'); continue; }
    const lines = p.additions + p.deletions;
    if (lines >= 200) { no('>= 200 lines'); continue; }
    const tests = files.filter(isTest), src = files.filter((f) => !isTest(f) && !/\.md$|CHANGELOG/.test(f));
    if (!tests.length) { no('no test file'); continue; }
    if (!src.length) { no('test-only PR'); continue; }
    if (files.some((f) => /package\.json$|pnpm-lock|\.github\//.test(f))) { no('touches deps/CI'); continue; }
    const areas = new Set(src.concat(tests).map(area));
    if (areas.size !== 1) { no('more than one area'); continue; }
    if (!/^src\//.test(src[0]) && !/^extensions\//.test(src[0]) && !/^packages\//.test(src[0])) { no('not src/extensions/packages'); continue; }
    out.push({ issue: i.number, issue_title: i.title, issue_created: i.createdAt, pr: p.number, pr_title: p.title, merged: p.mergedAt, fix: p.mergeCommit.oid, lines, files, tests, area: [...areas][0], author: p.author?.login });
  }
  out.sort((a, b) => a.lines - b.lines);
  fs.writeFileSync(path.join(DATA, 'fixlane-candidates.json'), JSON.stringify({ n: out.length, rejected: why, candidates: out }, null, 1));
  console.log(JSON.stringify({ n: out.length, rejected: why, areas: out.reduce((m, c) => ((m[c.area] = (m[c.area] || 0) + 1), m), {}) }, null, 1));
}

// ---- verify: the fix's test fails before the fix and passes after it ----
// At BASE (the fix's parent, or --base <sha> for a shared base): put only the fix's test files in
// (they must fail), then apply the fix's whole diff on BASE (they must pass). Lockfile changes
// between the installed tree and BASE are recorded (node_modules come from one install).
const WT = path.join(DATA, 'fixlane-wt');
const NODE24 = path.join(os.homedir(), '.nvm/versions/node/v24.20.0/bin');
const git = (...a) => execFileSync('git', a, { cwd: WT, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env } }).trim();
function vitest(files) {
  const t0 = Date.now();
  const r = spawnSync('node', ['scripts/run-vitest.mjs', 'run', ...files], { cwd: WT, encoding: 'utf8', timeout: 420000, env: { ...process.env, PATH: `${NODE24}:${process.env.PATH}`, CI: '1' }, maxBuffer: 1 << 28 });
  const out = (r.stdout || '') + (r.stderr || '');
  const tests = out.match(/Tests\s+([^\n]+)/)?.[1]?.trim() || null;
  return { code: r.status, signal: r.signal, s: Math.round((Date.now() - t0) / 1000), tests, tail: out.split('\n').filter((l) => /FAIL|✗|×|Error|failed|passed/.test(l)).slice(-6).map((l) => l.slice(0, 200)) };
}
function verify() {
  const { candidates: cs } = JSON.parse(fs.readFileSync(path.join(DATA, 'fixlane-candidates.json'), 'utf8'));
  const outF = path.join(DATA, 'fixlane-verify.jsonl');
  const done = new Set(fs.existsSync(outF) ? readJsonl('fixlane-verify.jsonl').map((r) => `${r.pr}@${r.base_mode}`) : []);
  const want = +opt('n', 10), base = opt('base', null);
  const pickList = opt('prs', null) ? opt('prs').split(',').map(Number) : null;
  // Spread over areas: one per area first, smallest fixes first.
  const seen = new Set(); const order = [];
  for (const c of cs) if (!seen.has(c.area)) { seen.add(c.area); order.push(c); }
  for (const c of cs) if (!order.includes(c)) order.push(c);
  const since = opt('since', null), until = opt('until', null);
  const list = (pickList ? cs.filter((c) => pickList.includes(c.pr)) : order).filter((c) => (!since || c.merged >= since) && (!until || c.merged < until));
  const lockAtInstall = git('rev-parse', 'HEAD:pnpm-lock.yaml');
  let ok = readJsonl('fixlane-verify.jsonl').filter((r) => r.verified && r.base_mode === (base ? 'common' : 'parent')).length;
  for (const c of list) {
    if (ok >= want) break;
    const mode = base ? 'common' : 'parent';
    if (done.has(`${c.pr}@${mode}`)) continue;
    const B = base || git('rev-parse', `${c.fix}^`);
    const row = { pr: c.pr, issue: c.issue, area: c.area, lines: c.lines, fix: c.fix, base: B, base_mode: mode, tests: c.tests };
    try {
      git('checkout', '-q', '-f', '--detach', B); git('clean', '-qfd', '--', 'src', 'extensions', 'packages');
      row.lock_changed = git('rev-parse', 'HEAD:pnpm-lock.yaml') !== lockAtInstall;
      // Test files from the fix only (new files included).
      const diffTests = execFileSync('git', ['diff', '--binary', `${c.fix}^`, c.fix, '--', ...c.tests], { cwd: WT, maxBuffer: 1 << 28 });
      const applyT = spawnSync('git', ['apply', '--3way', '-'], { cwd: WT, input: diffTests });
      if (applyT.status !== 0) { row.verdict = 'test diff does not apply on base'; throw 0; }
      row.before = vitest(c.tests);
      git('checkout', '-q', '-f', '--detach', B); git('clean', '-qfd', '--', 'src', 'extensions', 'packages');
      const diffAll = execFileSync('git', ['diff', '--binary', `${c.fix}^`, c.fix], { cwd: WT, maxBuffer: 1 << 28 });
      const applyA = spawnSync('git', ['apply', '--3way', '-'], { cwd: WT, input: diffAll });
      if (applyA.status !== 0) { row.verdict = 'fix diff does not apply on base'; throw 0; }
      row.after = vitest(c.tests);
      row.verified = row.before.code !== 0 && row.after.code === 0 && !row.before.signal;
      // A run that never got to the tests (build/import failure, "no tests") is the environment, not a result.
      const envErr = (r) => r.tests === 'no tests' || r.tests == null || r.tail.some((l) => /Compiled subprocess build failed|Cannot find (module|package)|ERR_MODULE_NOT_FOUND/.test(l));
      if (envErr(row.after) || (row.before.code !== 0 && envErr(row.before))) { row.verified = false; row.verdict = 'env-error (not a test result)'; throw 0; }
      row.verdict = row.verified ? 'fails before, passes after' : row.before.code === 0 ? 'test already passes before the fix' : row.after.code !== 0 ? 'test fails after the fix too' : 'other';
    } catch (e) { if (e !== 0) row.error = String(e.message || e).slice(0, 300); }
    fs.appendFileSync(outF, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n');
    if (row.verified) ok++;
    console.error(`[verify] #${c.pr} ${c.area} ${row.verdict || row.error} (${row.before?.s ?? '-'}s / ${row.after?.s ?? '-'}s) verified ${ok}/${want}`);
  }
  git('checkout', '-q', '-f', '--detach', lockAtInstall ? 'HEAD' : 'HEAD');
}

if (args[0] === 'candidates') candidates();
else if (args[0] === 'verify') verify();
else { console.error('usage: fixlane.mjs candidates | verify'); process.exit(2); }
