// The café demo's story, end to end with real git and the real merge job:
//   node --experimental-strip-types --test src/landing/demoproject.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED, TASKS, applyEdits } from './demoproject.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
const g = (cwd, ...a) => execFileSync('git', [...ID, ...a], { cwd, encoding: 'utf8' }).trim();
const T = Object.fromEntries(TASKS.map((t) => [t.key, t]));
const { NODE_TEST_CONTEXT, ...ENV } = process.env;

function readAll(dir) {
  const files = new Map();
  for (const p of g(dir, 'ls-files').split('\n').filter(Boolean)) files.set(p, readFileSync(join(dir, p), 'utf8'));
  return files;
}
function writeAll(dir, files) { for (const [p, t] of files) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); } }

test('the café story: handlers, a bounce and its fix, a lead redo, a stack', () => {
  const root = mkdtempSync(join(tmpdir(), 'qbcafe-'));
  const main = join(root, 'main.git'); g(root, 'init', '-q', '--bare', main);
  const w = join(root, 'w'); g(root, 'clone', '-q', main, w);
  writeAll(w, new Map(Object.entries(SEED))); g(w, 'add', '-A'); g(w, 'commit', '-qm', 'Corner Café'); g(w, 'push', '-q', 'origin', 'HEAD:main');
  assert.equal(spawnSync('node', ['--test'], { cwd: w, env: ENV }).status, 0, 'seed tests pass');

  // An agent: fork `from` (a bare repo), do the edits, push. Returns the change for the job.
  const forks = {};
  const work = (key, from, edits = T[key].edits, base) => {
    const f = forks[key] || join(root, `${key}-${Object.keys(forks).length}-${Date.now()}.git`);
    if (!forks[key]) { g(root, 'clone', '-q', '--bare', from, f); forks[key] = f; }
    const fw = join(root, `w-${key}-${Date.now()}-${Math.random()}`); g(root, 'clone', '-q', f, fw);
    const files = readAll(fw);
    const changed = applyEdits(files, edits);
    writeAll(fw, new Map(changed.map((p) => [p, files.get(p)])));
    const b = base || g(fw, 'rev-parse', 'HEAD');
    g(fw, 'add', '-A'); g(fw, 'commit', '-qm', key); g(fw, 'push', '-q', 'origin', 'HEAD:main');
    return { id: key, title: T[key].title, intent: T[key].intent, remote: f, token: null, base: b, commit: g(fw, 'rev-parse', 'HEAD'), changed };
  };
  const run = (changes) => {
    const r = spawnSync('node', [join(HERE, 'mergejob.mjs')], { env: { ...ENV, JOB: JSON.stringify({ dir: join(root, 'merger'), mainRemote: main, mainToken: null, check: null, changes }) }, encoding: 'utf8' });
    const line = r.stdout.split('\n').find((l) => l.startsWith('QB_RESULT '));
    assert.ok(line, r.stdout + r.stderr);
    const out = JSON.parse(line.slice(10));
    return { out, by: Object.fromEntries(out.changes.map((c) => [c.id, c])) };
  };

  const first = ['hours', 'contact', 'cakes', 'teas', 'rounder', 'dark', 'rename', 'tagline', 'badges', 'reservations'].map((k) => work(k, main));
  const resform = work('resform', forks.reservations, T.resform.edits);   // stacked: forked from the reservations fork
  const r1 = run(first.slice(0, 9));
  const b = r1.by;
  assert.equal(b.hours.how, 'merged');
  assert.equal(b.contact.how, 'replayed-handler'); assert.deepEqual(b.contact.conflicts, ['src/routes.js']);
  assert.equal(b.cakes.how, 'merged');
  assert.equal(b.teas.how, 'replayed-handler');
  assert.equal(b.rounder.bounced, true);
  assert.equal(b.dark.how, 'merged');
  assert.equal(b.rename.how, 'merged');
  assert.equal(b.tagline.landed, false); assert.deepEqual(b.tagline.unhandled, ['src/site.js']);
  assert.equal(b.badges.how, 'replayed-handler'); assert.deepEqual(b.badges.conflicts, ['style.css']);

  // Round 2: the fix (same fork, same base), the lead's redo (fresh fork of today's main),
  // and the stack (reservations, then the form with the page's commit as its base).
  const fix = work('rounder', null, T.rounder.fix, first.find((c) => c.id === 'rounder').base);
  delete forks.tagline;
  const redo = work('tagline', main);
  const resv = first.find((c) => c.id === 'reservations');
  const r2 = run([fix, redo, resv, { ...resform, base: resv.commit }]);
  for (const k of ['rounder', 'tagline', 'reservations', 'resform']) assert.equal(r2.by[k].landed, true, `${k}: ${r2.by[k].why}`);

  const end = join(root, 'end'); g(root, 'clone', '-q', main, end);
  assert.equal(spawnSync('node', ['--test'], { cwd: end, env: ENV }).status, 0, 'main is green at the end');
  const site = readFileSync(join(end, 'src/site.js'), 'utf8');
  assert.match(site, /Corner Café & Books/); assert.match(site, /good books since 1998/);
  const routes = readFileSync(join(end, 'src/routes.js'), 'utf8');
  for (const p of ['hours', 'contact', 'reservations']) assert.match(routes, new RegExp(`'/${p}'`));
  assert.match(readFileSync(join(end, 'src/pages/reservations.js'), 'utf8'), /<form>/);
  rmSync(root, { recursive: true, force: true });
});

test('every task applies to the seed (or to its stack base)', () => {
  for (const t of TASKS) {
    const files = new Map(Object.entries(SEED));
    if (t.stackOn) applyEdits(files, T[t.stackOn].edits);
    assert.ok(applyEdits(files, t.edits).length > 0, t.key);
    if (t.fix) assert.ok(applyEdits(files, t.fix).length > 0, `${t.key} fix`);
  }
});

test('busy mode: 300 tasks apply in order on top of each other and main stays green except the broken pages', async () => {
  const { busyTask } = await import('./demoproject.ts');
  const files = new Map(Object.entries(SEED));
  const kinds = {};
  for (let i = 0; i < 300; i++) {
    const t = busyTask(i);
    const k = t.fix ? 'broken' : t.title.split(' ')[0];
    kinds[k] = (kinds[k] || 0) + 1;
    applyEdits(files, t.edits);
    if (t.fix) applyEdits(files, t.fix);
  }
  const root = mkdtempSync(join(tmpdir(), 'qbbusy-'));
  writeAll(root, files);
  const r = spawnSync('node', ['--test'], { cwd: root, env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout.slice(-800));
  assert.ok(kinds.broken > 5 && kinds.Add > 200, JSON.stringify(kinds));
  rmSync(root, { recursive: true, force: true });
});

// Calls a real model (Claude Code on this machine): QB_TEST_LLM=1 node --experimental-strip-types --test src/landing/demoproject.test.mjs
test('tier 2: a real conflict is replayed by a model on the latest main', { skip: !process.env.QB_TEST_LLM }, () => {
  const root = mkdtempSync(join(tmpdir(), 'qbllm-'));
  const main = join(root, 'main.git'); g(root, 'init', '-q', '--bare', main);
  const w = join(root, 'w'); g(root, 'clone', '-q', main, w);
  writeAll(w, new Map(Object.entries(SEED))); g(w, 'add', '-A'); g(w, 'commit', '-qm', 'seed'); g(w, 'push', '-q', 'origin', 'HEAD:main');
  const base = g(w, 'rev-parse', 'HEAD');
  const mk = (key) => {
    const f = join(root, `${key}.git`); g(root, 'clone', '-q', '--bare', main, f);
    const fw = join(root, `w-${key}`); g(root, 'clone', '-q', f, fw);
    const files = readAll(fw); const ch = applyEdits(files, T[key].edits); writeAll(fw, new Map(ch.map((p) => [p, files.get(p)])));
    g(fw, 'add', '-A'); g(fw, 'commit', '-qm', key); g(fw, 'push', '-q', 'origin', 'HEAD:main');
    return { id: key, title: T[key].title, intent: T[key].intent, remote: f, token: null, base, commit: g(fw, 'rev-parse', 'HEAD') };
  };
  const changes = [mk('rename'), mk('tagline')];
  const r = spawnSync('node', [join(HERE, 'mergejob.mjs')], { env: { ...ENV, JOB: JSON.stringify({ dir: join(root, 'merger'), mainRemote: main, mainToken: null, check: 'node --test', llm: { model: process.env.QB_TEST_LLM_MODEL || 'claude-haiku-5-5' }, changes }) }, encoding: 'utf8', timeout: 300_000 });
  const out = JSON.parse(r.stdout.split('\n').find((l) => l.startsWith('QB_RESULT ')).slice(10));
  const by = Object.fromEntries(out.changes.map((c) => [c.id, c]));
  console.log(JSON.stringify(by.tagline.llm));
  assert.equal(by.rename.how, 'merged');
  assert.equal(by.tagline.how, 'replayed-llm', by.tagline.why);
  const end = join(root, 'end'); g(root, 'clone', '-q', main, end);
  const site = readFileSync(join(end, 'src/site.js'), 'utf8');
  assert.match(site, /Corner Café & Books/); assert.match(site, /good books since 1998/);
  rmSync(root, { recursive: true, force: true });
});
