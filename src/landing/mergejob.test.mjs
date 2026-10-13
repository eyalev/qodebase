// Local test of the merger box's job with real git: bare repos stand in for Artifacts.
//   node --test src/landing/mergejob.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const JOBJS = join(dirname(fileURLToPath(import.meta.url)), 'mergejob.mjs');
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
const g = (cwd, ...a) => execFileSync('git', [...ID, ...a], { cwd, encoding: 'utf8' }).trim();

function write(dir, files) { for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); } }

const ROUTES = `export const routes = [\n  ['/', 'home'],\n  ['/about', 'about'],\n];\n`;
const MATH = `export function add(a, b) {\n  return a + b;\n}\n\nexport function twice(x) {\n  return x * 2;\n}\n`;
const TEST = `import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { add, twice } from '../src/math.js';\ntest('add', () => assert.equal(add(2, 3), 5));\ntest('twice', () => assert.equal(twice(4), 8));\n`;
const PKG = JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n';

function setup(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'qbmerge-'));
  const main = join(root, 'main.git');
  g(root, 'init', '-q', '--bare', main);
  const w = join(root, 'w'); g(root, 'clone', '-q', main, w);
  write(w, { 'src/routes.js': ROUTES, 'src/math.js': MATH, 'test/math.test.js': TEST, 'package.json': PKG, ...extra });
  g(w, 'add', '-A'); g(w, 'commit', '-qm', 'start'); g(w, 'push', '-q', 'origin', 'HEAD:main');
  const base = g(w, 'rev-parse', 'HEAD');
  let n = 0;
  // A fork: its own bare repo cloned from main at base, with one commit.
  const fork = (id, edit) => {
    const f = join(root, `${id}.git`); g(root, 'clone', '-q', '--bare', main, f);
    const fw = join(root, `w-${id}`); g(root, 'clone', '-q', f, fw);
    edit(fw); g(fw, 'add', '-A'); g(fw, 'commit', '-qm', id); g(fw, 'push', '-q', 'origin', 'HEAD:main');
    return { id, title: `change ${id}`, intent: `do ${id}`, remote: f, token: null, base, commit: g(fw, 'rev-parse', 'HEAD') };
  };
  return { root, main, base, fork };
}
const run = (job) => {
  const r = spawnSync('node', [JOBJS], { env: { ...process.env, JOB: JSON.stringify(job) }, encoding: 'utf8' });
  if (process.env.DBG) console.error(r.stdout.split('\n').filter((l) => !l.startsWith('QB_RESULT')).join('\n'));
  const line = r.stdout.split('\n').find((l) => l.startsWith('QB_RESULT '));
  assert.ok(line, r.stdout + r.stderr);
  return JSON.parse(line.slice(10));
};
const edit = (fw, p, fn) => writeFileSync(join(fw, p), fn(readFileSync(join(fw, p), 'utf8')));

test('a train: clean change, two list-file collisions, two package.json collisions, a breaking change, a real conflict', () => {
  const s = setup();
  const changes = [
    s.fork('a', (fw) => { edit(fw, 'src/routes.js', (t) => t.replace(`  ['/about', 'about'],\n`, `  ['/about', 'about'],\n  ['/health', 'health'],\n`)); write(fw, { 'src/health.js': 'export const ok = 1;\n' }); }),
    s.fork('b', (fw) => edit(fw, 'src/routes.js', (t) => t.replace(`  ['/about', 'about'],\n`, `  ['/about', 'about'],\n  ['/pricing', 'pricing'],\n`))),
    s.fork('c', (fw) => edit(fw, 'package.json', (t) => { const j = JSON.parse(t); j.scripts.lint = 'echo lint'; return JSON.stringify(j, null, 2) + '\n'; })),
    s.fork('d', (fw) => edit(fw, 'package.json', (t) => { const j = JSON.parse(t); j.scripts.fmt = 'echo fmt'; return JSON.stringify(j, null, 2) + '\n'; })),
    s.fork('e', (fw) => edit(fw, 'src/math.js', (t) => t.replace('return x * 2;', 'return x * 3;'))),
    s.fork('f', (fw) => edit(fw, 'src/math.js', (t) => t.replace('return x * 2;', 'return x + x;'))),
  ];
  const r = run({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', changes });
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c]));
  assert.equal(r.pushed, true);
  assert.equal(by.a.landed, true); assert.equal(by.a.how, 'merged');
  assert.equal(by.b.landed, true); assert.equal(by.b.how, 'replayed-handler'); assert.deepEqual(by.b.conflicts, ['src/routes.js']);
  assert.equal(by.c.landed, true);
  assert.equal(by.d.landed, true); assert.equal(by.d.how, 'replayed-handler');
  assert.equal(by.e.landed, false); assert.equal(by.e.bounced, true);      // twice(4) = 12 fails the test
  assert.equal(by.f.landed, true);                                          // e bounced, so f applies cleanly in solo pass
  assert.equal(r.solo, true);
  // main has both routes, both deps, and the records as notes
  const w = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, w);
  const routes = readFileSync(join(w, 'src/routes.js'), 'utf8');
  assert.match(routes, /health/); assert.match(routes, /pricing/);
  assert.deepEqual(JSON.parse(readFileSync(join(w, 'package.json'), 'utf8')).scripts, { fmt: 'echo fmt', lint: 'echo lint', test: 'node --test' });
  g(w, 'fetch', '-q', 'origin', 'refs/notes/qodebase:refs/notes/qodebase');
  assert.match(g(w, 'notes', '--ref=qodebase', 'show', by.b.commit), /"how": "replayed-handler"/);
});

test('a real conflict is reported, not landed', () => {
  const s = setup();
  const changes = [
    s.fork('x', (fw) => edit(fw, 'src/math.js', (t) => t.replace('return a + b;', 'return b + a;'))),
    s.fork('y', (fw) => edit(fw, 'src/math.js', (t) => t.replace('return a + b;', 'return (a + b) | 0;'))),
  ];
  const r = run({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', changes });
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c]));
  assert.equal(by.x.landed, true);
  assert.equal(by.y.landed, false); assert.deepEqual(by.y.unhandled, ['src/math.js']);
});

test('main moved since the change forked: it lands on the newer main', () => {
  const s = setup();
  const c = s.fork('z', (fw) => write(fw, { 'z.txt': 'z\n' }));
  const w = join(s.root, 'mover'); g(s.root, 'clone', '-q', s.main, w);
  write(w, { 'm.txt': 'm\n' }); g(w, 'add', '-A'); g(w, 'commit', '-qm', 'm'); g(w, 'push', '-q', 'origin', 'HEAD:main');
  const r = run({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: null, changes: [c] });
  assert.equal(r.changes[0].landed, true);   // fetched after the move: lands on top
});

test('policy github/ffa: handlers off, a list-file collision is not replayed (it goes back to its agent)', () => {
  const s = setup();
  const changes = [
    s.fork('a', (fw) => edit(fw, 'src/routes.js', (t) => t.replace(`  ['/about', 'about'],\n`, `  ['/about', 'about'],\n  ['/health', 'health'],\n`))),
    s.fork('b', (fw) => edit(fw, 'src/routes.js', (t) => t.replace(`  ['/about', 'about'],\n`, `  ['/about', 'about'],\n  ['/pricing', 'pricing'],\n`))),
  ];
  const r = run({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', handlers: false, noChecks: true, changes });
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c]));
  assert.equal(by.a.landed, true);
  assert.equal(by.b.landed, false); assert.deepEqual(by.b.unhandled, ['src/routes.js']);
  assert.equal(r.checks.skipped, true);
});

test('a shallow main (an import from GitHub is depth 1): the train fetches and lands', () => {
  const s = setup();
  // a second commit, then a depth-1 copy of main stands in for an imported repo in Artifacts
  const w2 = join(s.root, 'w2'); g(s.root, 'clone', '-q', s.main, w2);
  write(w2, { 'README.md': 'hi\n' }); g(w2, 'add', '-A'); g(w2, 'commit', '-qm', 'second'); g(w2, 'push', '-q', 'origin', 'HEAD:main');
  const shallow = join(s.root, 'shallow.git');
  g(s.root, 'clone', '-q', '--bare', '--depth', '1', `file://${s.main}`, shallow);
  assert.ok(readFileSync(join(shallow, 'shallow'), 'utf8').trim(), 'the stand-in import is shallow');
  const base = g(shallow, 'rev-parse', 'main');
  const f = join(s.root, 'sf.git'); g(s.root, 'clone', '-q', '--bare', '--depth', '1', `file://${shallow}`, f);
  const fw = join(s.root, 'w-sf'); g(s.root, 'clone', '-q', `file://${f}`, fw);
  write(fw, { 'src/new.js': 'export const x = 1;\n' }); g(fw, 'add', '-A'); g(fw, 'commit', '-qm', 'sf'); g(fw, 'push', '-q', 'origin', 'HEAD:main');
  const change = { id: 'sf', title: 'change sf', intent: 'add new.js', remote: f, token: null, base, commit: g(fw, 'rev-parse', 'HEAD') };
  const r = run({ dir: join(s.root, 'merger'), mainRemote: shallow, mainToken: null, check: 'node --test', changes: [change] });
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 600));
  assert.equal(r.changes[0].landed, true, JSON.stringify(r.changes[0]).slice(0, 600));
});

test('a warm merger box: three trains in a row on one clone, main moving under it; every landing on main, main whole', () => {
  const s = setup();
  const dir = join(s.root, 'merger');
  const job = (c) => ({ dir, mainRemote: s.main, mainToken: null, check: 'npm test', changes: [c] });
  const r1 = run(job(s.fork('w1', (fw) => write(fw, { 'w1.txt': 'one\n' }))));
  assert.equal(r1.changes[0].landed, true);
  assert.ok(r1.phases.some((p) => p[0] === 'ls-remote'), 'cold: looks the branch up');
  // Someone else moves main between trains (another lane, a person): the warm clone must not miss it.
  const w = join(s.root, 'mover'); g(s.root, 'clone', '-q', s.main, w);
  write(w, { 'm.txt': 'm\n' }); g(w, 'add', '-A'); g(w, 'commit', '-qm', 'm'); g(w, 'push', '-q', 'origin', 'HEAD:main');
  const r2 = run(job(s.fork('w2', (fw) => write(fw, { 'w2.txt': 'two\n' }))));
  assert.equal(r2.changes[0].landed, true);
  assert.ok(!r2.phases.some((p) => p[0] === 'ls-remote'), 'warm: branch remembered');
  assert.ok(r2.phases.some((p) => p[0] === 'fetch-all'), 'warm, not shallow: main and forks fetched together');
  const r3 = run(job(s.fork('w3', (fw) => edit(fw, 'src/math.js', (t) => t.replace('return a + b;', 'return b + a;')))));
  assert.equal(r3.changes[0].landed, true);
  assert.equal(r3.mainBefore, r2.mainAfter, 'train 3 starts from train 2\'s main');
  const check = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, check);
  for (const f of ['w1.txt', 'w2.txt', 'm.txt']) assert.ok(readFileSync(join(check, f), 'utf8'));
  assert.match(readFileSync(join(check, 'src/math.js'), 'utf8'), /return b \+ a;/);
  // Prefetch (merger.ts): the fork's commit fetched into a ref of its own while it waited; the train skips the network.
  const c4 = s.fork('w4', (fw) => write(fw, { 'w4.txt': 'four\n' }));
  execFileSync('git', ['-c', 'gc.auto=0', 'fetch', '-q', '--no-tags', '--no-write-fetch-head', c4.remote, `+HEAD:refs/qb/p/${c4.id}`], { cwd: dir });
  assert.throws(() => execFileSync('git', ['cat-file', '-e', 'HEAD:w4.txt'], { cwd: dir, stdio: 'ignore' }), 'prefetched code is only in a ref, not in the working tree');
  const r4 = run(job(c4));
  assert.equal(r4.changes[0].landed, true);
  assert.equal(r4.fetchMs.prefetched, 1);
  assert.equal(r4.fetchMs.forks[0], 0);
  g(check, 'pull', '-q');
  assert.equal(readFileSync(join(check, 'w4.txt'), 'utf8'), 'four\n');
  execFileSync('git', ['fsck', '--strict'], { cwd: s.main });
  assert.equal(g(s.main, 'rev-parse', 'main'), r4.mainAfter);
});

// X4: model replays in one train run side by side (a stand-in `claude` on PATH that takes 1 s and edits files the way
// FAKE_MODE says), land in train order, and main stays whole: every change's work is there and the checks pass.
function fakeClaude(root, mode) {
  const bin = join(root, 'bin'); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const prompt = process.argv[process.argv.indexOf('-p') + 1];
const id = (prompt.match(/Intent: change (\\w+)/) || [])[1];
// Like Claude Code: every write under a .git path is refused ('sensitive file').
if (process.cwd().split('/').includes('.git')) { console.log(JSON.stringify({ is_error: true, result: 'refused: sensitive file' })); process.exit(0); }
// Like a real replay, make the reviewed change: each '+' line of the diff in the prompt replaces the line with the same
// start (up to its '=' or 14 chars) in that diff's file, or is appended. FAKE_MODE=drop leaves them out (a bad replay).
const applyDiff = () => {
  const diff = (prompt.split('\`\`\`diff')[1] || '').split('\`\`\`')[0];
  let file = null;
  for (const l of diff.split('\\n')) {
    const m = l.match(/^\\+\\+\\+ b\\/(.+)$/); if (m) { file = m[1]; continue; }
    if (!file || !l.startsWith('+') || l.startsWith('+++')) continue;
    const line = l.slice(1), key = (line.includes('=') ? line.slice(0, line.indexOf('=')) : line.slice(0, 14)).trim();
    const t = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\\n') : [];
    const k = t.findIndex((x) => x.trim().startsWith(key) && key.length > 2);
    if (k >= 0) t[k] = line; else t.push(line);
    fs.writeFileSync(file, t.join('\\n'));
  }
};
setTimeout(() => {
  // MOVE_MAIN: another lane lands on main while this train runs (once).
  if (process.env.MOVE_MAIN && !fs.existsSync(process.env.MOVE_MAIN + '.moved')) {
    const { execFileSync: x } = require('child_process'); const w = process.env.MOVE_MAIN + '.w'; const I = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
    x('git', ['clone', '-q', process.env.MOVE_MAIN, w]); fs.writeFileSync(w + '/other-lane.txt', 'landed by another lane\\n');
    x('git', [...I, 'add', '-A'], { cwd: w }); x('git', [...I, 'commit', '-qm', 'other lane'], { cwd: w }); x('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: w });
    fs.writeFileSync(process.env.MOVE_MAIN + '.moved', '1');
  }
  if (process.env.FAKE_MODE !== 'drop') applyDiff();
  if (process.env.FAKE_MODE === 'append') fs.appendFileSync('src/math.js', '\\nexport function f_' + id + '() {\\n  return "' + id + '";\\n}\\n');
  else { fs.mkdirSync('src', { recursive: true }); fs.writeFileSync('src/' + id + '.js', 'export const ' + id + ' = 1;\\n'); }
  console.log(JSON.stringify({ num_turns: 1, total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 5 }, result: 'done' }));
}, 1000);
`, { mode: 0o755 });
  return { PATH: `${bin}:${process.env.PATH}`, FAKE_MODE: mode };
}
const runEnv = (job, env) => {
  const r = spawnSync('node', [JOBJS], { env: { ...process.env, ...env, JOB: JSON.stringify(job) }, encoding: 'utf8' });
  if (process.env.DBG) console.error(r.stdout);
  const line = r.stdout.split('\n').find((l) => l.startsWith('QB_RESULT '));
  assert.ok(line, r.stdout + r.stderr);
  return { r: JSON.parse(line.slice(10)), log: r.stdout };
};
// Five changes rewrite the same line of math.js differently: the first merges as text, the other four need the model.
const conflicting = (s) => ['a', 'b', 'c', 'd', 'e'].map((id, k) => s.fork(id, (fw) => edit(fw, 'src/math.js', (t) => t.replace('return a + b;', `return a + b + ${k} - ${k};`).replace('export function twice', '// keep\nexport function twice'))));
// Disjoint: change a rewrites one line in each of four files; b..e each rewrite that line in ONE of them, differently. All
// four conflict with a, none with each other: their replays can run side by side.
const disjoint = (s) => {
  const files = ['src/p1.js', 'src/p2.js', 'src/p3.js', 'src/p4.js'];
  return [s.fork('a', (fw) => { for (const f of files) edit(fw, f, (t) => t.replace('= 0;', '= 100;')); }),
    ...['b', 'c', 'd', 'e'].map((id, k) => s.fork(id, (fw) => edit(fw, files[k], (t) => t.replace('= 0;', `= ${k + 1};`))))];
};

test('parallel model replays: four replays at once, all land in train order, main whole', () => {
  const s = setup({ 'src/p1.js': 'export const p1 = 0;\n', 'src/p2.js': 'export const p2 = 0;\n', 'src/p3.js': 'export const p3 = 0;\n', 'src/p4.js': 'export const p4 = 0;\n' });
  const env = fakeClaude(s.root, 'file');
  const t = Date.now();
  const { r, log } = runEnv({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', llm: { model: 'claude-haiku-5-5' }, changes: disjoint(s) }, env);
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c]));
  assert.equal(r.pushed, true);
  assert.equal(by.a.how, 'merged');
  for (const id of ['b', 'c', 'd', 'e']) { assert.equal(by[id].landed, true, id); assert.equal(by[id].how, 'replayed-llm', id); assert.equal(by[id].llm.parallel, true, id); }
  assert.match(log, /"event":"replays_parallel","n":4,"ok":4/);
  assert.ok(Date.now() - t < 3500, `four 1-second replays ran side by side (${Date.now() - t} ms)`);
  const w = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, w);
  for (const id of ['b', 'c', 'd', 'e']) assert.equal(readFileSync(join(w, `src/${id}.js`), 'utf8'), `export const ${id} = 1;\n`);
  // Landed in train order: main's log, oldest first, is start, a, b, c, d, e.
  assert.deepEqual(g(w, 'log', '--reverse', '--format=%s').split('\n'), ['start', 'change a', 'change b', 'change c', 'change d', 'change e']);
  assert.equal(spawnSync('node', ['--test'], { cwd: w, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } }).status, 0, 'checks pass on main');
});

test('replays of the same file run one at a time (no wasted side-by-side run), and nothing is lost', () => {
  const s = setup();
  const env = fakeClaude(s.root, 'append');
  const { r, log } = runEnv({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', llm: { model: 'claude-haiku-5-5' }, changes: conflicting(s) }, env);
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c]));
  assert.equal(r.pushed, true);
  for (const id of ['b', 'c', 'd', 'e']) assert.equal(by[id].landed, true, id);
  assert.match(log, /"event":"replays_parallel","n":1,/, 'only the first goes side by side; the rest share its file');
  assert.doesNotMatch(log, /"event":"replay_collided"/);
  assert.deepEqual(['c', 'd', 'e'].map((id) => by[id].llm.parallelOutcome), ['serial', 'serial', 'serial']);
  const w = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, w);
  const math = readFileSync(join(w, 'src/math.js'), 'utf8');
  for (const id of ['b', 'c', 'd', 'e']) assert.match(math, new RegExp(`f_${id}\\(`), id);
  assert.equal(spawnSync('node', ['--test'], { cwd: w, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } }).status, 0, 'checks pass on main');
});

// Two copies of one train at once (real build r8b: the merger box ran a train twice): one does the work, the other waits
// and reports the same result; main gets each change once; a third run of the finished train reuses the saved result.
test('the same train run twice at once lands once and reports one result', async () => {
  const { spawn } = await import('node:child_process');
  const s = setup();
  const changes = [s.fork('a', (fw) => write(fw, { 'src/a.js': 'export const a = 1;\n' })), s.fork('b', (fw) => write(fw, { 'src/b.js': 'export const b = 1;\n' }))];
  const job = { trainId: 't-dup', dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'sleep 2 && node --test', changes };
  const go = () => new Promise((res) => { const p = spawn('node', [JOBJS], { env: { ...process.env, JOB: JSON.stringify(job) } }); let out = ''; p.stdout.on('data', (d) => (out += d)); p.on('close', () => res(out)); });
  const [o1, o2] = await Promise.all([go(), new Promise((r) => setTimeout(r, 300)).then(go)]);
  const res = (o) => JSON.parse(o.split('\n').find((l) => l.startsWith('QB_RESULT ')).slice(10));
  const r1 = res(o1), r2 = res(o2);
  assert.equal(r1.pushed, true); assert.deepEqual(r2, r1, 'the waiting copy reports the first copy\'s result');
  assert.match(o2, /"event":"duplicate_waits"/);
  const w = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, w);
  assert.deepEqual(g(w, 'log', '--format=%s').split('\n'), ['change b', 'change a', 'start'], 'each change landed once');
  const o3 = await go();
  assert.match(o3, /"event":"result_reused"/); assert.deepEqual(res(o3), r1);
});

test('a model replay that leaves out reviewed lines is not landed (review 2 #2)', () => {
  const s = setup({ 'src/p1.js': 'export const p1 = 0;\n', 'src/p2.js': 'export const p2 = 0;\n', 'src/p3.js': 'export const p3 = 0;\n', 'src/p4.js': 'export const p4 = 0;\n' });
  const env = fakeClaude(s.root, 'drop');
  const { r, log } = runEnv({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', llm: { model: 'claude-haiku-5-5' }, changes: disjoint(s) }, env);
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c]));
  assert.equal(by.a.landed, true);
  for (const id of ['b', 'c', 'd', 'e']) { assert.equal(by[id].landed, false, id); assert.match(by[id].why, /left out 1 of 1 lines the reviewed change added/, id); }
  assert.match(log, /"event":"replay_incomplete"/);
});

// Review 2 #2: the flagship's splitter view. A change adds a big new file and edits one shared line; only the shared line
// conflicts. The new file is applied straight from the reviewed diff, the model redoes only the conflicting file (its prompt
// carries only that file's diff), and the big file lands whole.
test('a replay redoes only the conflicting file; the change\'s new file lands as reviewed (ag1dx)', () => {
  const s = setup({ 'index.html': '<title>app</title>\nconst nav = "home";\n' });
  const big = Array.from({ length: 400 }, (_, i) => `export const line${i} = ${i}; // ${'x'.repeat(60)}`).join('\n') + '\n';
  const changes = [
    s.fork('a', (fw) => edit(fw, 'index.html', (t) => t.replace('const nav = "home";', 'const nav = "home,trips";'))),
    s.fork('b', (fw) => { edit(fw, 'index.html', (t) => t.replace('const nav = "home";', 'const nav = "home,split";')); write(fw, { 'src/split.js': big }); }),
  ];
  const env = fakeClaude(s.root, 'file');
  const { r, log } = runEnv({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', llm: { model: 'claude-haiku-5-5' }, changes }, env);
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c]));
  assert.equal(by.a.how, 'merged');
  assert.equal(by.b.landed, true, by.b.why); assert.equal(by.b.how, 'replayed-llm');
  assert.deepEqual(by.b.llm.redone, ['index.html']); assert.deepEqual(by.b.llm.appliedAsReviewed, ['src/split.js']);
  const w = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, w);
  assert.equal(readFileSync(join(w, 'src/split.js'), 'utf8'), big, 'the new file landed whole');
  assert.match(readFileSync(join(w, 'index.html'), 'utf8'), /const nav = "home,split";/);
  assert.doesNotMatch(log, /replay_incomplete/);
});

// Lanes (2026-10-13): another lane pushed main during this train; the train rebases onto it (different files), runs
// its checks again and pushes, instead of running the whole train (replays included) again.
test('lanes: main moved by another lane mid-train -> rebase onto it and push', () => {
  const s = setup({ 'src/p1.js': 'export const p1 = 0;\n', 'src/p2.js': 'export const p2 = 0;\n', 'src/p3.js': 'export const p3 = 0;\n', 'src/p4.js': 'export const p4 = 0;\n' });
  const env = { ...fakeClaude(s.root, 'file'), MOVE_MAIN: s.main };
  const { r, log } = runEnv({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', rebaseOnStale: true, llm: { model: 'claude-haiku-5-5' }, changes: disjoint(s) }, env);
  assert.equal(r.pushed, true, r.pushErr);
  assert.match(log, /"event":"lane_rebased"/);
  const w = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, w);
  assert.equal(readFileSync(join(w, 'other-lane.txt'), 'utf8'), 'landed by another lane\n', 'the other lane kept');
  for (const id of ['b', 'c', 'd', 'e']) assert.equal(readFileSync(join(w, `src/${id}.js`), 'utf8'), `export const ${id} = 1;\n`, id);
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c]));
  for (const id of ['a', 'b', 'c', 'd', 'e']) { assert.equal(by[id].landed, true, id); assert.ok(g(w, 'notes', '--ref=qodebase', 'list').length >= 0); }
  assert.equal(spawnSync('node', ['--test'], { cwd: w, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: '' } }).status, 0, 'checks pass on main');
});

// Direct replays (2026-10-13): one Messages API call through a (fake) gateway instead of claude -p; whole files back.
test('direct replays: one gateway call per replay, whole files back, nothing lost', async () => {
  const http = await import('node:http');
  const { spawn } = await import('node:child_process');
  let calls = 0, auth = '', model = '';
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      calls++; auth = req.headers.authorization || ''; model = JSON.parse(b).model;
      const msg = JSON.parse(b).messages[0].content;
      const id = (msg.match(/Intent: change (\w+)/) || [])[1];
      const files = [...msg.matchAll(/<<<FILE (.+?)>>>\n([\s\S]*?)\n<<<END>>>/g)].map((m) => [m[1], m[2]]);
      const text = files.map(([p, t]) => `<<<FILE ${p}>>>\n${t.replace(/\n*$/, '')}\nexport function f_${id}() {\n  return "${id}";\n}\n<<<END>>>`).join('\n');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 100, completion_tokens: 40 } }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const s = setup();
  const job = { dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', llm: { model: 'claude-haiku-5-5' }, changes: conflicting(s) };
  const out = await new Promise((res) => { const p = spawn('node', [JOBJS], { env: { ...process.env, JOB: JSON.stringify(job), QB_REPLAY_DIRECT: '1', QB_GW_URL: `http://127.0.0.1:${srv.address().port}`, QB_GW_TOKEN: 'gw-test' } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', () => res(o)); });
  srv.close();
  if (process.env.DBG) console.error(out);
  const r = JSON.parse(out.split('\n').find((l) => l.startsWith('QB_RESULT ')).slice(10));
  assert.equal(r.pushed, true);
  assert.equal(auth, 'Bearer gw-test');
  assert.equal(model, 'anthropic/claude-haiku-5.5');
  assert.ok(calls >= 4, `one call per replay (${calls})`);
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c]));
  for (const id of ['b', 'c', 'd', 'e']) { assert.equal(by[id].landed, true, id); assert.equal(by[id].how, 'replayed-llm', id); assert.equal(by[id].llm.in, 100, id); }
  const w = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, w);
  const math = readFileSync(join(w, 'src/math.js'), 'utf8');
  for (const id of ['b', 'c', 'd', 'e']) assert.match(math, new RegExp(`f_${id}\\(`), id);
});

// Lanes + notes (2026-10-13): two lane trains at once, different files. One push races the other and rebases; the notes
// of BOTH trains must end up on the remote (a force-pushed notes ref used to drop the other lane's).
test('lanes: two trains at once keep every landed commit\'s note', async () => {
  const { spawn } = await import('node:child_process');
  const s = setup({ 'src/p1.js': 'export const p1 = 0;\n', 'src/p2.js': 'export const p2 = 0;\n', 'src/p3.js': 'export const p3 = 0;\n', 'src/p4.js': 'export const p4 = 0;\n' });
  const ch = (id, f) => s.fork(id, (fw) => edit(fw, f, (t) => t.replace('= 0;', '= 7;')));
  const laneA = [ch('a1', 'src/p1.js'), ch('a2', 'src/p2.js')], laneB = [ch('b1', 'src/p3.js'), ch('b2', 'src/p4.js'), ch('b3', 'src/p4.js')];   // b3 = b2's change again: lands as an empty commit
  const go = (dir, changes) => new Promise((res) => {
    const p = spawn('node', [JOBJS], { env: { ...process.env, JOB: JSON.stringify({ dir: join(s.root, dir), mainRemote: s.main, mainToken: null, check: 'sleep 1 && node --test', rebaseOnStale: true, changes }) } });
    let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', () => res(JSON.parse(o.split('\n').find((l) => l.startsWith('QB_RESULT ')).slice(10))));
  });
  const [ra, rb] = await Promise.all([go('lane-a', laneA), go('lane-b', laneB)]);
  assert.equal(ra.pushed, true, ra.pushErr); assert.equal(rb.pushed, true, rb.pushErr);
  const w = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, w);
  g(w, 'fetch', '-q', 'origin', '+refs/notes/qodebase:refs/notes/qodebase');
  const noted = new Set(g(w, 'notes', '--ref=qodebase', 'list').split('\n').filter(Boolean).map((l) => l.split(' ')[1]));
  const landed = g(w, 'log', '--format=%H %s', 'HEAD').split('\n').filter((l) => / change [ab]\d$/.test(l)).map((l) => l.split(' ')[0]);
  assert.equal(landed.length, 5, 'five changes on main, the no-op b3 included');
  for (const c of landed) assert.ok(noted.has(c), `note for ${c.slice(0, 7)}`);
});

// A change with nothing new on top of its base (its work is already on main) lands as an empty commit of its own, with its
// note, instead of no commit at all (59-96 such changes per code-dial run had no record on main, 2026-10-14).
test('a change with nothing new lands as its own empty commit, with a note', () => {
  const s = setup();
  const real = s.fork('a', (fw) => write(fw, { 'src/a.js': 'export const a = 1;\n' }));
  const none = { id: 'z', title: 'change z', intent: 'do z', remote: s.main, token: null, base: s.base, commit: s.base };   // nothing on top of base
  const r = run({ dir: join(s.root, 'merger'), mainRemote: s.main, mainToken: null, check: 'node --test', changes: [real, none] });
  assert.equal(r.pushed, true);
  const z = r.changes.find((c) => c.id === 'z');
  assert.equal(z.landed, true); assert.ok(z.commit, 'z has its own commit');
  const w = join(s.root, 'check'); g(s.root, 'clone', '-q', s.main, w); g(w, 'fetch', '-q', 'origin', '+refs/notes/qodebase:refs/notes/qodebase');
  assert.equal(g(w, 'log', '-1', '--format=%s', z.commit), 'change z');
  assert.match(g(w, 'notes', '--ref=qodebase', 'show', z.commit), /"change": "z"/);
});
