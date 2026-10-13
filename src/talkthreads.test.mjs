// Conversations in Talk: the server store (src/talkthreads.ts, on a real SQLite), titles, and the page's project matcher
// and "new conversation" words (src/talkconv.ts, run with stubs).
//   node --experimental-strip-types --test src/talkthreads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { convOp, cleanMsgs, cleanCtx, cleanTitle, titleMessages } from './talkthreads.ts';
import { CONV_JS } from './talkconv.ts';

// Durable Object SqlStorage over node:sqlite: exec(sql, ...args) -> { toArray(), one() }.
function fakeSql() {
  const db = new DatabaseSync(':memory:');
  return { exec(q, ...args) {
    const st = db.prepare(q);
    const rows = /^\s*select/i.test(q) ? st.all(...args) : (st.run(...args), []);
    return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('one: ' + rows.length); return rows[0]; } };
  } };
}

test('store: create, update parts, list newest first without messages, get with them', () => {
  const sql = fakeSql();
  const a = convOp(sql, 'put', { id: 'aaaaaa1', title: 'Dark mode for todo', ctx: [{ slug: 'eyal.todo', state: 'on' }], msgs: [{ who: 'you', text: 'add dark mode to my todo app' }, { who: 'ai', text: 'Send it to its agents?' }], chat: [{ role: 'user', content: 'x' }], n: 2 });
  assert.equal(a.title, 'Dark mode for todo');
  assert.equal(a.last, 'Send it to its agents?');
  convOp(sql, 'put', { id: 'bbbbbb2', msgs: [] });
  // A meta-only write keeps the messages.
  convOp(sql, 'put', { id: 'aaaaaa1', status: 'needs', unseen: true });
  const list = convOp(sql, 'list', {});
  assert.deepEqual(list.map((c) => c.id), ['aaaaaa1', 'bbbbbb2']);
  assert.equal(list[0].msgs, undefined);
  assert.equal(list[0].status, 'needs');
  assert.equal(list[0].unseen, true);
  const g = convOp(sql, 'get', { id: 'aaaaaa1' });
  assert.equal(g.msgs.length, 2);
  assert.deepEqual(g.ctx, [{ slug: 'eyal.todo', state: 'on' }]);
  assert.equal(g.title, 'Dark mode for todo');
  assert.deepEqual(convOp(sql, 'put', { id: 'BAD id' }), { error: 'id' });
  convOp(sql, 'delete', { id: 'bbbbbb2' });
  assert.equal(convOp(sql, 'list', {}).length, 1);
  convOp(sql, 'wipe', {});
  assert.equal(convOp(sql, 'list', {}).length, 0);
});

test('store: 30-day retention swept on write, at most 200 conversations', () => {
  const sql = fakeSql();
  convOp(sql, 'put', { id: 'oldold1', msgs: [] });
  sql.exec('UPDATE conv SET updated = ? WHERE id = ?', Date.now() - 31 * 86400_000, 'oldold1');
  convOp(sql, 'put', { id: 'newnew1', msgs: [] });
  assert.deepEqual(convOp(sql, 'list', {}).map((c) => c.id), ['newnew1']);
  for (let i = 0; i < 205; i++) convOp(sql, 'put', { id: 'c' + String(i).padStart(6, '0') });
  assert.equal((sql.exec('SELECT COUNT(*) AS n FROM conv').one()).n, 200);
});

test('clean: messages capped (count and size), context only real slugs, deduplicated', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ who: i % 2 ? 'ai' : 'you', text: 'x'.repeat(3000) }));
  const m = cleanMsgs(many);
  assert.ok(m.length <= 40 && JSON.stringify(m).length <= 64_000, String(m.length));
  assert.equal(cleanMsgs([{ who: 'evil', text: 'x' }, { who: 'you' }]).length, 0);
  assert.deepEqual(cleanCtx([{ slug: 'eyal.todo' }, { slug: 'eyal.todo', state: 'maybe' }, { slug: '../x' }, { slug: 'forq.timer', state: 'maybe' }]),
    [{ slug: 'eyal.todo', state: 'on' }, { slug: 'forq.timer', state: 'maybe' }]);
});

test('titles: one short line, quotes and labels off; the prompt keeps the current title unless the topic moved', () => {
  assert.equal(cleanTitle('"Dark mode for todo."'), 'Dark mode for todo');
  assert.equal(cleanTitle('<think>hmm</think>\nTitle: Habit tracker build\nmore'), 'Habit tracker build');
  const p = titleMessages([{ who: 'you', text: 'how is the build?' }, { who: 'note', text: 'skip me' }, { who: 'ai', text: 'Two of five landed.' }], 'Habit tracker build');
  assert.match(p[0].content, /"Habit tracker build"/);
  assert.equal(p[1].content, 'Person: how is the build?\nAssistant: Two of five landed.');
});

// The page side, with the few Talk functions it needs stubbed.
function page(me = 'eyal') {
  const src = readFileSync(new URL('./talkclient.ts', import.meta.url), 'utf8');
  const scaffold = /var SCAFFOLD_RX = (\/.*\/i);/.exec(src)[1];
  const dist = /function dist\(a, b\) \{[\s\S]*?\n\}/.exec(src)[0];
  const store = {};
  const ls = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } };
  const f = new Function('ls', 'me', `var KEY = 'qb-talk-'; var location = { search: '' };
    function get(k, d) { var v = ls.getItem(KEY + k); return v == null ? d : v; } function set(k, v) { ls.setItem(KEY + k, v); }
    var SCAFFOLD_RX = ${scaffold}; ${dist}
    ${CONV_JS}
    return { cvMatches: cvMatches, NEW_RX: NEW_RX, CONV_ON: CONV_ON };`);
  return f(ls, me);
}
const P = (owner, name, priv) => ({ owner, name, slug: `${owner}.${name}`, private: !!priv });
const LIST = [P('eyal', 'todo'), P('eyal', 'podqast'), P('eyal', 'habit-tracker'), P('eyal', 'real-course-builder'), P('forq', 'timer'), P('bob', 'secret-notes', true), P('eyal', 'lab-cafe-r3'), P('forq', 'calculator')];

test('off by default: the conversation code does nothing on a device without the setting', () => {
  assert.equal(page().CONV_ON, false);
});

test('chips from what was said: confident = theirs and clearly a name; unsure = short names, near spellings, public ones', () => {
  const { cvMatches } = page();
  const m = (t) => cvMatches(t, LIST).map((x) => `${x.slug}:${x.state}`);
  assert.deepEqual(m('add a streak counter to my habit tracker'), ['eyal.habit-tracker:on']);
  assert.deepEqual(m('in my todo app, add due dates'), ['eyal.todo:on']);
  assert.deepEqual(m('add a todo list to the page'), ['eyal.todo:maybe'], 'an ordinary word: only a suggestion');
  assert.deepEqual(m('what changed in podcast this week'), ['eyal.podqast:maybe'], 'a near spelling: a suggestion');
  assert.deepEqual(m('how does the timer app work'), ['forq.timer:maybe'], 'someone else\'s public project: a suggestion');
  assert.deepEqual(m('open secret notes'), [], 'never someone else\'s private project');
  assert.deepEqual(m('how is lab cafe r3'), [], 'never a test scaffold');
  assert.deepEqual(m('what is going on'), []);
});

test('"new conversation" words', () => {
  const { NEW_RX } = page();
  for (const t of ['new conversation', 'New conversation.', 'start a new conversation', 'okay, new chat', 'open a new thread please']) assert.ok(NEW_RX.test(t), t);
  for (const t of ['start a new conversation about the todo app', 'what is a new conversation', 'build a new chat app']) assert.ok(!NEW_RX.test(t), t);
});

test('two devices: a write from another tab since this one read it is refused (stored copy handed back); own racing saves are not', () => {
  const sql = fakeSql();
  const a = convOp(sql, 'put', { id: 'twodev1', dev: 'tabA', msgs: [{ who: 'you', text: 'one' }] });
  const b = convOp(sql, 'put', { id: 'twodev1', dev: 'tabB', base: a.updated, msgs: [{ who: 'you', text: 'one' }, { who: 'you', text: 'two from B' }] });
  assert.equal(b.error, undefined);
  sql.exec('UPDATE conv SET updated = updated + 5 WHERE id = ?', 'twodev1');   // B's write is newer than what A read
  const stale = convOp(sql, 'put', { id: 'twodev1', dev: 'tabA', base: a.updated, msgs: [{ who: 'you', text: 'one' }, { who: 'you', text: 'A overwrites' }] });
  assert.equal(stale.error, 'stale');
  assert.equal(stale.conv.msgs[1].text, 'two from B');
  // B's own next save, based on an older read of its own write, goes through.
  assert.equal(convOp(sql, 'put', { id: 'twodev1', dev: 'tabB', base: a.updated, msgs: [{ who: 'you', text: 'three' }] }).error, undefined);
});
