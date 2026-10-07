// The merger box's job: land a train of changes on a project's main with real git.
// Runs inside the MergeBox container (src/landing/merger.ts writes it to
// /opt/qb/mergejob.mjs and runs `node mergejob.mjs` with the job in $JOB).
//
// For each change, in order: its diff (base..commit, what the agent did and what was
// reviewed) is applied to the LATEST main with `git apply --3way`. A clean apply lands
// as is ("merged"). Conflicts in shared files go to deterministic handlers (tier 1:
// package.json deps, list files, lockfile regenerate) that replay the change's intent on
// today's main ("replayed-handler"). Anything else stops that change (the Landing DO
// sends it to tier 2 or 3). The train is tested once; if it fails, each change is tested
// alone so one bad change bounces without taking the others with it. Every landed commit
// carries its record as a git note (refs/notes/qodebase). One push at the end.
//
// Output: progress lines, then one line `QB_RESULT {json}`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const job = JSON.parse(process.env.JOB || readFileSync(process.argv[2] || '/dev/stdin', 'utf8'));
const DIR = job.dir;
const t0 = Date.now();
const say = (event, data = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'mergejob', event, ...data }));
// Artifacts tokens are `art_v2_…?expires=…`: git auth is Basic with the part before `?`.
const auth = (tok) => (tok ? ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x:${tok.split('?')[0]}`).toString('base64')}`] : []);
const ID = ['-c', 'user.name=qodebase lander', '-c', 'user.email=lander@qodebase.app', '-c', 'commit.gpgsign=false'];

function git(args, { tok, input, ok = false } = {}) {
  const r = spawnSync('git', [...ID, ...auth(tok), ...args], { cwd: DIR, input, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0 && !ok) throw new Error(`git ${args[0]} failed (${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 600)}`);
  return { code: r.status, out: (r.stdout || '').trimEnd(), err: (r.stderr || '').trimEnd() };
}
// The same, without blocking: for fetching many forks at once (each git takes its own ref).
function gitAsync(args, tok) {
  return new Promise((resolve) => {
    const p = spawn('git', [...ID, ...auth(tok), ...args], { cwd: DIR });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trimEnd(), err: err.trimEnd() }));
    p.on('error', (e) => resolve({ code: -1, out: '', err: String(e) }));
  });
}
const show = (spec) => { const r = git(['show', spec], { ok: true }); return r.code === 0 ? r.out + '\n' : null; };

// ---- tier 1 handlers: replay a shared-file edit on today's version ----------------
// Each gets the file at base (the change's start), ours (latest main), theirs (the
// change's version) and returns the merged text, or null when it cannot.
const DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'scripts'];
function mergeMap(b = {}, o = {}, t = {}) {
  const out = { ...o };
  for (const k of new Set([...Object.keys(b), ...Object.keys(t)])) {
    if (b[k] === t[k]) continue;                 // the change did not touch this key
    if (o[k] !== b[k] && o[k] !== t[k]) return null;   // both sides set it differently
    if (t[k] === undefined) delete out[k]; else out[k] = t[k];
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [z]) => (a < z ? -1 : a > z ? 1 : 0)));
}
function packageJson(base, ours, theirs) {
  try {
    const b = JSON.parse(base || '{}'), o = JSON.parse(ours), t = JSON.parse(theirs);
    const out = { ...o };
    for (const k of new Set([...Object.keys(b), ...Object.keys(t)])) {
      if (JSON.stringify(b[k]) === JSON.stringify(t[k])) continue;
      if (DEP_KEYS.includes(k)) { const m = mergeMap(b[k], o[k], t[k]); if (!m) return null; out[k] = m; continue; }
      if (JSON.stringify(o[k]) !== JSON.stringify(b[k]) && JSON.stringify(o[k]) !== JSON.stringify(t[k])) return null;
      if (t[k] === undefined) delete out[k]; else out[k] = t[k];
    }
    return JSON.stringify(out, null, 2) + '\n';
  } catch { return null; }
}
// A list file (routes, exports, a changelog): each line the change added goes into
// today's file after the same neighbour it had in the change's version; lines it removed
// are removed. Fails only if a removed line is gone and an added line has no anchor.
function listFile(base, ours, theirs) {
  const B = (base || '').split('\n'), O = ours.split('\n'), T = theirs.split('\n');
  const inB = new Map(); for (const l of B) inB.set(l, (inB.get(l) || 0) + 1);
  const removed = new Set(B.filter((l) => l.trim() && !T.includes(l)));
  let out = O.filter((l) => !removed.has(l));
  const seen = new Map();
  for (let i = 0; i < T.length; i++) {
    const l = T[i];
    const n = (seen.get(l) || 0) + 1; seen.set(l, n);
    if (n <= (inB.get(l) || 0)) continue;        // already in base: not added by the change
    if (out.includes(l) && l.trim()) continue;    // main has it already (same edit landed)
    // Anchor: the nearest previous line of the change's version that today's file has.
    let at = -1;
    for (let j = i - 1; j >= 0; j--) { const k = out.lastIndexOf(T[j]); if (k >= 0 && T[j].trim()) { at = k; break; } }
    if (at < 0) {
      // No line above it survives: anchor on the next line below instead.
      let below = -1;
      for (let j = i + 1; j < T.length; j++) { const k = out.indexOf(T[j]); if (k >= 0 && T[j].trim()) { below = k; break; } }
      at = below >= 0 ? below - 1 : out.length - 1;
    }
    // Keep runs of added lines in their order: skip past lines this change already added.
    out.splice(at + 1, 0, l);
  }
  return out.join('\n');
}
const LIST_DEFAULT = [/(^|\/)routes?\.[cm]?[jt]sx?$/, /(^|\/)index\.[cm]?[jt]s$/, /(^|\/)exports?\.[cm]?[jt]s$/, /(^|\/)CHANGELOG(\.md)?$/i, /\.list$/];
function handlerFor(path, cfg) {
  if (/(^|\/)package\.json$/.test(path)) return ['package-json', packageJson];
  if ((cfg.list || []).includes(path) || LIST_DEFAULT.some((re) => re.test(path))) return ['list', listFile];
  if (/(^|\/)package-lock\.json$/.test(path)) return ['lockfile', null];   // regenerated after package.json
  return null;
}

// ---- one change on top of HEAD ----------------------------------------------------
function applyChange(c, cfg) {
  const before = git(['rev-parse', 'HEAD']).out;
  const base = c.base && git(['cat-file', '-e', `${c.base}^{commit}`], { ok: true }).code === 0 ? c.base : git(['merge-base', before, c.commit]).out;
  const patch = git(['diff', '--binary', '--full-index', base, c.commit]).out + '\n';
  const files = git(['diff', '--name-only', base, c.commit]).out.split('\n').filter(Boolean);
  if (!files.length) return { id: c.id, ok: false, empty: true, files, conflicts: [], why: 'no changes since its base' };
  const patchFile = join(DIR, '.git', 'qb.patch');   // per repo: two jobs never share it
  writeFileSync(patchFile, patch);
  const ap = git(['apply', '--3way', '--index', '--whitespace=nowarn', patchFile], { ok: true });
  let how = 'merged', conflicts = [], handled = [];
  if (ap.code !== 0) {
    conflicts = git(['diff', '--name-only', '--diff-filter=U'], { ok: true }).out.split('\n').filter(Boolean);
    if (!conflicts.length) {
      // apply refused outright (no 3-way info): every file of the change counts.
      conflicts = files;
      git(['reset', '-q', '--hard', before]);
      return { id: c.id, ok: false, files, conflicts, why: ap.err.slice(0, 400) };
    }
    const unhandled = [];
    let lock = false;
    for (const p of conflicts) {
      const h = handlerFor(p, cfg);
      if (!h) { unhandled.push(p); continue; }
      if (h[0] === 'lockfile') { lock = true; handled.push({ path: p, handler: 'lockfile' }); continue; }
      const merged = h[1](show(`:1:${p}`), show(`:2:${p}`) ?? '', show(`:3:${p}`) ?? '');
      if (merged == null) { unhandled.push(p); continue; }
      writeFileSync(join(DIR, p), merged);
      git(['add', p]);
      handled.push({ path: p, handler: h[0] });
    }
    if (unhandled.length) { git(['reset', '-q', '--hard', before]); return { id: c.id, ok: false, files, conflicts, unhandled, why: `conflict in ${unhandled.join(', ')}` }; }
    if (lock) {
      const r = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: DIR, encoding: 'utf8' });
      if (r.status !== 0) { git(['reset', '-q', '--hard', before]); return { id: c.id, ok: false, files, conflicts, unhandled: ['package-lock.json'], why: 'lockfile could not be regenerated' }; }
      git(['add', 'package-lock.json']);
    }
    how = 'replayed-handler';
  }
  const msg = `${c.title || c.id}\n\n${(c.intent || '').slice(0, 4000)}\n\nqodebase-change: ${c.id}\n`;
  git(['commit', '-q', '--allow-empty', '-F', '-'], { input: msg });
  const commit = git(['rev-parse', 'HEAD']).out;
  return { id: c.id, ok: true, how, files, conflicts, handled, commit, before };
}

// ---- checks -----------------------------------------------------------------------
let depsKey = '';
function runChecks() {
  if (!job.check) return { ok: true, ms: 0, failures: [], skipped: true };
  const s = Date.now();
  // Dependencies once per lockfile/package.json version (node_modules is ignored by git clean).
  if (existsSync(join(DIR, 'package.json'))) {
    const key = (readFileSync(join(DIR, 'package.json'), 'utf8') + (existsSync(join(DIR, 'package-lock.json')) ? readFileSync(join(DIR, 'package-lock.json'), 'utf8') : '')).length + ':' + git(['hash-object', 'package.json']).out;
    const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'));
    const hasDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
    if (hasDeps && key !== depsKey) {
      const r = spawnSync('bash', ['-c', 'npm ci --no-audit --no-fund 2>&1 || npm install --no-audit --no-fund 2>&1'], { cwd: DIR, encoding: 'utf8', timeout: 300_000 });
      if (r.status !== 0) return { ok: false, ms: Date.now() - s, failures: ['npm install failed: ' + (r.stdout || '').split('\n').slice(-3).join(' ')] };
      depsKey = key;
    }
  }
  // NODE_TEST_CONTEXT (set when this job itself runs under node --test) would make a
  // project's `node --test` report to that parent instead of running its tests.
  const { NODE_TEST_CONTEXT, JOB, ...env } = process.env;
  const r = spawnSync('bash', ['-c', job.check], { cwd: DIR, encoding: 'utf8', timeout: 300_000, env: { ...env, CI: '1', NO_COLOR: '1' } });
  const out = (r.stdout || '') + (r.stderr || '');
  const failures = out.split('\n').filter((l) => /^\s*(not ok|✖|FAIL|Error:|AssertionError)/.test(l)).map((l) => l.trim()).slice(0, 6);
  return { ok: r.status === 0, ms: Date.now() - s, failures: r.status === 0 ? [] : (failures.length ? failures : [out.trim().split('\n').slice(-3).join(' ').slice(0, 300) || `exit ${r.status}`]) };
}

function diffOf(from, to) {
  const out = [];
  for (const path of git(['diff', '--name-only', from, to]).out.split('\n').filter(Boolean).slice(0, 20)) {
    const lines = git(['diff', '-U2', from, to, '--', path]).out.split('\n').slice(4, 124);
    out.push({ path, lines });
  }
  return out;
}

// ---- the train --------------------------------------------------------------------
async function main() {
  if (!existsSync(join(DIR, '.git'))) { mkdirSync(DIR, { recursive: true }); git(['init', '-q']); }
  const sym = git(['ls-remote', '--symref', job.mainRemote, 'HEAD'], { tok: job.mainToken }).out;
  const branch = job.branch || (sym.match(/ref: refs\/heads\/(\S+)\s+HEAD/) || [])[1] || 'main';
  git(['fetch', '-q', '--no-tags', job.mainRemote, `+refs/heads/${branch}:refs/qb/main`], { tok: job.mainToken });
  git(['fetch', '-q', '--no-tags', job.mainRemote, '+refs/notes/qodebase:refs/notes/qodebase'], { tok: job.mainToken, ok: true });
  const mainBefore = git(['rev-parse', 'refs/qb/main']).out;
  say('main', { branch, mainBefore });
  const cfg = (() => { try { return JSON.parse(show(`${mainBefore}:.qodebase/landing.json`) || '{}'); } catch { return {}; } })();
  if (!job.check && cfg.check) job.check = cfg.check;

  const fetched = [];
  const results = new Map();
  // Every fork at once: one at a time took ~1 s each, 8.7 s of an 11.7 s train (2026-10-08).
  const fetches = await Promise.all(job.changes.map((c) => gitAsync(['fetch', '-q', '--no-tags', '--no-write-fetch-head', c.remote, `+HEAD:refs/qb/c/${c.id}`], c.token)));
  say('fetched', { forks: job.changes.length, ms: Date.now() - t0 });
  for (const [k, c] of job.changes.entries()) {
    const f = fetches[k];
    if (f.code !== 0) { results.set(c.id, { id: c.id, ok: false, conflicts: [], why: 'could not fetch its fork: ' + f.err.slice(0, 200) }); continue; }
    const head = git(['rev-parse', `refs/qb/c/${c.id}`]).out;
    if (c.commit && c.commit !== head && git(['cat-file', '-e', `${c.commit}^{commit}`], { ok: true }).code !== 0) c.commit = head;
    c.commit = c.commit || head;
    fetched.push(c);
  }
  const reset = (to) => { git(['checkout', '-q', '-f', '--detach', to]); git(['clean', '-qfd']); };

  // Pass 1: the whole train, tested once.
  reset(mainBefore);
  let applied = [];
  for (const c of fetched) {
    const r = applyChange(c, cfg);
    results.set(c.id, r);
    say('applied', { id: c.id, ok: r.ok, how: r.how, conflicts: r.conflicts, why: r.why });
    if (r.ok) applied.push(c);
  }
  let checks = applied.length ? runChecks() : { ok: true, ms: 0, failures: [] };
  say('checks', { train: applied.map((c) => c.id), ...checks });
  let solo = false;
  if (!checks.ok && applied.length > 1) {
    // Pass 2: one at a time, keeping each change that leaves the checks green.
    solo = true;
    reset(mainBefore);
    const keep = [];
    // Every change gets another try, not only those that applied: one that collided
    // with a change now bounced may apply cleanly without it.
    for (const c of fetched.filter((x) => !results.get(x.id)?.empty)) {
      const r = applyChange(c, cfg);
      if (!r.ok) { results.set(c.id, r); continue; }
      const ch = runChecks();
      say('solo_checks', { id: c.id, ...ch });
      if (ch.ok) { keep.push(c); results.set(c.id, { ...r, checks: ch }); }
      else { results.set(c.id, { ...r, ok: false, bounced: true, checks: ch, why: 'checks failed' }); git(['reset', '-q', '--hard', r.before]); }
    }
    applied = keep;
    checks = { ok: true, ms: 0, failures: [], solo: true };
  } else if (!checks.ok) {
    for (const c of applied) results.set(c.id, { ...results.get(c.id), ok: false, bounced: true, checks, why: 'checks failed' });
    applied = [];
    reset(mainBefore);
  }

  // Records as git notes, then one push.
  const landed = applied.map((c) => results.get(c.id));
  for (const r of landed) {
    const c = job.changes.find((x) => x.id === r.id);
    r.diff = diffOf(r.before, r.commit);
    const note = { change: r.id, title: c.title, intent: (c.intent || '').slice(0, 2000), agent: c.agent, fork: c.fork, base: c.base, agentCommit: c.commit,
      how: r.how, handled: r.handled, review: c.review || null, checks: { ok: true }, landedBy: 'qodebase merge queue', at: new Date().toISOString() };
    git(['notes', '--ref=qodebase', 'add', '-f', '-F', '-', r.commit], { input: JSON.stringify(note, null, 2) + '\n' });
  }
  let mainAfter = mainBefore, pushed = false, stale = false, notesPushed = false, pushErr = '';
  if (landed.length) {
    const tip = git(['rev-parse', 'HEAD']).out;
    // Plain push (not force): if main moved meanwhile, it is refused and the train runs again.
    const p = git(['push', '-q', job.mainRemote, `${tip}:refs/heads/${branch}`], { tok: job.mainToken, ok: true });
    if (p.code === 0) { pushed = true; mainAfter = tip; }
    else { pushErr = p.err.slice(0, 400); stale = /rejected|non-fast-forward|fetch first|stale/i.test(p.err); }
    if (pushed) notesPushed = git(['push', '-q', '-f', job.mainRemote, 'refs/notes/qodebase:refs/notes/qodebase'], { tok: job.mainToken, ok: true }).code === 0;
  }
  const out = {
    ok: true, branch, mainBefore, mainAfter, pushed, stale, pushErr, notesPushed, solo, checks, ms: Date.now() - t0,
    changes: job.changes.map((c) => {
      const r = results.get(c.id) || { id: c.id, ok: false, why: 'not applied' };
      const landedOk = r.ok && pushed;
      return { id: c.id, landed: landedOk, how: landedOk ? r.how : null, commit: landedOk ? r.commit : null, agentCommit: c.commit, files: r.files || [], conflicts: r.conflicts || [],
        unhandled: r.unhandled || [], handled: r.handled || [], bounced: !!r.bounced, checks: r.checks || null, why: r.why || (r.ok && !pushed ? (stale ? 'main moved: retry' : 'push failed') : ''), diff: landedOk ? r.diff : null };
    }),
  };
  console.log('QB_RESULT ' + JSON.stringify(out));
}

main().catch((e) => { say('error', { err: String(e?.stack || e) }); console.log('QB_RESULT ' + JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 600), ms: Date.now() - t0 })); });
