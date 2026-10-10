// The board's pure logic (src/landing/board.ts):
//   node --experimental-strip-types --test src/landing/board.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBoardEvent, boardView, boardText, parseDedupe, backlogItems, dedupePrompt, BOARD_TTL_MS } from './board.ts';

const T0 = 1_000_000_000;
const ev = (agent, kind, intent, files, dt) => ({ ...makeBoardEvent({ agent, kind, intent, files }, T0 + dt * 1000) });

test('events are validated and clipped', () => {
  assert.throws(() => makeBoardEvent({ kind: 'started' }), /no agent/);
  assert.throws(() => makeBoardEvent({ agent: 'a', kind: 'nope' }), /kind/);
  const e = makeBoardEvent({ agent: 'a1', kind: 'editing', intent: 'x'.repeat(500), files: './src/a.js, src/b.js,,' }, 5);
  assert.equal(e.intent.length, 200);
  assert.deepEqual(e.files, ['src/a.js', 'src/b.js']);
  assert.equal(e.ts, 5);
});

test('now view: one row per live agent, files over the window, not me, TTL drops old', () => {
  const evs = [ev('a1', 'started', 'menu', ['menu.html'], 0), ev('a1', 'editing', 'menu', ['menu.css'], 10),
    ev('a2', 'editing', 'cart', ['cart.js'], 20), ev('me', 'editing', 'mine', ['x'], 30), ev('old', 'editing', 'gone', ['y'], -700)];
  const rows = boardView(evs, { me: 'me', now: T0 + 60_000 });
  assert.deepEqual(rows.map((r) => r.agent), ['a2', 'a1']);
  assert.deepEqual(rows[1].files.sort(), ['menu.css', 'menu.html']);
  assert.equal(rows[1].kind, 'editing');
  assert.equal(rows[0].ageS, 40);
});

test('files and area filters (folder prefix matches)', () => {
  const evs = [ev('a1', 'editing', 'menu page', ['src/menu/a.js'], 0), ev('a2', 'editing', 'cart', ['src/cart.js'], 0)];
  const at = { now: T0 + 1000 };
  assert.deepEqual(boardView(evs, { ...at, files: ['src/menu'] }).map((r) => r.agent), ['a1']);
  assert.deepEqual(boardView(evs, { ...at, files: 'src/cart.js' }).map((r) => r.agent), ['a2']);
  assert.deepEqual(boardView(evs, { ...at, area: 'MENU' }).map((r) => r.agent), ['a1']);
  assert.equal(boardView(evs, { ...at, files: ['other.js'] }).length, 0);
});

test('recent: finished work once per agent+intent, after the live rows; a landed agent is not live', () => {
  const evs = [
    ev('a1', 'started', 'titleCase', ['str.js'], 0), ev('a1', 'pushed', 'titleCase', ['str.js'], 60), ev('a1', 'landed', 'titleCase', [], 120),
    ev('a2', 'started', 'cart', ['cart.js'], 100), ev('a2', 'committed', 'cart', ['cart.js'], 130),
    ev('a3', 'landed', 'ancient', [], -3000),
  ];
  const now = T0 + 200_000;
  const plain = boardView(evs, { now });
  assert.deepEqual(plain.map((r) => r.agent), ['a2'], 'landed a1 is not working now; without recent it is not listed');
  const rows = boardView(evs, { now, recent: 30 * 60_000 });
  assert.deepEqual(rows.map((r) => `${r.agent}:${r.done ? 'done' : 'live'}`), ['a2:live', 'a1:done']);
  assert.equal(rows[1].kind, 'landed');
  const txt = boardText(rows, [{ a: 'T3', b: 'T11', at: 0, by: 'x' }]);
  assert.match(txt, /Working now:\na2 committed/);
  assert.match(txt, /Finished in the last 30 min:\nFINISHED a1 landed/);
  assert.match(txt, /T3 = T11/);
  assert.equal(boardText([]), '');
});

test('the TTL is 10 minutes', () => {
  assert.equal(BOARD_TTL_MS, 600_000);
  assert.equal(boardView([ev('a', 'editing', 'x', [], 0)], { now: T0 + 601_000 }).length, 0);
});

test('dedupe answer parsing: known ids only, no self pairs, no repeats', () => {
  const txt = 'Sure.\n{"same": [["T3","T11"], ["T11","T3"], ["T4","T4"], ["T9","T99"], "junk"]}\n';
  assert.deepEqual(parseDedupe(txt, ['T3', 'T4', 'T9', 'T11']), [['T3', 'T11']]);
  assert.deepEqual(parseDedupe('no json'), []);
  assert.deepEqual(parseDedupe('{"same": []}'), []);
});

test('backlog items: ids from labels, list items without labels get an index', () => {
  const items = backlogItems('# Backlog\n\n- [ ] **T1** titleCase(s)\n- [x] T2: slugify\n3. add a footer\nplain prose line\nT4 capitalize words\n');
  assert.deepEqual(items.map((i) => i.id), ['T1', 'T2', '#3', 'T4']);
  const p = dedupePrompt(items);
  assert.match(p, /T1: \*\*T1\*\* titleCase/);
  assert.match(p, /"same"/);
});
