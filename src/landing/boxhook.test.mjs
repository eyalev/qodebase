// The box side of the agent board: `forq hook` (Claude Code hooks), `forq who`, `forq intent`, against a stub API.
//   node --experimental-strip-types --test src/landing/boxhook.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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
  const forq = (args, stdin, env = {}) => new Promise((res) => {
    const p = spawn('python3', [cli, ...args], { env: { ...process.env, FORQ_RUN: run, FORQ_REPO: repo, ...env } });
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
    const posts = () => t.calls.filter((c) => c.body?.kind !== 'alive');
    await t.forq(['hook'], bash);
    assert.equal(posts().length, 1);
    assert.deepEqual(posts()[0].body, { kind: 'committed', status: 'Add a', files: ['a.js'] });
    await t.forq(['hook'], bash);
    assert.equal(posts().length, 1, 'same HEAD: no second post');
    await t.forq(['hook'], { ...bash, tool_input: { command: 'git pull --rebase' } });
    assert.equal(posts().length, 1, 'not a commit: nothing');
    assert.equal(t.calls.filter((c) => c.body?.kind === 'alive').length, 1, 'one heartbeat for three tool uses within 2 min');
  } finally { t.close(); }
});

test('forq who / intent', async () => {
  const t = await setup((c) => (c.url.startsWith('/api/agent/who') ? { on: true, text: 'Working now:\na2 x' }
    : c.url === '/api/agent/intent' ? { ts: 1, others: 'Landed on main in the last 30 min:\nLANDED a3 landed 2m ago: titleCase' } : {}));
  try {
    const w = await t.forq(['who', '--recent', '10m', '--files', 'src/a.js']);
    assert.equal(w.out.trim(), 'Working now:\na2 x');
    assert.equal(t.calls[0].url, '/api/agent/who?recent=600000&files=src%2Fa.js');
    await t.forq(['who', '--recent']);
    assert.equal(t.calls[1].url, '/api/agent/who?recent=1800000');
    const i = await t.forq(['intent', 'T3', 'capitalizeWords', '--files', 'src/str.js']);
    assert.deepEqual(t.calls[2].body, { intent: 'T3 capitalizeWords', files: ['src/str.js'] });
    assert.match(i.out, /on the board: T3 capitalizeWords\nOthers on the same files[\s\S]*LANDED a3 landed/);
  } finally { t.close(); }
});

test('forq push: force-pushes an agent fork, refuses the router', async () => {
  const t = await setup(() => ({}));
  try {
    const remote = join(t.root, 'fork.git'); execFileSync('git', [...ID, 'init', '-q', '--bare', remote]);
    execFileSync('git', [...ID, 'remote', 'add', 'origin', remote], { cwd: t.repo });
    writeFileSync(join(t.repo, 'a.js'), '1'); execFileSync('git', [...ID, 'add', 'a.js'], { cwd: t.repo }); execFileSync('git', [...ID, 'commit', '-qm', 'one'], { cwd: t.repo });
    execFileSync('git', [...ID, 'push', '-q', 'origin', 'HEAD:main'], { cwd: t.repo });
    execFileSync('git', [...ID, 'commit', '-q', '--amend', '-m', 'one, rewritten'], { cwd: t.repo });   // a rewritten history (sync-main)
    const r = await t.forq(['push']);
    assert.equal(r.code, 0, r.err);
    assert.equal(execFileSync('git', ['log', '-1', '--format=%s', 'main'], { cwd: remote, encoding: 'utf8' }).trim(), 'one, rewritten');
    writeFileSync(join(t.run, 'agent-token'), 'eyal.lab--router.sig');
    const rr = await t.forq(['push']);
    assert.notEqual(rr.code, 0);
    assert.match(rr.err, /for agents on their own fork/);
  } finally { t.close(); }
});

test('forq sync-main: conflict says forq skip; forq skip drops the duplicate commit and pushes; a half-done rebase is aborted first', async () => {
  const t = await setup((c) => (c.url === '/api/agent/main-info' ? { remote: join(t.root, 'main.git'), token: 'x', branch: 'main' } : {}));
  try {
    const g = (cwd, ...a) => execFileSync('git', [...ID, ...a], { cwd, encoding: 'utf8' }).trim();
    const main = join(t.root, 'main.git'), fork = join(t.root, 'fork.git');
    g(t.root, 'init', '-q', '--bare', main); g(t.root, 'init', '-q', '--bare', fork);
    g(t.repo, 'remote', 'add', 'origin', fork);
    writeFileSync(join(t.repo, 'dates.js'), 'base\n'); g(t.repo, 'add', '-A'); g(t.repo, 'commit', '-qm', 'seed');
    g(t.repo, 'push', '-q', main, 'HEAD:main'); g(t.repo, 'push', '-q', 'origin', 'HEAD:main');
    writeFileSync(join(t.repo, 'dates.js'), 'base\nparseDate = mine\n'); g(t.repo, 'commit', '-qam', 'T1 dates (mine)');
    // another agent's T1 landed first, written differently
    const w = join(t.root, 'w'); g(t.root, 'clone', '-q', main, w);
    writeFileSync(join(w, 'dates.js'), 'base\nparseDate = theirs\n'); g(w, 'commit', '-qam', 'T1 dates (theirs)'); g(w, 'push', '-q', 'origin', 'HEAD:main');
    const r = await t.forq(['sync-main']);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /run: forq skip/);
    // an earlier half-done rebase does not block a new sync-main: it is aborted and redone
    const r2 = await t.forq(['sync-main']);
    assert.match(r2.err, /run: forq skip/);
    const s = await t.forq(['skip']);
    assert.equal(s.code, 0, s.err);
    assert.match(s.out, /dropped 1 commit/);
    assert.equal(g(fork, 'log', '-1', '--format=%s', 'main'), 'T1 dates (theirs)');
    assert.equal((await t.forq(['skip'])).code, 1, 'no rebase in progress');
  } finally { t.close(); }
});

test('heartbeat: any tool use posts alive at most every 2 min; an off board stops it', async () => {
  let off = false;
  const t = await setup((c) => (off ? { off: true } : { ts: 1 }));
  try {
    const read = { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: '/x' } };
    await t.forq(['hook'], read); await t.forq(['hook'], read);
    assert.deepEqual(t.calls.map((c) => c.body), [{ kind: 'alive' }]);
    const st = JSON.parse(readFileSync(join(t.run, 'board-state.json'), 'utf8')); st.alive -= 121; writeFileSync(join(t.run, 'board-state.json'), JSON.stringify(st));
    off = true;
    await t.forq(['hook'], read);
    assert.equal(t.calls.length, 2, 'after 2 min: another heartbeat');
    await t.forq(['hook'], { hook_event_name: 'UserPromptSubmit', prompt: 'x' });
    assert.equal(t.calls.length, 2, 'the board said off: the hook stays quiet for 2 min');
  } finally { t.close(); }
});

test('forq next and forq tasks', async () => {
  let ans = { id: 'T3', text: 'T3 dates helper', aliases: ['T21'], again: false };
  const t = await setup((c) => (c.url === '/api/agent/next' ? ans : c.url === '/api/agent/tasks' ? { items: 31, ids: 30 } : {}));
  try {
    const r = await t.forq(['next']);
    assert.equal(t.calls[0].method, 'POST');
    assert.match(r.out, /your task: T3: T3 dates helper\nalso add T21 as a thin alias/);
    ans = { none: true };
    assert.match((await t.forq(['next'])).out, /no task left/);
    ans = { off: true };
    assert.notEqual((await t.forq(['next'])).code, 0);
    writeFileSync(join(t.repo, 'BACKLOG.md'), '- T1 a\n');
    const tk = await t.forq(['tasks', 'BACKLOG.md']);
    assert.match(tk.out, /registered 30 task ids/);
    assert.equal(t.calls.at(-1).body.text, '- T1 a\n');
  } finally { t.close(); }
});

test('forq spawn: a twin of running/landed work goes out as an alias task (W9c); no twin, no check, or the board off: the task as typed', async () => {
  let twinOn = true;
  const t = await setup((c) => {
    if (c.url === '/api/agent/twin') return !twinOn ? { on: false, items: [] }
      : c.body.stage === 'prompt' ? { on: true, items: [{ id: 'C1', text: 'titleCase' }, { id: 'NEW', text: 'x' }], prompt: 'P' }
      : { twin: { change: 'eyal.lab--a1', title: 'titleCase' }, task: 'ALIAS TASK' };
    if (c.url === '/api/agent/spawn') return { id: 'eyal.lab--b2' };
    return {};
  });
  try {
    const bin = join(t.root, 'bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\ncat >/dev/null\necho \'{"result":"{\\"same\\":[[\\"NEW\\",\\"C1\\"]]}","usage":{"input_tokens":5,"output_tokens":3}}\'\n', { mode: 0o755 });
    const PATH = `${bin}:${process.env.PATH}`;
    const r = await t.forq(['spawn', 'capitalizeWords'], null, { PATH });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /same work as eyal\.lab--a1[\s\S]*started eyal\.lab--b2/);
    const spawnCall = t.calls.find((c) => c.url === '/api/agent/spawn');
    assert.equal(spawnCall.body.task, 'ALIAS TASK');
    assert.equal(t.calls.find((c) => c.body?.stage === 'answer').body.usage.in, 5, 'the pass\'s tokens go to the ledger');
    twinOn = false;
    await t.forq(['spawn', 'a new page'], null, { PATH });
    assert.equal(t.calls.filter((c) => c.url === '/api/agent/spawn').at(-1).body.task, 'a new page');
  } finally { t.close(); }
});
