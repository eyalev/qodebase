// The intent tree's builders (src/intents.ts): rollup, sort order, paging, why, find, and a 10k-leaf run.
//   node --experimental-strip-types --test src/intents.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTree, fleetTree, parseRecords, answer, changeStatus, areaOf, rollStatus } from './intents.ts';

const ev = (t, what) => ({ t, what });
const ch = (id, state, claims, extra = {}) => ({ id: `eyal.p--${id}`, title: `Task ${id}`, intent: `Do ${id}\n\nAsked: build it`, agent: `agent ${id}`, state, claims, files: claims,
  events: [ev(1000, 'asked')], createdAt: 2000, landedAt: state === 'landed' ? 5000 : null, ...extra });
const info = { slug: 'eyal.p', name: 'p', autoLand: true, requests: [{ text: 'Build a travel app with photos', at: 1000 }, { text: 'Add a dark theme', at: 9000 }] };
const view = (changes) => ({ changes, areas: [{ path: '/' }, { path: 'js/features' }, { path: 'css' }] });
const q = (s) => new URLSearchParams(s);

test('status words: needs you only when a person must act', () => {
  const v = view([]);
  assert.equal(changeStatus({ state: 'pushed', review: { verdict: 'approved' } }, v, false).status, 'needs');
  assert.equal(changeStatus({ state: 'pushed', review: { verdict: 'approved' } }, v, true).status, 'waiting');
  assert.equal(changeStatus({ state: 'pushed', review: { verdict: 'changes' } }, v, true).status, 'working');
  assert.equal(changeStatus({ state: 'bounced' }, v, true).status, 'blocked');
  assert.equal(changeStatus({ state: 'with-lead', lead: 'agent 3' }, v, true).waitingOn, 'its lead (agent 3) to combine it with newer code');
  assert.equal(changeStatus({ state: 'working' }, { ...v, run: { stopped: true } }, true).status, 'failed');
  assert.equal(changeStatus({ state: 'landed' }, { ...v, run: { stopped: true } }, true).status, 'done');
  assert.equal(rollStatus({ needs: 0, blocked: 1, working: 3, waiting: 0, failed: 0, done: 9 }), 'blocked');
  // Nothing open: done, with the failures counted beside it (never "Blocked" on finished work).
  assert.equal(rollStatus({ needs: 0, blocked: 0, working: 0, waiting: 0, failed: 12, done: 2468 }), 'done');
  assert.equal(rollStatus({ needs: 0, blocked: 0, working: 0, waiting: 0, failed: 2, done: 0 }), 'failed');
});

test('areas: the longest known folder that holds most claimed files', () => {
  assert.equal(areaOf({ claims: ['js/features/a.js', 'js/features/b.js', 'index.html'] }, ['/', 'js/features', 'js']), 'js/features');
  assert.equal(areaOf({ claims: ['index.html'] }, ['/']), '/');
  assert.equal(areaOf({ claims: [], files: ['css/x.css'] }, ['css']), 'css');
});

test('project tree: request -> areas -> intents, rolled up, needs + blocked first', () => {
  const T = projectTree({ ...info, autoLand: false }, view([
    ch('a', 'landed', ['js/features/trips.js']), ch('b', 'working', ['js/features/photos.js']), ch('c', 'bounced', ['css/app.css']),
    ch('d', 'pushed', ['css/dark.css'], { review: { verdict: 'approved' }, createdAt: 9500 }),
  ]));
  const root = answer(T, q(''));
  assert.equal(root.node.leaves, 4);
  assert.deepEqual(root.node.counts, { needs: 1, blocked: 1, working: 1, waiting: 0, failed: 0, done: 1 });
  assert.equal(root.node.status, 'needs');
  // The dark-theme request (one area: lifted, so its intent sits right under it) needs you, so it comes first.
  assert.deepEqual(root.children.map((c) => [c.label, c.status]), [['Add a dark theme', 'needs'], ['Build a travel app with photos', 'blocked']]);
  const dark = answer(T, q(`node=${root.children[0].id}`));
  assert.equal(dark.children[0].kind, 'intent');
  assert.equal(dark.children[0].waitingOn, 'ready for you to merge');
  assert.equal(root.children[0].id, 'r9000', 'requests are keyed by when they were asked');
  const both = answer(T, q(`node=p&open=${root.children[0].id},nope`));
  assert.equal(both.open[root.children[0].id].children.length, 1);
  assert.deepEqual(both.open.nope, { error: 'no such node' });
  const travel = answer(T, q(`node=${root.children[1].id}`));
  assert.deepEqual(travel.children.map((c) => [c.kind, c.label, c.status]), [['area', 'css', 'blocked'], ['area', 'js/features', 'working']]);
  const feat = answer(T, q(`node=${travel.children[1].id}`));
  assert.deepEqual(feat.children.map((c) => c.status), ['working', 'done']);
  assert.equal(feat.node.endedAt, null, 'a group with open work has not ended');
  assert.ok(feat.children[1].detail.commits !== undefined && feat.children[1].detail.intent === 'Do a', 'the intent text without the Asked: tail');
});

test('why: the path from the request down to a change; find: by words', () => {
  const T = projectTree(info, view([ch('a', 'working', ['js/features/photos.js'], { title: 'Photo upload for the journal' }), ch('b', 'landed', ['css/x.css'])]));
  const w = answer(T, q('why=c:eyal.p--a'));
  assert.deepEqual(w.path.map((n) => n.kind), ['project', 'request', 'area', 'intent']);
  assert.equal(w.path[1].label, 'Build a travel app with photos');
  const f = answer(T, q('find=photo upload'));
  assert.equal(f.nodes[0].id, 'c:eyal.p--a');
  assert.equal(f.nodes[0].path.at(-1).id, 'c:eyal.p--a');
  assert.deepEqual(answer(T, q('why=nope')), { error: 'no such node' });
});

test('a change with no request goes to its own group; a request with no changes yet is being split', () => {
  const T = projectTree({ ...info, requests: [{ text: 'Later request', at: 50_000 }] }, view([ch('a', 'landed', ['x.js'])]));
  const root = answer(T, q(''));
  assert.deepEqual(root.children.map((c) => [c.label, c.status]).sort(), [['Changes with no recorded request', 'done'], ['Later request', 'working']]);
  assert.equal(root.children.find((c) => c.label === 'Later request').waitingOn, 'the router agent to split it into tasks');
});

test('fleet tree: folders by path, chains collapsed, the job is the root folder, statuses and $ rolled up', () => {
  const nd = [
    { file: 'src/vs/base/common/a.ts', status: 'landed', comments: 3, usd: 0.001, at: 10, ms: 5, landed_at: 40 },
    { file: 'src/vs/base/common/b.ts', status: 'skipped', usd: 0, at: 11, ms: 1 },
    { file: 'src/vs/editor/x/y/z.ts', status: 'verify_fail', reason: 'code changed', usd: 0.002, at: 12, ms: 9 },
    { file: 'src/vs/editor/x/y/z.ts', status: 'landed', comments: 1, usd: 0.002, at: 30, ms: 9, landed_at: 50 },   // retried: the last row wins
    { file: 'src/vs/editor/w.ts', status: 'ready', usd: 0.003, at: 20, ms: 4 },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';
  const recs = parseRecords(nd);
  assert.equal(recs.length, 4);
  const T = fleetTree(recs, { label: 'Document src/vs', pending: 10 });
  const root = answer(T, q(''));
  assert.equal(root.node.pending, 10);
  assert.equal(root.node.counts.waiting, 11);
  assert.equal(root.node.leaves, 14, 'files not started count in the total');
  assert.deepEqual(root.children.map((c) => [c.id, c.label]), [['src/vs/editor', 'editor'], ['src/vs/base/common', 'base/common']]);
  assert.ok(Math.abs(root.node.usd - 0.006) < 1e-9);
  const ed = answer(T, q('node=src/vs/editor'));
  assert.deepEqual(ed.children.map((c) => [c.label, c.status]), [['w.ts', 'waiting'], ['x/y', 'done']]);
  assert.deepEqual(answer(T, q('why=src/vs/editor/x/y/z.ts')).path.map((n) => n.label), ['Document src/vs', 'editor', 'x/y', 'z.ts']);
});

test('10k leaves: built fast, paged 50 at a time, blocked files first', () => {
  const recs = [];
  for (let i = 0; i < 10_000; i++) recs.push({ file: `src/f${i % 40}/g${i % 3}/file${i}.ts`, status: i % 997 === 0 ? 'rejected' : i % 3 ? 'landed' : 'skipped', usd: 0.0005, at: i, ms: 3, comments: 2 });
  const t0 = performance.now();
  const T = fleetTree(recs, { label: 'big' });
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `built in ${ms.toFixed(0)} ms`);
  const root = answer(T, q(''));
  assert.equal(root.node.leaves, 10_000);
  assert.equal(root.total, 40);
  assert.equal(root.children.length, 40);
  const withFail = root.children.find((c) => c.counts.failed > 0);
  assert.equal(withFail.status, 'done', 'a folder with nothing open is done, failures counted');
  const f = root.children.find((c) => c.id === 'src/f0');
  const g = answer(T, q(`node=${f.id}`));
  const leaf = answer(T, q(`node=${g.children[0].id}&limit=50`));
  assert.equal(leaf.children.length, 50);
  assert.ok(leaf.total > 80 && leaf.total < 90, String(leaf.total));
  const p2 = answer(T, q(`node=${g.children[0].id}&offset=50&limit=50`));
  assert.equal(p2.offset, 50);
  assert.notEqual(p2.children[0]?.id, leaf.children[0].id);
});

test('a build that settled, then a change hours later: groups keep the build\'s time, the later change is named apart', () => {
  const v = { ...view([ch('a', 'landed', ['js/features/a.js'], { createdAt: 2000, landedAt: 5000 }), ch('b', 'landed', ['js/features/b.js'], { createdAt: 3000, landedAt: 6000 }),
    ch('c', 'landed', ['js/features/c.js'], { createdAt: 4000, landedAt: 8 * 3600_000 })]), build: { startedAt: 1500, settledAt: 6500 } };
  const T = projectTree({ ...info, requests: [{ text: 'Build a travel app with photos', at: 1000 }] }, v);
  const root = answer(T, q(''));
  assert.equal(root.node.startedAt, 1500);
  assert.equal(root.node.endedAt, 6500, 'the project = the build, as the project page says');
  assert.deepEqual(root.node.later, { n: 1, at: 8 * 3600_000, items: [{ after: 8 * 3600_000 - 6500, back: false }] });
  assert.equal(root.children[0].endedAt, 6000);
  assert.equal(root.children[0].later.n, 1);
  // No build record: unchanged.
  assert.equal(answer(projectTree(info, view([ch('a', 'landed', ['x.js'], { landedAt: 5000 })])), q('')).node.later, undefined);
});
