import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePush, whoPushed, repoTarget, repoEventTarget, eligibleSlug, handleArtifactsBatch } from './events.ts';

const push = (repo, committer, after = 'b'.repeat(40)) => ({ type: 'cf.artifacts.repo.pushed', source: { type: 'artifacts.repo', namespace: 'forq', repoName: repo },
  payload: { ref: 'refs/heads/main', before: 'a'.repeat(40), after, commits: [{ id: after, message: 'Fix the menu\n\nbody', committer, author: committer }], totalCommitsCount: 1 },
  metadata: { eventTimestamp: '2026-10-12T22:00:00.000Z' } });

test('events: who pushed, from the committer', () => {
  assert.equal(whoPushed({ name: 'forq agent eyal.x--ab12c', email: 'agent+eyal.x--ab12c@qodebase.app' }).kind, 'agent');
  assert.equal(whoPushed({ name: 'qodebase lander', email: 'lander@qodebase.app' }).kind, 'lander');
  assert.equal(whoPushed({ name: 'qodebase sim', email: 'sim@qodebase.app' }).kind, 'platform');
  assert.deepEqual(whoPushed({ name: 'Eyal Levin', email: 'e@x.org' }), { kind: 'person', name: 'Eyal Levin', email: 'e@x.org' });
});

test('events: a push event parsed; repo -> project + change', () => {
  const p = parsePush(push('eyal.cafe-lab', { name: 'Eyal Levin', email: 'e@x.org' }));
  assert.equal(p.repo, 'eyal.cafe-lab'); assert.equal(p.message, 'Fix the menu'); assert.equal(p.n, 1); assert.equal(p.by.kind, 'person');
  assert.equal(p.at, Date.parse('2026-10-12T22:00:00.000Z'));
  assert.equal(parsePush({ type: 'cf.artifacts.repo.cloned' }), null);
  assert.deepEqual(repoTarget('eyal.cafe--ab12c'), { slug: 'eyal.cafe', change: 'eyal.cafe--ab12c' });
  assert.deepEqual(repoTarget('eyal.cafe'), { slug: 'eyal.cafe', change: null });
  assert.equal(eligibleSlug('eyal.lab-x1'), false); assert.equal(eligibleSlug('eyal.cafe-team'), true); assert.equal(eligibleSlug('r123-main'), false);
});

test('events: account-level repo events keep only a project\'s own lifecycle in namespace forq', () => {
  const ev = (type, repoName, payload = {}, namespace = 'forq') => ({ type: `cf.artifacts.repo.${type}`, source: { type: 'artifacts', namespace, repoName }, payload, metadata: { eventTimestamp: '2026-10-12T22:00:00.000Z' } });
  assert.equal(repoEventTarget(ev('forked', 'eyal.cafe', { repoName: 'eyal.cafe--ab12c' })), null, 'an agent fork');
  assert.equal(repoEventTarget(ev('forked', 'r1x-main', { repoName: 'r1x-a5' }, 'qbsim')), null, 'the sim');
  assert.equal(repoEventTarget(ev('created', 'eyal.cafe')), null, 'created: every Build makes one');
  assert.deepEqual(repoEventTarget(ev('forked', 'eyal.cafe', { repoName: 'dana.cafe' })).text, 'forked as dana/cafe');
  assert.equal(repoEventTarget(ev('imported', 'eyal.tetris', { sourceUrl: 'https://github.com/a/tetris.git', repoId: 'x' })).text, 'imported from github.com/a/tetris');
  assert.equal(repoEventTarget(ev('deleted', 'eyal.lab-q2')), null, 'lab projects never');
});

test('events: the batch consumer routes pushes and repo events to Landing, acks everything, retries a failure', async () => {
  const calls = [];
  const landing = (name) => ({
    gitPushed: async (e) => { calls.push(['push', name, e.change, e.by.kind]); if (name === 'eyal.boom') throw new Error('down'); return 'ok'; },
    repoEvent: async (e) => { calls.push(['repo', name, e.kind]); return 'noted'; },
  });
  const env = { Landing: { idFromName: (n) => n, get: (n) => landing(n) } };
  const acked = [], retried = [];
  const msg = (body, attempts = 1) => ({ body, attempts, ack: () => acked.push(body), retry: () => retried.push(body) });
  const ms = [msg(push('eyal.cafe-lab', { name: 'Eyal', email: 'e@x.org' })), msg(push('eyal.boom', { name: 'Eyal', email: 'e@x.org' })),
    msg({ type: 'cf.artifacts.repo.forked', source: { type: 'artifacts', namespace: 'forq', repoName: 'eyal.cafe' }, payload: { repoName: 'dana.cafe' } }), msg({ type: 'cf.r2.bucket.created' })];
  await handleArtifactsBatch({ messages: ms }, env);
  assert.deepEqual(calls, [['push', 'eyal.cafe-lab', null, 'person'], ['push', 'eyal.boom', null, 'person'], ['repo', 'eyal.cafe', 'forked']]);
  assert.equal(acked.length, 3); assert.equal(retried.length, 1, 'a failed push is retried');
});

test('events: a notes push or a push without commits is not a person\'s push', () => {
  const notes = { type: 'cf.artifacts.repo.pushed', source: { namespace: 'forq', repoName: 'eyal.x' }, payload: { ref: 'refs/notes/qodebase', after: 'a'.repeat(40), commits: [], totalCommitsCount: 0 } };
  assert.equal(parsePush(notes), null);
  assert.equal(parsePush({ ...notes, payload: { ...notes.payload, ref: 'refs/heads/main' } }), null, 'no commits');
});
