// node --test sim/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, POLICIES } from '../public/sim/engine.js';

const small = { repos: 3, agentsPerRepo: 30, files: 300 };

test('same seed, same run', () => {
  const a = createSim({ ...small, seed: 7 }); a.runUntil(3600);
  const b = createSim({ ...small, seed: 7 }); b.runUntil(3600);
  assert.deepEqual(a.metrics, b.metrics);
});

for (const policy of Object.keys(POLICIES)) {
  test(`${policy}: every agent is in exactly one state`, () => {
    const sim = createSim({ ...small, policy });
    for (const h of [0.01, 0.5, 2]) {
      sim.runUntil(h * 3600);
      const s = sim.snapshot({ files: false });
      assert.equal(s.groups.reduce((n, [, c]) => n + c, 0), s.totalAgents, `at ${h} h`);
    }
  });
}

test('claims on every file: no conflicts ever', () => {
  const sim = createSim({ ...small, policy: 'claims' }); sim.runUntil(4 * 3600);
  assert.equal(sim.metrics.conflicts, 0);
  assert.ok(sim.metrics.merged > 100);
});

test('classic: throughput bounded by the people reviewing', () => {
  const sim = createSim({ repos: 1, agentsPerRepo: 200, files: 2000, policy: 'classic' });
  sim.runUntil(4 * 3600);
  // 2 people, ~8 min a diff: ~15 changes/h each.
  assert.ok(sim.metrics.merged / 4 < 40, `merged/h ${sim.metrics.merged / 4}`);
});

test('main red share stays within 0..1', () => {
  const sim = createSim({ repos: 2, agentsPerRepo: 500, files: 2000, policy: 'agentReview', pBreak: 0.05 });
  sim.runUntil(3 * 3600);
  const { redShare } = sim.snapshot({ files: false });
  assert.ok(redShare >= 0 && redShare <= 1, `redShare ${redShare}`);
});

test('a followed change records its story', () => {
  const sim = createSim({ ...small, policy: 'hybrid' });
  sim.runUntil(600);
  assert.ok(sim.follow());
  sim.runUntil(3 * 3600);
  const f = sim.snapshot().follow;
  assert.ok(f.log.length >= 3);
});
