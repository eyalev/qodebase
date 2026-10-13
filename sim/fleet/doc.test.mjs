// The fleet's code step on real VS Code files: targets found, fake comments inserted, verify passes; a code change fails.
//   node --test sim/fleet/doc.test.mjs   (needs ~/projects/github/microsoft/vscode, sparse src/vs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { targets, insert, verify, parseAnswer, prompt } from './src/doc.js';

const ROOT = join(homedir(), 'projects/github/microsoft/vscode');
const files = [];
(function walk(d) { if (!existsSync(d)) return; for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'test') walk(p); } else if (f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts')) files.push(p); } })(join(ROOT, 'src/vs'));

test('every real file: fake comments inserted verify; the count of files and targets', { skip: !files.length }, () => {
  let withTargets = 0, nTargets = 0, fails = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8'), rel = f.slice(ROOT.length + 1);
    const t = targets(rel, text);
    if (!t.length) continue;
    withTargets++; nTargets += t.length;
    const { text: next, inserted } = insert(text, t, Object.fromEntries(t.map((x) => [x.name, `Does the ${x.name} thing for this module, used by callers that need it.`])));
    assert.equal(inserted, t.length, rel);
    const v = verify(rel, text, next);
    if (!v.ok) fails.push(`${rel}: ${v.why}`);
  }
  console.log(JSON.stringify({ files: files.length, withTargets, targets: nTargets, verifyFails: fails.length, firstFails: fails.slice(0, 5) }));
  assert.equal(fails.length, 0);
});

test('a real code change is caught', { skip: !files.length }, () => {
  const f = files.find((p) => targets(p, readFileSync(p, 'utf8')).length > 0);
  const text = readFileSync(f, 'utf8');
  assert.equal(verify(f, text, text.replace(/return /, 'return void ')).ok, false);
  assert.equal(verify(f, text, text.replace(/\bconst\b/, 'let')).ok, false);
  assert.equal(verify(f, text, text + '\n// a comment\n').ok, true);
});

test('model answers: JSON inside text, unknown names dropped; prompt names the targets', () => {
  const t = [{ name: 'foo', kind: 'function', line: 0, signature: 'export function foo()' }];
  assert.deepEqual(parseAnswer('Sure! {"foo": "Does foo.", "bar": "x"} done', t), { foo: 'Does foo.' });
  assert.deepEqual(parseAnswer('no json', t), {});
  assert.match(prompt('a.ts', 'export function foo() {}', t), /- foo \(function\)/);
});

test('packs: budget and count, a big file alone; pack answers parse per id', async () => {
  const { packFiles, parseAnswerPack, promptPack } = await import('./src/doc.js');
  const f = (id, n) => ({ id, path: `${id}.ts`, text: 'x'.repeat(n), tg: [{ name: 'a', kind: 'function', signature: 'function a()' }] });
  const p = packFiles([f('F1', 3500), f('F2', 3500), f('F3', 60000), f('F4', 100)], 8, 6000);
  assert.deepEqual(p.map((x) => x.map((y) => y.id)), [['F1', 'F2'], ['F3'], ['F4']]);
  assert.equal(packFiles([1, 2, 3, 4, 5].map((i) => f(`F${i}`, 10)), 2, 12000).length, 3);
  const files = [f('F1', 10), f('F2', 10)];
  const a = parseAnswerPack('ok {"F1": {"a": "Does a thing well."}, "F2": "bad", "F9": {"a": "x"}}', files);
  assert.deepEqual(a, { F1: { a: 'Does a thing well.' } });
  assert.match(promptPack(files), /=== F2: F2\.ts/);
});

test('a declaration that does not start its line is not a target', () => {
  const t = 'function f() {\n} export class A {}\nexport function b() {}\n';
  assert.deepEqual(targets('x.ts', t).map((x) => x.name), ['b']);
});
