#!/usr/bin/env node
// Talk eval: real sentences against real page snapshots (scripts/talk-fixtures/),
// decided by the real model through the qodebase-talk AI Gateway, scored
// against what should happen. Run from the forq root:
//   node --experimental-strip-types scripts/talk-eval.mjs [--only <substr>] [--model clef]
// Needs ~/.config/forq-cf/api-token (Workers AI on the forq account).
// One JSONL line per case to ~/.local/share/forq/talk-eval.jsonl.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildQuestions, candidateProjects, currentSlug, resolve, stateText } from '../src/talkdecide.ts';

const ACC = '887d7234a6b8d65ad355a4f6684cab67';
const TOKEN = fs.readFileSync(path.join(os.homedir(), '.config/forq-cf/api-token'), 'utf8').trim();
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const model = args.includes('--model') ? `@cf/cloudflare/${args[args.indexOf('--model') + 1]}` : '@cf/cloudflare/clef-flash';
const FX = path.join(path.dirname(new URL(import.meta.url).pathname), 'talk-fixtures');
const screen = (f) => JSON.parse(fs.readFileSync(path.join(FX, f + '.json'), 'utf8'));
const allProjects = JSON.parse(fs.readFileSync(path.join(FX, 'projects.json'), 'utf8'))
  .map((p, i) => ({ ...p, id: `p${i + 1}`, mine: p.owner === 'eyal' }));

// [page fixture, sentence, expectation]. Expectation: mode (act|ask|both|none,
// a list = any of them) and, for actions, op + where it lands (href substring)
// or which element (label substring).
const CASES = [
  // Navigation by menu words.
  ['home', 'show me my projects', { mode: 'act', op: 'go', href: '/mine' }],
  ['home', 'go to explore', { mode: 'act', op: 'go', href: '/explore' }],
  ['home', 'open my inbox', { mode: 'act', op: 'go', href: '/inbox' }],
  ['home', 'take me to settings', { mode: 'act', op: 'go', href: '/settings' }],
  ['home', 'I want to import something from GitHub', { mode: 'act', op: 'go', href: '/import' }],
  ['home', 'how do I use this from the terminal', { mode: ['ask', 'both', 'act'], op: ['go', 'none'], href: '/cli' }],
  ['home', 'install an AI assistant in my Cloudflare', { mode: 'act', op: 'go', href: '/personal-agents' }],
  ['home', 'can I run my own copy of qodebase?', { mode: ['ask', 'both'] }],
  ['p_forq_calculator', 'go home', { mode: 'act', op: 'go', href: '/' }],
  ['p_forq_calculator', 'go back', { mode: 'act', op: 'back' }],
  // Projects by name or by what they are.
  ['home', 'open the timer app', { mode: 'act', op: 'go', href: '/p/forq/timer' }],
  ['home', 'open my calculator', { mode: 'act', op: 'go', href: '/p/eyal/calculator' }],
  ['home', 'play 2048', { mode: 'act', op: 'go', href: '2048/app' }],
  ['home', 'show me the code of the to-do app', { mode: 'act', op: 'go', href: 'todo/code' }],
  ['explore', 'find the tetris game', { mode: 'act', op: 'go', href: 'javascript-tetris' }],
  ['mine', 'open my pomodoro thing', { mode: 'act', op: 'go', href: 'pomodoro-streak' }],
  ['home', 'could you bring up that tip splitting thing I made', { mode: 'act', op: 'go', href: '/p/eyal/tipsplit' }],
  // On a project page.
  ['p_forq_calculator', 'try the app', { mode: 'act', op: 'go', href: '/p/forq/calculator/app' }],
  ['p_forq_calculator', 'show me its history', { mode: 'act', op: 'go', href: '/p/forq/calculator/history' }],
  ['p_forq_calculator', 'open my copy', { mode: 'act', op: 'go', href: '/p/eyal/calculator' }],
  ['p_forq_calculator', 'what does this project do?', { mode: ['ask', 'both'] }],
  ['p_forq_calculator', 'read me the license', { mode: ['act', 'both'], op: 'go', href: 'LICENSE' }],
  // Search and typing.
  ['p_forq_calculator_code', 'search the code for divide', { mode: 'act', op: 'type', text: 'divide' }],
  ['home', 'build a habit tracker with streaks', { mode: 'act', op: 'type', text: 'habit tracker' }],
  ['home', 'I want to make a recipe app', { mode: ['act', 'ask'], op: ['type', 'none'], text: 'recipe app' }],
  // Buttons and scrolling.
  ['home', 'open the menu', { mode: 'act', op: 'press', label: 'Menu' }],
  ['personal-agents', 'scroll down to Hermes', { mode: 'act', op: 'scroll', label: 'Hermes' }],
  ['personal-agents', 'go to the top', { mode: 'act', op: 'scroll' }],
  // Questions, both, chatter.
  ['personal-agents', 'which of these works on the free plan?', { mode: ['ask', 'both'] }],
  ['personal-agents', 'what is the difference between T3 Code and Mobile Agent', { mode: ['ask', 'both'] }],
  ['p_forq_calculator', 'open the app and tell me how it works', { mode: 'both' }],
  ['home', 'explain this page', { mode: ['ask', 'both', 'act'], op: ['explain', 'none'] }],
  ['home', 'thanks', { mode: ['none', 'ask'] }],
  ['home', 'um so I was', { mode: ['none'] }],
  // Risky: must be flagged.
  ['mine', 'delete the particles project', { mode: ['act', 'both', 'ask'], risky: true }],
  ['home', 'sign me out', { mode: 'act', risky: true }],
];

const asList = (x) => (x == null ? null : Array.isArray(x) ? x : [x]);

async function run(page, utterance) {
  const s = screen(page);
  s.me = 'eyal';
  const projects = candidateProjects(utterance, allProjects, 24, currentSlug(s.path));
  const { questions, cands } = buildQuestions(utterance, s, projects);
  const state = stateText(utterance, s, projects);
  const t0 = Date.now();
  const r = await fetch(`https://gateway.ai.cloudflare.com/v1/${ACC}/qodebase-talk/workers-ai/${model}`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: model.split('/').pop(), state, questions }),
  });
  const ms = Date.now() - t0;
  const body = await r.json().catch(() => ({}));
  const res = body.result || body;
  if (!res.answers) return { error: JSON.stringify(body).slice(0, 300), ms };
  return { cmd: resolve(res.answers, cands, s, projects, utterance), ms, usage: res.usage, nq: Object.keys(questions).length, np: projects.length };
}

function judge(cmd, want) {
  const bad = [];
  if (want.mode && !asList(want.mode).includes(cmd.mode)) bad.push(`mode ${cmd.mode}`);
  if (want.op && (cmd.mode === 'act' || cmd.mode === 'both') && !asList(want.op).includes(cmd.op)) bad.push(`op ${cmd.op}${cmd.why ? ' (' + cmd.why + ')' : ''}`);
  if (want.href && cmd.op === 'go' && !(want.href === '/' ? cmd.href === '/' : (cmd.href || '').includes(want.href))) bad.push(`href ${cmd.href}`);
  if (want.label && !(cmd.label || '').includes(want.label)) bad.push(`label ${cmd.label}`);
  if (want.text && !(cmd.text || '').toLowerCase().includes(want.text)) bad.push(`text ${cmd.text}`);
  if (want.risky && !((cmd.risky ?? 0) >= 0.5)) bad.push(`risky ${cmd.risky}`);
  return bad;
}

const logFile = path.join(os.homedir(), '.local/share/forq/talk-eval.jsonl');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
let pass = 0, n = 0;
const times = [];
for (const [page, utterance, want] of CASES) {
  if (only && !utterance.includes(only) && !page.includes(only)) continue;
  n++;
  const out = await run(page, utterance);
  times.push(out.ms);
  const bad = out.error ? [`error ${out.error}`] : judge(out.cmd, want);
  if (!bad.length) pass++;
  const c = out.cmd || {};
  console.log(`${bad.length ? '✗' : '✓'} ${String(out.ms).padStart(5)}ms [${page}] "${utterance}" → ${c.mode}(${c.modeP?.toFixed?.(2)}) ${c.op} ${c.href || c.label || c.text || c.section || ''}${c.risky != null ? ' risky=' + c.risky.toFixed(2) : ''}${bad.length ? '   ✗ ' + bad.join('; ') : ''}`);
  fs.appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), event: 'talk_eval', model, page, utterance, want, cmd: out.cmd, ms: out.ms, usage: out.usage, nq: out.nq, np: out.np, error: out.error, pass: !bad.length, bad }) + '\n');
}
times.sort((a, b) => a - b);
console.log(`\n${pass}/${n} pass · ${model} · median ${times[Math.floor(times.length / 2)]} ms · p90 ${times[Math.floor(times.length * 0.9)]} ms`);
