import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAsks, stateOf } from './asks.ts';

test('asks: router requests own the changes made until the next request; board tasks with claims, done and aliases', () => {
  const ch = (id, state, createdAt) => ({ id, title: id, state, createdAt });
  const out = buildAsks({
    requests: [{ text: 'build a café', at: 100, from: 'person', state: 'sent' }, { text: 'fix the menu', at: 500, from: 'talk', state: 'sent' },
      { text: 'Merge a1', at: 600, from: 'merge' }, { text: 'TypeError in /menu', at: 900, from: 'issues', state: 'waking' }],
    changes: [ch('p.c--a1', 'landed', 110), ch('p.c--a2', 'bounced', 120), ch('p.c--a3', 'queued', 510), ch('p.c--a4', 'landed', 520)],
    lists: [{ by: 'router', at: 130, items: [{ id: 'T1', text: 'menu page' }, { id: 'T2', text: 'opening hours' }, { id: 'T3', text: 'hours page' }, { id: 'T4', text: 'contact form' }] }],
    done: ['T1'], claims: { a3: { ids: ['T2'], at: 140 } }, aliases: [{ a: 'T2', b: 'T3' }],
  });
  const by = Object.fromEntries(out.asks.map((a) => [a.id, a]));
  const r1 = by[`r${(100).toString(36)}`], r2 = by[`r${(500).toString(36)}`], r3 = by[`r${(900).toString(36)}`];
  assert.deepEqual(r1.changes, ['p.c--a1', 'p.c--a2']); assert.equal(r1.state, 'mixed'); assert.equal(r1.from, 'person');
  assert.deepEqual(r2.changes, ['p.c--a3', 'p.c--a4']); assert.equal(r2.state, 'in-line'); assert.equal(r2.from, 'talk');
  assert.equal(r3.state, 'planning'); assert.equal(r3.from, 'issues'); assert.equal(r3.delivery, 'waking');
  assert.ok(!out.asks.some((a) => a.text === 'Merge a1'), 'merge turns are not asks');
  assert.equal(by['t:T1'].state, 'landed');
  assert.deepEqual(by['t:T2'].changes, ['p.c--a3']); assert.equal(by['t:T2'].state, 'in-line'); assert.deepEqual(by['t:T2'].aliases, ['hours page']);
  assert.equal(by['t:T3'].duplicateOf, 't:T2');
  assert.equal(by['t:T4'].state, 'planning');
  assert.equal(out.asks[0].at, 900, 'newest first');
  assert.equal(out.counts.planning, 3, 'r3, T4, and the duplicate T3');
});

test('asks: state of a set of changes', () => {
  assert.equal(stateOf([]), 'planning');
  assert.equal(stateOf(['landed', 'working']), 'working');
  assert.equal(stateOf(['landed', 'reviewing']), 'in-line');
  assert.equal(stateOf(['landed', 'landed']), 'landed');
  assert.equal(stateOf(['bounced']), 'bounced');
  assert.equal(stateOf(['landed', 'bounced']), 'mixed');
});

test('asks: scripted demo changes (no request, no list) are asks of their own', () => {
  const out = buildAsks({ requests: [], lists: [], done: [], claims: {}, aliases: [],
    changes: [{ id: 'e.c--d1', title: 'Menu prices', state: 'landed', createdAt: 5, kind: 'demo' }, { id: 'e.c--d2', title: 'Hours', state: 'queued', createdAt: 6, kind: 'demo' }] });
  assert.deepEqual(out.asks.map((a) => [a.id, a.from, a.state, a.text]), [['c:e.c--d2', 'script', 'in-line', 'Hours'], ['c:e.c--d1', 'script', 'landed', 'Menu prices']]);
});

test('asks: a task list nobody claimed from (only for dedupe) is left out', () => {
  const out = buildAsks({ requests: [{ text: 'build', at: 1, from: 'person', state: 'sent' }], changes: [], lists: [{ by: 'router', at: 2, items: [{ id: 'T1', text: 'a' }, { id: 'T2', text: 'b' }] }], done: [], claims: {}, aliases: [] });
  assert.deepEqual(out.asks.map((a) => a.from), ['person']);
});
