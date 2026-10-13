// node --test sim/fleet/merge.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertionsOf, merge3, landOne } from './src/merge.js';
import { insert, targets } from './src/doc.js';

const base = ['export function a() {', '  return 1;', '}', 'export function b() { return 2; }', 'export function c() { return 3; }', ''].join('\n');
const doc = (text, c) => insert(text, targets('x.ts', text).filter((t) => c[t.name]), c).text;

test('insertions of a comment change', () => {
  const t = doc(base, { b: 'Returns two, always.' });
  assert.deepEqual(insertionsOf(base, t), [{ at: 3, lines: ['/**', ' * Returns two, always.', ' */'] }]);
  assert.equal(insertionsOf(base, base.replace('return 1', 'return 9')), null);
});

test('far and neighbouring functions merge; the same function conflicts unless identical', () => {
  const A = doc(base, { a: 'Returns one, always.' }), C = doc(base, { c: 'Returns three, always.' }), B = doc(base, { b: 'Returns two, always.' });
  const m = merge3(base, A, C); assert.ok(m.text.includes('Returns one') && m.text.includes('Returns three'));
  const n = merge3(base, B, C); assert.ok(n.text.includes('Returns two') && n.text.includes('Returns three'));   // b and c are adjacent lines
  assert.equal(merge3(base, B, doc(base, { b: 'Gives back the number two.' })).conflict, 3);
  assert.equal(merge3(base, B, B).identical, 1);
});

test('landOne: clean, merged, duplicate kept first, replay', () => {
  const B1 = doc(base, { b: 'Returns two, always.' }), B2 = doc(base, { b: 'Gives back the number two.' }), C = doc(base, { c: 'Returns three, always.' });
  assert.equal(landOne('x.ts', base, base, B1, ['b'], {}).how, 'clean');
  const m = landOne('x.ts', B1, base, C, ['c'], { c: 'Returns three, always.' }); assert.equal(m.how, 'merged');
  const d = landOne('x.ts', B1, base, B2, ['b'], { b: 'Gives back the number two.' }); assert.equal(d.how, 'duplicate'); assert.equal(d.text, B1);
  assert.equal((d.text.match(/\/\*\*/g) || []).length, 1);
  // A base that is not the current text's ancestor by insertion (someone rewrote a line): replay by intent.
  const moved = base.replace('export function c() { return 3; }', 'export function c() { return 3 }');
  const r = landOne('x.ts', moved, base, C, ['c'], { c: 'Returns three, always.' }); assert.equal(r.how, 'replayed'); assert.ok(r.text.includes('Returns three'));
});
