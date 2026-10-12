import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landedEntry } from './landed.ts';

test('G2: a landed change as History shows it under its commit', () => {
  const c = { id: 'p.c--a1', title: 'Menu page', intent: 'Add a menu page\n\nAsked: build a café', agent: 'agent a1', stackedOn: 'p.c--a0', landedAt: 5,
    review: { verdict: 'approved', notes: 'ok' }, landing: { how: 'replayed-handler', commit: 'abc', mainCommit: 'def' },
    events: [{ t: 1, what: 'reviewing', detail: 'by review2' }, { t: 2, what: 'approved' }] };
  assert.deepEqual(landedEntry(c), { id: 'p.c--a1', title: 'Menu page', intent: 'Add a menu page', agent: 'agent a1', verdict: 'approved', reviewer: 'review2',
    replayed: true, how: 'handler', stackedOn: 'p.c--a0', landedAt: 5 });
  assert.equal(landedEntry({ ...c, landing: { how: 'merged' }, review: null, events: [], stackedOn: null }).how, 'clean');
  assert.equal(landedEntry({ ...c, landing: { how: 'replayed-llm' } }).how, 'model');
});
