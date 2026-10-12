// node --experimental-strip-types --test src/speechjoin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOIN_SPEECH } from './speechjoin.ts';
const joinSpeech = new Function(`${JOIN_SPEECH}; return joinSpeech;`)();
const R = (...ts) => ts.map((t) => [{ transcript: t }]);
// Replays a session: each event carries the results list as Chrome sends it; returns the box after each event.
const play = (events) => events.map((rs) => joinSpeech(R(...rs)));

test('Android continuous: cumulative entries never stack (the reported bug)', () => {
  const out = play([['I'], ['I', 'I want'], ['I', 'I want', 'I want to'], ['I', 'I want', 'I want to', 'I want to be'], ['I', 'I want', 'I want to', 'I want to be', 'I want to build a trip planner']]);
  assert.deepEqual(out, ['I', 'I want', 'I want to', 'I want to be', 'I want to build a trip planner']);
});
test('Android repeats a final', () => {
  assert.equal(joinSpeech(R('A webapp to help my family plan trips', 'A webapp to help my family plan trips')), 'A webapp to help my family plan trips');
});
test('Android: capitalisation changes between entries', () => {
  assert.equal(joinSpeech(R('a webapp', 'A webapp to help')), 'A webapp to help');
});
test('Desktop continuous: separate finals join with one space', () => {
  assert.equal(joinSpeech(R('I want to build', ' a shopping list', ' for my family')), 'I want to build a shopping list for my family');
});
test('Desktop: interim replaced in place (one entry that grows)', () => {
  assert.deepEqual(play([['I want'], ['I want to build'], ['I want to build', ' a list']]), ['I want', 'I want to build', 'I want to build a list']);
});
test('empty and missing alternatives', () => {
  assert.equal(joinSpeech([]), '');
  assert.equal(joinSpeech([[{ transcript: '' }], [{}], [{ transcript: 'hello' }]]), 'hello');
});
test('Android: a revised word mid-phrase replaces, not appends', () => {
  assert.equal(joinSpeech(R('I want to be', 'I want to build a trip planner')), 'I want to build a trip planner');
});
test('Android: a shorter repeat of the start keeps the longer text', () => {
  assert.equal(joinSpeech(R('I want to build a trip planner', 'I want to')), 'I want to build a trip planner');
});
