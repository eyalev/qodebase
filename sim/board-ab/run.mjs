// E4 (docs/board/PLAN.md): N real Haiku 5.5 agents pick their own tasks from one backlog and push
// to one shared bare repo, with or without the agent board. One `claude -p` per task pick (fresh
// context each time), looping until the agent says the backlog is done or the wall cap.
//   node sim/board-ab/run.mjs --cond A|B|C [--agents 5] [--minutes 25] [--rep 1]
// Writes runs under ~/.local/share/qb9-board-ab/<run-id>/ (clones, calls.jsonl, result.json)
// and one line per run to sim/board-ab/runs.jsonl. Hidden tests: lab-hidden/board-ab (private).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const COND = opt('cond', 'A'), N = +opt('agents', 5), MINUTES = +opt('minutes', 25), REP = +opt('rep', 1);
const MODEL = 'claude-haiku-5-5';
const BOARD = path.resolve(HERE, '../../board/board.mjs');
const HOOK = path.resolve(HERE, '../../board/hooks/board-hook.mjs');
const HIDDEN = path.join(os.homedir(), '<lab-hidden dir>/board-ab/tasks.test.mjs');
const ROOT = path.join(os.homedir(), '.local/share/qb9-board-ab');
const RUN_ID = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}-${COND}-r${REP}`;
const DIR = path.join(ROOT, RUN_ID);
// Haiku 5.5 $/1M (docs/lab prices, checked 2026-10-08). Calls are on the subscription; this is the API equivalent.
const PRICE = { in: 0.10, out: 0.50, cacheR: 0.01, cacheW: 0.125 };

const sh = (cmd, a, cwd, env) => execFileSync(cmd, a, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 1 << 26 }).trim();
const log = (f, o) => fs.appendFileSync(path.join(DIR, f), JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');

// ---- guard: the weekly meter (all LLM runs stop at 77%) ----
function meter() { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude/data/latest.json'), 'utf8')).weekly_all_pct; } catch { return null; } }
const STOP_AT = 77;

// ---- setup: one starter commit (fixed author/date), a bare origin, N clones ----
function setup() {
  fs.mkdirSync(DIR, { recursive: true });
  const seed = path.join(DIR, 'seed');
  fs.cpSync(path.join(HERE, 'starter'), seed, { recursive: true });
  const fixed = { GIT_AUTHOR_NAME: 'board-ab', GIT_AUTHOR_EMAIL: 'lab@qodebase.app', GIT_COMMITTER_NAME: 'board-ab', GIT_COMMITTER_EMAIL: 'lab@qodebase.app', GIT_AUTHOR_DATE: '2026-10-10T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-10T00:00:00Z' };
  sh('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], seed); sh('git', ['add', '-A'], seed); sh('git', ['commit', '-qm', 'textkit starter (board-ab v1)'], seed, fixed);
  const starterSha = sh('git', ['rev-parse', 'HEAD'], seed);
  sh('git', ['clone', '-q', '--bare', seed, path.join(DIR, 'origin.git')], DIR);
  for (let k = 1; k <= N; k++) {
    const c = path.join(DIR, `agent${k}`);
    sh('git', ['clone', '-q', path.join(DIR, 'origin.git'), c], DIR);
    sh('git', ['config', 'user.name', `agent${k}`], c); sh('git', ['config', 'user.email', `agent${k}@board-ab.local`], c);
    sh('git', ['config', 'pull.rebase', 'true'], c);
  }
  if (COND === 'B' || COND === 'C') fs.writeFileSync(path.join(DIR, 'board-settings.json'), JSON.stringify({ hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node ${HOOK}` }] }],
    PreToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: `node ${HOOK}` }] }],
    PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node ${HOOK}` }] }],
    Stop: [{ hooks: [{ type: 'command', command: `node ${HOOK}` }] }],
  } }, null, 1));
  return starterSha;
}

// ---- the task prompt (versioned) ----
const PROMPT_VERSION = 'board-ab-v1';
function prompt(k) {
  // A = no board; B = hooks only (automatic posts: file names, commits); C = hooks + one instruction
  // to state the picked task (manager, 2026-10-10: with claude -p the hook's 'started' text is this
  // harness prompt, not the task, so B shares only files).
  const board = COND === 'C' ? `\nThere is a shared board where agents say what they are working on. Before choosing a task, run \`node ${BOARD} who\`. After choosing a task, run \`node ${BOARD} post started --intent "<task id + title>" --files <comma-separated files you expect to touch>\`.\n` : '';
  return `You are agent ${k} of ${N}, working at the same time as the others on this repository (textkit). Each agent works in its own clone and pushes to the same origin; you cannot talk to them.${board}
1. Run \`git pull --rebase\` first.
2. Read BACKLOG.md and the code on main. Pick ONE task that you believe nobody has done yet.
3. Implement it as the backlog says (code, re-export, a test, a CHANGELOG line) and run \`npm test\` until it is green.
4. Commit with a message that starts with the task id, e.g. \`T5: add countWords\`, then \`git push\`. If the push is rejected, run \`git pull --rebase\`, fix any conflict, run \`npm test\` again and push again.
5. End with ONLY one JSON line: {"task": "T5", "status": "pushed" | "skipped" | "failed", "note": "<short>"}.
If you believe every task in the backlog is already done on main, change nothing and reply {"task": null, "status": "all-done"}.`;
}

function callAgent(k, iter) {
  return new Promise((resolve) => {
    const cwd = path.join(DIR, `agent${k}`);
    const a = ['-p', '--model', MODEL, '--output-format', 'json', '--max-turns', '40', '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash(git:*)', 'Bash(npm test)', 'Bash(npm test:*)', 'Bash(npm run test:*)', 'Bash(node:*)', 'Bash(ls:*)', 'Bash(cat:*)',
      '--setting-sources', '', '--strict-mcp-config'];
    if (COND === 'B' || COND === 'C') a.push('--settings', path.join(DIR, 'board-settings.json'));
    const env = { ...process.env, CLAUDE_NO_HOOKS: '1' };
    if (COND === 'B' || COND === 'C') Object.assign(env, { BOARD_AGENT: `agent${k}`, BOARD_FILE: path.join(DIR, 'board.jsonl'), BOARD_STATE_DIR: path.join(DIR, 'board-state', `agent${k}`) });
    const t0 = Date.now();
    const p = spawn('claude', a, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => p.kill('SIGTERM'), 12 * 60e3); // this child only, by its handle
    p.on('close', (code) => {
      clearTimeout(timer);
      let j = null; try { j = JSON.parse(out); } catch {}
      const u = j?.usage || {};
      const usd = ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out + (u.cache_read_input_tokens || 0) * PRICE.cacheR + (u.cache_creation_input_tokens || 0) * PRICE.cacheW) / 1e6;
      let ans = null; try { ans = JSON.parse((j?.result || '').match(/\{[^{}]*"status"[^{}]*\}/g)?.at(-1)); } catch {}
      const row = { agent: k, iter, ms: Date.now() - t0, code, task: ans?.task ?? null, status: ans?.status ?? (j ? 'unparsed' : 'no-output'), note: ans?.note?.slice(0, 200), turns: j?.num_turns ?? null,
        tokens: { in: u.input_tokens ?? null, out: u.output_tokens ?? null, cacheR: u.cache_read_input_tokens ?? null, cacheW: u.cache_creation_input_tokens ?? null }, usd_api_equiv: +usd.toFixed(5),
        denials: j?.permission_denials?.length ?? null, error: j ? (j.is_error ? String(j.result).slice(0, 200) : undefined) : (err || 'no output').slice(0, 300) };
      log('calls.jsonl', row);
      console.error(`[agent${k}#${iter}] ${row.task ?? '-'} ${row.status} ${Math.round(row.ms / 1000)}s $${row.usd_api_equiv}`);
      resolve(row);
    });
    p.stdin.end(prompt(k));
  });
}

async function agentLoop(k, deadline) {
  let iter = 0, idle = 0;
  while (Date.now() < deadline) {
    const m = meter(); if (m != null && m >= STOP_AT) { log('events.jsonl', { event: 'meter-stop', agent: k, meter: m }); break; }
    const r = await callAgent(k, ++iter);
    if (r.status === 'all-done') break;
    if (r.status !== 'pushed') { if (++idle >= 3) break; } else idle = 0;
  }
}

// ---- scoring (no model): hidden tests, red main, duplicates, rebases ----
function score(starterSha) { return scoreIn(DIR, N, starterSha); }
const DUP_PAIRS = [['T1', 'slugify', 'T9', 'toSlug'], ['T3', 'titleCase', 'T11', 'capitalizeWords'], ['T5', 'countWords', 'T13', 'wordCount'], ['T6', 'truncate', 'T14', 'shorten']];
function scoreIn(DIRX, NX, starterSha) { const DIR = DIRX, N = NX;
  const fin = path.join(DIR, 'final');
  sh('git', ['clone', '-q', path.join(DIR, 'origin.git'), fin], DIR);
  // Hidden tests, one per task.
  let hidden = {};
  try { execFileSync('node', ['--test', '--test-reporter=tap', HIDDEN], { cwd: DIR, env: { ...process.env, REPO: fin }, encoding: 'utf8' }); } catch (e) { hidden.__out = e.stdout; }
  const tap = hidden.__out ?? execFileSync('node', ['--test', '--test-reporter=tap', HIDDEN], { cwd: DIR, env: { ...process.env, REPO: fin }, encoding: 'utf8' });
  hidden = {}; for (const m of tap.matchAll(/^(not ok|ok) \d+ - (T\d+)/gm)) hidden[m[2]] = m[1] === 'ok';
  // Every commit on main: who, which task, and does `npm test` pass there (red main).
  const commits = sh('git', ['log', '--first-parent', '--reverse', '--format=%H\t%an\t%ct\t%s', `${starterSha}..HEAD`], fin).split('\n').filter(Boolean).map((l) => { const [sha, author, ct, subj] = l.split('\t'); return { sha, author, ct: +ct, subj, tasks: [...new Set(subj.match(/T\d+/g) || [])] }; });
  let red = 0;
  for (const c of commits) { sh('git', ['checkout', '-q', c.sha], fin); try { execFileSync('npm', ['test'], { cwd: fin, stdio: 'ignore', timeout: 120000 }); c.green = true; } catch { c.green = false; red++; } }
  sh('git', ['checkout', '-q', 'main'], fin);
  // Same task id landed by more than one agent = duplicated work.
  const byTask = {}; for (const c of commits) for (const t of c.tasks) (byTask[t] ||= new Set()).add(c.author);
  const sameTaskTwice = Object.entries(byTask).filter(([, s]) => s.size > 1).map(([t, s]) => ({ task: t, agents: [...s] }));
  // Duplicate pairs (same intent, different names) implemented twice: the second name is its own
  // implementation, not an alias of the first.
  const src = fs.readdirSync(path.join(fin, 'src')).map((f) => fs.readFileSync(path.join(fin, 'src', f), 'utf8')).join('\n');
  const own = (name, other) => { const m = src.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`)) || src.match(new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*\\(([^)]*)\\)\\s*=>([\\s\\S]*?);\\n`)); return !!m && !new RegExp(`\\b${other}\\s*\\(`).test(m[0]); };
  const dupPairs = DUP_PAIRS.map(([ta, a, tb, b]) => ({ pair: `${ta}/${tb}`, [a]: hidden[ta] ?? false, [b]: hidden[tb] ?? false, both_separate: own(a, b) && own(b, a), alias: (hidden[ta] && hidden[tb]) && !(own(a, b) && own(b, a)) }));
  // Git friction per agent, from each clone's reflog (newest first). A plain `git pull --rebase` with
  // nothing local is not friction; these are: a conflict resolved (rebase (continue)), a rebase given
  // up (abort), a hard reset to origin/main (local work dropped or redone), and a pull --rebase started
  // right after a local commit (the push was rejected and the agent caught up).
  const friction = {};
  for (let k = 1; k <= N; k++) {
    const rl = sh('git', ['reflog', '--format=%gs'], path.join(DIR, `agent${k}`)).split('\n');
    let afterCommit = 0; for (let i = 0; i < rl.length - 1; i++) if (/^pull --rebase \(start\)/.test(rl[i]) && /^(commit|rebase \(continue\))/.test(rl[i + 1])) afterCommit++;
    friction[`agent${k}`] = { conflicts: rl.filter((l) => /^rebase \(continue\)/.test(l)).length, aborts: rl.filter((l) => /^rebase \(abort\)/.test(l)).length,
      resets_to_origin: rl.filter((l) => /^reset: moving to origin\/main/.test(l)).length, rejected_push_recoveries: afterCommit };
  }
  const fsum = (k) => Object.values(friction).reduce((a, f) => a + f[k], 0);
  const intents = [['T1', 'T9'], ['T2'], ['T3', 'T11'], ['T4'], ['T5', 'T13'], ['T6', 'T14'], ['T7'], ['T8'], ['T10'], ['T12'], ['T15'], ['T16']];
  return { hidden_pass: Object.values(hidden).filter(Boolean).length, hidden_total: 16, intents_covered: intents.filter((g) => g.some((t) => hidden[t])).length, intents_total: 12, hidden,
    commits: commits.length, red_commits: red, final_green: commits.length ? commits.at(-1).green : true, same_task_twice: sameTaskTwice, dup_pairs: dupPairs,
    dup_pairs_both_separate: dupPairs.filter((d) => d.both_separate).length, friction, conflicts: fsum('conflicts'), rebase_aborts: fsum('aborts'), resets_to_origin: fsum('resets_to_origin'), rejected_push_recoveries: fsum('rejected_push_recoveries'),
    commits_by_agent: commits.reduce((m, c) => ((m[c.author] = (m[c.author] || 0) + 1), m), {}) };
}

// ---- rescore an existing run (no model): node run.mjs --rescore <run dir> ----
if (opt('rescore', null)) {
  const RD = opt('rescore'); const prev = JSON.parse(fs.readFileSync(path.join(RD, 'result.json'), 'utf8'));
  fs.rmSync(path.join(RD, 'final'), { recursive: true, force: true });
  const starter = JSON.parse(fs.readFileSync(path.join(RD, 'events.jsonl'), 'utf8').split('\n')[0]).starter;
  globalThis.__DIR = RD;
  const calls = fs.readFileSync(path.join(RD, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const { rebases, rebases_total, ...keep } = prev;
  const next = { ...keep, skipped: calls.filter((c) => c.status === 'skipped').length, failed: calls.filter((c) => c.status === 'failed').length, ...scoreIn(RD, prev.agents, starter), rescored: new Date().toISOString() };
  fs.writeFileSync(path.join(RD, 'result.json'), JSON.stringify(next, null, 1));
  const lines = fs.readFileSync(path.join(HERE, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => (r.run === next.run ? next : r));
  fs.writeFileSync(path.join(HERE, 'runs.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify({ run: next.run, hidden: next.hidden_pass, red: next.red_commits, conflicts: next.conflicts, aborts: next.rebase_aborts, resets: next.resets_to_origin, rejected: next.rejected_push_recoveries, skipped: next.skipped, dup_pairs_both: next.dup_pairs_both_separate, same_task_twice: next.same_task_twice.length }));
  process.exit(0);
}

// ---- main ----
const m0 = meter();
if (m0 != null && m0 >= STOP_AT) { console.error(`weekly meter ${m0}% >= ${STOP_AT}%: not starting`); process.exit(3); }
const starterSha = setup();
const t0 = Date.now(); const deadline = t0 + MINUTES * 60e3;
log('events.jsonl', { event: 'start', cond: COND, agents: N, minutes: MINUTES, rep: REP, meter: m0, prompt_version: PROMPT_VERSION, starter: starterSha });
console.error(`[run] ${RUN_ID} cond ${COND}, ${N} agents, ${MINUTES} min, meter ${m0}%`);
await Promise.all(Array.from({ length: N }, (_, i) => agentLoop(i + 1, deadline)));
const wallS = Math.round((Date.now() - t0) / 1000);
const calls = fs.readFileSync(path.join(DIR, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sum = (f) => calls.reduce((a, c) => a + (f(c) || 0), 0);
const result = { run: RUN_ID, cond: COND, agents: N, rep: REP, minutes_cap: MINUTES, wall_s: wallS, prompt_version: PROMPT_VERSION, model: MODEL, meter_start: m0, meter_end: meter(),
  calls: calls.length, pushed: calls.filter((c) => c.status === 'pushed').length, skipped: calls.filter((c) => c.status === 'skipped').length, failed: calls.filter((c) => c.status === 'failed').length, all_done_calls: calls.filter((c) => c.status === 'all-done').length,
  tokens: { in: sum((c) => c.tokens.in), out: sum((c) => c.tokens.out), cacheR: sum((c) => c.tokens.cacheR), cacheW: sum((c) => c.tokens.cacheW) },
  usd_api_equiv: +sum((c) => c.usd_api_equiv).toFixed(4), usd_note: 'subscription; API-equivalent at Haiku 5.5 rates',
  board_events: fs.existsSync(path.join(DIR, 'board.jsonl')) ? fs.readFileSync(path.join(DIR, 'board.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0,
  ...score(starterSha) };
fs.writeFileSync(path.join(DIR, 'result.json'), JSON.stringify(result, null, 1));
fs.appendFileSync(path.join(HERE, 'runs.jsonl'), JSON.stringify(result) + '\n');
console.log(JSON.stringify({ run: result.run, cond: COND, wall_s: wallS, hidden: `${result.hidden_pass}/16`, intents: `${result.intents_covered}/12`, red: result.red_commits, same_task_twice: result.same_task_twice.length, dup_pairs_both: result.dup_pairs_both_separate, conflicts: result.conflicts, aborts: result.rebase_aborts, resets: result.resets_to_origin, rejected: result.rejected_push_recoveries, skipped: result.skipped, calls: result.calls, usd: result.usd_api_equiv }));
