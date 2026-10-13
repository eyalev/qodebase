// /how is all hand-written strings: a stray quote breaks the whole Worker (b235d74 once did). Render it and check it parses.
// how.ts imports './ui' without an extension (fine for the bundler, not for node), so the test swaps that import for a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('/how renders, with its sections and links closed', async () => {
  const src = readFileSync(new URL('./how.ts', import.meta.url), 'utf8').replace("import { shell } from './ui';", 'const shell = (_t: string, body: string) => body;');
  const f = join(mkdtempSync(join(tmpdir(), 'how-')), 'how.ts'); writeFileSync(f, src);
  const h = String((await import(f)).howPage(false));
  for (const s of ['One agent or many?', 'Land by intent', 'What we measured', 'Different jobs need different ways to run agents', 'See for yourself']) assert.ok(h.includes(s), s);
  assert.equal((h.match(/<a /g) || []).length, (h.match(/<\/a>/g) || []).length, 'every link is closed');
  assert.doesNotMatch(h, /href=""/);
});
