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

// Direct replays (2026-10-13): this file also runs as the replay helper (one Messages API call through forq's AI
// Gateway instead of a claude -p agent loop), so the box needs no second file. See replayHelper().
if (process.env.QB_REPLAY_HELPER) { await replayHelper(); process.exit(0); }
const job = JSON.parse(process.env.JOB || readFileSync(process.argv[2] || '/dev/stdin', 'utf8'));
const DIR = job.dir;
const t0 = Date.now();
// Timeline (T1): every phase of the job as [name, start ms, end ms, change id?], reported with the result.
const PH = [];
const phase = (name, s, id) => { PH.push(id ? [name, s, Date.now(), id] : [name, s, Date.now()]); };
const say = (event, data = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), module: 'mergejob', event, ...data }));
// Artifacts tokens are `art_v2_…?expires=…`: git auth is Basic with the part before `?`.
const auth = (tok) => (tok ? ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x:${tok.split('?')[0]}`).toString('base64')}`] : []);
const ID = ['-c', 'user.name=qodebase lander', '-c', 'user.email=lander@qodebase.app', '-c', 'commit.gpgsign=false'];

function git(args, { tok, input, ok = false, cwd = DIR } = {}) {
  const r = spawnSync('git', [...ID, ...auth(tok), ...args], { cwd, input, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0 && !ok) throw new Error(`git ${args[0]} failed (${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 600)}`);
  return { code: r.status, out: (r.stdout || '').trimEnd(), err: (r.stderr || '').trimEnd() };
}
// The same, without blocking: for fetching many forks at once (each git takes its own ref).
function gitAsync(args, tok) {
  return new Promise((resolve) => {
    const s = Date.now();
    const p = spawn('git', [...ID, ...auth(tok), ...args], { cwd: DIR });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trimEnd(), err: err.trimEnd(), ms: Date.now() - s }));
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
function applyChange(c, cfg, { defer = false } = {}) {
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
      const h = job.handlers === false ? null : handlerFor(p, cfg);
      if (!h) { unhandled.push(p); continue; }
      if (h[0] === 'lockfile') { lock = true; handled.push({ path: p, handler: 'lockfile' }); continue; }
      const merged = h[1](show(`:1:${p}`), show(`:2:${p}`) ?? '', show(`:3:${p}`) ?? '');
      if (merged == null) { unhandled.push(p); continue; }
      writeFileSync(join(DIR, p), merged);
      git(['add', p]);
      handled.push({ path: p, handler: h[0] });
    }
    if (unhandled.length) {
      git(['reset', '-q', '--hard', before]);
      // X4: in pass 1 the model replays are set aside and run side by side after the text merges (replayDeferred).
      if (job.llm && defer) return { id: c.id, ok: false, deferred: true, base, files, conflicts, handled, unhandled };
      // Tier 2: a model redoes the change's intent on today's code (per-project flag).
      if (job.llm) {
        const rp = replay(c, base, before, conflicts, unhandled);
        if (rp.ok) return { id: c.id, ok: true, how: 'replayed-llm', files, conflicts, handled, commit: rp.commit, before, llm: rp.llm, reviewedDiff: diffOf(base, c.commit) };
        return { id: c.id, ok: false, files, conflicts, unhandled, llm: rp.llm, why: `conflict in ${unhandled.join(', ')}; model replay failed: ${rp.why}` };
      }
      return { id: c.id, ok: false, files, conflicts, unhandled, why: `conflict in ${unhandled.join(', ')}` };
    }
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

// ---- tier 2: model replay -----------------------------------------------------------
// The change could not be merged as text. Give a small model (default Claude Haiku 5.5) the
// change's intent and the diff the agent made on older code, in a checkout of TODAY's main,
// and let it make the same change here. Its edits are committed like any other change and
// still go through the checks. Usage is reported (tokens, cost estimate, prompt size).
// Review 2 #2 (2026-10-13): the model redoes ONLY the files whose text merge conflicted. Every other file of the change is
// applied straight from the reviewed diff first (partialApply). A replay used to redo the whole change from a diff cut at
// 12,000 characters, and one (the flagship's splitter view) landed without a 119-line file the model never saw.
function partialApply(c, base, conflicts, cwd = DIR) {
  const ex = conflicts.map((p) => `:(exclude)${p}`);
  const patch = git(['diff', '--binary', '--full-index', base, c.commit, '--', '.', ...ex], { cwd }).out;
  if (!patch.trim()) return { ok: true, files: [] };
  const pf = `${cwd}.partial.patch`;
  writeFileSync(pf, patch + '\n');
  const r = git(['apply', '--3way', '--index', '--whitespace=nowarn', pf], { cwd, ok: true });
  rmSync(pf, { force: true });
  const files = git(['diff', '--name-only', base, c.commit, '--', '.', ...ex], { cwd }).out.split('\n').filter(Boolean);
  return { ok: r.code === 0, files, err: r.err.slice(0, 300) };
}
function replayPrompt(c, base, conflicts, applied = [], cwd = DIR) {
  // The conflicting files' full reviewed diff: nothing cut (a sanity cap of 400k chars only, said if it ever hits).
  let diff = git(['diff', '-U3', base, c.commit, '--', ...conflicts], { cwd }).out;
  const cut = diff.length > 400_000; if (cut) diff = diff.slice(0, 400_000);
  return [
    'You are the merge queue of a git platform. A reviewed change could not be merged as text because some files changed since the change was written.',
    `Redo the change ONLY in these files, on the code in this directory (the latest version): ${conflicts.join(', ')}. Keep everything that is already in them; add the change's intent on top.`,
    applied.length ? `The rest of the change is already in place (applied as reviewed): ${applied.join(', ')}. Do not touch those files.` : '',
    'Edit files only. Do not run git.',
    '', `Intent: ${c.title}`, (c.intent || '').slice(0, 2000), '',
    `The change to ${conflicts.length === 1 ? 'that file' : 'those files'} as it was written on the older code (unified diff${cut ? ', cut at 400k characters' : ''}):`, '```diff', diff, '```',
  ].filter((l) => l !== '').join('\n');
}
const CLAUDE_ARGS = (prompt) => ['-p', prompt, '--model', job.llm.model, '--output-format', 'json', '--permission-mode', 'acceptEdits',
  '--allowedTools', 'Read,Edit,Write,Glob,Grep', '--max-turns', '12'];
// Only the credential we were given; no auth variable is blanked or removed (Anthropic's 2026-10 rule; the replay
// used to set ANTHROPIC_API_KEY='' when none was given).
// QB_GW_URL + QB_GW_TOKEN: Claude through forq's AI Gateway (Cloudflare unified billing, no plan, no Anthropic key):
// Claude Code needs ANTHROPIC_API_KEY set (the gateway ignores it), the gateway token travels in cf-aig-authorization.
const claudeEnv = () => ({ ...process.env, IS_SANDBOX: '1',
  ...(process.env.QB_GW_URL && process.env.QB_GW_TOKEN
    ? { ANTHROPIC_BASE_URL: process.env.QB_GW_URL, ANTHROPIC_API_KEY: process.env.QB_GW_TOKEN, ANTHROPIC_CUSTOM_HEADERS: `cf-aig-authorization: Bearer ${process.env.QB_GW_TOKEN}` }
    : { ...(process.env.QB_CLAUDE_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.QB_CLAUDE_TOKEN } : {}), ...(process.env.QB_ANTHROPIC_KEY ? { ANTHROPIC_API_KEY: process.env.QB_ANTHROPIC_KEY } : {}) }),
  QB_GW_TOKEN: '', QB_CLAUDE_TOKEN: '', JOB: '' });
// Direct mode: QB_REPLAY_DIRECT + the gateway: the replay is ONE call (the files as they are + the reviewed diff in,
// the whole new files out), ~3-5 s instead of claude -p's ~12 s agent loop (measured, code dial 60). Same coverage rule.
const DIRECT = () => !!(process.env.QB_REPLAY_DIRECT && process.env.QB_GW_URL && process.env.QB_GW_TOKEN);
function replayer(prompt, files) {
  return DIRECT()
    ? { cmd: process.execPath, args: [process.argv[1]], input: JSON.stringify({ prompt, files, model: job.llm.model }), env: { ...process.env, QB_REPLAY_HELPER: '1', JOB: '' } }
    : { cmd: 'claude', args: CLAUDE_ARGS(prompt), input: undefined, env: claudeEnv() };
}
async function replayHelper() {
  const out = (o) => console.log(JSON.stringify(o));
  const inp = JSON.parse(readFileSync(0, 'utf8'));   // fd 0: /dev/stdin fails (ENXIO) when stdin is a spawn pipe
  const cur = inp.files.map((f) => { let s = ''; try { s = readFileSync(f, 'utf8'); } catch {} return `<<<FILE ${f}>>>\n${s}\n<<<END>>>`; }).join('\n\n');
  const user = `${inp.prompt}\n\nThe files as they are now on the latest main:\n\n${cur}\n\nReply with the COMPLETE new content of each of these files and nothing else, each one as:\n<<<FILE path>>>\n(the whole file)\n<<<END>>>`;
  // No x-api-key: the gateway pays Anthropic from forq's unified-billing credits; a placeholder key would be forwarded.
  let r, j = {};
  try {
    r = await fetch(`${process.env.QB_GW_URL}/v1/messages`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'cf-aig-authorization': `Bearer ${process.env.QB_GW_TOKEN}` },
      body: JSON.stringify({ model: inp.model, max_tokens: 16000, temperature: 0, messages: [{ role: 'user', content: user }] }) });
    j = await r.json().catch(() => ({}));
  } catch (e) { out({ is_error: true, result: `fetch: ${String(e?.message || e).slice(0, 200)}` }); process.exit(1); }
  if (!r.ok) { out({ is_error: true, result: `HTTP ${r.status}: ${JSON.stringify(j).slice(0, 240)}` }); process.exit(1); }
  const text = (j.content || []).map((b) => b.text || '').join('');
  let n = 0;
  for (const m of text.matchAll(/<<<FILE (.+?)>>>\n([\s\S]*?)\n?<<<END>>>/g)) {
    if (!inp.files.includes(m[1])) continue;
    writeFileSync(m[1], m[2].endsWith('\n') ? m[2] : m[2] + '\n'); n++;
  }
  out({ usage: j.usage || {}, num_turns: 1, total_cost_usd: null, is_error: n === 0, result: n ? `wrote ${n} file${n === 1 ? '' : 's'}` : `no files in the answer: ${text.slice(0, 160)}` });
  process.exit(n ? 0 : 1);
}
function llmOf(r, t, prompt) {
  let j = {}; try { j = JSON.parse(r.stdout || '{}'); } catch {}
  const u = j.usage || {};
  return { model: job.llm.model, ms: Date.now() - t, turns: j.num_turns ?? null, usd: j.total_cost_usd ?? null,
    in: u.input_tokens ?? null, out: u.output_tokens ?? null, cacheRead: u.cache_read_input_tokens ?? null, cacheWrite: u.cache_creation_input_tokens ?? null,
    // Claude Code writes 1-hour cache (2x input, not 1.25x): the part of cacheWrite that is 1-hour (qb9, 2026-10-10).
    cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? null,
    promptChars: prompt.length, exit: r.status, error: r.status === 0 && !j.is_error ? undefined : String(j.result || r.stderr || r.error || '').slice(0, 300) };
}
const replayMsg = (c, unhandled) => `${c.title || c.id}\n\n${(c.intent || '').slice(0, 4000)}\n\nReplayed by ${job.llm.model} on the latest main (the text merge conflicted in ${unhandled.join(', ')}).\n\nqodebase-change: ${c.id}\n`;
// After a model replay: is every line the reviewed change ADDED still there? (Review 2 #2, 2026-10-13: a replay must never
// quietly drop reviewed work.) Non-trivial added lines only (3+ chars after trim), looked up in the replayed version of the
// same file; a file the replay deleted counts as missing. Lines the reviewed diff REMOVED are not checked: on a stale base
// they are often other agents' work, which a replay rightly keeps.
// Measured on the flagship's and R8b's 35 old replays: good rewrites keep 56-100% of the reviewed lines in the files they
// redo; the one that dropped work kept 23%. So: every file the change ADDED must exist (hard), and the lines of the redone
// (conflicting) files must be at least half there.
const REPLAY_MIN_COVERAGE = 0.5;
function coverage(base, agentCommit, landedCommit, cwd = DIR, only = null) {
  const added = git(['diff', '--name-only', '--diff-filter=A', base, agentCommit], { cwd }).out.split('\n').filter(Boolean);
  const lostFiles = added.filter((f) => git(['cat-file', '-e', `${landedCommit}:${f}`], { cwd, ok: true }).code !== 0);
  const files = git(['diff', '--name-only', '--diff-filter=AM', base, agentCommit], { cwd }).out.split('\n').filter(Boolean).filter((f) => !only || only.includes(f));
  let want = 0, have = 0; const missing = lostFiles.map((f) => `${f}: the whole file is missing`);
  for (const f of files) {
    const added = git(['diff', '-U0', base, agentCommit, '--', f], { cwd }).out.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1).trim()).filter((l) => l.length >= 3);
    if (!added.length) continue;
    const now = git(['show', `${landedCommit}:${f}`], { cwd, ok: true });
    const lines = new Set(now.code === 0 ? now.out.split('\n').map((l) => l.trim()) : []);
    for (const l of added) { want++; if (lines.has(l)) have++; else if (missing.length < 3) missing.push(`${f}: ${l.slice(0, 80)}`); }
  }
  return { want, have, ratio: lostFiles.length ? 0 : want ? have / want : 1, lostFiles, missing };
}

const sameLines = (a, b) => { const lines = (d) => d.split('\n').filter((l) => /^[+-](?![+-])/.test(l)).map((l) => l.trim()).sort().join('\n'); return lines(a) === lines(b); };

function replay(c, base, before, conflicts, unhandled) {
  const t = Date.now();
  const pa = partialApply(c, base, conflicts);
  if (!pa.ok) { git(['reset', '-q', '--hard', before]); git(['clean', '-qfd']); say('partial_apply_failed', { id: c.id, err: pa.err }); }
  const redo = pa.ok ? conflicts : git(['diff', '--name-only', base, c.commit]).out.split('\n').filter(Boolean);
  const prompt = replayPrompt(c, base, redo, pa.ok ? pa.files : []);
  const rp = replayer(prompt, redo);
  const r = spawnSync(rp.cmd, rp.args, { cwd: DIR, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 << 20, env: rp.env, input: rp.input });
  const llm = llmOf(r, t, prompt);
  say('replay', { id: c.id, ...llm });
  if (r.status !== 0 || llm.error) { git(['reset', '-q', '--hard', before]); git(['clean', '-qfd']); return { ok: false, llm, why: llm.error || `exit ${r.status}` }; }
  git(['add', '-A']);
  if (!git(['diff', '--cached', '--name-only']).out.trim()) { git(['reset', '-q', '--hard', before]); return { ok: false, llm, why: 'the model made no change' }; }
  // Diff-of-diffs: did the replay add/remove the same lines the reviewed change did?
  git(['commit', '-q', '-F', '-'], { input: replayMsg(c, unhandled) });
  const commit = git(['rev-parse', 'HEAD']).out;
  llm.sameLines = sameLines(git(['diff', before, commit]).out, git(['diff', base, c.commit]).out);
  const cov = coverage(base, c.commit, commit, DIR, redo);
  llm.coverage = Math.round(cov.ratio * 1000) / 1000; llm.redone = redo; llm.appliedAsReviewed = pa.ok ? pa.files : [];
  if (cov.ratio < REPLAY_MIN_COVERAGE) {
    git(['reset', '-q', '--hard', before]); git(['clean', '-qfd']);
    say('replay_incomplete', { id: c.id, ...cov });
    return { ok: false, llm, why: cov.lostFiles.length ? `the replay lost ${cov.lostFiles.join(', ')}, which the reviewed change added` : `the replay left out ${cov.want - cov.have} of ${cov.want} lines the reviewed change added (${cov.missing.join('; ')})` };
  }
  return { ok: true, commit, llm };
}

// X4 (2026-10-13): the R5 flagship's trains spent most of their time on model replays run one after another. The ones
// pass 1 set aside run side by side, each in its own worktree on the train's text-merged code, and land in train order by
// cherry-pick; one that collides with an earlier replay is replayed again, alone, on the code it now has to fit.
const REPLAY_PAR = Math.max(1, Math.min(6, Number(process.env.QB_REPLAY_PAR) || 4));
function replayAsync(c, base, unhandled, cwd, conflicts = unhandled) {
  return new Promise((resolve) => {
    const t = Date.now();
    const pa = partialApply(c, base, conflicts, cwd);
    if (!pa.ok) { git(['reset', '-q', '--hard', 'HEAD'], { cwd }); git(['clean', '-qfd'], { cwd }); }
    const redo = pa.ok ? conflicts : git(['diff', '--name-only', base, c.commit], { cwd }).out.split('\n').filter(Boolean);
    const prompt = replayPrompt(c, base, redo, pa.ok ? pa.files : [], cwd);
    const rp = replayer(prompt, redo);
    const p = spawn(rp.cmd, rp.args, { cwd, env: rp.env });
    if (rp.input !== undefined) { p.stdin.end(rp.input); } else p.stdin.end();
    let stdout = '', stderr = '';
    const kill = setTimeout(() => p.kill('SIGTERM'), 240_000);
    p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
    const done = (status, error) => {
      clearTimeout(kill);
      const llm = llmOf({ stdout, stderr, status, error }, t, prompt);
      llm.redone = redo; llm.appliedAsReviewed = pa.ok ? pa.files : [];
      say('replay', { id: c.id, parallel: true, ...llm });
      if (status !== 0 || llm.error) return resolve({ ok: false, llm, why: llm.error || `exit ${status}` });
      git(['add', '-A'], { cwd });
      if (!git(['diff', '--cached', '--name-only'], { cwd }).out.trim()) return resolve({ ok: false, llm, why: 'the model made no change' });
      git(['commit', '-q', '-F', '-'], { cwd, input: replayMsg(c, unhandled) });
      resolve({ ok: true, commit: git(['rev-parse', 'HEAD'], { cwd }).out, llm, t });
    };
    p.on('close', (code) => done(code));
    p.on('error', (e) => done(-1, e));
  });
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
/** Pass 1's set-aside changes (in train order) onto HEAD: parallel replays, then cherry-picks in order. */
async function replayDeferred(deferred, results, applied, cfg) {
  if (!deferred.length) return;
  const at = git(['rev-parse', 'HEAD']).out;
  // A change stacked on another set-aside change needs its parent's replay first: it waits for the serial pass. So does one
  // whose files overlap a change already chosen to run side by side: replays of the same shared files collide when they
  // are put together, and the serial redo then costs more than plain serial (real build r8b, 2026-10-13: 2 of 2).
  const par = [], used = new Set();
  for (const d of deferred) {
    if (deferred.some((o) => o.c.id !== d.c.id && o.c.commit === d.r.base)) continue;
    if ((d.r.files || []).some((f) => used.has(f))) continue;
    par.push(d); for (const f of d.r.files || []) used.add(f);
  }
  const tP = Date.now();
  const outs = await pool(par, REPLAY_PAR, async (d) => {
    // Outside .git: Claude Code refuses every write under a .git path ('sensitive file'), so a worktree in .git made each
    // parallel replay fail and run again alone (the proof build's 5 replays all ran twice, 2026-10-13).
    const wt = `${DIR}.wt/${d.c.id.replace(/[^\w.-]/g, '_')}`;
    git(['worktree', 'remove', '--force', wt], { ok: true }); rmSync(wt, { recursive: true, force: true }); git(['worktree', 'prune'], { ok: true });
    mkdirSync(`${DIR}.wt`, { recursive: true });
    git(['worktree', 'add', '-q', '--detach', wt, at]);
    try { return await replayAsync(d.c, d.r.base, d.r.unhandled, wt, d.r.conflicts); }
    finally { git(['worktree', 'remove', '--force', wt], { ok: true }); }
  });
  phase('replay-llm-parallel', tP);
  say('replays_parallel', { n: par.length, ok: outs.filter((o) => o.ok).length, ms: Date.now() - tP, par: REPLAY_PAR });
  const byId = new Map(par.map((d, k) => [d.c.id, outs[k]]));
  for (const d of deferred) {
    const { c, r } = d;
    const o = byId.get(c.id);
    const before = git(['rev-parse', 'HEAD']).out;
    if (o?.ok) {
      const cp = git(['cherry-pick', '--allow-empty', '--keep-redundant-commits', o.commit], { ok: true });
      const covOk = cp.code === 0 && (() => { const cov = coverage(r.base, c.commit, git(['rev-parse', 'HEAD']).out, DIR, r.conflicts); o.llm.coverage = Math.round(cov.ratio * 1000) / 1000; if (cov.ratio < REPLAY_MIN_COVERAGE) { say('replay_incomplete', { id: c.id, parallel: true, ...cov }); return false; } return true; })();
      if (cp.code === 0 && !covOk) { git(['reset', '-q', '--hard', before]); git(['clean', '-qfd']); o.ok = false; o.why = 'the side-by-side replay left out reviewed lines'; }
      else if (cp.code === 0) {
        const commit = git(['rev-parse', 'HEAD']).out;
        o.llm.sameLines = sameLines(git(['diff', before, commit]).out, git(['diff', r.base, c.commit]).out);
        results.set(c.id, { id: c.id, ok: true, how: 'replayed-llm', files: r.files, conflicts: r.conflicts, handled: r.handled, commit, before, llm: { ...o.llm, parallel: true, parallelOutcome: 'landed' }, reviewedDiff: diffOf(r.base, c.commit) });
        say('applied', { id: c.id, ok: true, how: 'replayed-llm', parallel: true });
        applied.push(c); continue;
      }
      if (cp.code !== 0) {
        git(['cherry-pick', '--abort'], { ok: true }); git(['reset', '-q', '--hard', before]); git(['clean', '-qfd']);
        say('replay_collided', { id: c.id, err: (cp.err || cp.out).slice(0, 200) });
      }
    } else if (o) say('replay_parallel_failed', { id: c.id, why: String(o.why || '').slice(0, 300) });
    // Serial: a stacked change, a replay that collided with an earlier one, or one that failed in parallel (one more try).
    const tS = Date.now();
    const s = applyChange(c, cfg);
    if (s.llm) s.llm.parallelOutcome = !o ? 'serial' : o.ok ? 'collided' : `failed: ${String(o.why || '').slice(0, 120)}`;
    phase(s.llm ? 'replay-llm' : 'apply', tS, c.id);
    results.set(c.id, s);
    say('applied', { id: c.id, ok: s.ok, how: s.how, serial: true, why: s.why });
    if (s.ok) applied.push(c);
  }
}

// ---- checks -----------------------------------------------------------------------
let depsKey = '';
function runChecks() {
  if (!job.check || job.noChecks) return { ok: true, ms: 0, failures: [], skipped: true };
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
  const tMain = Date.now();
  const warm = existsSync(join(DIR, '.git'));
  if (!warm) { mkdirSync(DIR, { recursive: true }); git(['init', '-q']); }
  // Warm box (T1 finding, 2026-10-12: fetching main was 4.4 s of each train, three round trips one after another):
  // main's branch is looked up once per box and remembered; main, the notes and (unless the clone is shallow,
  // where parallel fetches fight over .git/shallow) the agents' forks are fetched at the same time.
  const branchFile = join(DIR, '.git', 'qb-branch');
  const known = !job.branch && existsSync(branchFile) ? readFileSync(branchFile, 'utf8').split('\n') : null;
  let sym = '', branch = job.branch || (known && known[0] === job.mainRemote ? known[1] : null);
  if (!branch) {
    const tL = Date.now();
    sym = git(['ls-remote', '--symref', job.mainRemote, 'HEAD'], { tok: job.mainToken }).out;
    branch = (sym.match(/ref: refs\/heads\/(\S+)\s+HEAD/) || [])[1] || 'main';
    phase('ls-remote', tL);
    try { writeFileSync(branchFile, `${job.mainRemote}\n${branch}\n`); } catch {}
  }
  const shallow = warm && git(['rev-parse', '--is-shallow-repository'], { ok: true }).out === 'true';
  // A change whose approved commit is already here (prefetched while it waited in the queue) needs no fetch.
  const have = (c) => warm && c.commit && git(['cat-file', '-e', `${c.commit}^{commit}`], { ok: true }).code === 0;
  const forkFetch = () => Promise.all(job.changes.map((c) => have(c)
    ? (git(['update-ref', `refs/qb/c/${c.id}`, c.commit]), { code: 0, out: '', err: '', ms: 0, prefetched: true })
    : gitAsync(['fetch', '-q', '--update-shallow', '--no-tags', '--no-write-fetch-head', c.remote, `+HEAD:refs/qb/c/${c.id}`], c.token)));
  const tF = Date.now();
  const early = warm && !shallow ? forkFetch() : null;
  // --update-shallow: an imported repo is shallow (depth 1), and without it git refuses the ref ('shallow roots are
  // not allowed to be updated', exit 0, no ref): every train of an imported project bounced (self-host check, 2026-10-12).
  const [f, fn] = await Promise.all([
    gitAsync(['fetch', '--update-shallow', '--no-tags', job.mainRemote, `+refs/heads/${branch}:refs/qb/main`], job.mainToken),
    gitAsync(['fetch', '-q', '--no-tags', job.mainRemote, '+refs/notes/qodebase:refs/notes/qodebase'], job.mainToken),
  ]);
  if (f.code !== 0) throw new Error(`git fetch failed (${f.code}): ${(f.err || f.out).slice(0, 600)}`);
  // A fetch that exited 0 without writing the ref (seen on a self-hosted copy, 2026-10-12): say what the remote
  // advertised and what git printed, instead of failing later on rev-parse with no clue.
  if (git(['rev-parse', '-q', '--verify', 'refs/qb/main'], { ok: true }).code !== 0) {
    const ls = git(['ls-remote', job.mainRemote], { tok: job.mainToken, ok: true });
    const v = git(['--version'], { ok: true }).out;
    say('main_fetch_no_ref', { branch, sym: sym.slice(0, 200), fetchOut: (f.out + '\n' + f.err).slice(0, 600), lsRemote: (ls.out || ls.err).slice(0, 600), git: v });
    throw new Error(`main fetch wrote no ref (branch ${branch}; ${v}); remote refs: ${(ls.out || ls.err).replace(/\s+/g, ' ').slice(0, 300)}; fetch said: ${(f.out + ' ' + f.err).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  let mainBefore = git(['rev-parse', 'refs/qb/main']).out;
  if (!early) phase('fetch-main', tF);
  say('main', { branch, mainBefore });
  const cfg = (() => { try { return JSON.parse(show(`${mainBefore}:.qodebase/landing.json`) || '{}'); } catch { return {}; } })();
  if (!job.check && cfg.check) job.check = cfg.check;

  const fetched = [];
  const results = new Map();
  // Every fork at once: one at a time took ~1 s each, 8.7 s of an 11.7 s train (2026-10-08).
  const tForks = Date.now();
  const fetches = await (early || forkFetch());
  phase(early ? 'fetch-all' : 'fetch-forks', early ? tF : tForks);
  // Each fetch's own time (why a warm fetch still took ~3 s in the box, 2026-10-12).
  const fetchMs = { main: f.ms, notes: fn.ms, forks: fetches.map((x) => x.ms), prefetched: fetches.filter((x) => x.prefetched).length, warm, shallow, parallel: !!early };
  say('fetched', { forks: job.changes.length, ...fetchMs, ms: Date.now() - t0 });
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
  const deferred = [];
  for (const c of fetched) {
    const tA = Date.now();
    const r = applyChange(c, cfg, { defer: true });
    if (r.deferred) { deferred.push({ c, r }); phase('apply', tA, c.id); say('deferred', { id: c.id, unhandled: r.unhandled }); continue; }
    phase(r.llm ? 'replay-llm' : r.how === 'replayed-handler' ? 'replay' : 'apply', tA, c.id);
    results.set(c.id, r);
    say('applied', { id: c.id, ok: r.ok, how: r.how, conflicts: r.conflicts, why: r.why });
    if (r.ok) applied.push(c);
  }
  await replayDeferred(deferred, results, applied, cfg);
  // Train order for what landed (the set-aside ones landed after the text merges; the notes and the result follow it).
  applied = fetched.filter((c) => applied.includes(c));
  const tC = Date.now();
  let checks = applied.length ? runChecks() : { ok: true, ms: 0, failures: [] };
  if (applied.length && !checks.skipped) phase('checks', tC);
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
      const tS = Date.now();
      const r = applyChange(c, cfg);
      phase('apply', tS, c.id);
      if (!r.ok) { results.set(c.id, r); continue; }
      const tSC = Date.now();
      const ch = runChecks();
      phase('checks-solo', tSC, c.id);
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
  const tN = Date.now();
  for (const r of landed) {
    const c = job.changes.find((x) => x.id === r.id);
    r.diff = diffOf(r.before, r.commit);
    const note = { change: r.id, title: c.title, intent: (c.intent || '').slice(0, 2000), agent: c.agent, fork: c.fork, base: c.base, agentCommit: c.commit,
      how: r.how, handled: r.handled, review: c.review || null, ...(r.llm ? { replay: { model: r.llm.model, sameLinesAsReviewed: r.llm.sameLines } } : {}), checks: { ok: true }, landedBy: 'qodebase merge queue', at: new Date().toISOString() };
    git(['notes', '--ref=qodebase', 'add', '-f', '-F', '-', r.commit], { input: JSON.stringify(note, null, 2) + '\n' });
  }
  if (landed.length) phase('notes', tN);
  let mainAfter = mainBefore, pushed = false, stale = false, notesPushed = false, pushErr = '';
  if (landed.length) {
    const tP = Date.now();
    const tip = git(['rev-parse', 'HEAD']).out;
    // Plain push (not force): if main moved meanwhile, it is refused and the train runs again.
    const p = git(['push', '-q', job.mainRemote, `${tip}:refs/heads/${branch}`], { tok: job.mainToken, ok: true });
    if (p.code === 0) { pushed = true; mainAfter = tip; }
    else { pushErr = p.err.slice(0, 400); stale = /rejected|non-fast-forward|fetch first|stale/i.test(p.err); }
    phase('push', tP);
    // Lanes (2026-10-13): another lane moved main while this train ran. Lanes touch different files, so the train's
    // commits are rebased onto the new main, the checks run again, and the push is retried (instead of the whole train,
    // replays included, running again).
    for (let i = 0; !pushed && stale && job.rebaseOnStale && i < 4; i++) {
      const tR = Date.now();
      const f2 = await gitAsync(['fetch', '-q', '--no-tags', job.mainRemote, `+refs/heads/${branch}:refs/qb/main`], job.mainToken);
      if (f2.code !== 0) { pushErr = f2.err.slice(0, 300); break; }
      const newMain = git(['rev-parse', 'refs/qb/main']).out;
      const before = git(['rev-list', '--reverse', `${mainBefore}..HEAD`]).out.split('\n').filter(Boolean);
      const rb = git(['rebase', '-q', '--onto', newMain, mainBefore], { ok: true });
      if (rb.code !== 0) { git(['rebase', '--abort'], { ok: true }); say('lane_rebase_conflict', { err: rb.err.slice(0, 300) }); break; }
      const after = git(['rev-list', '--reverse', `${newMain}..HEAD`]).out.split('\n').filter(Boolean);
      if (after.length === before.length) {
        const map = new Map(before.map((o, k) => [o, after[k]]));
        for (const r of landed) if (map.has(r.commit)) { git(['notes', '--ref=qodebase', 'copy', '-f', r.commit, map.get(r.commit)], { ok: true }); r.commit = map.get(r.commit); }
      }
      const ch = runChecks();
      phase('rebase', tR);
      say('lane_rebased', { attempt: i + 1, newMain, commits: after.length, checks: ch.ok });
      if (!ch.ok) { pushErr = 'checks failed after rebasing onto the new main'; break; }
      mainBefore = newMain;
      const tip2 = git(['rev-parse', 'HEAD']).out;
      const p2 = git(['push', '-q', job.mainRemote, `${tip2}:refs/heads/${branch}`], { tok: job.mainToken, ok: true });
      if (p2.code === 0) { pushed = true; stale = false; mainAfter = tip2; }
      else { pushErr = p2.err.slice(0, 400); stale = /rejected|non-fast-forward|fetch first|stale/i.test(p2.err); }
    }
    if (pushed) { const tNP = Date.now(); notesPushed = git(['push', '-q', '-f', job.mainRemote, 'refs/notes/qodebase:refs/notes/qodebase'], { tok: job.mainToken, ok: true }).code === 0; phase('push-notes', tNP); }
  }
  const out = {
    ok: true, branch, mainBefore, mainAfter, pushed, stale, pushErr, notesPushed, solo, checks, ms: Date.now() - t0, phases: PH, fetchMs,
    changes: job.changes.map((c) => {
      const r = results.get(c.id) || { id: c.id, ok: false, why: 'not applied' };
      const landedOk = r.ok && pushed;
      return { id: c.id, landed: landedOk, how: landedOk ? r.how : null, commit: landedOk ? r.commit : null, agentCommit: c.commit, files: r.files || [], conflicts: r.conflicts || [],
        unhandled: r.unhandled || [], handled: r.handled || [], bounced: !!r.bounced, empty: !!r.empty, llm: r.llm || null, reviewedDiff: landedOk ? r.reviewedDiff || null : null, checks: r.checks || null, why: r.why || (r.ok && !pushed ? (stale ? 'main moved: retry' : 'push failed') : ''), diff: landedOk ? r.diff : null };
    }),
  };
  saveResult(out);
  console.log('QB_RESULT ' + JSON.stringify(out));
}

// ---- one job at a time per clone, and one run per train (2026-10-13) ---------------
// Real build r8b: the same train ran twice at once in the box (the first copy's result never reached Landing, a second
// copy started 3 min later): two jobs in one working tree, the first pushed, the second found main moved, and the retry
// read the already-landed work as 'the model made no change'. Now a job holds a lock on the clone; a second copy of the
// same train waits for the first and prints ITS result; a train that already finished prints the saved result.
const LOCK = `${DIR}.lock`, RES = `${DIR}.res`;
const resFile = () => join(RES, `${String(job.trainId || 'none').replace(/[^\w.-]/g, '_')}.json`);
function saveResult(out) { if (!job.trainId) return; try { mkdirSync(RES, { recursive: true }); writeFileSync(resFile(), JSON.stringify(out)); } catch {} }
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function withLock(run) {
  if (job.trainId && existsSync(resFile())) { say('result_reused', { train: job.trainId }); console.log('QB_RESULT ' + readFileSync(resFile(), 'utf8')); return; }
  const tW = Date.now();
  for (;;) {
    try { mkdirSync(LOCK); writeFileSync(join(LOCK, 'owner'), JSON.stringify({ pid: process.pid, train: job.trainId || null, at: Date.now() })); break; }
    catch {
      let o = {}; try { o = JSON.parse(readFileSync(join(LOCK, 'owner'), 'utf8')); } catch {}
      if (!o.pid || !alive(o.pid)) { say('lock_stale', { owner: o }); rmSync(LOCK, { recursive: true, force: true }); continue; }
      if (job.trainId && o.train === job.trainId) {
        // The same train is already running here: wait for its result and report that one.
        say('duplicate_waits', { train: job.trainId, pid: o.pid });
        while (alive(o.pid) && Date.now() - tW < 20 * 60_000) await sleepMs(2000);
        if (existsSync(resFile())) { console.log('QB_RESULT ' + readFileSync(resFile(), 'utf8')); return; }
        continue;   // it died without a result: take the lock and run
      }
      if (Date.now() - tW > 20 * 60_000) throw new Error(`the clone is locked by train ${o.train} for 20 min`);
      await sleepMs(2000);
    }
  }
  if (Date.now() - tW > 1000) phase('wait-lock', tW);
  try { await run(); } finally { rmSync(LOCK, { recursive: true, force: true }); }
}

withLock(main).catch((e) => { say('error', { err: String(e?.stack || e) }); console.log('QB_RESULT ' + JSON.stringify({ ok: false, error: String(e?.message || e).slice(0, 600), ms: Date.now() - t0, phases: PH })); });
