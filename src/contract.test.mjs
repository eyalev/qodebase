// The contract view's pure parts (src/contractcore.ts): where the contract is, who made it, who edited it.
//   node --experimental-strip-types --test src/contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contractFromChanges, contractHistory, langOf, CONTRACT_RX } from './contractcore.ts';

const ch = (id, title, files, extra = {}) => ({ id: `eyal.p--${id}`, title, files, agent: `a-${id}`, state: 'landed', createdAt: extra.createdAt ?? 1000, landedAt: extra.landedAt ?? 2000, ...extra });

test('the skeleton change names the contract (its own record), before anything else', () => {
  const cs = [ch('f1', 'Rooms view', ['js/rooms.js', 'js/contracts.js'], { createdAt: 3000, landedAt: 4000 }), ch('s', 'Skeleton: the runnable app shell', ['index.html', 'js/contracts.js', 'js/shell.js'])];
  assert.deepEqual(contractFromChanges(cs), { path: 'js/contracts.js', via: 'skeleton' });
  const h = contractHistory(cs, 'js/contracts.js');
  assert.equal(h.created.title, 'Skeleton: the runnable app shell');
  assert.equal(h.created.skeleton, true);
  assert.deepEqual(h.edits.map((e) => [e.title, e.agent]), [['Rooms view', 'Agent 2']]);
});

test('no skeleton: any change that wrote a contracts file; none at all: null (the route then searches main)', () => {
  assert.deepEqual(contractFromChanges([ch('a', 'Add types', ['src/types/contract.ts', 'README.md'])]), { path: 'src/types/contract.ts', via: 'change' });
  assert.equal(contractFromChanges([ch('a', 'Dark mode', ['css/app.css'])]), null);
  assert.equal(contractFromChanges([]), null);
});

test('names: contracts.js beats a notes file; not any word with "contract" in a folder name only', () => {
  assert.ok(CONTRACT_RX.test('contracts.js') && CONTRACT_RX.test('src/api-contract.d.ts') && CONTRACT_RX.test('docs/CONTRACT.md'));
  assert.ok(!CONTRACT_RX.test('contracts/index.html') && !CONTRACT_RX.test('src/contractor.png'));
  assert.deepEqual(contractFromChanges([ch('s', 'Skeleton: shell', ['docs/contract-notes.md', 'contracts.js'])]).path, 'contracts.js');
  assert.equal(langOf('js/contracts.js'), 'js'); assert.equal(langOf('types/contract.d.ts'), 'ts'); assert.equal(langOf('contract.json'), 'json');
});

test('a real crew build (home-ledger): the skeleton wrote js/contracts.js', () => {
  const v = JSON.parse(readFileSync(new URL('../claude5/contract/home-ledger-view.json', import.meta.url), 'utf8'));
  const hit = contractFromChanges(v.changes);
  assert.deepEqual(hit, { path: 'js/contracts.js', via: 'skeleton' });
  const h = contractHistory(v.changes, hit.path);
  assert.equal(h.created.skeleton, true);
  console.log(JSON.stringify({ created: h.created.title, edits: h.edits.map((e) => `${e.agent}: ${e.title}`) }));
});
