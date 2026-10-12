// Visual context (S1/S2): message composition, the attachment marker, ids. node --experimental-strip-types --test src/attach.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAttachId, isAttachId, composeMessage, parseMarker, attachedLines, attachKey } from './attach.ts';

test('ids: 12 chars + the type\'s extension; only images', () => {
  const id = newAttachId('image/png');
  assert.ok(isAttachId(id), id);
  assert.match(newAttachId('image/jpeg'), /\.jpg$/);
  assert.equal(newAttachId('text/html'), null);
  assert.equal(isAttachId('../../etc/passwd'), false);
  assert.equal(attachKey('eyal.app', id), `a/eyal.app/${id}`);
});

test('compose: picks as a short block, attachments as a marker; bad ids dropped; plain text unchanged', () => {
  assert.equal(composeMessage('make it blue', 'eyal.app', undefined, undefined).text, 'make it blue');
  const a = 'abcdefghijkl.png', b = 'mnopqrstuvwx.jpg';
  const m = composeMessage(' make this bigger ', 'eyal.app', [a, 'nope', b], [{ kind: 'pick', tag: 'button', selector: '#go', text: 'Go!', html: '<button id="go">Go!</button>', url: 'https://x.ttyview.dev/' }]);
  assert.match(m.text, /^make this bigger\n\nThe person pointed at this element in the running app:\n- button `#go`, text "Go!" on https:\/\/x\.ttyview\.dev\/\n   <button id="go">Go!<\/button>\n\n\[\[qb-attach slug=eyal\.app ids=abcdefghijkl\.png,mnopqrstuvwx\.jpg\]\]$/);
  assert.deepEqual(m.ids, [a, b]);
  const p = parseMarker(m.text);
  assert.deepEqual([p.slug, p.ids], ['eyal.app', [a, b]]);
  assert.ok(!p.rest.includes('qb-attach'));
  assert.equal(parseMarker('no marker here'), null);
});

test('the box sees file paths instead of the marker', () => {
  const t = attachedLines('do it', ['abcdefghijkl.png'], ['mnopqrstuvwx.jpg']);
  assert.match(t, /do it\n\nAttached image from the person \(open it with your Read tool[^\n]*\n- \/workspace\/attachments\/abcdefghijkl\.png\n\n\(1 attached image could not be copied/);
  assert.equal(attachedLines('x', [], []), 'x');
});
