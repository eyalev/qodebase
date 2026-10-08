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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'qbmerge-'));
  const main = join(root, 'main.git');
  g(root, 'init', '-q', '--bare', main);
  const w = join(root, 'w'); g(root, 'clone', '-q', main, w);
  write(w, { 'src/routes.js': ROUTES, 'src/math.js': MATH, 'test/math.test.js': TEST, 'package.json': PKG });
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
