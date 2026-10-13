// node --experimental-strip-types --test src/talkstt.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { sttText, wordsOnly } from './talkstt.ts';

test('the parsed Workers AI whisper result (webm clip)', async () => {
  const res = { text: " What's going on?", word_count: 3, transcription_info: { language: 'en', duration: 2.1 }, segments: [{ start: 0, end: 2.1, text: " What's going on?" }], vtt: 'WEBVTT' };
  assert.deepEqual(await sttText(res), { text: "What's going on?", shape: 'object' });
});
test('a raw Response from the binding (what happened 2026-10-13)', async () => {
  const res = new Response(JSON.stringify({ text: ' How many projects do I have?', transcription_info: { language: 'en' } }), { headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await sttText(res), { text: 'How many projects do I have?', shape: 'response' });
});
test('a REST-style envelope', async () => {
  assert.equal((await sttText({ result: { text: 'Hello.' }, success: true })).text, 'Hello.');
});
test('never a method, code or empty text', async () => {
  assert.equal((await sttText({ text: function text() {} })).text, '');
  assert.equal(wordsOnly('function text() { [native code] }'), '');
  assert.equal(wordsOnly('[object Response]'), '');
  assert.equal(wordsOnly('   '), '');
  assert.equal(wordsOnly('...'), '');
  assert.equal(wordsOnly("What's going on?"), "What's going on?");
  assert.equal(wordsOnly('מה קורה?'), 'מה קורה?');
});
