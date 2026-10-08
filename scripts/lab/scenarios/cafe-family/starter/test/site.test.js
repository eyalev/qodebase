import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routes } from '../src/routes.js';
import { site } from '../src/site.js';
import { price } from '../src/lib/format.js';

test('every page renders a heading', () => {
  for (const r of routes) assert.match(r.page(site), /<h1>/, r.path);
});
test('every page has its own path', () => {
  assert.equal(new Set(routes.map((r) => r.path)).size, routes.length);
});
test('prices show euros and cents', () => {
  assert.equal(price(1.2), '€1.20');
  assert.equal(price(3), '€3');
});
