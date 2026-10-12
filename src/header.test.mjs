// The site header (src/header.ts). node --experimental-strip-types --test src/header.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteHeader } from './header.ts';

const ctx = { owner: 'eyal', name: 'corner-cafe', href: '/p/eyal/corner-cafe' };
const hrefOf = (html, cls) => (new RegExp(`class="${cls}[^"]*" href="([^"]*)"`).exec(html) || [])[1];

test('owner / name links to the project page (a stray quote made it reload the page)', () => {
  const h = siteHeader({ active: 'explore', inbox: 0, me: '', ctx });
  assert.equal(hrefOf(h, 'hctx'), '/p/eyal/corner-cafe');
  assert.doesNotMatch(h, /href=""/);
});

test('long names get hlong; a private project shows the lock', () => {
  const h = siteHeader({ active: 'mine', inbox: 0, me: 'eyal', ctx: { ...ctx, name: 'a-really-long-project-name', private: true } });
  assert.match(h, /class="hctx hlong"/);
  assert.equal(hrefOf(h, 'hctx hlong'), '/p/eyal/corner-cafe');
  assert.match(h, /class="hp"/);
});

test('signed in: a bell with the Inbox count opens Inbox; the avatar is a clean initial', () => {
  const h = siteHeader({ active: 'explore', inbox: 3, me: 'eyal' });
  assert.equal(hrefOf(h, 'hbell on'), '/inbox');
  assert.match(h, /class="hbadge">3</);
  assert.match(h, /<button type="button" class="hav"[^>]*>E<\/button>/);
});

test('signed out: Sign in and the menu button, no bell', () => {
  const h = siteHeader({ active: 'home', inbox: 0, me: '' });
  assert.match(h, /href="\/login">Sign in</);
  assert.match(h, /class="gmenu"/);
  assert.doesNotMatch(h, /class="hbell/);
});

test('every attribute value is closed (no empty href, no doubled quotes)', () => {
  for (const o of [{ active: 'explore', inbox: 0, me: '', ctx }, { active: 'build', inbox: 5, me: 'eyal', ctx }, { active: 'home', inbox: 0, me: '' }]) {
    const h = siteHeader(o);
    assert.doesNotMatch(h, /=""[^ >]/, 'an attribute was opened twice');
  }
});
