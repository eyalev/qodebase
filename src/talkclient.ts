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
  voice: get('voice', 'off'),           // spoken replies: off | aura-1 | aura-2 | phone (off by default)
  speaker: get('speaker', ''),          // Aura speaker ('' = the model's default)
  when: get('when', 'voice'),           // voice (only when I spoke) | always
};
var LANGS = { en: 'en-US', he: 'he-IL', auto: 'en-US' };
var me = null, busy = false, listening = false, lastSpoken = false;
var hist = sget('log', []);             // [{who:'you'|'app'|'ai'|'note', text}]
var chatHist = sget('chat', []);       // [{role, content}] for the chat lane

// ---- DOM -------------------------------------------------------------------
var css = [
  '#talk-root{--t-acc:var(--acc,#17695a);--t-accfg:var(--acc-fg,#fff);--t-bg:var(--bg,#fff);--t-card:var(--card,#f6f7f8);--t-chip:var(--chip,#eceef1);--t-line:var(--line,#e2e5e9);--t-fg:var(--fg,#15171a);--t-dim:var(--dim,#5f6670);font:16px/1.45 var(--t-ff);color:var(--t-fg);-webkit-tap-highlight-color:transparent}',
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
  '.talk-chip{min-height:44px;padding:0 14px;border-radius:8px;border:0;background:var(--t-chip);color:var(--t-fg);font:500 15px var(--t-ff);cursor:pointer}',
  '.talk-chip.pri{background:var(--t-acc);color:var(--t-accfg)}',
  '#talk-form{display:flex;gap:8px;padding:8px 8px 8px 16px;border-top:1px solid var(--t-line);align-items:center}',
  '#talk-in{flex:1;min-width:0;height:44px;border-radius:8px;border:1px solid var(--t-line);background:var(--t-card);color:var(--t-fg);padding:0 12px;font:16px var(--t-ff);outline:none}',
  '#talk-in:focus{border-color:var(--t-acc)}',
  '#talk-mic{width:44px;height:44px;border-radius:8px;border:0;background:var(--t-acc);color:var(--t-accfg);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}',
  '#talk-mic svg{width:22px;height:22px}',
  '#talk-mic.on{background:#b42d1f}',
  '#talk-set{display:none;padding:12px 16px;border-bottom:1px solid var(--t-line);gap:12px;flex-direction:column;font-size:15px}',
  '#talk-root.settings #talk-set{display:flex}',
  '#talk-set label{display:flex;flex-direction:column;gap:4px;color:var(--t-dim);font-size:13px}',
  '#talk-set select{height:44px;border-radius:8px;border:1px solid var(--t-line);background:var(--t-card);color:var(--t-fg);font:16px var(--t-ff);padding:0 8px}',
  '.talk-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
  '.talk-link{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:8px;background:var(--t-chip);color:var(--t-fg);font-size:14px;text-decoration:none}',
  '.talk-mark{outline:3px solid var(--acc,#17695a)!important;outline-offset:3px!important;border-radius:8px;transition:outline-color .12s}',
  '.talk-mark.dash{outline-style:dashed!important}',
].join('\n');

var ICON = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

var root, sheet, logEl, live, offer, inp, micBtn, fab, stEl, spk;
function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }

function build() {
  var st = el('style'); st.textContent = css; document.head.appendChild(st);
  root = el('div', { id: 'talk-root' });
  // The page's own font (it changes with the site's look), for every Talk control too.
  root.style.setProperty('--t-ff', getComputedStyle(document.body).fontFamily || 'sans-serif');
  fab = el('button', { id: 'talk-fab', type: 'button', 'aria-label': 'Talk to qodebase' }, ICON.mic);
  sheet = el('section', { id: 'talk-sheet', 'aria-label': 'Talk' });
  var head = el('div', { id: 'talk-head' });
  head.innerHTML = '<b>Talk</b><span class="st" id="talk-st"></span>';
  spk = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Spoken replies' }, ICON.mute);
  var gear = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Talk settings' }, ICON.gear);
  var close = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Close' }, ICON.x);
  head.appendChild(spk); head.appendChild(gear); head.appendChild(close);
  var setp = el('div', { id: 'talk-set' });
  setp.innerHTML =
    '<label>Dictation<select id="talk-s-engine"><option value="native">Phone’s own (Chrome), free, live words</option><option value="whisper">Whisper on Cloudflare, steadier with names</option></select></label>' +
    '<label>Language<select id="talk-s-lang"><option value="en">English</option><option value="he">עברית (Hebrew)</option><option value="auto">Auto (Whisper detects)</option></select></label>' +
    '<label>Spoken replies<select id="talk-s-voice"><option value="off">Off</option><option value="aura-1">Natural voice (Cloudflare Aura)</option><option value="aura-2">Richer voice (Aura 2, twice the price)</option><option value="phone">The phone\u2019s own voice</option></select></label>' +
    '<label>Voice<select id="talk-s-speaker"></select></label>' +
    '<label>Speak<select id="talk-s-when"><option value="voice">When I talked</option><option value="always">Always</option></select></label>' +
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

  fab.addEventListener('click', function () { unlockAudio(); open(true); if (S.engine === 'native' || S.engine === 'whisper') startListen(); });
  close.addEventListener('click', function () { stopListen(true); open(false); });
  gear.addEventListener('click', function () { root.classList.toggle('settings'); });
  micBtn.addEventListener('click', function () { unlockAudio(); if (listening) stopListen(false); else startListen(); });
  form.addEventListener('submit', function (e) { e.preventDefault(); unlockAudio(); var v = inp.value.trim(); if (!v) return; inp.value = ''; lastSpoken = false; submit(v); });
  var se = document.getElementById('talk-s-engine'), sl = document.getElementById('talk-s-lang'), sv = document.getElementById('talk-s-voice'), sk = document.getElementById('talk-s-speaker'), sw = document.getElementById('talk-s-when');
  se.value = S.engine; sl.value = S.lang; sv.value = S.voice; sw.value = S.when;
  var fillSpeakers = function () {
    var list = SPEAKERS[S.voice] || [];
    sk.innerHTML = list.map(function (n) { return '<option value="' + n + '">' + n.charAt(0).toUpperCase() + n.slice(1) + '</option>'; }).join('');
    if (list.indexOf(S.speaker) < 0) S.speaker = list[0] || '';
    sk.value = S.speaker; sk.parentNode.style.display = list.length ? '' : 'none';
    sw.parentNode.style.display = S.voice === 'off' ? 'none' : '';
  };
  fillSpeakers();
  sv.onchange = function () { S.voice = sv.value; set('voice', S.voice); if (S.voice !== 'off') set('voice-on', S.voice); fillSpeakers(); set('speaker', S.speaker); voiceBtn(); if (S.voice !== 'off') { unlockAudio(); lastSpoken = true; say('This is how I sound.'); } };
  sk.onchange = function () { S.speaker = sk.value; set('speaker', S.speaker); unlockAudio(); lastSpoken = true; say('This is how I sound.'); };
  sw.onchange = function () { S.when = sw.value; set('when', S.when); };
  spk.addEventListener('click', function () { unlockAudio(); S.voice = S.voice === 'off' ? get('voice-on', 'aura-1') : 'off'; set('voice', S.voice); sv.value = S.voice; fillSpeakers(); voiceBtn(); if (S.voice === 'off') stopSpeaking(); });
  voiceBtn();
  se.onchange = function () { S.engine = se.value; set('engine', S.engine); };
  sl.onchange = function () { S.lang = sl.value; set('lang', S.lang); };
  document.getElementById('talk-s-clear').onclick = function () { hist = []; chatHist = []; sset('log', hist); sset('chat', chatHist); render(); root.classList.remove('settings'); };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('open')) { stopListen(true); open(false); }
  });
  render();
}

function open(on) { root.classList.toggle('open', !!on); sset('open', !!on); if (on) setTimeout(function () { logEl.scrollTop = logEl.scrollHeight; }, 50); }
function status(t) { stEl.textContent = t || ''; }
function add(who, text, links) { if (run && who !== 'you') run.texts.push(String(text)); hist.push({ who: who, text: String(text), links: links || undefined }); if (hist.length > 40) hist = hist.slice(-40); sset('log', hist); render(); }
function render() {
  logEl.innerHTML = '';
  if (!hist.length) {
    var h = el('div', { class: 'hint' });
    h.textContent = 'Try: “open my calculator”, “show me the code of the timer”, “what is this page?”, “build a habit tracker”.';
    logEl.appendChild(h);
  }
  hist.forEach(function (m) {
    var d = el('div', { class: m.who }); d.textContent = m.text;
    if (m.links && m.links.length) {
      var row = el('div', { class: 'talk-links' });
      m.links.forEach(function (l) { if (!/^\/[^/]/.test(l.href)) return; var a = el('a', { href: l.href, class: 'talk-link' }); a.textContent = l.text; row.appendChild(a); });
      d.appendChild(row);
    }
    logEl.appendChild(d);
  });
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
    if (r.error) { if (run) run.ok = false; add('note', r.why || 'Something went wrong.'); return done(); }
    var c = r.cmd;
    if (run) { run.mode = c.mode; run.action = c.op; }
    logEv('decide', { text: text, mode: c.mode, mode_p: c.modeP, op: c.op, p: c.p, risky: c.risky, ms: Date.now() - t0 });
    if ((c.risky || 0) >= 0.5) {
      add('ai', 'That would change or remove something, so I will leave the doing to you.');
      if (c.op === 'go' && c.href) offerOn('Take me to ' + (c.label || 'that page') + '?', function () { act(c); });
      return done();
    }
    if (c.mode === 'none') { add('note', (c.complete || 0) < 0.5 ? 'Sounds cut off. Say it again?' : 'I did not catch a request there.'); return done(); }
    if (c.op === 'status') return whatsGoingOn(text);
    if (c.op === 'change') return changeRequest(c);
    if (c.op === 'code') return codeQuestion(c);
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
  }).catch(function (e) { if (run) run.ok = false; add('note', 'Could not reach qodebase.'); logEv('error', { where: 'decide', err: String(e) }); done(); });
}
function done() { busy = false; status(''); finish(); }

// ---- "What's going on": real data across their projects (/api/talk/status, no model).
function whatsGoingOn(text) {
  status('Looking at your projects\u2026');
  api('status', { utterance: text }).then(function (r) {
    if (r.error) { if (run) run.ok = false; add('note', r.why || 'Could not look.'); return done(); }
    add('ai', r.text, r.links); say(r.text);
    logEv('status', { ms: r.ms, links: (r.links || []).length });
    done();
  }).catch(function (e) { if (run) run.ok = false; add('note', 'Could not reach qodebase.'); logEv('error', { where: 'status', err: String(e) }); done(); });
}

// ---- Change requests: "in my todo app, add due dates" -> that project's router agent.
// Theirs: one-line confirm, send, open its Changes. Not theirs: offer Fork, then send to the copy.
function changeRequest(c) {
  var parts = String(c.slug || '').split('.'), owner = parts[0], name = parts.slice(1).join('.');
  if (!owner || !name) { add('note', 'Which project? Say its name.'); return done(); }
  var text = c.text;
  if (!c.mine) {
    add('ai', owner + '/' + name + ' is not yours. Fork it to get your own copy, then I can send the change to its agents.');
    offerOn('Fork ' + owner + '/' + name + '?', function () {
      busy = true; status('Forking\u2026');
      projPost(owner, name, 'fork', {}).then(function (f) {
        if (f.error) { add('note', 'Could not fork: ' + f.error); return done(); }
        add('app', 'Forked to ' + f.owner + '/' + f.name + '.');
        sendChange(f.owner, f.name, text);
      }).catch(function () { add('note', 'Could not reach qodebase.'); done(); });
    }, 'Fork');
    return done();
  }
  offerOn('Send to ' + owner + '/' + name + '\u2019s agents: \u201c' + text + '\u201d?', function () { busy = true; sendChange(owner, name, text); }, 'Send');
  done();
}
// ---- Questions about a project's code: qb1's ask box (a read-only Claude Code box on
// the owner's Claude). Owner only; others get the quick chat lane over the page.
var DEPTH_MODEL = { fact: 'haiku', explain: 'sonnet', plan: 'opus' };
function codeQuestion(c) {
  var parts = String(c.slug || '').split('.'), owner = parts[0], name = parts.slice(1).join('.');
  if (!c.mine) { add('note', 'I can only read the code of your own projects, so this answer is from the page.'); return ask(c.text, ''); }
  var model = DEPTH_MODEL[c.depth] || 'sonnet';
  var t0 = Date.now(), tries = 0;
  add('app', 'Reading the code of ' + owner + '/' + name + '\u2026');
  say('Reading the code.');
  var tick = setInterval(function () { status('Reading the code ' + Math.floor((Date.now() - t0) / 1000) + 's'); }, 500);
  var stop = function () { clearInterval(tick); };
  var start = function () {
    tries++;
    projPost(owner, name, 'ask', { question: c.text, model: model }).then(function (r) {
      if (r.error || !r.id) { stop(); add('note', 'Could not ask: ' + (r.error || 'no answer')); return done(); }
      poll(r.id);
    }).catch(function () { stop(); add('note', 'Could not reach qodebase.'); done(); });
  };
  var poll = function (id) {
    if (Date.now() - t0 > 240000) { stop(); add('note', 'Still reading after four minutes. The answer will be in the project when it is ready.'); return done(); }
    fetch('/api/p/' + owner + '/' + name + '/ask-result?id=' + encodeURIComponent(id), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.state === 'done') {
        stop();
        logEv('code_answer', { project: owner + '/' + name, model: j.model || model, ms: Date.now() - t0, box_ms: j.ms, tries: tries });
        chatHist.push({ role: 'user', content: c.text }); chatHist.push({ role: 'assistant', content: j.answer || '' }); chatHist = chatHist.slice(-12); sset('chat', chatHist);
        add('ai', j.answer || 'No answer came back.'); say(j.answer || '');
        return done();
      }
      if (j.state === 'failed') {
        logEv('code_failed', { project: owner + '/' + name, err: j.error, tries: tries });
        if (tries < 2) return start();   // a deploy restarts the box mid-question: one retry
        stop(); add('note', 'The code reader failed: ' + (j.error || 'unknown')); return done();
      }
      setTimeout(function () { poll(id); }, 2500);
    }).catch(function () { setTimeout(function () { poll(id); }, 4000); });
  };
  start();
}

function projPost(owner, name, verb, body) {
  return fetch('/api/p/' + owner + '/' + name + '/' + verb, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }); });
}
function sendChange(owner, name, text) {
  status('Sending\u2026');
  projPost(owner, name, 'router', { text: text }).then(function (r) {
    logEv('change', { project: owner + '/' + name, ok: !r.error, err: r.error || null });
    if (r.error) { add('note', 'Could not send it: ' + r.error); return done(); }
    add('app', 'Sent to ' + owner + '/' + name + '\u2019s agents. Opening its Changes\u2026');
    act({ op: 'go', href: '/p/' + owner + '/' + name + '/changes', label: owner + '/' + name + ' (changes)' });
  }).catch(function () { add('note', 'Could not reach qodebase.'); done(); });
}

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
      leave(function () { location.assign(c.href); });
      return;
    }
    if (c.op === 'back') { add('app', 'Going back…'); busy = false; leave(function () { history.back(); }); return; }
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
  if (run) run.texts.push(text);
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
    if (r.error) { if (run) run.ok = false; add('note', r.why || 'No answer.'); return done(); }
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
        var pm = /^\/p\/([^/]+)\/([^/?]+)\/?([a-z]*)/.exec(href || '');
        if (href) nav = { href: href, label: l ? (l.innerText || href).split('\n')[0] : pm ? pm[1] + '/' + pm[2] + (pm[3] ? ' (' + pm[3] + ')' : '') : href };
      }
    });
    if (nav) { var c = { op: 'go', href: nav.href, label: nav.label }; setTimeout(function () { act(c); }, reply ? 900 : 0); return; }
    done();
  }).catch(function (e) { if (run) run.ok = false; add('note', 'Could not reach qodebase.'); logEv('error', { where: 'chat', err: String(e) }); done(); });
}

// ---- Spoken replies --------------------------------------------------------
var SPEAKERS = {
  'aura-1': ['helios', 'angus', 'arcas', 'orion', 'orpheus', 'perseus', 'zeus', 'athena', 'asteria', 'luna', 'hera', 'stella'],
  'aura-2': ['draco', 'apollo', 'arcas', 'atlas', 'hermes', 'orion', 'zeus', 'asteria', 'athena', 'aurora', 'cora', 'helena', 'hera', 'iris', 'juno', 'luna', 'minerva', 'thalia'],
};
var player = null, actx = null;
function voiceBtn() { if (!spk) return; var on = S.voice !== 'off'; spk.innerHTML = on ? ICON.sound : ICON.mute; spk.setAttribute('aria-label', on ? 'Spoken replies on (tap for text only)' : 'Text only (tap for spoken replies)'); spk.setAttribute('aria-pressed', on ? 'true' : 'false'); }
// Phones only play sound that a tap started: every tap in Talk calls this, so a reply
// that arrives seconds later may still play (the element and audio context are unlocked).
function unlockAudio() {
  try {
    if (!player) { player = new Audio(); player.preload = 'auto'; player.addEventListener('ended', function () { logEv('speak_done', {}); }); }
    var C = window.AudioContext || window.webkitAudioContext;
    if (C) { actx = actx || new C(); if (actx.state === 'suspended') actx.resume(); }
  } catch (e) {}
}
function stopSpeaking() {
  try { if (player) { player.pause(); player.removeAttribute('src'); player.load(); } } catch (e) {}
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
}
function spoken(text) {
  // What is worth hearing: no links or ids, at most ~3 sentences / 600 characters.
  var t = String(text || '').replace(/https?:\/\/\S+/g, '').replace(/[\x60*#_]/g, '').replace(/\(?\b[\w.-]+\/[\w./-]+\.[a-z]{1,5}(:\d+)?\)?/gi, '').replace(/\s+([,.])/g, '$1').replace(/\s+/g, ' ').trim();
  if (t.length > 600) { var cut = t.slice(0, 600); var i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! ')); t = i > 200 ? cut.slice(0, i + 1) : cut; }
  return t;
}
function phoneSay(text) {
  if (!window.speechSynthesis) return;
  try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.lang = /[\u0590-\u05ff]/.test(text) ? 'he-IL' : 'en-US'; speechSynthesis.speak(u); } catch (e) {}
}
function say(text) {
  if (S.voice === 'off' || (S.when === 'voice' && !lastSpoken)) return;
  var t = spoken(text);
  if (!t) return;
  if (S.voice === 'phone') return phoneSay(t);
  unlockAudio();
  var t0 = Date.now();
  player.src = '/api/talk/tts?model=' + encodeURIComponent(S.voice) + '&speaker=' + encodeURIComponent(S.speaker || '') + '&text=' + encodeURIComponent(t);
  player.onplaying = function () { logEv('speak_start', { chars: t.length, ms_first: Date.now() - t0 }); };
  player.onerror = function () { logEv('speak_error', { chars: t.length }); phoneSay(t); };
  var p = player.play();
  if (p && p.catch) p.catch(function (e) { logEv('speak_blocked', { err: String(e) }); phoneSay(t); });
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
  stopSpeaking();   // talking over the reply stops it
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

// ---- Page tools (WebMCP) ------------------------------------------------------
// Jarvis hands (and any WebMCP client) can call Talk and a few typed navigation
// tools. Contract: <jarvis webmcp contract>.
// Mirrored in window.__webmcp (what Jarvis reads over CDP) and registered with
// real WebMCP when the browser has it. Navigation and questions only: nothing
// that deletes, merges, deploys or changes settings.
var run = null;   // the talk() call in flight: { texts, mode, action, ok, resolve }
function finish() {
  if (!run) return;
  var r = run; run = null;
  r.resolve({ ok: r.ok !== false, text: r.texts.join(' ') || 'Done.', data: { mode: r.mode || null, action: r.action || null } });
}
// Navigating away: answer the call first, then leave (a result sent after unload is lost).
function leave(go) { if (run) { finish(); setTimeout(go, 80); } else go(); }

var PAGES = { home: '/', explore: '/explore', yours: '/mine', inbox: '/inbox', build: '/build', import: '/import', settings: '/settings', command_line: '/cli', personal_agents: '/personal-agents', own_copy: '/own', about: '/about' };
var PAGE_WORDS = { home: 'home', explore: 'Explore', yours: 'your projects', inbox: 'Inbox', build: 'Build', import: 'Import from GitHub', settings: 'Settings', command_line: 'the command line page', personal_agents: 'your own AI assistant', own_copy: 'get your own qodebase', about: 'About' };
var PARTS = { page: '', app: '/app', code: '/code/', readme: '/readme', history: '/history', agents: '' };   // agents are cards on the project page (no /agents page)

function navTo(href, label) {
  add('app', 'Opening ' + label + '…');
  sset('last', label); sset('open', true); open(true);
  setTimeout(function () { location.assign(href); }, 80);
}

var projList = null;
function projects() {
  if (projList) return Promise.resolve(projList);
  return fetch('/api/projects', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) { projList = j.projects || []; return projList; });
}
function findProject(list, q) {
  var raw = String(q || '').toLowerCase().trim();
  var slash = /^([a-z0-9-]+)\s*\/\s*([a-z0-9-]+)$/.exec(raw);
  if (slash) return list.filter(function (p) { return p.owner === slash[1] && p.name === slash[2]; });
  var words = raw.replace(/[^a-z0-9 -]/g, ' ').split(/[\s-]+/).filter(function (w) { return w && !/^(the|my|a|an|project|projects|app|repo|one|open|show|me|please)$/.test(w); });
  var key = words.join('-');
  if (!key) return [];
  var rank = function (p) { return p.owner === me ? 0 : p.owner === 'forq' ? 1 : 2; };
  var by = function (a, b) { return rank(a) - rank(b); };
  var exact = list.filter(function (p) { return p.name === key || p.name.replace(/-/g, '') === key.replace(/-/g, ''); }).sort(by);
  if (exact.length) return exact;
  var all = list.filter(function (p) { return words.every(function (w) { return p.name.indexOf(w) >= 0; }); }).sort(by);
  if (all.length) return all;
  // Spoken names: "the podqast one", "podcast" for podqast. A name said inside the sentence, then a near spelling.
  var spaced = ' ' + words.join(' ') + ' ';
  var inside = list.filter(function (p) { return spaced.indexOf(' ' + p.name.replace(/-/g, ' ') + ' ') >= 0; }).sort(by);
  if (inside.length) return inside;
  var flat = key.replace(/-/g, '');
  var near = list.map(function (p) { return { p: p, d: dist(p.name.replace(/-/g, ''), flat) }; })
    .filter(function (x) { return x.d <= Math.max(1, Math.floor(flat.length / 4)); })
    .sort(function (a, b) { return a.d - b.d || by(a.p, b.p); });
  return near.map(function (x) { return x.p; });
}
function dist(a, b) {
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

var TOOLS = [
  { name: 'talk',
    description: 'Say a sentence to qodebase Talk, as if typed in the talk sheet: it opens pages, presses safe buttons, or answers questions about the page and projects. Use for questions and anything the other tools do not cover. Pass the whole sentence.',
    inputSchema: { type: 'object', properties: { sentence: { type: 'string', description: 'The sentence, verbatim.' } }, required: ['sentence'] },
    run: function (a) {
      var text = String(a.sentence || '').trim();
      if (!text) return Promise.resolve({ ok: false, text: 'No sentence.' });
      if (busy || run) return Promise.resolve({ ok: false, text: 'Talk is busy with the last sentence.' });
      return new Promise(function (resolve) {
        run = { texts: [], ok: true, resolve: resolve };
        open(true); lastSpoken = false; submit(text);
      });
    } },
  { name: 'open_project',
    description: 'Open a project by name (like "calculator" or "forq/timer"), or one part of it: page (the project page), app (the live app), code, readme, history, agents (its agent cards).',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Project name, or owner/name.' }, part: { type: 'string', enum: Object.keys(PARTS), description: 'Which part; page = the project page.' } }, required: ['name'] },
    run: function (a) {
      return projects().then(function (list) {
        var hits = findProject(list, a.name);
        if (!hits.length) return { ok: false, text: 'No project called ' + a.name + '.', data: { candidates: [] } };
        var p = hits[0], part = PARTS.hasOwnProperty(a.part) ? a.part : 'page';
        var label = p.owner + '/' + p.name + (part !== 'page' ? ' (' + part + ')' : '');
        navTo('/p/' + p.owner + '/' + p.name + PARTS[part], label);
        return { ok: true, text: 'Opening ' + label + '.', data: { project: p.owner + '/' + p.name, part: part, others: hits.slice(1, 5).map(function (h) { return h.owner + '/' + h.name; }) } };
      });
    } },
  { name: 'go',
    description: 'Open one of qodebase\'s main pages by its page value: home, explore (public projects), yours (your projects), inbox, build (start a new project), import (from GitHub), settings, command_line, personal_agents (install an AI assistant), own_copy (your own qodebase), about.',
    inputSchema: { type: 'object', properties: { page: { type: 'string', enum: Object.keys(PAGES) } }, required: ['page'] },
    run: function (a) {
      if (!PAGES.hasOwnProperty(a.page)) return Promise.resolve({ ok: false, text: 'No page called ' + a.page + '.' });
      navTo(PAGES[a.page], PAGE_WORDS[a.page]);
      return Promise.resolve({ ok: true, text: 'Opening ' + PAGE_WORDS[a.page] + '.', data: { page: a.page } });
    } },
];
var TOOL_BY = {};
TOOLS.forEach(function (t) { TOOL_BY[t.name] = t; });

function callTool(name, args) {
  var t = TOOL_BY[name], t0 = Date.now();
  args = args && typeof args === 'object' ? args : {};
  var p = t ? Promise.resolve().then(function () { return t.run(args); }) : Promise.resolve({ ok: false, text: 'No tool called ' + name + '.' });
  return p.catch(function (e) { return { ok: false, text: 'The tool failed.', data: { err: String(e) } }; }).then(function (r) {
    var row = { tool: name, args: args, ms: Date.now() - t0, ok: !!r.ok, path: location.pathname, text_len: (r.text || '').length };
    logEv('webmcp', row);
    try { fetch('/api/talk/log', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row) }).catch(function () {}); } catch (e) {}
    return r;
  });
}

function publishTools() {
  var pub = TOOLS.map(function (t) { return { name: t.name, description: t.description, inputSchema: t.inputSchema }; });
  window.__webmcp = { version: 1, app: 'qodebase', tools: pub, call: callTool };
  // Real WebMCP (origin trial; was navigator.modelContext before Chrome 150). One wrapper, so a moved API breaks only here.
  var mc = document.modelContext || navigator.modelContext;
  if (mc && typeof mc.registerTool === 'function') {
    pub.forEach(function (t) {
      try {
        mc.registerTool({ name: t.name, description: t.description, inputSchema: t.inputSchema,
          execute: function (args) { return callTool(t.name, args).then(function (r) { return { content: [{ type: 'text', text: r.text }], isError: !r.ok }; }); } });
      } catch (e) { logEv('webmcp_register_error', { tool: t.name, err: String(e) }); }
    });
  }
  window.dispatchEvent(new Event('webmcp:ready'));
}

// ---- Boot ----------------------------------------------------------------
fetch('/api/talk/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
  if (!j.signedIn) return;
  me = j.handle;
  build();
  publishTools();
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
