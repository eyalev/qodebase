import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from './timeline.ts';

const T = 1_000_000;
const ev = (t, what, detail) => ({ t: T + t, what, ...(detail ? { detail } : {}) });
const change = (id, agent, events, extra = {}) => ({ id, agent, title: `task ${id}`, intent: '', kind: 'agent', fork: '', remote: '', base: null, commit: null, state: 'working',
  files: [], claims: [], needs: [], provides: [], stackedOn: null, events, review: null, landing: null, lead: null, createdAt: events[0].t, landedAt: null, tries: 0, ...extra });

test('timeline: spans per change, reviewer row, train + merger phases, landing mark, critical path', () => {
  const a = change('eyal.cafe--a1', 'eyal.cafe--a1', [ev(0, 'asked'), ev(1, 'working'), ev(60_000, 'pushed'), ev(65_000, 'reviewing', 'by review2'), ev(90_000, 'approved'),
    ev(91_000, 'queued'), ev(100_000, 'testing', 'in a train of 1'), ev(130_000, 'landed', 'abc on main')], { state: 'landed' });
  const b = change('eyal.cafe--a2', 'eyal.cafe--a2', [ev(5_000, 'asked'), ev(20_000, 'pushed'), ev(21_000, 'reviewing'), ev(30_000, 'changes-suggested', 'fix it'), ev(31_000, 'working')]);
  const train = { id: 't1', state: 'landed', changes: [a.id], startedAt: T + 100_000, endedAt: T + 130_000, checks: null, mainBefore: 'x', mainAfter: 'y', outcomes: { [a.id]: 'landed' },
    phases: [['box-queue', T + 100_000, T + 100_500], ['wake-cold', T + 100_500, T + 110_000], ['fetch-main', T + 110_000, T + 112_000], ['apply', T + 112_000, T + 113_000, a.id], ['checks', T + 113_000, T + 125_000], ['push', T + 125_000, T + 129_000]], cold: true };
  const tl = buildTimeline({ slug: 'eyal.cafe', now: T + 200_000, changes: [a, b], trains: [train], request: { at: T - 30_000, sentAt: T - 20_000, text: 'build a café' }, kind: 'build' });

  const of = (lane) => tl.spans.filter((s) => s.lane === lane).map((s) => [s.phase, s.start - T, s.end - T]);
  assert.deepEqual(of('a:eyal.cafe--a1'), [['work', 0, 60_000], ['wait_review', 60_000, 65_000], ['review', 65_000, 90_000], ['wait_merge', 90_000, 91_000], ['wait_queue', 91_000, 100_000], ['train', 100_000, 130_000]]);
  assert.deepEqual(of('a:eyal.cafe--a2').at(-1), ['work', 30_000, 200_000], 'fixing after changes were suggested: open until now');
  assert.ok(tl.spans.find((s) => s.lane === 'a:eyal.cafe--a2' && s.phase === 'work' && s.start === T + 30_000).open);
  assert.deepEqual(of('r:review2'), [['review', 65_000, 90_000]]);
  assert.deepEqual(of('r:reviewer'), [['review', 21_000, 30_000]], 'no reviewer named: one shared row');
  assert.deepEqual(of('planner'), [['wake', -30_000, -20_000], ['plan', -20_000, 0]]);
  assert.deepEqual(of('merger').map((x) => x[0]), ['wait_box', 'wake', 'fetch', 'apply', 'checks', 'push']);
  assert.equal(tl.spans.find((s) => s.lane === 'merger' && s.phase === 'wake').detail, 'cold start');
  assert.deepEqual(tl.marks, [{ lane: 'main', at: T + 130_000, change: a.id, kind: 'landed', train: 't1' }]);
  assert.deepEqual(tl.lanes.map((l) => l.group), ['planner', 'agents', 'agents', 'reviewers', 'reviewers', 'queue', 'merger', 'main']);
  const crit = new Set(tl.critical);
  assert.ok(tl.spans.filter((s) => s.change === a.id && s.lane.startsWith('a:')).every((s) => crit.has(s.id)), 'the last landing\'s change is on the critical path');
  assert.ok(tl.spans.filter((s) => s.lane === 'merger').every((s) => crit.has(s.id)), 'and its train\'s merger phases');
  assert.ok(!tl.spans.filter((s) => s.change === b.id).some((s) => crit.has(s.id)));
  assert.equal(tl.totals['merger:checks'], 12_000);
  assert.equal(tl.run.open, true); assert.equal(tl.run.kind, 'build'); assert.equal(tl.run.start, T - 30_000);
});

test('timeline: since cuts older changes and trains', () => {
  const old = change('p.x--a1', 'p.x--a1', [ev(0, 'asked'), ev(10, 'landed')], { state: 'landed' });
  const nu = change('p.x--a2', 'p.x--a2', [ev(500_000, 'asked')]);
  const tl = buildTimeline({ slug: 'p.x', now: T + 600_000, since: T + 400_000, changes: [old, nu], trains: [], kind: 'demo' });
  assert.deepEqual([...new Set(tl.spans.map((s) => s.change))], ['p.x--a2']);
  assert.equal(tl.marks.length, 0);
});
