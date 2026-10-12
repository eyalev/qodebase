// The board's pure logic (src/landing/board.ts):
//   node --experimental-strip-types --test src/landing/board.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBoardEvent, boardView, boardText, parseDedupe, backlogItems, dedupePrompt, BOARD_TTL_MS, taskIds, knownTaskIds, claimHolders, pickNext } from './board.ts';

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
  assert.ok(!rows.some((r) => r.agent === 'a2' && r.done), 'committed is not finished');
  assert.equal(rows[1].kind, 'landed');
  const txt = boardText(rows, [{ a: 'T3', b: 'T11', at: 0, by: 'x' }]);
  assert.match(txt, /Working now[^\n]*:\na2 committed/);
  assert.match(txt, /Landed on main in the last 30 min:\nLANDED a1 landed/);
  assert.match(txt, /T3 = T11/);
  assert.equal(boardText([]), '');
});

test('only landed work is finished; pushed/queued/bounced stays live up to 45 min; silent agents expire', () => {
  const evs = [
    ev('p', 'started', 'slugify', ['s.js'], 0), ev('p', 'pushed', 'slugify', ['s.js'], 60),          // pushed, never landed
    ev('b', 'started', 'tags', ['t.js'], 0), ev('b', 'bounced', 'tags', ['t.js'], 120),              // sent back
    ev('s', 'started', 'stalled', ['x.js'], 0), ev('s', 'committed', 'stalled', ['x.js'], 30),       // went silent
    ev('l', 'pushed', 'dates', ['d.js'], 0), ev('l', 'landed', 'dates', ['d.js'], 200),
  ];
  const rows = boardView(evs, { now: T0 + 20 * 60_000, recent: 30 * 60_000 });
  const by = Object.fromEntries(rows.map((r) => [r.agent, r]));
  assert.equal(by.p?.done, undefined, 'pushed is not FINISHED');
  assert.equal(by.p?.kind, 'pushed', 'pushed stays live past the 10 min TTL');
  assert.equal(by.b?.kind, 'bounced');
  assert.equal(by.s, undefined, 'a silent agent expires after the TTL: its task is free again');
  assert.equal(by.l?.done, true);
  assert.equal(boardView(evs, { now: T0 + 50 * 60_000 }).length, 0, 'in flight ends at 45 min');
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

test('claims: the earliest live claim keeps a task; later claimants are told; a dead holder does not count', () => {
  assert.deepEqual(taskIds('T5: dueSoon and T12 overdue, T5 again', new Set(['T5', 'T12'])), ['T5', 'T12']);
  const claims = { a: { ids: ['T5'], at: 100 }, b: { ids: ['T5'], at: 200 }, c: { ids: ['T5', 'T9'], at: 300 }, d: { ids: ['T9'], at: 50 } };
  const live = new Set(['a', 'b', 'c']);   // d went silent
  assert.deepEqual(claimHolders(claims, 'a', live), {}, 'first claimant keeps it');
  assert.deepEqual(claimHolders(claims, 'b', live), { T5: 'a' });
  assert.deepEqual(claimHolders(claims, 'c', live), { T5: 'a' }, 'T9: d is not live, so c holds it');
  assert.deepEqual(claimHolders(claims, 'c', new Set(['a', 'd'])), { T5: 'a', T9: 'd' });
  assert.deepEqual(claimHolders({}, 'x', live), {});
});

test('task ids count only when a registered list has them (not ES2022, UTF8, SHA256, V8)', () => {
  const known = knownTaskIds([{ items: [{ id: 'T5' }, { id: 'T12' }, { id: '#3' }] }]);
  assert.deepEqual([...known].sort(), ['T12', 'T5'], "an unlabelled item ('#3') is not claimable by name");
  assert.deepEqual(taskIds('T5 target ES2022, UTF8 strings, SHA256 ids, V8 flags', known), ['T5']);
  assert.deepEqual(taskIds('T5: x', new Set()), [], 'no list registered: no claims');
  assert.deepEqual(knownTaskIds(), new Set());
});

test('heartbeats keep a slow agent (and its claim) live without changing its row', () => {
  const evs = [ev('slow', 'started', 'T5 big task', ['a.js'], 0), { ...ev('slow', 'alive', '', [], 900), kind: 'alive' }];
  const rows = boardView(evs, { now: T0 + 1000 * 1000 });
  assert.equal(rows.length, 1, 'alive 100 s ago keeps it live although its last word is 1000 s old');
  assert.equal(rows[0].kind, 'started');
  assert.equal(rows[0].intent, 'T5 big task');
  assert.deepEqual(rows[0].files, ['a.js'], 'files of its current task stay');
  assert.equal(boardView(evs, { now: T0 + 1600 * 1000 }).length, 0, 'no heartbeat for 10 min: gone, its task is free');
  assert.equal(boardView([{ ...ev('x', 'alive', '', [], 0), kind: 'alive' }], { now: T0 + 1000 }).length, 0, 'a heartbeat alone is no row');
});

test('forq next: first free task in list order; skips done, live claims and alias second names; same task when asked twice', () => {
  const items = ['T1', 'T2', 'T3', 'T4', 'T5'].map((id) => ({ id, text: `${id} text` }));
  const aliases = [{ a: 'T2', b: 'T4', at: 0, by: 'router' }];
  const base = { done: new Set(['T1']), live: new Set(['a', 'b']), aliases };
  let claims = { a: { ids: ['T2'], at: 1 } };
  const n1 = pickNext(items, { ...base, me: 'b', claims });
  assert.equal(n1.id, 'T3', 'T1 done, T2 held by a live agent');
  assert.equal(n1.again, false);
  claims = { ...claims, b: { ids: ['T3'], at: 2 } };
  assert.equal(pickNext(items, { ...base, me: 'b', claims }).id, 'T3', 'asking again returns the same task');
  assert.equal(pickNext(items, { ...base, me: 'c', claims }).id, 'T5', 'T4 is the alias of T2: never handed out alone');
  assert.deepEqual(pickNext(items, { ...base, me: 'a', claims }).aliases, ['T4'], 'the builder of T2 also adds the alias T4');
  assert.equal(pickNext(items, { ...base, me: 'c', claims, live: new Set(['b']) }).id, 'T2', 'a dead holder frees its task');
  assert.equal(pickNext(items, { ...base, me: 'c', claims, done: new Set(['T1', 'T2', 'T3', 'T5']) }), null);
});
