#!/usr/bin/env node
// Claude Code hook for the agent board (docs/board/PLAN.md). One script for every event:
//   UserPromptSubmit            post started (first 120 chars of the prompt); context = others' now-view (<= 5 lines)
//   PreToolUse Edit|Write|MultiEdit  post editing <file> (once per file per 30 s); context = warning when another
//                               live agent named that file in the last 10 min (once per file per 5 min)
//   PostToolUse Bash            git commit -> post committed <subject>; git push -> post committed (status pushed)
//   Stop                        post done
// Never posts command bodies, tool output or file contents. Does nothing without BOARD_FILE / BOARD_URL.
// It must never get in the agent's way: every failure is swallowed, and it exits 0.
// Settings (settings.json "hooks"): command `node /path/to/board/hooks/board-hook.mjs` on UserPromptSubmit,
// PreToolUse (matcher "Edit|Write|MultiEdit"), PostToolUse (matcher "Bash") and Stop.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { backend, makeEvent, fmtRow, clip, stateDir, readState, writeState } from '../lib.mjs';

const EDIT_DEBOUNCE_MS = 30_000, WARN_EVERY_MS = 5 * 60_000;
const STATE_DIR = stateDir();
const LOG = join(STATE_DIR, 'hook.jsonl');
const log = (event, o = {}) => { try { appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), module: 'board-hook', event, ...o }) + '\n'); } catch {} };

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
const b = backend();
if (!b) process.exit(0);
mkdirSync(STATE_DIR, { recursive: true });

const ev = input.hook_event_name;
const agent = process.env.BOARD_AGENT || (input.session_id ? `cc-${String(input.session_id).slice(0, 8)}` : null);
const cwd = input.cwd || process.cwd();
const git = (...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 2000 }); return r.status === 0 ? r.stdout.trim() : ''; };
const root = git('rev-parse', '--show-toplevel') || cwd;
const rel = (p) => { if (!p) return null; const r = isAbsolute(p) ? relative(root, p) : p; return r.startsWith('..') ? p : r; };

const state = readState(agent);
state.edits ||= {}; state.warned ||= {};
const saveState = () => writeState(agent, state);
// The agent's own `board post started --intent …` wins over the prompt text (qb9, 2026-10-10).
const intentNow = () => state.explicit || state.intent || '';
const out = (hookEventName, additionalContext) => { if (additionalContext) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })); };
const post = async (kind, intent, files, status) => { const t0 = Date.now(); await b.post(makeEvent({ agent, kind, intent, files, status })); log('posted', { agent, kind, ms: Date.now() - t0 }); };

try {
  if (!agent) process.exit(0);
  if (ev === 'UserPromptSubmit') {
    const intent = clip(input.prompt, 120);
    state.intent = intent; delete state.explicit; saveState();   // a new prompt = a new task
    const [, rows] = await Promise.all([post('started', intent, []), b.who({ me: agent })]);
    if (rows.length) out(ev, `Agent board — other agents working now (advisory, not locks):\n${rows.slice(0, 5).map(fmtRow).join('\n')}`);
  } else if (ev === 'PreToolUse' && /^(Edit|Write|MultiEdit)$/.test(input.tool_name || '')) {
    const file = rel(input.tool_input?.file_path);
    if (file) {
      const now = Date.now(), jobs = [];
      if (!(now - (state.edits[file] || 0) < EDIT_DEBOUNCE_MS)) { state.edits[file] = now; jobs.push(post('editing', intentNow(), [file])); }
      const rows = await b.who({ me: agent, files: [file] });
      await Promise.all(jobs);
      if (rows.length && !(now - (state.warned[file] || 0) < WARN_EVERY_MS)) {
        state.warned[file] = now;
        out(ev, `Agent board: ${file} was also touched in the last 10 min by:\n${rows.slice(0, 3).map(fmtRow).join('\n')}\nCoordinate (pull/rebase first, or pick other work) to avoid a conflict.`);
      }
      // keep the state small
      for (const m of [state.edits, state.warned]) for (const [k, t] of Object.entries(m)) if (now - t > 3_600_000) delete m[k];
      saveState();
    }
  } else if (ev === 'PostToolUse' && input.tool_name === 'Bash') {
    const cmd = String(input.tool_input?.command || '');
    // Only the fact and the commit subject; never the command itself.
    if (/\bgit\b[^|;&]*\bcommit\b/.test(cmd)) await post('committed', clip(git('log', '-1', '--format=%s'), 120), git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').filter(Boolean));
    else if (/\bgit\b[^|;&]*\bpush\b/.test(cmd)) await post('committed', clip(git('log', '-1', '--format=%s'), 120), [], 'pushed');
  } else if (ev === 'Stop') {
    await post('done', intentNow(), []);
  }
} catch (e) { log('error', { agent, ev, err: String(e?.message || e) }); }
process.exit(0);
