// The page reader for Talk: what the person can see and use, as the decision
// model's choices. Shipped inside /talk.js and evaluated as-is by
// scripts/talk-eval.mjs to snapshot real pages, so both read pages the same way.
// Each element gets data-talk="<id>" so the command can find it again.
export const SCAN_JS = String.raw`function talkScan(root) {
  root = root || document;
  var out = [], seen = {}, n = { l: 0, b: 0, f: 0, h: 0 };
  var clean = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
  var lines = function (el) { var t = String(el.innerText || el.textContent || '').split('\n').map(clean).filter(Boolean); return t.length > 1 ? t[0] + ' (' + t.slice(1).join(', ') + ')' : (t[0] || ''); };
  var skip = function (el) { return el.closest('#talk-root') || el.closest('[aria-hidden="true"]'); };
  var add = function (el, kind, text, extra) {
    text = clean(text).slice(0, kind === 'link' ? 120 : 70);
    if (!text) return;
    var p = kind === 'link' ? 'l' : kind === 'button' ? 'b' : kind === 'field' ? 'f' : 'h';
    var id = el.getAttribute('data-talk') || (p + (++n[p]));
    if (!el.getAttribute('data-talk')) el.setAttribute('data-talk', id); else n[p] = Math.max(n[p], Number(id.slice(1)) || 0);
    var item = { id: id, kind: kind, text: text };
    for (var k in extra || {}) item[k] = extra[k];
    out.push(item);
  };
  root.querySelectorAll('h1, h2, h3').forEach(function (h) { if (!skip(h) && out.filter(function (i) { return i.kind === 'heading'; }).length < 20) add(h, 'heading', h.textContent); });
  var links = 0;
  root.querySelectorAll('a[href]').forEach(function (a) {
    if (skip(a) || links >= 60) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(javascript|mailto):/.test(href)) return;
    // Menu links carry a second line ("Account" / "eyal: your name…"): first line names it.
    var text = a.getAttribute('aria-label') || lines(a);
    var key = href + '|' + clean(text).toLowerCase();
    if (seen[href] || seen[key]) return;
    seen[href] = seen[key] = 1; links++;
    if (href === '/' && !/home/i.test(text)) text = clean(text) + ' (home page)';
    add(a, 'link', text, { href: href });
  });
  var buttons = 0;
  root.querySelectorAll('button').forEach(function (b) {
    if (skip(b) || b.disabled || b.type === 'hidden' || buttons >= 40) return;
    var t = b.getAttribute('aria-label') || b.title || lines(b);
    if (/^(close|×|✕)$/i.test(clean(t))) return;
    buttons++;
    add(b, 'button', t);
  });
  root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]), textarea, [contenteditable=true]').forEach(function (f) {
    if (skip(f)) return;
    var lab = f.id && root.querySelector('label[for="' + f.id + '"]');
    add(f, 'field', f.getAttribute('placeholder') || f.getAttribute('aria-label') || (lab && lab.textContent) || f.name || 'text field');
  });
  return out;
}`;
