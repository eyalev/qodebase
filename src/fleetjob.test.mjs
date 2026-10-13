// node --experimental-strip-types --test src/fleetjob.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate, cleanStart, PRESETS, BUDGET_MAX, AGENTS_MAX } from './fleetjob.ts';

test('estimate: VS Code editor (~1,200 files) on the Workers AI pair', () => {
  const e = estimate({ files: 1200, models: PRESETS.workers, agents: 1000, budgetUsd: 3 });
  assert.equal(e.files, 1200);
  assert.ok(e.minutes[0] >= 1 && e.minutes[1] > e.minutes[0], JSON.stringify(e));
  assert.ok(e.usd[0] > 0.1 && e.usd[1] < 1, JSON.stringify(e));   // ~$0.30 at S5 prices
  assert.equal(e.capUsd, 3); assert.equal(e.note, '');
});
test('estimate: few agents slow it down; the cache costs nothing; a small budget says it stops early', () => {
  const many = estimate({ files: 4000, models: PRESETS.workers, agents: 1000, budgetUsd: 5 }), few = estimate({ files: 4000, models: PRESETS.workers, agents: 10, budgetUsd: 5 });
  assert.ok(few.minutes[0] > many.minutes[0]);
  assert.deepEqual(estimate({ files: 4000, models: PRESETS.cache, agents: 200, budgetUsd: 1 }).usd, [0, 0]);
  assert.match(estimate({ files: 40000, models: PRESETS.workers, agents: 2000, budgetUsd: 1 }).note, /stops it at \$1\.00/);
  assert.equal(estimate({ files: 0, models: PRESETS.workers, agents: 10, budgetUsd: 1 }), null);
});
test('cleanStart: repo checked, numbers clamped, job only when asked, real models batched', () => {
  assert.ok('error' in cleanStart({ repo: '../etc' }));
  assert.ok('error' in cleanStart({ repo: 'fleet-nest-1', root: 'a b;rm' }));
  const c = cleanStart({ repo: 'fleet-vscode-src-3', root: '/src/vs/editor/', agents: 99999, budgetUsd: 500, job: 'comments+index', preset: 'workers', label: 'VS Code editor <script>' });
  assert.equal(c.root, 'src/vs/editor'); assert.equal(c.agents, AGENTS_MAX); assert.equal(c.budgetUsd, BUDGET_MAX); assert.equal(c.job, 'comments+index');
  assert.equal(c.batch, 20); assert.equal(c.label, 'VS Code editor script');
  const k = cleanStart({ repo: 'fleet-nest-2', preset: 'cache' });
  assert.equal(k.job, undefined); assert.equal(k.batch, undefined); assert.deepEqual(k.models, PRESETS.cache);
});
