import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, addItem, getItem, runCommand } from '../src/index.js';

test('store', () => {
  const s = createStore();
  const a = addItem(s, { title: 'a' });
  assert.equal(a.id, 1);
  assert.equal(getItem(s, 1).title, 'a');
});
test('count command', () => {
  const s = createStore(); addItem(s, { title: 'a' });
  assert.equal(runCommand(s, 'count'), '1');
  assert.equal(runCommand(s, 'nope'), 'unknown command: nope');
});
