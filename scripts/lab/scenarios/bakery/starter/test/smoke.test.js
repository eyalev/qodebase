import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('the server entry point exists', () => {
  assert.match(readFileSync(new URL('../server.js', import.meta.url), 'utf8'), /createServer|listen/);
});
