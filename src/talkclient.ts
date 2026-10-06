// /talk.js: the Talk layer on every qodebase page. A talk button (bottom
// right) opens a sheet: speak (phone's own dictation, or Whisper on
// Cloudflare) or type a sentence; the app previews what it will do (the target
// outlined), does it, answers in the sheet (spoken too, if set), or both. The
// conversation survives page changes (sessionStorage). Settings: dictation
// engine, language, speak replies. Written as plain ES5-ish JS in a raw string:
// no backticks or dollar-brace inside.
import { SCAN_JS } from './talkscan';

export const TALK_JS = String.raw`(function () {
'use strict';
if (window.top !== window || window.__talk) return;
window.__talk = 1;
if (/^\/(login|a\/|session)/.test(location.pathname)) return;
` + SCAN_JS + String.raw`
var KEY = 'qb-talk-', ss = window.sessionStorage, ls = window.localStorage;
function get(k, d) { try { var v = ls.getItem(KEY + k); return v == null ? d : v; } catch (e) { return d; } }
function set(k, v) { try { ls.setItem(KEY + k, v); } catch (e) {} }
function sget(k, d) { try { var v = ss.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function sset(k, v) { try { ss.setItem(KEY + k, JSON.stringify(v)); } catch (e) {} }
function logEv(event, data) { try { console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), module: 'talk', event: event }, data || {}))); } catch (e) {} }

var S = {
  engine: get('engine', ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? 'native' : 'whisper'),
  lang: get('lang', 'en'),
  speak: get('speak', 'voice'),        // off | voice (only when I spoke) | always
};
var LANGS = { en: 'en-US', he: 'he-IL', auto: 'en-US' };
var me = null, busy = false, listening = false, lastSpoken = false;
var hist = sget('log', []);             // [{who:'you'|'app'|'ai'|'note', text}]
var chatHist = sget('chat', []);       // [{role, content}] for the chat lane

// ---- DOM -------------------------------------------------------------------
var css = [
  '#talk-root{--t-acc:var(--acc,#17695a);--t-accfg:var(--acc-fg,#fff);--t-bg:var(--bg,#fff);--t-card:var(--card,#f6f7f8);--t-chip:var(--chip,#eceef1);--t-line:var(--line,#e2e5e9);--t-fg:var(--fg,#15171a);--t-dim:var(--dim,#5f6670);font:16px/1.45 "Instrument Sans",system-ui,sans-serif;color:var(--t-fg);-webkit-tap-highlight-color:transparent}',
  '#talk-fab{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:2147483000;width:52px;height:52px;border-radius:12px;border:0;background:var(--t-acc);color:var(--t-accfg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.18);cursor:pointer;transition:background-color .12s}',
  '#talk-fab svg{width:24px;height:24px}',
  '#talk-fab.on{background:#b42d1f}',
  '#talk-root.open #talk-fab{display:none}',
  '#talk-sheet{position:fixed;left:0;right:0;bottom:0;z-index:2147483001;background:var(--t-bg);border-top:1px solid var(--t-line);border-radius:12px 12px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.14);transform:translateY(105%);transition:transform .22s ease;max-height:62dvh;display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom)}',
  '#talk-root.open #talk-sheet{transform:none}',
  '@media (min-width:720px){#talk-sheet{left:auto;right:16px;bottom:16px;width:420px;border:1px solid var(--t-line);border-radius:12px}}',
  '#talk-head{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 16px;border-bottom:1px solid var(--t-line)}',
  '#talk-head b{font-weight:600;font-size:15px;flex:1}',
  '#talk-head .st{font-size:13px;color:var(--t-dim);font-variant-numeric:tabular-nums}',
  '.talk-ib{width:44px;height:44px;border:0;border-radius:8px;background:transparent;color:var(--t-fg);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}',
  '.talk-ib svg{width:20px;height:20px}',
  '@media (hover:hover){.talk-ib:hover{background:var(--t-chip)}}',
  '#talk-log{overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;min-height:64px;overscroll-behavior:contain}',
  '#talk-log .you{align-self:flex-end;background:var(--t-acc);color:var(--t-accfg);padding:8px 12px;border-radius:12px;max-width:85%;font-size:15px}',
  '#talk-log .ai{align-self:flex-start;font-size:15px;max-width:92%}',
  '#talk-log .app,#talk-log .note{align-self:flex-start;font-size:13px;color:var(--t-dim)}',
  '#talk-log .hint{font-size:13px;color:var(--t-dim)}',
  '#talk-live{padding:0 16px;min-height:0;font-size:15px;color:var(--t-dim)}',
  '#talk-live:not(:empty){padding:4px 16px 8px}',
  '#talk-offer{display:none;gap:8px;align-items:center;padding:0 16px 8px;font-size:15px;flex-wrap:wrap}',
  '#talk-offer.on{display:flex}',
  '.talk-chip{min-height:44px;padding:0 14px;border-radius:8px;border:0;background:var(--t-chip);color:var(--t-fg);font:500 15px "Instrument Sans",system-ui,sans-serif;cursor:pointer}',
  '.talk-chip.pri{background:var(--t-acc);color:var(--t-accfg)}',
  '#talk-form{display:flex;gap:8px;padding:8px 8px 8px 16px;border-top:1px solid var(--t-line);align-items:center}',
  '#talk-in{flex:1;min-width:0;height:44px;border-radius:8px;border:1px solid var(--t-line);background:var(--t-card);color:var(--t-fg);padding:0 12px;font:16px "Instrument Sans",system-ui,sans-serif;outline:none}',
  '#talk-in:focus{border-color:var(--t-acc)}',
  '#talk-mic{width:44px;height:44px;border-radius:8px;border:0;background:var(--t-acc);color:var(--t-accfg);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}',
  '#talk-mic svg{width:22px;height:22px}',
  '#talk-mic.on{background:#b42d1f}',
  '#talk-set{display:none;padding:12px 16px;border-bottom:1px solid var(--t-line);gap:12px;flex-direction:column;font-size:15px}',
  '#talk-root.settings #talk-set{display:flex}',
  '#talk-set label{display:flex;flex-direction:column;gap:4px;color:var(--t-dim);font-size:13px}',
  '#talk-set select{height:44px;border-radius:8px;border:1px solid var(--t-line);background:var(--t-card);color:var(--t-fg);font:16px "Instrument Sans",system-ui,sans-serif;padding:0 8px}',
  '.talk-mark{outline:3px solid var(--acc,#17695a)!important;outline-offset:3px!important;border-radius:8px;transition:outline-color .12s}',
  '.talk-mark.dash{outline-style:dashed!important}',
].join('\n');

var ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

var root, sheet, logEl, live, offer, inp, micBtn, fab, stEl;
function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }

function build() {
  var st = el('style'); st.textContent = css; document.head.appendChild(st);
  root = el('div', { id: 'talk-root' });
  fab = el('button', { id: 'talk-fab', type: 'button', 'aria-label': 'Talk to qodebase' }, ICON.mic);
  sheet = el('section', { id: 'talk-sheet', 'aria-label': 'Talk' });
  var head = el('div', { id: 'talk-head' });
  head.innerHTML = '<b>Talk</b><span class="st" id="talk-st"></span>';
  var gear = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Talk settings' }, ICON.gear);
  var close = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Close' }, ICON.x);
  head.appendChild(gear); head.appendChild(close);
  var setp = el('div', { id: 'talk-set' });
  setp.innerHTML =
    '<label>Dictation<select id="talk-s-engine"><option value="native">Phone’s own (Chrome), free, live words</option><option value="whisper">Whisper on Cloudflare, steadier with names</option></select></label>' +
    '<label>Language<select id="talk-s-lang"><option value="en">English</option><option value="he">עברית (Hebrew)</option><option value="auto">Auto (Whisper detects)</option></select></label>' +
    '<label>Speak replies<select id="talk-s-speak"><option value="voice">When I talked</option><option value="always">Always</option><option value="off">Never</option></select></label>' +
    '<button type="button" class="talk-chip" id="talk-s-clear">Clear the conversation</button>';
  logEl = el('div', { id: 'talk-log', 'aria-live': 'polite' });
  live = el('div', { id: 'talk-live' });
  offer = el('div', { id: 'talk-offer' });
  var form = el('form', { id: 'talk-form' });
  inp = el('input', { id: 'talk-in', type: 'text', enterkeyhint: 'send', autocomplete: 'off', placeholder: 'Say or type: open my calculator', 'aria-label': 'Talk to qodebase' });
  micBtn = el('button', { id: 'talk-mic', type: 'button', 'aria-label': 'Speak' }, ICON.mic);
  form.appendChild(inp); form.appendChild(micBtn);
  sheet.appendChild(head); sheet.appendChild(setp); sheet.appendChild(logEl); sheet.appendChild(live); sheet.appendChild(offer); sheet.appendChild(form);
  root.appendChild(fab); root.appendChild(sheet);
  document.body.appendChild(root);
  stEl = document.getElementById('talk-st');

  fab.addEventListener('click', function () { open(true); if (S.engine === 'native' || S.engine === 'whisper') startListen(); });
  close.addEventListener('click', function () { stopListen(true); open(false); });
  gear.addEventListener('click', function () { root.classList.toggle('settings'); });
  micBtn.addEventListener('click', function () { if (listening) stopListen(false); else startListen(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); var v = inp.value.trim(); if (!v) return; inp.value = ''; lastSpoken = false; submit(v); });
  var se = document.getElementById('talk-s-engine'), sl = document.getElementById('talk-s-lang'), sp = document.getElementById('talk-s-speak');
  se.value = S.engine; sl.value = S.lang; sp.value = S.speak;
  se.onchange = function () { S.engine = se.value; set('engine', S.engine); };
  sl.onchange = function () { S.lang = sl.value; set('lang', S.lang); };
  sp.onchange = function () { S.speak = sp.value; set('speak', S.speak); };
  document.getElementById('talk-s-clear').onclick = function () { hist = []; chatHist = []; sset('log', hist); sset('chat', chatHist); render(); root.classList.remove('settings'); };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('open')) { stopListen(true); open(false); }
  });
  render();
}

function open(on) { root.classList.toggle('open', !!on); sset('open', !!on); if (on) setTimeout(function () { logEl.scrollTop = logEl.scrollHeight; }, 50); }
function status(t) { stEl.textContent = t || ''; }
function add(who, text) { hist.push({ who: who, text: String(text) }); if (hist.length > 40) hist = hist.slice(-40); sset('log', hist); render(); }
function render() {
  logEl.innerHTML = '';
  if (!hist.length) {
    var h = el('div', { class: 'hint' });
    h.textContent = 'Try: “open my calculator”, “show me the code of the timer”, “what is this page?”, “build a habit tracker”.';
    logEl.appendChild(h);
  }
  hist.forEach(function (m) { var d = el('div', { class: m.who }); d.textContent = m.text; logEl.appendChild(d); });
  logEl.scrollTop = logEl.scrollHeight;
}

// ---- Pointing ----------------------------------------------------------------
var marked = [];
function unmark() { marked.forEach(function (e) { e.classList.remove('talk-mark', 'dash'); }); marked = []; }
function mark(e, dashed) {
  if (!e) return;
  e.classList.add('talk-mark'); if (dashed) e.classList.add('dash'); marked.push(e);
  try { e.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (x) {}
}
function byId(id) { return id ? document.querySelector('[data-talk="' + id + '"]') : null; }
function showSeq(ids) {
  unmark();
  var i = 0;
  (function step() { unmark(); if (i >= ids.length) return; mark(byId(ids[i++])); setTimeout(step, 1700); })();
}

// ---- Screen ----------------------------------------------------------------
function screen() {
  var items = talkScan(document);
  return { path: location.pathname + location.search, title: document.title, items: items, last: sget('last', null) };
}
function pageText() {
  var main = document.querySelector('main') || document.body;
  var t = String(main.innerText || '').replace(/\n{3,}/g, '\n\n');
  var mine = root ? String(root.innerText || '') : '';
  if (mine) t = t.replace(mine, '');
  return t.slice(0, 5000);
}

// ---- Server ----------------------------------------------------------------
function api(path, body) {
  return fetch('/api/talk/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
    .then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
}

// ---- The one entry point: a sentence --------------------------------------
var preview = null;   // { text, cmd } from interim speech
function submit(text) {
  if (busy) return;
  busy = true; unmark(); offerOff();
  add('you', text);
  status('Thinking…');
  var t0 = Date.now();
  var reuse = preview && preview.text === text ? Promise.resolve({ cmd: preview.cmd, ms: { total: 0 } }) : api('decide', { utterance: text, screen: screen() });
  preview = null;
  reuse.then(function (r) {
    if (r.error) { add('note', r.why || 'Something went wrong.'); return done(); }
    var c = r.cmd;
    logEv('decide', { text: text, mode: c.mode, mode_p: c.modeP, op: c.op, p: c.p, risky: c.risky, ms: Date.now() - t0 });
    if ((c.risky || 0) >= 0.5) {
      add('ai', 'That would change or remove something, so I will leave the doing to you.');
      if (c.op === 'go' && c.href) offerOn('Take me to ' + (c.label || 'that page') + '?', function () { act(c); });
      return done();
    }
    if (c.mode === 'none') { add('note', (c.complete || 0) < 0.5 ? 'Sounds cut off. Say it again?' : 'I did not catch a request there.'); return done(); }
    var acts = (c.mode === 'act' || c.mode === 'both') && c.op !== 'none' && c.op !== 'explain';
    if (acts && (c.p == null || c.p >= 0.45)) {
      if (c.mode === 'both') sset('pending', { text: text, did: describe(c) });
      return act(c, true);
    }
    if (acts && c.p >= 0.2) {
      offerOn('Maybe: ' + describe(c) + '?', function () { if (c.mode === 'both') sset('pending', { text: text, did: describe(c) }); act(c); });
      if (c.mode === 'act') return done();
    }
    ask(text, '');
  }).catch(function (e) { add('note', 'Could not reach qodebase.'); logEv('error', { where: 'decide', err: String(e) }); done(); });
}
function done() { busy = false; status(''); }

function describe(c) {
  if (c.op === 'go') return 'open ' + (c.label || c.href);
  if (c.op === 'back') return 'go back';
  if (c.op === 'press') return 'press “' + c.label + '”';
  if (c.op === 'type') return 'type “' + c.text + '” into “' + c.label + '”';
  if (c.op === 'scroll') return 'scroll to ' + (c.label || c.section);
  if (c.op === 'search') return 'search for “' + c.text + '”';
  return c.op;
}

function act(c, withPreview) {
  var target = c.target && byId(c.target);
  var go = function () {
    unmark();
    if (c.op === 'go') {
      add('app', 'Opening ' + (c.label || c.href) + '…');
      sset('last', c.label || c.href);
      sset('open', true);
      busy = false;
      location.assign(c.href);
      return;
    }
    if (c.op === 'back') { add('app', 'Going back…'); busy = false; history.back(); return; }
    if (c.op === 'press' && target) { add('app', 'Pressed “' + c.label + '”.'); target.click(); }
    else if (c.op === 'type' && target) { typeInto(target, c.text); add('app', 'Typed “' + c.text + '”.'); offerSubmit(target); }
    else if (c.op === 'scroll') {
      if (c.section === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (c.section === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      else if (target) { mark(target); setTimeout(unmark, 1800); }
      add('app', 'Scrolled to ' + (c.label || c.section) + '.');
    }
    else if (c.op === 'search') { add('note', 'There is no search box on this page.'); return ask('Find ' + c.text, ''); }
    else { add('note', 'Could not find that on the page any more.'); }
    var p = sget('pending', null);
    if (p) { sset('pending', null); return ask(p.text, p.did); }
    done();
  };
  if (withPreview && target) { mark(target, true); status(describe(c)); setTimeout(go, 450); }
  else go();
}

function typeInto(t, text) {
  t.focus();
  if (t.isContentEditable) { t.textContent = text; t.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
  var proto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(t, text);
  t.dispatchEvent(new Event('input', { bubbles: true }));
  t.dispatchEvent(new Event('change', { bubbles: true }));
}
function offerSubmit(t) {
  var f = t.form; if (!f) return;
  var b = f.querySelector('button[type=submit], button:not([type])');
  if (!b) return;
  offerOn('Send it?', function () { if (f.requestSubmit) f.requestSubmit(b); else b.click(); }, (b.innerText || 'Send').trim());
}

function offerOn(text, yes, yesLabel) {
  offer.innerHTML = '';
  var s = el('span'); s.textContent = text;
  var y = el('button', { type: 'button', class: 'talk-chip pri' }); y.textContent = yesLabel || 'Go';
  var n = el('button', { type: 'button', class: 'talk-chip' }); n.textContent = 'No';
  y.onclick = function () { offerOff(); yes(); };
  n.onclick = function () { offerOff(); };
  offer.appendChild(s); offer.appendChild(y); offer.appendChild(n);
  offer.classList.add('on');
}
function offerOff() { offer.classList.remove('on'); offer.innerHTML = ''; }

function ask(text, did) {
  busy = true;
  status('Answering…');
  api('chat', { utterance: text, did: did, screen: screen(), pageText: pageText(), history: chatHist }).then(function (r) {
    if (r.error) { add('note', r.why || 'No answer.'); return done(); }
    var reply = r.reply || '';
    chatHist.push({ role: 'user', content: text });
    if (reply) chatHist.push({ role: 'assistant', content: reply });
    chatHist = chatHist.slice(-12); sset('chat', chatHist);
    if (reply) { add('ai', reply); say(reply); }
    var acts = r.actions || [];
    logEv('chat', { text: text, reply_len: reply.length, actions: acts.map(function (a) { return a.name; }), ms: r.ms && r.ms.model });
    var nav = null;
    acts.forEach(function (a) {
      if (a.name === 'show') showSeq((a.args && a.args.ids) || []);
      else if (a.name === 'press') { var b = byId(a.args.id); if (b) { add('app', 'Pressed “' + (b.innerText || b.getAttribute('aria-label') || '').trim() + '”.'); b.click(); } }
      else if (a.name === 'type_into') { var f = byId(a.args.id); if (f) { typeInto(f, String(a.args.text || '')); offerSubmit(f); } }
      else if (a.name === 'go' && !did) {
        var to = String(a.args.to || ''); var l = byId(to);
        var href = l ? l.getAttribute('href') : (to.charAt(0) === '/' ? to : null);
        if (href) nav = { href: href, label: l ? (l.innerText || href).split('\n')[0] : href };
      }
    });
    if (nav) { var c = { op: 'go', href: nav.href, label: nav.label }; setTimeout(function () { act(c); }, reply ? 900 : 0); return; }
    done();
  }).catch(function (e) { add('note', 'Could not reach qodebase.'); logEv('error', { where: 'chat', err: String(e) }); done(); });
}

function say(text) {
  if (S.speak === 'off' || (S.speak === 'voice' && !lastSpoken) || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = /[֐-׿]/.test(text) ? 'he-IL' : 'en-US';
    speechSynthesis.speak(u);
  } catch (e) {}
}

// ---- Listening ---------------------------------------------------------------
var rec = null, mr = null, chunks = [], stream = null, t0 = 0, tick = null, interimTimer = null, interimCalls = 0;
function setListening(on) {
  listening = on;
  micBtn.classList.toggle('on', on); micBtn.innerHTML = on ? ICON.stop : ICON.mic;
  micBtn.setAttribute('aria-label', on ? 'Stop' : 'Speak');
  clearInterval(tick);
  if (on) { t0 = Date.now(); tick = setInterval(function () { status('Listening ' + Math.floor((Date.now() - t0) / 1000) + 's'); }, 250); status('Listening'); }
  else if (!busy) status('');
}
function startListen() {
  if (listening || busy) return;
  if (window.speechSynthesis) speechSynthesis.cancel();
  offerOff(); live.textContent = '';
  if (S.engine === 'native') return startNative();
  return startWhisper();
}
function stopListen(cancel) {
  if (!listening) return;
  if (rec) { if (cancel) rec.abort(); else rec.stop(); }
  if (mr) { if (cancel) { chunks = []; mr.onstop = null; } try { mr.stop(); } catch (e) {} }
  if (cancel) { setListening(false); live.textContent = ''; unmark(); }
}

function startNative() {
  var R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { add('note', 'This browser has no built-in dictation. Switch to Whisper in Talk settings.'); return; }
  rec = new R();
  rec.lang = LANGS[S.lang] || 'en-US';
  rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  var finalText = '';
  interimCalls = 0;
  rec.onresult = function (e) {
    var interim = '';
    for (var i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
    }
    live.textContent = (finalText + ' ' + interim).trim();
    // Preview while still talking: what it would do, the target outlined (dashed).
    clearTimeout(interimTimer);
    var said = (finalText + ' ' + interim).trim();
    if (said.split(/\s+/).length >= 3 && interimCalls < 2) interimTimer = setTimeout(function () { interimDecide(said); }, 450);
  };
  rec.onerror = function (e) {
    logEv('stt_error', { engine: 'native', err: e.error });
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') add('note', 'The microphone is blocked for this site. Allow it in the browser, or type instead.');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') add('note', 'Dictation stopped (' + e.error + ').');
  };
  rec.onend = function () {
    clearTimeout(interimTimer);
    setListening(false); rec = null;
    var t = finalText.trim() || live.textContent.trim();
    live.textContent = '';
    if (t) { lastSpoken = true; submit(t); }
  };
  try { rec.start(); setListening(true); } catch (e) { add('note', 'Could not start dictation: ' + e.message); }
}
function interimDecide(text) {
  interimCalls++;
  api('decide', { utterance: text, screen: screen(), interim: true }).then(function (r) {
    if (!listening || !r.cmd) return;
    var c = r.cmd;
    if ((c.mode === 'act' || c.mode === 'both') && c.op !== 'none' && (c.risky || 0) < 0.5) {
      preview = { text: text, cmd: c };
      unmark(); if (c.target) mark(byId(c.target), true);
      status('→ ' + describe(c));
    }
  }).catch(function () {});
}

function startWhisper() {
  if (!navigator.mediaDevices || !window.MediaRecorder) { add('note', 'This browser cannot record audio. Switch to the phone’s own dictation in Talk settings.'); return; }
  setListening(true); status('Starting the microphone…');
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
    stream = s; chunks = [];
    var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0] || '';
    mr = new MediaRecorder(s, type ? { mimeType: type } : {});
    mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      setListening(false);
      var blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      mr = null;
      if (blob.size < 2000) { status(''); return; }
      status('Hearing…');
      fetch('/api/talk/transcribe?lang=' + encodeURIComponent(S.lang), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type }, body: blob })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          status('');
          if (j.error) { add('note', j.why || 'Could not hear that.'); return; }
          if (!j.text) { add('note', 'I did not hear anything.'); return; }
          lastSpoken = true; submit(j.text);
        }).catch(function (e) { status(''); add('note', 'Could not reach qodebase.'); logEv('error', { where: 'stt', err: String(e) }); });
    };
    mr.start(250);
    t0 = Date.now();
    // Stop by itself after a pause in speech or 30 s, whichever comes first.
    silenceStop(s);
  }).catch(function (e) {
    setListening(false);
    logEv('stt_error', { engine: 'whisper', err: String(e) });
    add('note', /denied|allowed/i.test(String(e)) ? 'The microphone is blocked for this site. Allow it in the browser, or type instead.' : 'Could not start the microphone.');
  });
}
function silenceStop(s) {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var src = ctx.createMediaStreamSource(s), an = ctx.createAnalyser();
    an.fftSize = 512; src.connect(an);
    var buf = new Uint8Array(an.fftSize), spoke = false, quietSince = 0;
    (function loop() {
      if (!mr) { ctx.close(); return; }
      an.getByteTimeDomainData(buf);
      var peak = 0; for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      var now = Date.now();
      if (peak > 12) { spoke = true; quietSince = 0; } else if (!quietSince) quietSince = now;
      if ((spoke && quietSince && now - quietSince > 1300) || now - t0 > 30000) { try { mr.stop(); } catch (e) {} ctx.close(); return; }
      requestAnimationFrame(loop);
    })();
  } catch (e) { setTimeout(function () { if (mr) mr.stop(); }, 8000); }
}

// ---- Boot ----------------------------------------------------------------
fetch('/api/talk/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
  if (!j.signedIn) return;
  me = j.handle;
  build();
  // Coming back from a navigation Talk made: show the sheet, finish any pending question.
  if (sget('open', false)) {
    open(true);
    var last = hist[hist.length - 1];
    if (last && last.who === 'app' && /^Opening /.test(last.text)) { hist[hist.length - 1] = { who: 'app', text: last.text.replace(/^Opening (.*)…$/, 'Opened $1.') }; sset('log', hist); render(); }
    var p = sget('pending', null);
    if (p) { sset('pending', null); setTimeout(function () { ask(p.text, p.did); }, 300); }
  }
}).catch(function () {});
})();`;
