// The box side of the agent board: `forq hook` (Claude Code hooks), `forq who`, `forq intent`, against a stub API.
//   node --experimental-strip-types --test src/landing/boxhook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORQ_CLI } from '../cli.ts';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];

async function setup(answer) {
  const root = mkdtempSync(join(tmpdir(), 'qbhook-'));
  const run = join(root, 'run'), repo = join(root, 'repo'); mkdirSync(run); mkdirSync(repo);
  const calls = [];
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      const c = { method: req.method, url: req.url, agent: req.headers['x-forq-agent'], body: body ? JSON.parse(body) : null };
      calls.push(c);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(answer(c)));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  writeFileSync(join(run, 'api'), `http://127.0.0.1:${srv.address().port}`);
  writeFileSync(join(run, 'agent-token'), 'eyal.lab--a1.sig');
  const cli = join(root, 'forq'); writeFileSync(cli, FORQ_CLI);
  execFileSync('git', [...ID, 'init', '-q'], { cwd: repo });
  const forq = (args, stdin) => new Promise((res) => {
    const p = spawn('python3', [cli, ...args], { env: { ...process.env, FORQ_RUN: run, FORQ_REPO: repo } });
    let out = '', err = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => res({ code, out, err })); p.stdin.end(stdin ? JSON.stringify(stdin) : '');
  });
  return { root, run, repo, calls, forq, close: () => srv.close() };
}

test('prompt: the board goes into the context; an off board is not asked again for 2 min', async () => {
  let on = true;
  const t = await setup((c) => (c.url.startsWith('/api/agent/who') ? (on ? { on: true, text: 'Working now:\na2 editing 5s ago: cart [cart.js]' } : { on: false }) : {}));
  try {
    const r = await t.forq(['hook'], { hook_event_name: 'UserPromptSubmit', prompt: 'do the thing' });
    assert.equal(r.code, 0);
    const o = JSON.parse(r.out);
    assert.equal(o.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(o.hookSpecificOutput.additionalContext, /a2 editing 5s ago: cart/);
    assert.equal(t.calls[0].url, '/api/agent/who?recent=1800000');
    assert.equal(t.calls[0].agent, 'eyal.lab--a1.sig');
    on = false;
    assert.equal((await t.forq(['hook'], { hook_event_name: 'UserPromptSubmit', prompt: 'x' })).out, '');
    assert.equal((await t.forq(['hook'], { hook_event_name: 'UserPromptSubmit', prompt: 'x' })).out, '');
    assert.equal(t.calls.length, 2, 'the third prompt did not call: off is remembered');
  } finally { t.close(); }
});

test('edit: posts the file (relative), warns once when others touched it, debounced 30 s', async () => {
  const t = await setup((c) => (c.url === '/api/agent/board' ? { ts: 1, rows: [{ line: 'a2 editing 3s ago: menu [src/menu.js]' }] } : {}));
  try {
    const edit = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(t.repo, 'src/menu.js'), old_string: 'SECRET', new_string: 'x' } };
    const r = await t.forq(['hook'], edit);
    assert.equal(r.code, 0);
    assert.deepEqual(t.calls[0].body, { kind: 'editing', files: ['src/menu.js'], who: true });
    assert.ok(!JSON.stringify(t.calls[0].body).includes('SECRET'), 'never the file contents');
    assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /src\/menu.js was also touched.*\n.*a2 editing/);
    assert.equal((await t.forq(['hook'], edit)).out, '');
    assert.equal(t.calls.length, 1, 'second edit within 30 s: no post');
    await t.forq(['hook'], { ...edit, tool_name: 'Read' });
    assert.equal(t.calls.length, 1, 'other tools: nothing');
  } finally { t.close(); }
});

test('commit: posts the subject and files once per new commit, never the command', async () => {
  const t = await setup(() => ({}));
  try {
    writeFileSync(join(t.repo, 'a.js'), '1'); execFileSync('git', [...ID, 'add', 'a.js'], { cwd: t.repo });
    execFileSync('git', [...ID, 'commit', '-qm', 'Add a'], { cwd: t.repo });
    const bash = { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'cd x && git commit -qm "Add a" --author=TOKEN123' } };
    await t.forq(['hook'], bash);
    assert.equal(t.calls.length, 1);
    assert.deepEqual(t.calls[0].body, { kind: 'committed', status: 'Add a', files: ['a.js'] });
    await t.forq(['hook'], bash);
    assert.equal(t.calls.length, 1, 'same HEAD: no second post');
    await t.forq(['hook'], { ...bash, tool_input: { command: 'git pull --rebase' } });
    assert.equal(t.calls.length, 1, 'not a commit: nothing');
  } finally { t.close(); }
});

test('forq who / intent', async () => {
  const t = await setup((c) => (c.url.startsWith('/api/agent/who') ? { on: true, text: 'Working now:\na2 x' }
    : c.url === '/api/agent/intent' ? { ts: 1, others: 'Finished in the last 30 min:\nFINISHED a3 landed 2m ago: titleCase' } : {}));
  try {
    const w = await t.forq(['who', '--recent', '10m', '--files', 'src/a.js']);
    assert.equal(w.out.trim(), 'Working now:\na2 x');
    assert.equal(t.calls[0].url, '/api/agent/who?recent=600000&files=src%2Fa.js');
    await t.forq(['who', '--recent']);
    assert.equal(t.calls[1].url, '/api/agent/who?recent=1800000');
    const i = await t.forq(['intent', 'T3', 'capitalizeWords', '--files', 'src/str.js']);
    assert.deepEqual(t.calls[2].body, { intent: 'T3 capitalizeWords', files: ['src/str.js'] });
    assert.match(i.out, /on the board: T3 capitalizeWords\nOthers on the same files[\s\S]*FINISHED a3 landed/);
  } finally { t.close(); }
});
