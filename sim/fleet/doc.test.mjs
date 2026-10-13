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
