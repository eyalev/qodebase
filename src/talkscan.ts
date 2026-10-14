// The page reader for Talk: what the person can see and use, as the decision
// model's choices. Shipped inside /talk.js and evaluated as-is by
// scripts/talk-eval.mjs to snapshot real pages, so both read pages the same way.
// Each element gets data-talk="<id>" so the command can find it again.
//
// Voice coverage (2026-10-13): in-page routes (#/… links on Runs and Agents at work), <summary> toggles,
// role=tab|switch|button elements, names given by aria-labelledby, sliders and selects named by their label
// (with the value and choices), only what is on screen or one tap away (a closed <details>, or a [hidden]
// panel that a visible button controls), and buttons that share a label (every run card's "Pause") carry the
// name of their card. Pages can add actions an element cannot express (a tap at a point on a timeline):
// window.__talkActions = [{ id, text, run(words) }] become buttons named by their text.
export const SCAN_JS = String.raw`function talkScan(root) {
  root = root || document;
  var out = [], seen = {}, n = { l: 0, b: 0, f: 0, h: 0 };
  // New ids start after every id already on the page (a page that redrew part of itself keeps the rest).
  root.querySelectorAll('[data-talk]').forEach(function (e) { var id = e.getAttribute('data-talk') || '', k = id.charAt(0); if (n[k] != null) n[k] = Math.max(n[k], Number(id.slice(1)) || 0); });
  var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
  var lines = function (el) {
    // A closed panel has no layout, so innerText runs its parts together ("FastestOne strong agent"): take its children's words apart.
    var raw = el.getClientRects().length ? String(el.innerText || el.textContent || '') : [].map.call(el.childNodes, function (c) { return c.textContent; }).join('\n');
    // One line made of parts that touch ("Landed" + "14"): keep a space between them.
    if (raw.indexOf('\n') < 0 && el.children.length) { var parts = []; (function walk(n) { [].forEach.call(n.childNodes, function (x) { if (x.nodeType === 3) parts.push(x.textContent); else if (x.nodeType === 1 && x.tagName !== 'SVG' && x.tagName !== 'svg') walk(x); }); })(el); raw = parts.join(' '); }
    var t = raw.split('\n').map(clean).filter(Boolean); return t.length > 1 ? t[0] + ' (' + t.slice(1).join(', ') + ')' : (t[0] || '');
  };
  var skip = function (el) { return el.closest('#talk-root') || el.closest('.talk-cmic') || el.closest('[aria-hidden="true"]'); };
  // On screen, or one tap away: inside a closed <details> (its summary opens it), or a [hidden] panel that a
  // visible button names with aria-controls (Build's settings sheet). Anything else that is not rendered is skipped.
  var shown = function (el) {
    if (el.getClientRects().length) return true;
    var h = el.closest('[hidden]');
    if (h && h.id && root.querySelector('[aria-controls="' + h.id + '"]')) return true;
    var d = el.closest('details:not([open])');
    return !!(d && !h && el.closest('summary') !== el);
  };
  var named = function (el) {
    var by = el.getAttribute('aria-labelledby');
    if (by) { var t = by.split(/\s+/).map(function (i) { var x = document.getElementById(i); return x ? lines(x) : ''; }).join(' '); if (clean(t)) return t; }
    return el.getAttribute('aria-label') || el.title || '';
  };
  var labelOf = function (f) {
    var lab = (f.id && root.querySelector('label[for="' + f.id + '"]')) || f.closest('label');
    if (!lab) return '';
    // The label's own words, without the control's (a wrapping label holds the slider and its value too).
    var c = lab.cloneNode(true); [].forEach.call(c.querySelectorAll('input, select, textarea, output, button'), function (x) { x.remove(); });
    var parts = []; (function walk(n) { [].forEach.call(n.childNodes, function (x) { if (x.nodeType === 3) parts.push(x.textContent); else if (x.nodeType === 1) walk(x); }); })(c);
    return clean(parts.join(' '));
  };
  var add = function (el, kind, text, extra) {
    text = clean(text).slice(0, kind === 'link' ? 120 : 90);
    if (!text) return;
    var p = kind === 'link' ? 'l' : kind === 'button' ? 'b' : kind === 'field' ? 'f' : 'h';
    var id = el.getAttribute('data-talk') || (p + (++n[p]));
    if (!el.getAttribute('data-talk')) el.setAttribute('data-talk', id);
    var item = { id: id, kind: kind, text: text };
    for (var k in extra || {}) item[k] = extra[k];
    out.push(item);
    return item;
  };
  root.querySelectorAll('h1, h2, h3').forEach(function (h) { if (!skip(h) && shown(h) && out.filter(function (i) { return i.kind === 'heading'; }).length < 20) add(h, 'heading', h.textContent); });
  var links = 0;
  root.querySelectorAll('a[href]').forEach(function (a) {
    if (skip(a) || links >= 60 || !shown(a)) return;
    var href = a.getAttribute('href');
    // In-page routes (#/run/…, #/timeline) are places; plain #anchors are not.
    if (!href || (href.charAt(0) === '#' && href.charAt(1) !== '/') || /^(javascript|mailto):/.test(href)) return;
    // Menu links carry a second line ("Account" / "eyal: your name…"): first line names it.
    var text = named(a) || lines(a);
    var key = href + '|' + clean(text).toLowerCase();
    // The same place linked again (a change record from its feed events and from its title): one item, named by the
    // shortest text, which is the thing's own title ('Dark mode: theme toggle…', not 'Collision, replayed. Agent 10…').
    if (seen[href] && seen[href] !== 1) { var t2 = clean(text); if (t2.length >= 6 && t2.length < seen[href].text.length) seen[href].text = t2.slice(0, 120); return; }
    if (seen[href] || seen[key]) return;
    seen[key] = 1; links++;
    if (href === '/' && !/home/i.test(text)) text = clean(text) + ' (home page)';
    seen[href] = add(a, 'link', text, { href: href }) || 1;
  });
  var buttons = 0, btns = [];
  root.querySelectorAll('button, summary, [role=button], [role=tab], [role=switch], input[type=checkbox]').forEach(function (b) {
    if (skip(b) || b.disabled || b.type === 'hidden' || buttons >= 48 || !shown(b)) return;
    if (b.tagName !== 'BUTTON' && b.tagName !== 'SUMMARY' && b.tagName !== 'INPUT' && b.closest('button, a')) return;
    var t = named(b) || (b.tagName === 'INPUT' ? labelOf(b) : '') || lines(b);
    if (/^(close|×|✕)$/i.test(clean(t))) return;
    var sw = b.getAttribute('role') === 'switch' || b.type === 'checkbox';
    if (sw) t = clean(t) + ' (switch, now ' + ((b.getAttribute('aria-checked') === 'true' || b.checked) ? 'on' : 'off') + ')';
    else if (b.getAttribute('role') === 'tab' && b.getAttribute('aria-selected') === 'true') t = clean(t) + ' (tab, showing)';
    else if (b.tagName === 'SUMMARY') t = clean(t) + (b.parentNode && b.parentNode.open ? ' (open)' : ' (opens more)');
    buttons++;
    var it = add(b, 'button', t);
    if (it) btns.push({ el: b, it: it });
  });
  // Buttons that share a label ("Pause" on every run card) carry their card's name, so a sentence can pick one.
  var count = {};
  btns.forEach(function (x) { count[x.it.text] = (count[x.it.text] || 0) + 1; });
  btns.forEach(function (x) {
    if (count[x.it.text] < 2) return;
    var card = x.el.closest('[data-talk-ctx], article, li, section, .card, .rc'), name = '';
    if (card) { var h = card.getAttribute('data-talk-ctx') || ((card.querySelector('h1, h2, h3, h4, .rc-name, b, strong') || {}).textContent) || lines(card); name = clean(h).slice(0, 50); }
    if (name && name.toLowerCase() !== x.it.text.toLowerCase()) { x.bare = x.it.text; x.it.text = x.it.text + ' (' + name + ')'; }
  });
  // A card name that does not tell them apart either (two "Build it" under one heading) is only noise: drop it.
  var after = {};
  btns.forEach(function (x) { after[x.it.text] = (after[x.it.text] || 0) + 1; });
  btns.forEach(function (x) { if (x.bare && after[x.it.text] > 1) x.it.text = x.bare; });
  root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]), textarea, select, [contenteditable=true]').forEach(function (f) {
    if (skip(f) || f.disabled || !shown(f)) return;
    var name = f.getAttribute('placeholder') || named(f) || labelOf(f) || f.name || 'text field';
    if (f.type === 'range') name = clean(labelOf(f) || named(f) || f.name || 'slider') + ' (slider, now ' + f.value + ', ' + f.min + ' to ' + f.max + ')';
    else if (f.tagName === 'SELECT') name = clean(name) + ' (choice, now ' + clean((f.selectedOptions[0] || {}).textContent) + '; ' + [].slice.call(f.options, 0, 8).map(function (o) { return clean(o.textContent); }).join(', ') + ')';
    else if (f.type === 'password') name = clean(name) + ' (secret)';
    add(f, 'field', name);
  });
  // Actions the page names itself (no element to tap): a moment on a timeline, the next slide.
  (window.__talkActions || []).forEach(function (a, i) {
    if (!a || !a.text || typeof a.run !== 'function') return;
    var id = 'x' + (a.id || i);
    out.push({ id: id, kind: 'button', text: clean(a.text).slice(0, 120) });
  });
  return out;
}`;
