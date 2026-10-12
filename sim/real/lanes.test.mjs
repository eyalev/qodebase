// node --test sim/real/lanes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, makeOp, check, randomOp, resetNames, isHot } from './project.mjs';
import { runReal } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rnd = ((a) => () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; })(7);
const view = (files) => [(p) => files.get(p) ?? null, () => files.keys()];

test('split hot files: every folder has its own routes and fields, and the project is green', () => {
  const files = generate({ modules: 6, filesPerModule: 4, rnd, splitHot: true });
  assert.ok(!files.has('src/routes.ts') && !files.has('src/schema.ts') && files.has('package.json'));
  for (let m = 0; m < 6; m++) assert.ok(files.has(`src/m${m}/routes.ts`) && files.has(`src/m${m}/fields.ts`));
  assert.deepEqual(check(...view(files)), []);
  assert.ok(isHot('src/m3/routes.ts') && isHot('src/m3/fields.ts') && isHot('package.json') && !isHot('src/m3/f1.ts'));
});

test('split hot files: adding a function and a field stays inside its folder', () => {
  const files = generate({ modules: 6, filesPerModule: 4, rnd, splitHot: true });
  resetNames();
  const pick = () => 'src/m2/f1.ts';
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const op = randomOp(rnd, pick, view(files)[0], { splitHot: true });
    const out = op.apply(...view(files));
    if (!out) continue;
    seen.add(op.kind);
    if (op.kind === 'addFunction' || op.kind === 'addField') for (const p of out.keys()) assert.match(p, /^src\/m2\//);
    const next = new Map(files); for (const [p, t] of out) next.set(p, t);
    assert.deepEqual(check(...view(next)), [], `${op.text}`);
  }
  assert.ok(seen.has('addFunction') && seen.has('addField'));
});

test('the tests catch a route added twice across two folders and a field twice', () => {
  const files = generate({ modules: 3, filesPerModule: 2, rnd, splitHot: true });
  const a = makeOp('addFunction', { file: 'src/m0/f0.ts', name: 'dup', routesFile: 'src/m0/routes.ts' }).apply(...view(files));
  const next = new Map(files); for (const [p, t] of a) next.set(p, t);
  const b = makeOp('addFunction', { file: 'src/m1/f0.ts', name: 'dup', routesFile: 'src/m1/routes.ts' }).apply(...view(next));
  for (const [p, t] of b) next.set(p, t);
  assert.ok(check(...view(next)).some((f) => /route \/dup twice/.test(f)));
  next.set('src/m2/fields.ts', next.get('src/m2/fields.ts').replace("'id',", "'id',\n  'id',"));
  assert.ok(check(...view(next)).some((f) => f.startsWith('src/m2/fields.ts: a field twice')));
});

const small = (o) => {
  const name = `test-lanes-${Math.random().toString(36).slice(2, 8)}`;
  try { return runReal({ policy: 'intents', agents: 40, hours: 0.5, seed: 2, modules: 16, bundle: false, name, ...o }).stats; }
  finally { rmSync(join(HERE, 'out', `${name}.git`), { recursive: true, force: true }); }
};

test('lanes: every landing is counted in exactly one lane; shared hot files push work to the coordinated lane', () => {
  const shared = small({ lanes: 4 }), split = small({ lanes: 4, splitHot: true });
  for (const s of [shared, split]) {
    assert.equal(s.laneLanded.length, 6); // 4 areas + root + coordinated
    assert.equal(s.laneLanded.reduce((a, b) => a + b, 0), s.landed);
    assert.ok(s.landed > 0 && s.doorBusy > 0 && s.doorBusy < 1);
    assert.ok(s.breaks <= s.mainChecksFailed);
  }
  assert.ok(shared.coordLanded / shared.landed > split.coordLanded / split.landed, `${shared.coordLanded}/${shared.landed} vs ${split.coordLanded}/${split.landed}`);
});

test('no claims: nothing deferred, and the coordinated lane holds the lanes it touches', () => {
  const s = small({ lanes: 4, claims: false });
  assert.equal(s.claims, false);
  assert.equal(s.deferred, 0);
  assert.ok(s.coordLanded > 0 && s.landed > s.coordLanded);
});

test('one lane has no door, no coordinated lane and no main check', () => {
  const s = small({ lanes: 1 });
  assert.equal(s.laneLanded.length, 1);
  assert.equal(s.doorBusy, 0);
  assert.equal(s.coordLanded, 0);
  assert.equal(s.mainChecksFailed, 0);
});

test('controller: caps start small, agents park, and caps move', () => {
  const s = small({ lanes: 2, controller: true, ctl: { start: 2, evalS: 300, windowS: 300, holdS: 300 } });
  assert.ok(s.idled > 0);
  assert.ok(s.avgWorking < 40);
  assert.equal(s.caps.length, 4); // 2 areas + root + coordinated
  assert.ok(s.capMax.some((c) => c > 2));
  const pick = small({ lanes: 2, controller: true, ctlPick: true, ctl: { start: 2 } });
  assert.ok(pick.deferred > 0 && pick.idled > 0);
  const free = small({ lanes: 2 });
  assert.equal(free.idled, 0);
  assert.equal(free.caps, null);
});
