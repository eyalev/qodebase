import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { testServer } from './helpers.js';

const t = await testServer();
after(() => t.stop());

test('members sign up and log in; /api/me needs the token', async () => {
  const s = await t.call('POST', '/api/members', { name: 'Ana', email: 'ana@test.club', password: 'password-1' });
  assert.equal(s.status, 201); assert.equal(s.data.balance, 0);
  assert.equal((await t.call('POST', '/api/members', { name: 'Ana', email: 'ana@test.club', password: 'password-1' })).status, 409);
  assert.equal((await t.call('POST', '/api/login', { email: 'ana@test.club', password: 'nope-nope' })).status, 401);
  const l = await t.call('POST', '/api/login', { email: 'ana@test.club', password: 'password-1' });
  assert.equal((await t.call('GET', '/api/me', undefined, l.data.token)).data.name, 'Ana');
  assert.equal((await t.call('GET', '/api/me')).status, 401);
});

test('four courts and 14 hourly slots a day, free on an empty club', async () => {
  assert.equal((await t.call('GET', '/api/courts')).data.length, 4);
  const day = (await t.call('GET', '/api/availability?date=2030-01-08')).data;
  assert.equal(day.length, 56);
  assert.ok(day.every((s) => s.status === 'free'));
  assert.equal(day.find((s) => s.time === '10:00').price, 12);
  assert.equal(day.find((s) => s.time === '18:00').price, 20);
});
