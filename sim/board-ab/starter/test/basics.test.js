import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shout, clamp, runCommand } from '../src/index.js';

test('shout', () => assert.equal(shout('hi'), 'HI!'));
test('clamp', () => assert.equal(clamp(12, 0, 10), 10));
test('shout command', () => assert.equal(runCommand('shout hey you'), 'HEY YOU!'));
test('unknown command', () => assert.equal(runCommand('nope x'), 'unknown command: nope'));
