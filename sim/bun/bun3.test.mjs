// node --test sim/bun/bun3.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHunks, run } from './bun3.mjs';

const H = (os, ol, ns, nl, lines) => ({ os, ol, ns, nl, lines });
test('a hunk applies at its line, at an offset when lines moved, and fails when its old lines are gone', () => {
  const f = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(applyHunks(f, [H(2, 2, 2, 2, [' b', '-c', '+C', ' d'])]).lines, ['a', 'b', 'C', 'd', 'e']);
  assert.deepEqual(applyHunks(['x', 'y', ...f], [H(2, 3, 2, 3, [' b', '-c', '+C', ' d'])]).lines, ['x', 'y', 'a', 'b', 'C', 'd', 'e']);
  const r = applyHunks(['a', 'B', 'c'], [H(2, 3, 2, 3, [' b', '-c', '+C'])]);
  assert.equal(r.ok, false); assert.equal(r.lost, 1);
  assert.deepEqual(applyHunks([], [H(0, 0, 1, 2, ['+n1', '+n2'])]).lines, ['n1', 'n2']);
});

// three commits on one file in history order, plus one on another file
const data = { seg: 'tail', files: { 'src/a/x.rs': 'l1\nl2\nl3\nl4', 'src/b/y.rs': 'y1' }, final: { 'src/a/x.rs': 'L1\nl2\nl3\nL4', 'src/b/y.rs': 'Y1' },
  tasks: [
    { sha: 's1', phase: 'tail', crates: ['a'], diffs: [{ path: 'src/a/x.rs', hunks: [H(1, 2, 1, 2, ['-l1', '+L1', ' l2'])] }] },
    { sha: 's2', phase: 'tail', crates: ['a'], diffs: [{ path: 'src/a/x.rs', hunks: [H(3, 2, 3, 2, [' l3', '-l4', '+L4'])] }] },
    { sha: 's3', phase: 'tail', crates: ['b'], diffs: [{ path: 'src/b/y.rs', hunks: [H(1, 1, 1, 1, ['-y1', '+Y1'])] }] },
  ] };
test('history order ends on history\'s files; more agents finish sooner with the same files', () => {
  const v = run(data, { validate: true, method: 'bun' });
  assert.equal(v.landed, 3); assert.equal(v.conflicts, 0); assert.equal(v.filesDiffer, 0);
  const p = run(data, { method: 'bun', agents: 3 });
  assert.equal(p.filesDiffer, 0); assert.ok(p.hours < v.hours);
  const c = run(data, { method: 'check', agents: 3, checkS: 60 });
  assert.ok(c.checkShare > 0 && c.hours > p.hours);
});

import { applyDiff } from './bun3.mjs';
test('new files keep their trailing newline, deletions become null, no-newline markers are honoured', () => {
  assert.deepEqual(applyDiff(null, { hunks: [H(0, 0, 1, 2, ['+a', '+b'])] }).lines, ['a', 'b', '']);
  assert.deepEqual(applyDiff(null, { hunks: [H(0, 0, 1, 1, ['+a', '\\ No newline at end of file'])] }).lines, ['a']);
  assert.equal(applyDiff(['a', 'b', ''], { hunks: [H(1, 2, 0, 0, ['-a', '-b'])] }).lines, null);
  assert.deepEqual(applyDiff(['a', 'b'], { hunks: [H(2, 1, 2, 1, ['-b', '\\ No newline at end of file', '+b'])] }).lines, ['a', 'b', '']);
  assert.deepEqual(applyDiff(['a', 'b', ''], { hunks: [H(2, 1, 2, 1, ['-b', '+c', '\\ No newline at end of file'])] }).lines, ['a', 'c']);
});

test('a commit that edits code an earlier commit writes waits for it, is redone, and the tree still ends on history', () => {
  const d2 = { seg: 'tail', files: { 'src/a/x.rs': 'a\n' }, final: { 'src/a/x.rs': 'a\nB\n' }, tasks: [
    { sha: 'p1', phase: 'tail', crates: ['a'], diffs: [{ path: 'src/a/x.rs', hunks: [H(1, 1, 1, 2, [' a', '+b'])] }] },
    { sha: 'p2', phase: 'tail', crates: ['a'], diffs: [{ path: 'src/a/x.rs', hunks: [H(2, 1, 2, 1, ['-b', '+B'])] }] },
  ] };
  let sawConflict = false;
  for (let seed = 1; seed <= 30; seed++) {
    const r = run(d2, { method: 'bun', agents: 2, seed, touchesPerRange: 1, order: 'none' });
    assert.equal(r.filesDiffer, 0, `seed ${seed}`); assert.equal(r.landed, 2); assert.equal(r.lostHunks, 0);
    if (r.conflicts) sawConflict = true;
  }
  assert.ok(sawConflict, 'some seed lands p2 first');
});

import { blameDeps } from './bun3.mjs';
test('blame dependencies: p2 edits the line p1 wrote, so with content order p2 never lands first', () => {
  const d3 = { seg: 'tail', files: { 'src/a/x.rs': 'a\n' }, final: { 'src/a/x.rs': 'a\nB\n' }, tasks: [
    { sha: 'p1', phase: 'tail', crates: ['a'], diffs: [{ path: 'src/a/x.rs', hunks: [H(1, 1, 1, 2, [' a', '+b'])] }] },
    { sha: 'p2', phase: 'tail', crates: ['a'], diffs: [{ path: 'src/a/x.rs', hunks: [H(2, 1, 2, 1, ['-b', '+B'])] }] },
  ] };
  assert.deepEqual(blameDeps(d3), [[], [0]]);
  for (let seed = 1; seed <= 30; seed++) { const r = run(d3, { method: 'bun', agents: 2, seed, touchesPerRange: 1 }); assert.equal(r.conflicts, 0); assert.equal(r.filesDiffer, 0); }
});
