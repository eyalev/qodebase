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
function logEv(event, data) { try { console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), module: 'talk', event: event }, data || {}))); } catch (e) {} trace(event, data); }
// ---- Experience trace (the owner only, /api/talk/trace): every step, batched, sent on leaving a page.
var tq = [], tOn = false, tTimer = null, VERSION = '';
var tsid = (function () { try { var v = ss.getItem(KEY + 'sid'); if (!v) { v = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); ss.setItem(KEY + 'sid', v); } return v; } catch (e) { return 'nosid'; } })();
function trace(ev, data) {
  if (!tOn && tq.length > 300) return;
  var r = { ts: Date.now(), ev: ev, path: location.pathname };
  for (var k in data || {}) { var v = data[k]; r[k] = typeof v === 'string' ? v.slice(0, 400) : v; }
  tq.push(r);
  if (tOn && !tTimer) tTimer = setTimeout(traceFlush, 4000);
}
function traceFlush(beacon) {
  clearTimeout(tTimer); tTimer = null;
  if (!tOn || !tq.length) return;
  var body = JSON.stringify({ sid: tsid, events: tq.splice(0, 200) });
  try { if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/talk/trace', new Blob([body], { type: 'application/json' })); return; } } catch (e) {}
  fetch('/api/talk/trace', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
  if (tq.length) tTimer = setTimeout(traceFlush, 1000);
}
function traceStart() {
  tOn = true;
  var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
  trace('page', { version: VERSION || undefined, title: document.title, w: window.innerWidth, h: window.innerHeight, nav: nav.type, load_ms: nav.duration ? Math.round(nav.duration) : undefined });
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('a, button, [role=button], input, textarea, summary');
    if (!t) return;
    trace('tap', { what: t.tagName.toLowerCase(), id: t.id || undefined, talk: !!t.closest('#talk-root') || undefined, label: (t.getAttribute('aria-label') || t.innerText || t.value || t.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 80), href: t.getAttribute('href') || undefined });
  }, true);
  document.addEventListener('submit', function (e) { trace('submit', { form: (e.target && (e.target.id || e.target.getAttribute('action'))) || '' }); }, true);
  document.addEventListener('visibilitychange', function () { trace('visibility', { state: document.visibilityState }); if (document.visibilityState === 'hidden') traceFlush(true); });
  window.addEventListener('pagehide', function () { trace('leave', {}); traceFlush(true); });
  window.addEventListener('error', function (e) { trace('js_error', { msg: String(e.message || ''), src: String(e.filename || '').split('/').pop(), line: e.lineno }); });
  window.addEventListener('unhandledrejection', function (e) { trace('js_rejection', { msg: String(e.reason && (e.reason.message || e.reason)) }); });
  traceFlush();
}

var S = {
  engine: get('engine2', 'live'),   // live (Deepgram Nova-3 live words + Whisper on the whole clip, like tmux-web; default) | native | whisper
  lang: get('lang', 'en'),
  voice: get('voice', 'off'),           // spoken replies: off | aura-1 | aura-2 | phone (off by default)
  speaker: get('speaker', ''),          // Aura speaker ('' = the model's default)
  when: get('when', 'voice'),           // voice (only when I spoke) | always
  speed: Number(get('speed', '1.25')) || 1.25,   // reply speed, pitch kept (Ask's Jarvis default)
  pause: get('pause', '2500'),          // mic 'pause': send after this many ms of quiet
  mic: get('mic', 'send'),              // how the mic works: send (tap, speak, tap Send, like tmux-web; default) | pause (sends when I stop) | hold | conv (conversation)
  whisper: get('whisper', 'on'),        // re-read the whole clip with Whisper before sending (Deepgram live only)
  keep: get('keepmic', 'open'),
  clips: get('clips', 'off'),           // owner only: keep my recordings for debugging (7 days); off by default         // open = keep the mic ready while Talk is open (first words never lost) | use = only while speaking
};
// Aura-2 is the default voice since 2026-10-07 (Eyal): devices that had Aura-1 only because it was the default move once.
try { if (!ls.getItem(KEY + 'v2')) { if (ls.getItem(KEY + 'voice-on') === 'aura-1') ls.setItem(KEY + 'voice-on', 'aura-2'); if (S.voice === 'aura-1') { S.voice = 'aura-2'; S.speaker = ''; ls.setItem(KEY + 'voice', 'aura-2'); ls.removeItem(KEY + 'speaker'); } ls.setItem(KEY + 'v2', '1'); } } catch (e) {}
var CLIPS = false;   // the owner may keep recordings (set from /api/talk/me)
var LANGS = { en: 'en-US', he: 'he-IL', auto: 'en-US' };
var me = null, busy = false, listening = false, lastSpoken = false;
var hist = sget('log', []);             // [{who:'you'|'app'|'ai'|'note', text}]
var chatHist = sget('chat', []);       // [{role, content}] for the chat lane

// ---- DOM -------------------------------------------------------------------
var css = [
  '#talk-root{--t-acc:var(--acc,#17695a);--t-accfg:var(--acc-fg,#fff);--t-bg:var(--bg,#fff);--t-card:var(--card,#f6f7f8);--t-chip:var(--chip,#eceef1);--t-line:var(--line,#e2e5e9);--t-fg:var(--fg,#15171a);--t-dim:var(--dim,#5f6670);--t-warn:var(--warn,#b42d1f);font:16px/1.45 var(--t-ff);color:var(--t-fg);-webkit-tap-highlight-color:transparent}',
  // The voice bar (2026-10-13, manager's brief): a mini-player on every page, above the page's own bottom bars.
  // Mic + what you are saying (growing to 3 lines) or the last answer in one line; tap it to open the whole
  // conversation, which folds back into the bar. Its height is kept free at the end of the page.
  '#talk-bar{position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:2147483000;display:flex;align-items:flex-end;gap:4px;padding:6px;min-height:56px;box-sizing:border-box;border-radius:14px;background:var(--t-card);box-shadow:inset 0 0 0 1px var(--t-line),0 4px 16px rgba(0,0,0,.10);color:var(--t-fg)}',
  '@media (min-width:720px){#talk-bar{left:auto;right:16px;width:420px}}',
  '#talk-root.open #talk-bar{display:none}',
  '.talk-bb{width:44px;height:44px;flex:none;border:0;border-radius:10px;background:transparent;color:var(--t-fg);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}',
  '.talk-bb svg{width:22px;height:22px}',
  '.talk-bb.pri{background:var(--t-acc);color:var(--t-accfg)}',
  '.talk-bb.on{background:var(--t-warn)}',
  '@media (hover:hover){.talk-bb:not(.pri):hover{background:var(--t-chip)}}',
  '#talk-bmid{flex:1;min-width:0;min-height:44px;display:flex;align-items:center;border:0;background:transparent;color:inherit;text-align:left;padding:0 6px;font:15px/20px var(--t-ff);cursor:pointer}',
  '#talk-btext{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;overflow-wrap:anywhere}',
  '#talk-btext.dim{color:var(--t-dim)}',
  '#talk-root.live #talk-btext,#talk-root.boffer #talk-btext{-webkit-line-clamp:3}',
  '#talk-boffer{display:none;gap:6px;flex:none}',
  '#talk-root.boffer #talk-boffer{display:flex}',
  '#talk-root.boffer #talk-bexp,#talk-root.live #talk-bexp{display:none}',
  '#talk-bsend{display:none}',
  '#talk-root.live #talk-bsend{display:flex}',
  '#talk-boffer .talk-chip{min-height:44px;padding:0 12px}',
  // Pages with a composer (form.ask) keep the mic in its row: the bar there is the door to Talk, without a mic.
  '#talk-root.slim #talk-bmic{display:none}',
  '#talk-root.slim #talk-bar{min-height:48px;padding:2px 2px 2px 6px}',
  '#talk-spacer{height:0;pointer-events:none}',
  // A page can ask for less: data-talk-bar="mic" on <body> (a deck: only the mic, the words show while in use),
  // "off" (no bar; ?clean on any URL does the same, for recordings).
  '#talk-root.miconly #talk-bar{right:auto;width:auto;min-height:0}',
  '#talk-root.miconly #talk-bmid,#talk-root.miconly #talk-bexp{display:none}',
  '#talk-root.nobar #talk-bar{display:none}',
  // Pages with a composer (form.ask, [data-talk-composer]) get the mic inside it, WhatsApp-style, and no floating button.
  'body.talk-composer #talk-ver{display:none!important}',
  '.talk-cmic{width:44px;height:44px;flex:none;border-radius:12px;border:0;background:var(--acc,#17695a);color:var(--acc-fg,#fff);display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
  '.talk-cmic svg{width:22px;height:22px}',
  '.talk-cmic.on{background:var(--warn,#b42d1f)}',
  'form.talk-hassend-off .send{display:none!important}',
  'form.talk-hassend-on .talk-cmic{display:none!important}',
  '@media (max-width:600px){#talk-ver{display:none!important}}',
  '#talk-ver{position:fixed;z-index:2147483000;font:11px/1 var(--t-ff);color:var(--t-dim);font-variant-numeric:tabular-nums;pointer-events:none;text-align:center;width:72px}',
  '#talk-root.open #talk-ver{display:none}',
  '#talk-head .ver{font-size:11px;color:var(--t-dim);font-variant-numeric:tabular-nums}',
  '#talk-sheet{position:fixed;left:0;right:0;bottom:0;z-index:2147483001;background:var(--t-bg);border-top:1px solid var(--t-line);border-radius:12px 12px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.14);transform:translateY(105%);transition:transform .22s ease,height .22s ease;height:var(--talk-h,62dvh);max-height:92dvh;display:flex;flex-direction:column;padding-bottom:env(safe-area-inset-bottom)}',
  '#talk-sheet.drag{transition:none}',
  '#talk-grab{display:flex;align-items:center;justify-content:center;height:20px;margin:0;padding:0;border:0;background:transparent;width:100%;cursor:grab;touch-action:none}',
  '#talk-grab i{display:block;width:36px;height:4px;border-radius:2px;background:var(--t-line)}',
  '#talk-head{cursor:pointer}',
  '#talk-root.open #talk-sheet{transform:none}',
  '@media (min-width:720px){#talk-sheet{left:auto;right:16px;bottom:16px;width:420px;border:1px solid var(--t-line);border-radius:12px}}',
  '#talk-head{display:flex;align-items:center;gap:8px;padding:0 8px 8px 16px;border-bottom:1px solid var(--t-line)}',
  '#talk-head b{font-weight:600;font-size:15px;flex:1}',
  '#talk-head .st{font-size:13px;color:var(--t-dim);font-variant-numeric:tabular-nums}',
  '.talk-ib{width:44px;height:44px;border:0;border-radius:8px;background:transparent;color:var(--t-fg);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}',
  '.talk-ib svg{width:20px;height:20px}',
  '@media (hover:hover){.talk-ib:hover{background:var(--t-chip)}}',
  '#talk-log{overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;min-height:64px;overscroll-behavior:contain;flex:1 1 auto}',
  '#talk-log .you{align-self:flex-end;background:var(--t-acc);color:var(--t-accfg);padding:8px 12px;border-radius:12px;max-width:85%;font-size:15px}',
  '#talk-log .ai{align-self:flex-start;font-size:15px;max-width:92%;white-space:pre-line}',
  '#talk-log .app,#talk-log .note{align-self:flex-start;font-size:13px;color:var(--t-dim)}',
  '#talk-log .hint{font-size:13px;color:var(--t-dim)}',
  '#talk-live{padding:0 16px;min-height:0;font-size:15px;color:var(--t-dim)}',
  '#talk-live:not(:empty){padding:4px 16px 8px}',
  '#talk-offer{display:none;gap:8px;align-items:center;padding:0 16px 8px;font-size:15px;flex-wrap:wrap}',
  '#talk-offer.on{display:flex}',
  // A long quoted request stays three lines so Send / No stay on screen (qb8, 2026-10-08: a 900-character order pushed them off).
  '#talk-offer>span{flex:1 1 100%;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}',
  '#talk-offer{flex:none}',
  '.talk-chip{min-height:44px;padding:0 14px;border-radius:8px;border:0;background:var(--t-chip);color:var(--t-fg);font:500 15px var(--t-ff);cursor:pointer}',
  '.talk-chip.pri{background:var(--t-acc);color:var(--t-accfg)}',
  '#talk-form{display:flex;gap:8px;padding:8px 8px 8px 16px;border-top:1px solid var(--t-line);align-items:center}',
  '#talk-form{align-items:flex-end!important}',
  '#talk-in{flex:1;min-width:0;min-height:44px;max-height:35dvh;height:44px;resize:none;overflow-y:auto;box-sizing:border-box;border-radius:8px;border:1px solid var(--t-line);background:var(--t-card);color:var(--t-fg);padding:10px 12px;font:16px/22px var(--t-ff);outline:none;display:block}',
  '#talk-in.live{border-color:var(--t-acc);box-shadow:inset 0 0 0 1px var(--t-acc)}',
  '#talk-send{width:44px;height:44px;border-radius:8px;border:0;background:var(--t-chip);color:var(--t-fg);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}',
  '#talk-send svg{width:22px;height:22px}',
  '#talk-send.ready{background:var(--t-acc);color:var(--t-accfg)}',
  '#talk-in:focus{border-color:var(--t-acc)}',
  '#talk-mic{width:44px;height:44px;border-radius:8px;border:0;background:var(--t-acc);color:var(--t-accfg);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}',
  '#talk-mic svg{width:22px;height:22px}',
  '#talk-mic.on{background:var(--t-warn)}',
  '.talk-ib.on{background:var(--t-acc);color:var(--t-accfg)}',
  '#talk-set{display:none;padding:12px 16px;border-bottom:1px solid var(--t-line);gap:12px;flex-direction:column;font-size:15px}',
  '#talk-root.settings #talk-set{display:flex;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain}',
  '#talk-root.settings #talk-log,#talk-root.settings #talk-live,#talk-root.settings #talk-offer{display:none!important}',
  '#talk-set label{display:flex;flex-direction:column;gap:4px;color:var(--t-dim);font-size:13px}',
  '#talk-set select{height:44px;border-radius:8px;border:1px solid var(--t-line);background:var(--t-card);color:var(--t-fg);font:16px var(--t-ff);padding:0 8px}',
  '.talk-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
  '.talk-link{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:8px;background:var(--t-chip);color:var(--t-fg);font-size:14px;text-decoration:none}',
  '.talk-mark{outline:3px solid var(--acc,#17695a)!important;outline-offset:3px!important;border-radius:8px;transition:outline-color .12s}',
  '.talk-mark.dash{outline-style:dashed!important}',
].join('\n');

var ICON = {
  conv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

var root, sheet, logEl, live, offer, inp, micBtn, sendBtn, stEl, spk, convBtn;
var bar, bMic, bText, bOffer, bSend, bExp, spacer;
// The input grows with what you say or type (up to a third of the screen), then scrolls to the newest words.
function fitInp() { if (!inp) return; inp.style.height = 'auto'; inp.style.height = Math.max(44, inp.scrollHeight + 2) + 'px'; inp.scrollTop = inp.scrollHeight; if (sendBtn) sendBtn.classList.toggle('ready', !!inp.value.trim() || listening); }
function setInp(v) {
  if (cInto) { cInto.value = v; try { cInto.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} cInto.scrollTop = cInto.scrollHeight; return; }
  inp.value = v; fitInp(); barSync();
}
function inpVal() { return cInto ? cInto.value : inp.value; }

// ---- The mic inside a page's composer (WhatsApp-style) -----------------------------------------
// Eyal, 2026-10-12: the floating button sat on the conversation right above "Ask for a change" + Send.
// On pages with a composer the mic lives in its row: empty box → mic, text → the page's own Send.
// Tap: dictate into that box (live words, then Whisper reads the whole clip); tap again to stop.
// Long-press: open Talk. The page's Send does what it always did.
var cInto = null, cMic = null;
function wireComposers() {
  var forms = document.querySelectorAll('form.ask, [data-talk-composer]');
  var any = false;
  [].forEach.call(forms, function (f) {
    var ta = f.querySelector('textarea, input[type=text]');
    if (!ta || !f.getClientRects().length) return;
    any = true;
    if (f.__talk) { if (f.__talkSync) f.__talkSync(); return; }   // re-check: attachments can change without an input event
    f.__talk = 1;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'talk-cmic'; b.setAttribute('aria-label', 'Speak (hold for Talk)'); b.innerHTML = ICON.mic;
    // The page's own Send: .send first (an attach button can come earlier in the row, qb7's S1).
    var send = f.querySelector('.send') || f.querySelector('button[type=submit]') || f.querySelector('button:not([type])');
    if (send && send.parentNode) send.parentNode.insertBefore(b, send); else f.appendChild(b);
    // Empty: the mic. Text: the page's Send. Listening into this box: stop AND Send (tap the mic, speak, tap Send).
    var sync = function () {
      // Attached images count as something to send (qb7's chips: [data-talk-attachment] or data-talk-has="1" on the form).
      var live = listening && cInto === ta, has = !!ta.value.trim() || f.dataset.talkHas === '1' || !!f.querySelector('[data-talk-attachment]');
      f.classList.toggle('talk-hassend-on', has && !live); f.classList.toggle('talk-hassend-off', !has && !live);
    };
    ta.addEventListener('input', sync); sync(); f.__talkSync = sync;
    // Send while listening: stop, let Whisper check the words, then send them with the page's own Send.
    f.addEventListener('submit', function (e) {
      if (!(listening && cInto === ta)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      trace('cmic', { how: 'send-while-listening' }); f.__sendAfter = 1; stopListen(false, false);
    }, true);
    var lp = null, long = false;
    b.addEventListener('pointerdown', function () { long = false; lp = setTimeout(function () { long = true; trace('cmic', { how: 'long' }); open(true); if (!listening && !busy) startListen(); }, 550); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { b.addEventListener(ev, function () { clearTimeout(lp); }); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    b.addEventListener('click', function (e) {
      e.preventDefault(); if (long) return; unlockAudio();
      if (listening && cInto === ta) { trace('cmic', { how: 'stop' }); stopListen(false, false); return; }
      if (listening || busy) return;
      if (S.engine !== 'live') { open(true); startListen(); return; }   // the other engines live in the sheet
      cInto = ta; cMic = b; trace('cmic', { how: 'start', path: location.pathname });
      startListen();
    });
  });
  document.body.classList.toggle('talk-composer', any);
  if (root && root.classList.contains('slim') !== any) { root.classList.toggle('slim', any); trace('bar_slim', { on: any }); setTimeout(placeBar, 50); }
}
// Spoken into a project's "Ask for a change" box, but it sounds like something to do on the site ("open the code",
// "what's going on", "pause the run"): offer it in the bar; the words stay in the box until they say yes.
var SITE_OPS = ['go', 'back', 'press', 'scroll', 'status', 'list', 'code', 'type'];
function suggestFromComposer(text, form) {
  api('decide', { utterance: text, screen: screen() }).then(function (r) {
    var c = r && r.cmd; if (!c) return;
    var yes = SITE_OPS.indexOf(c.op) >= 0 && c.mode !== 'none' && (c.p == null || c.p >= 0.6) && !(c.op === 'type' && /ask for a change/i.test(c.label || ''));
    trace('cmic_decide', { text: text, op: c.op, mode: c.mode, p: c.p, offer: yes });
    if (!yes || listening || busy) return;
    var ta = form.querySelector('textarea, input[type=text]');
    offerOn('Not a change? I can ' + describe(c) + '.', function () {
      if (ta && ta.value.trim() === text.trim()) { ta.value = ''; try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
      preview = { text: text, cmd: c }; lastSpoken = true; submit(text);
    }, 'Do it');
  }).catch(function () {});
}
function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }

function build() {
  var st = el('style'); st.textContent = css; document.head.appendChild(st);
  root = el('div', { id: 'talk-root' });
  // The page's own font (it changes with the site's look), for every Talk control too.
  root.style.setProperty('--t-ff', getComputedStyle(document.body).fontFamily || 'sans-serif');
  // The voice bar: mic | what you are saying, or the last answer | open the conversation.
  bar = el('div', { id: 'talk-bar', role: 'region', 'aria-label': 'Talk to qodebase' });
  bMic = el('button', { id: 'talk-bmic', class: 'talk-bb pri', type: 'button', 'aria-label': 'Speak to qodebase' }, ICON.mic);
  var bMid = el('button', { id: 'talk-bmid', type: 'button', 'aria-label': 'Open the conversation' });
  bText = el('span', { id: 'talk-btext' }); bMid.appendChild(bText);
  bOffer = el('div', { id: 'talk-boffer' });
  bSend = el('button', { id: 'talk-bsend', class: 'talk-bb pri', type: 'button', 'aria-label': 'Send' }, ICON.send);
  bExp = el('button', { id: 'talk-bexp', class: 'talk-bb', type: 'button', 'aria-label': 'Open the conversation' }, ICON.up);
  bar.appendChild(bMic); bar.appendChild(bMid); bar.appendChild(bOffer); bar.appendChild(bSend); bar.appendChild(bExp);
  bMid.addEventListener('click', function () { unlockAudio(); trace('bar', { how: 'open' }); open(true); });
  bExp.addEventListener('click', function () { unlockAudio(); trace('bar', { how: 'expand' }); open(true); });
  bSend.addEventListener('click', function () { unlockAudio(); trace('bar', { how: 'send' }); if (listening) stopListen(false, true); });
  sheet = el('section', { id: 'talk-sheet', 'aria-label': 'Talk' });
  var head = el('div', { id: 'talk-head' });
  head.innerHTML = '<b>Talk</b><span class="st" id="talk-st"></span>';
  spk = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Spoken replies' }, ICON.mute);
  var gear = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Talk settings' }, ICON.gear);
  var close = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Close' }, ICON.x);
  convBtn = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Start a conversation' }, ICON.conv);
  convBtn.addEventListener('click', function () { unlockAudio(); if (vc) endConversation('you'); else startConversation(); });
  head.appendChild(convBtn); head.appendChild(spk); head.appendChild(gear); head.appendChild(close);
  var setp = el('div', { id: 'talk-set' });
  setp.innerHTML =
    '<label>Dictation<select id="talk-s-engine"><option value="live">Deepgram live (Cloudflare): words as you speak</option><option value="native">Phone’s own (Chrome), free, live words</option><option value="whisper">Whisper on Cloudflare, steadier with names</option></select></label>' +
    '<label>How the mic works<select id="talk-s-mic"><option value="send">Tap the mic, speak, tap Send (like tmux-web)</option><option value="pause">Tap the mic; it sends when I stop talking</option><option value="hold">Hold the mic while I talk; letting go sends</option><option value="conv">Conversation: it keeps listening and talks back</option></select></label>' +
    '<label>Send after a pause of<select id="talk-s-pause"><option value="1500">1.5 s</option><option value="2500">2.5 s</option><option value="4000">4 s</option></select></label>' +
    '<label>Check the words with Whisper<select id="talk-s-whisper"><option value="on">On: the whole recording is read again (steadier, about 1.5 s)</option><option value="off">Off: send the live words right away</option></select></label>' +
    '<label>Microphone<select id="talk-s-keep"><option value="open">Ready while Talk is open (your first words are never lost)</option><option value="use">Only while I speak</option></select></label>' +
    '<label>Language<select id="talk-s-lang"><option value="en">English</option><option value="he">עברית (Hebrew)</option><option value="auto">Auto (Whisper detects)</option></select></label>' +
    '<label>Spoken replies<select id="talk-s-voice"><option value="off">Off</option><option value="aura-2">Natural voice (Cloudflare Aura 2)</option><option value="aura-1">Lighter voice (Aura 1, half the price)</option><option value="phone">The phone\u2019s own voice</option></select></label>' +
    '<label>Voice<select id="talk-s-speaker"></select></label>' +
    '<label>Speed<select id="talk-s-speed"><option value="1">1\u00d7</option><option value="1.1">1.1\u00d7</option><option value="1.15">1.15\u00d7</option><option value="1.25">1.25\u00d7</option><option value="1.4">1.4\u00d7</option><option value="1.6">1.6\u00d7</option></select></label>' +
    '<label>Speak<select id="talk-s-when"><option value="voice">When I talked</option><option value="always">Always</option></select></label>' +
    (CLIPS ? '<label>Keep my recordings (only you can hear them, deleted after 7 days)<select id="talk-s-clips"><option value="off">Off</option><option value="on">On, for debugging</option></select></label>' : '') +
    '<button type="button" class="talk-chip" id="talk-s-clear">Clear the conversation</button>' +
    '<button type="button" class="talk-chip pri" id="talk-s-done">Done</button>';
  logEl = el('div', { id: 'talk-log', 'aria-live': 'polite' });
  live = el('div', { id: 'talk-live' });
  offer = el('div', { id: 'talk-offer' });
  var form = el('form', { id: 'talk-form' });
  inp = el('textarea', { id: 'talk-in', rows: '1', enterkeyhint: 'send', autocomplete: 'off', placeholder: 'Say or type: open my calculator', 'aria-label': 'Talk to qodebase' });
  micBtn = el('button', { id: 'talk-mic', type: 'button', 'aria-label': 'Speak' }, ICON.mic);
  sendBtn = el('button', { id: 'talk-send', type: 'submit', 'aria-label': 'Send' }, ICON.send);
  form.appendChild(inp); form.appendChild(micBtn); form.appendChild(sendBtn);
  inp.addEventListener('input', function () { fitInp(); });
  inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); } });
  var grab = el('button', { id: 'talk-grab', type: 'button', 'aria-label': 'Drag to resize Talk, tap to fold it into the bar' }, '<i></i>');
  sheet.appendChild(grab); sheet.appendChild(head); sheet.appendChild(setp); sheet.appendChild(logEl); sheet.appendChild(live); sheet.appendChild(offer); sheet.appendChild(form);
  var h0 = Number(get('h', 0)); if (h0 > 0) sheet.style.setProperty('--talk-h', h0 + 'px');
  // Tap the header (not its buttons) to fold the conversation back into the bar.
  head.addEventListener('click', function (e) { if (e.target.closest('button')) return; open(false); });
  dragHandle(grab);
  if (VERSION) {
    var vb = el('div', { id: 'talk-ver', 'aria-hidden': 'true' }); vb.textContent = VERSION; root.appendChild(vb);
    var vh = el('span', { class: 'ver' }); vh.textContent = VERSION; head.querySelector('b').after(vh);
  }
  root.appendChild(bar); root.appendChild(sheet);
  spacer = el('div', { id: 'talk-spacer', 'aria-hidden': 'true' });
  document.body.appendChild(spacer);
  document.body.appendChild(root);
  wireComposers(); setInterval(wireComposers, 1500);
  placeBar(); window.addEventListener('resize', function () { scrollers = null; placeBar(); }); setTimeout(placeBar, 600); setTimeout(function () { scrollers = null; placeBar(); }, 2500); setInterval(placeBar, 3000);
  stEl = document.getElementById('talk-st');

  // The bar's mic works like the sheet's ("How the mic works"): tap, speak, tap Send; hold; pause; conversation.
  // Speaking from the bar keeps the page in view: the words grow in the bar, the answer comes back to it.
  var bHoldT = null, bHeld = false;
  bMic.addEventListener('pointerdown', function () { if (S.mic !== 'hold' || vc || listening) return; unlockAudio(); bHeld = false; bHoldT = setTimeout(function () { bHeld = true; startListen(); try { navigator.vibrate && navigator.vibrate(20); } catch (e) {} }, 150); });
  var bHoldEnd = function () { clearTimeout(bHoldT); if (S.mic === 'hold' && bHeld && listening) { trace('bar', { how: 'release' }); stopListen(false, true); } };
  bMic.addEventListener('pointerup', bHoldEnd); bMic.addEventListener('pointercancel', bHoldEnd); bMic.addEventListener('pointerleave', bHoldEnd);
  bMic.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  bMic.addEventListener('click', function () {
    unlockAudio();
    if (S.mic === 'hold') { if (bHeld) { bHeld = false; return; } if (!listening) { bNote('Hold the mic while you talk'); } return; }
    if (S.mic === 'conv') { if (vc) endConversation('you'); else { startConversation(); } return; }
    if (vc) { vc.toggleMute(); return; }
    if (listening) { trace('bar', { how: 'stop-tap', mode: S.mic }); stopListen(false, true); return; }
    trace('bar', { how: 'mic', mode: S.mic }); if (S.engine === 'live') { dcWarm(); } startListen();
  });
  close.addEventListener('click', function () { open(false); });
  gear.addEventListener('click', function () { var on = root.classList.toggle('settings'); if (on) setp.scrollTop = 0; trace('settings', { open: on }); });
  // The mic follows "How the mic works": send (tap, speak, tap Send), pause (sends when you stop), hold, conv.
  var holdT = null, held = false;
  micBtn.addEventListener('pointerdown', function () { if (S.mic !== 'hold' || vc || listening) return; unlockAudio(); held = false; holdT = setTimeout(function () { held = true; startListen(); try { navigator.vibrate && navigator.vibrate(20); } catch (e) {} }, 150); });
  var holdEnd = function () { clearTimeout(holdT); if (S.mic === 'hold' && held && listening) { trace('mic', { how: 'release' }); stopListen(false, true); } };
  micBtn.addEventListener('pointerup', holdEnd); micBtn.addEventListener('pointercancel', holdEnd); micBtn.addEventListener('pointerleave', holdEnd);
  micBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  micBtn.addEventListener('click', function () {
    unlockAudio();
    if (S.mic === 'hold') { if (held) { held = false; return; } if (!listening) status('Hold the mic while you talk'); return; }
    if (S.mic === 'conv') { if (vc) endConversation('you'); else startConversation(); return; }
    if (vc) { vc.toggleMute(); return; }
    if (listening) { trace('mic', { how: 'stop-tap', mode: S.mic }); stopListen(false, S.mic === 'pause'); } else startListen();
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault(); unlockAudio();
    // Send while listening: stop, let Whisper check the words, then send them.
    if (listening && dcOn) { trace('mic', { how: 'send-tap' }); stopListen(false, true); return; }
    if (listening) { stopListen(false); return; }
    var v = inp.value.trim(); if (!v) return; setInp('');
    if (vc) { vcActive(); vc.sendText(v); return; }
    lastSpoken = false; submit(v);
  });
  var se = document.getElementById('talk-s-engine'), sl = document.getElementById('talk-s-lang'), sv = document.getElementById('talk-s-voice'), sk = document.getElementById('talk-s-speaker'), sw = document.getElementById('talk-s-when');
  se.value = S.engine; sl.value = S.lang; sv.value = S.voice; sw.value = S.when;
  var fillSpeakers = function () {
    var list = SPEAKERS[S.voice] || [];
    sk.innerHTML = list.map(function (n) { return '<option value="' + n + '">' + n.charAt(0).toUpperCase() + n.slice(1) + '</option>'; }).join('');
    if (list.indexOf(S.speaker) < 0) S.speaker = list[0] || '';
    sk.value = S.speaker; sk.parentNode.style.display = list.length ? '' : 'none';
    sw.parentNode.style.display = S.voice === 'off' ? 'none' : '';
    var spd = document.getElementById('talk-s-speed'); if (spd) spd.parentNode.style.display = S.voice === 'phone' ? 'none' : '';
  };
  fillSpeakers();
  sv.onchange = function () { S.voice = sv.value; set('voice', S.voice); if (S.voice !== 'off') set('voice-on', S.voice); fillSpeakers(); set('speaker', S.speaker); voiceBtn(); if (S.voice !== 'off') { unlockAudio(); lastSpoken = true; say('This is how I sound.'); } };
  sk.onchange = function () { S.speaker = sk.value; set('speaker', S.speaker); unlockAudio(); lastSpoken = true; say('This is how I sound.'); };
  sw.onchange = function () { S.when = sw.value; set('when', S.when); };
  var spz = document.getElementById('talk-s-pause'); spz.value = S.pause === 'tap' ? '2500' : S.pause;
  spz.onchange = function () { S.pause = spz.value; set('pause', S.pause); trace('setting', { pause: S.pause }); };
  var sclp = document.getElementById('talk-s-clips');
  if (sclp) { sclp.value = S.clips; sclp.onchange = function () { S.clips = sclp.value; set('clips', S.clips); trace('setting', { clips: S.clips }); }; }
  var smic = document.getElementById('talk-s-mic'), swh = document.getElementById('talk-s-whisper'), skp = document.getElementById('talk-s-keep');
  var showMic = function () { spz.parentNode.style.display = S.mic === 'pause' ? '' : 'none'; swh.parentNode.style.display = S.engine === 'live' && S.mic !== 'conv' ? '' : 'none'; micBtn.setAttribute('aria-label', S.mic === 'hold' ? 'Hold to speak' : S.mic === 'conv' ? 'Start a conversation' : 'Speak'); };
  smic.value = S.mic; swh.value = S.whisper; skp.value = S.keep; showMic();
  smic.onchange = function () { S.mic = smic.value; set('mic', S.mic); trace('setting', { mic: S.mic }); showMic(); };
  swh.onchange = function () { S.whisper = swh.value; set('whisper', S.whisper); trace('setting', { whisper: S.whisper }); };
  skp.onchange = function () { S.keep = skp.value; set('keepmic', S.keep); trace('setting', { keep: S.keep }); if (S.keep === 'open') warmMic(); else releaseMic(); };
  var sspd = document.getElementById('talk-s-speed'); sspd.value = String(S.speed);
  sspd.onchange = function () { S.speed = Number(sspd.value) || 1.25; set('speed', String(S.speed)); trace('setting', { speed: S.speed }); vcVoice(); if (S.voice !== 'off') { unlockAudio(); lastSpoken = true; say('This is how fast I talk.'); } };
  spk.addEventListener('click', function () { unlockAudio(); S.voice = S.voice === 'off' ? get('voice-on', 'aura-2') : 'off'; set('voice', S.voice); sv.value = S.voice; fillSpeakers(); voiceBtn(); if (S.voice === 'off') stopSpeaking(); });
  voiceBtn();
  se.onchange = function () { S.engine = se.value; set('engine2', S.engine); trace('setting', { engine: S.engine }); if (S.engine === 'live') dcWarm(); showMic(); };
  sl.onchange = function () { S.lang = sl.value; set('lang', S.lang); };
  document.getElementById('talk-s-done').onclick = function () { root.classList.remove('settings'); trace('settings', { open: false }); };
  document.getElementById('talk-s-clear').onclick = function () { hist = []; chatHist = []; sset('log', hist); sset('chat', chatHist); render(); root.classList.remove('settings'); };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('open')) { stopListen(true); open(false); }
  });
  render();
}

function open(on) { if (on && S.engine === 'live' && me) { dcWarm(); warmMic(); } if (!on) releaseMic(); trace('sheet', { open: !!on, bar: root.classList.contains('bar') }); root.classList.toggle('open', !!on); sset('open', !!on); if (on) setTimeout(function () { logEl.scrollTop = logEl.scrollHeight; }, 50); }
// Sit above the page's own bottom bar (a project's tabs and its "Ask for a change" box), whatever it is, and keep
// the bar's height free at the end of the page (and of the page's own scrolling panel, on project pages).
var scrollers = null, lastLift = -1;
function placeBar() {
  if (!bar) return;
  // Walk up from the bottom edge: each short bar touching the one below (fixed, sticky, or a page
  // that lays out as a full-height column, like a project page's tabs + "Ask for a change") lifts the button.
  // A dock inset from the edge (bottom: 8px) counts too: probes at 4/12/20 px and 20 px tolerance, also at the
  // button's own side (qb7, 2026-10-12: a home-page dock with bottom:8px was covered by the button).
  var y = window.innerHeight, lift = 0;
  root.style.pointerEvents = 'none';   // probe the page under the bar, not the bar
  for (var n = 0; n < 4; n++) {
    var top = null;
    [0.15, 0.5, 0.85].forEach(function (fx) {
      [4, 12, 20].forEach(function (dy) {
        var e = document.elementFromPoint(Math.round(window.innerWidth * fx), y - dy);
        var dock = null;
        for (; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
          if (root.contains(e) || e === spacer) { dock = null; break; }
          var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
          var pinned = cs.position === 'fixed' || cs.position === 'sticky' || e.parentElement === document.body;
          if (pinned && r.height < window.innerHeight * 0.3 && y - r.bottom > -3 && y - r.bottom < 20) { dock = e; break; }
        }
        if (dock) { var t = dock.getBoundingClientRect().top; top = top === null ? t : Math.min(top, t); }
      });
    });
    if (top === null) break;
    lift = window.innerHeight - top; y = top;
  }
  root.style.pointerEvents = '';
  // A page can name its docks: [data-talk-dock] near the bottom always lifts the button above it.
  [].forEach.call(document.querySelectorAll('[data-talk-dock]'), function (d) {
    var r = d.getBoundingClientRect();
    if (r.height > 0 && r.bottom > window.innerHeight - 48 && r.top < window.innerHeight) lift = Math.max(lift, window.innerHeight - r.top);
  });
  lift = Math.round(lift);
  bar.style.bottom = 'calc(' + (lift ? lift + 8 : 8) + 'px + env(safe-area-inset-bottom))';
  var vb = document.getElementById('talk-ver');
  if (vb) { vb.style.right = '6px'; vb.style.bottom = 'calc(' + (lift + bar.offsetHeight + 12) + 'px + env(safe-area-inset-bottom))'; }
  reserve(lift);
}
// The bar covers the last ~64 px above the page's own bottom bars: the page gets that much more room at its end.
// Body-scrolling pages: a spacer after everything. Pages that scroll a panel of their own (a project page's view
// between its header and its composer): that panel's bottom padding, measured once the page has drawn.
function reserve(lift) {
  var r = bar.getBoundingClientRect(), need = Math.round(r.height + 16);
  if (!r.height || root.classList.contains('open')) return;
  // Only a page that scrolls as a whole gets the spacer: an app-like page (a full-height column) must not start to scroll.
  var docH = document.documentElement.scrollHeight - (spacer.offsetHeight || 0);
  var sp = docH > window.innerHeight + 4 ? need : 0;
  if (spacer.offsetHeight !== sp) spacer.style.height = sp + 'px';
  if (!scrollers) {
    scrollers = [].filter.call(document.querySelectorAll('main, [class*=view], [class*=scroll], section, div'), function (e) {
      if (root.contains(e) || e === document.body) return false;
      var cs = getComputedStyle(e);
      return /(auto|scroll)/.test(cs.overflowY) && e.clientHeight > 200 && e.clientWidth > 280;
    }).slice(0, 4);
  }
  scrollers.forEach(function (e) {
    if (e.__talkPad == null) e.__talkPad = parseFloat(getComputedStyle(e).paddingBottom) || 0;
    var er = e.getBoundingClientRect(), over = er.bottom - r.top;
    var pad = over > 0 ? Math.round(over + 12) : 0;
    if (e.__talkAdd !== pad) { e.__talkAdd = pad; e.style.paddingBottom = (e.__talkPad + pad) + 'px'; }
  });
  if (lift !== lastLift) { lastLift = lift; trace('bar_place', { lift: lift, h: Math.round(r.height), spacer: sp, scrollers: scrollers.length }); }
}
// The handle: drag to any height (remembered), low enough folds the conversation into the bar; a tap folds it.
function dragHandle(g) {
  var y0 = 0, h0 = 0, moved = false, on = false;
  g.addEventListener('pointerdown', function (e) { on = true; moved = false; y0 = e.clientY; h0 = sheet.getBoundingClientRect().height; g.setPointerCapture(e.pointerId); });
  g.addEventListener('pointermove', function (e) {
    if (!on) return;
    var dy = y0 - e.clientY;
    if (!moved && Math.abs(dy) < 6) return;
    if (!moved) { moved = true; sheet.classList.add('drag'); }
    var h = Math.max(96, Math.min(window.innerHeight * 0.92, h0 + dy));
    sheet.style.setProperty('--talk-h', h + 'px');
  });
  var end = function () {
    if (!on) return; on = false; sheet.classList.remove('drag');
    if (!moved) return open(false);
    var h = sheet.getBoundingClientRect().height;
    if (h < 200) { sheet.style.setProperty('--talk-h', (Number(get('h', 0)) || window.innerHeight * 0.62) + 'px'); return open(false); }
    set('h', Math.round(h)); trace('sheet', { h: Math.round(h) });
  };
  g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
}
function status(t) { stEl.textContent = t || ''; barSync(); }
function add(who, text, links) { if (run && who !== 'you') run.texts.push(String(text)); hist.push({ who: who, text: String(text), links: links || undefined }); if (hist.length > 40) hist = hist.slice(-40); sset('log', hist); render(); }
function render() {
  logEl.innerHTML = '';
  if (!hist.length) {
    var h = el('div', { class: 'hint' });
    h.textContent = 'Try: “open my calculator”, “show me the code of the timer”, “what is this page?”, “build a habit tracker”.';
    logEl.appendChild(h);
  }
  var lastMsg = hist.length ? hist[hist.length - 1] : null;
  barSync();
  hist.forEach(function (m) {
    var d = el('div', { class: m.who });
    // Answers from the code reader come as light markdown: show it as plain lines.
    d.textContent = m.who === 'ai' ? String(m.text).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\x60([^\x60]+)\x60/g, '$1').replace(/^\s*[-*] /gm, '\u2022 ') : m.text;
    if (m.links && m.links.length) {
      var row = el('div', { class: 'talk-links' });
      m.links.forEach(function (l) { if (!/^\/[^/]/.test(l.href)) return; var a = el('a', { href: l.href, class: 'talk-link' }); a.textContent = l.text; row.appendChild(a); });
      d.appendChild(row);
    }
    logEl.appendChild(d);
  });
  logEl.scrollTop = logEl.scrollHeight;
}

// The bar shows one thing: the question waiting for a yes, what you are saying, what Talk is doing, or the last answer.
function barSync() {
  if (!bar) return;
  var mine = listening && !cInto;   // words for Talk (a page's composer shows its own)
  root.classList.toggle('live', mine && !offerState);
  root.classList.toggle('boffer', !!offerState);
  var t = '', dim = false, last = null;
  for (var i = hist.length - 1; i >= 0; i--) if (hist[i].who !== 'you') { last = hist[i]; break; }
  if (offerState) t = offerState.text || (last ? last.text : 'Go ahead?');
  else if (mine) { t = inp.value.trim(); if (!t) { t = stEl.textContent || 'Listening\u2026'; dim = true; } }
  else if (busy && stEl.textContent) { t = stEl.textContent; dim = true; }
  else if (last) t = last.text;
  else { t = 'Say what you want to do'; dim = true; }
  bText.textContent = String(t).replace(/\s+/g, ' ').trim();
  bText.classList.toggle('dim', dim);
  var on = (listening && !cInto) || (vc && vcStatus !== 'idle');
  bMic.classList.toggle('on', !!on); bMic.innerHTML = on ? ICON.stop : ICON.mic;
  bMic.setAttribute('aria-label', on ? 'Stop' : 'Speak to qodebase');
  barMode();
}
function bNote(t) { add('note', t); }
var miniT = null;
function barMode() {
  var m = document.body.getAttribute('data-talk-bar') || '';
  if (/[?&](clean|rec=1)\b/.test(location.search) || document.body.classList.contains('rec')) m = 'off';
  root.classList.toggle('nobar', m === 'off');
  if (m !== 'mic') { root.classList.remove('miconly'); return; }
  // Mic only, unless something is happening; the last answer stays readable for 6 s.
  var active = listening || busy || !!offerState || (vc && vcStatus !== 'idle');
  clearTimeout(miniT);
  if (active) root.classList.remove('miconly');
  else miniT = setTimeout(function () { root.classList.add('miconly'); placeBar(); }, root.classList.contains('miconly') ? 0 : 6000);
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
var lastText = '';
function submit(text) {
  lastText = String(text || '');
  trace('said', { text: text, spoken: lastSpoken, engine: lastSpoken ? S.engine : 'typed' });
  if (busy) return;
  // A short yes / no answers the question on screen (Stop this run? Send it to the agents?): no model.
  var said = String(text || '').trim(), short = said.split(/\s+/).length <= 5;
  if (offerState && short && YES_RX.test(said)) { var y = offerState.yes; trace('offer_voice', { answer: 'yes', text: said }); add('you', said); offerOff(); y(); return; }
  if (offerState && said.split(/\s+/).length <= 3 && NO_RX.test(said)) { trace('offer_voice', { answer: 'no', text: said }); add('you', said); offerOff(); add('app', 'Okay, I left it.'); return; }
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
    // Delete, sign out, revoke: never by voice. Stop, pause, merge, build, spend: after a yes (said or tapped).
    var g = gateOf(c);
    if (g) logEv('gate', { op: c.op, label: c.label, risky: c.risky, destroys: c.destroys, gate: g });
    if (g === 'refuse') {
      add('ai', 'That would remove something for good, so I will leave the doing to you.');
      if (c.op === 'go' && c.href) offerOn('Take me to ' + (c.label || 'that page') + '?', function () { act(c); });
      else if (c.target && byId(c.target)) { unmark(); mark(byId(c.target)); }
      return done();
    }
    if (g === 'confirm') {
      var q = confirmLine(c);
      add('ai', q); say(q);
      var t = byId(c.target); if (t && t.getClientRects().length) { unmark(); mark(t, true); }
      offerOn(q, function () { unmark(); c.confirmed = true; act(c); }, confirmVerb(c));
      return done();
    }
    if (c.greet) { var hi = greeting(c.example); add('ai', hi); say(hi); return done(); }
    if (c.mode === 'none') { add('note', (c.complete || 0) < 0.5 ? 'Sounds cut off. Say it again?' : 'I did not catch a request there.'); return done(); }
    if (c.op === 'status') return whatsGoingOn(text);
    if (c.op === 'list') {
      var n = Number(c.target) || 0;
      var line = n ? 'You have ' + n + ' project' + (n === 1 ? '' : 's') + '. The latest: ' + c.text + '.' : 'You have no projects yet. Say what you want to build.';
      add('ai', line); say(line);
      if (n && location.pathname !== '/mine') { sset('last', 'your projects'); setTimeout(function () { act({ op: 'go', href: '/mine', label: 'your projects' }); }, 400); return; }
      return done();
    }
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
// The gate (same words as talkdecide.ts gate(), which the conversation agent uses).
var CONFIRM_RX = /^(stop|pause|resume|merge|build it|build|send back|start|watch a run|run for real|replay|replace|connect my plan|save the key|shot|fork|import)\b/i;
var DESTROY_RX = /^(remove|delete|revoke|sign out|log out|uninstall|disconnect|make (it )?(private|public)|clear)\b/i;
var YES_RX = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|do it|go( ahead)?|please( do)?|confirm|send( it)?|fork( it)?|stop it|go for it)\b/i;
var NO_RX = /^\s*(no|nope|nah|cancel|don'?t|never ?mind|not now|leave it)\b/i;
function gateOf(c) {
  if (['press', 'go', 'type'].indexOf(c.op) < 0) return (c.risky || 0) >= 0.5 && ['status', 'list', 'code'].indexOf(c.op) < 0 ? 'refuse' : null;
  var label = String(c.label || '').trim();
  if ((c.destroys || 0) >= 0.5 || DESTROY_RX.test(label)) return 'refuse';
  if ((c.risky || 0) >= 0.5 || (c.op === 'press' && CONFIRM_RX.test(label))) return 'confirm';
  return null;
}
function plainLabel(l) { return String(l || '').replace(/\s*\((switch|tab|choice|slider)[^)]*\)$/, '').replace(/\s*\((.*)\)$/, ', $1'); }
function confirmLine(c) {
  if (c.op === 'press') return 'Press \u201c' + plainLabel(c.label) + '\u201d? Say yes, or tap ' + confirmVerb(c) + '.';
  if (c.op === 'go') return 'Open ' + (c.label || 'that page') + '? Say yes, or tap Go.';
  return describe(c) + '? Say yes, or tap Go.';
}
function confirmVerb(c) { var w = String(c.label || '').trim().split(/\s+/)[0] || 'Go'; return c.op === 'press' && w.length <= 10 ? w.charAt(0).toUpperCase() + w.slice(1) : 'Go'; }
// A greeting or small talk: a friendly line and three things to try, one with their own project.
function greeting(example) {
  var p = example || 'todo';
  return 'Hi! I can find things, open your projects, and answer questions about them. Try \u201cwhat\u2019s going on\u201d, \u201copen my ' + p + '\u201d, or \u201chow does my ' + p + ' work?\u201d';
}

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
  // The whole request: the server decides on the first 300 characters only, so a long order (qb8's 900-character
  // café list) would otherwise reach the router cut short.
  var text = lastText && c.text && lastText.indexOf(String(c.text).slice(0, 60)) === 0 ? lastText : c.text;
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
  // The confirm quotes the start of a long request (the whole text is what gets sent).
  var quote = text.length > 160 ? text.slice(0, 150).replace(/\s+\S*$/, '') + '\u2026' : text;
  offerOn('Send to ' + owner + '/' + name + '\u2019s agents: \u201c' + quote + '\u201d?', function () { busy = true; sendChange(owner, name, text); }, 'Send');
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
  if (!vc) say('Reading the code.');   // in a conversation the agent already said it
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
        // In a conversation the agent speaks it and the transcript shows it: add it here only when typing.
        if (vc) speakOut(j.answer || 'No answer came back.'); else { add('ai', j.answer || 'No answer came back.'); say(j.answer || ''); }
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
  projPost(owner, name, 'router', { text: text, from: 'talk' }).then(function (r) {
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
  if (c.op === 'status') return 'tell you what is going on';
  if (c.op === 'list') return 'list your projects';
  if (c.op === 'code') return 'read the code of ' + (c.label || 'the project') + ' to answer';
  return c.op;
}

function act(c, withPreview) {
  var target = c.target && /^x/.test(c.target) ? null : find(c);
  var go = function () {
    unmark();
    if (c.op === 'go' && /^#/.test(String(c.href || ''))) c.href = location.pathname + location.search + c.href;
    if (c.op === 'go') {
      // A place on this same page (#/run/…, #/timeline): change the hash, the page draws it; no reload.
      var u = null; try { u = new URL(c.href, location.href); } catch (e) {}
      if (u && u.origin === location.origin && u.pathname === location.pathname && u.search === location.search && u.hash && u.hash !== location.hash) {
        location.hash = u.hash; add('app', 'Opened ' + (c.label || u.hash) + '.'); sset('last', c.label || u.hash);
        setTimeout(function () { scrollers = null; placeBar(); }, 400);
        return after();
      }
    }
    if (c.op === 'go' && String(c.href).replace(/\/$/, '') === (location.pathname + location.search).replace(/\/$/, '')) {
      // Already here: a reload would drop the conversation and repeat the page for nothing.
      add('app', 'You are on ' + (c.label || 'that page') + '.');
      return done();
    }
    if (c.op === 'go') {
      add('app', 'Opening ' + (c.label || c.href) + '…');
      sset('last', c.label || c.href);
      busy = false;
      leave(function () { location.assign(c.href); });
      return;
    }
    if (c.op === 'back') { add('app', 'Going back…'); busy = false; leave(function () { history.back(); }); return; }
    if (c.op === 'press' && c.target && /^x/.test(c.target)) { return pageAction(c); }
    if (c.op === 'press' && target) {
      var before = visibleButtons();
      add('app', 'Pressed \u201c' + plainLabel(c.label) + '\u201d.'); target.click();
      // A button that asks again ("Stop" → "Stop this run", "Remove" → tap again): after a yes, press the second one too.
      if (c.confirmed) return followConfirm(c, before);
    }
    else if (c.op === 'type' && target) { typeInto(target, c.text); add('app', target.tagName === 'SELECT' || target.type === 'range' ? 'Set \u201c' + plainLabel(c.label) + '\u201d to ' + (target.tagName === 'SELECT' ? (target.selectedOptions[0] || {}).textContent : target.value) + '.' : 'Typed \u201c' + c.text + '\u201d.'); if (target.tagName !== 'SELECT' && target.type !== 'range') offerSubmit(target); }
    else if (c.op === 'scroll') {
      if (c.section === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (c.section === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      else if (target) { mark(target); setTimeout(unmark, 1800); }
      add('app', 'Scrolled to ' + (c.label || c.section) + '.');
    }
    else if (c.op === 'search') { add('note', 'There is no search box on this page.'); return ask('Find ' + c.text, ''); }
    else { add('note', 'Could not find that on the page any more.'); logEv('act_missing', { op: c.op, target: c.target, label: c.label }); }
    after();
  };
  var after = function () {
    var p = sget('pending', null);
    if (p) { sset('pending', null); return ask(p.text, p.did); }
    done();
  };
  var start = function () { if (withPreview && target && target.getClientRects().length) { mark(target, true); status(describe(c)); setTimeout(go, 450); } else go(); };
  // Inside a closed panel (Build's settings, a closed <details>): open it first, then do it.
  if (target && !target.getClientRects().length) reveal(target, function () { target = find(c) || target; start(); }); else start();
}
// The element a command names. Pages that redraw every few seconds (Runs, Agents at work) drop the data-talk ids:
// read the page again and take the element with the same words.
function find(c) {
  var e = c.target ? byId(c.target) : null;
  if (e && document.contains(e)) return e;
  if (!c.label) return null;
  var want = String(c.label).toLowerCase(), bare = want.replace(/\s*\(.*\)$/, '');
  var items = talkScan(document);
  var hit = items.filter(function (i) { return i.text.toLowerCase() === want; })[0] || items.filter(function (i) { return i.text.toLowerCase().replace(/\s*\(.*\)$/, '') === bare; })[0];
  trace('refind', { label: c.label, id: hit ? hit.id : null });
  return hit ? byId(hit.id) : null;
}
function reveal(e, cb) {
  var d = e.closest('details:not([open])'); if (d) d.open = true;
  var h = e.closest('[hidden]');
  if (h && h.id) { var t = document.querySelector('[aria-controls="' + h.id + '"]'); if (t && t.getClientRects().length) t.click(); }
  trace('reveal', { details: !!d, panel: h ? h.id || h.className : null });
  setTimeout(cb, 300);
}
function visibleButtons() { return [].filter.call(document.querySelectorAll('button, [role=button]'), function (b) { return b.getClientRects().length && !root.contains(b); }); }
function followConfirm(c, before) {
  var verb = String(c.label || '').trim().split(/\s+/)[0].toLowerCase();
  setTimeout(function () {
    var again = visibleButtons().filter(function (b) {
      if (before.indexOf(b) >= 0) return false;
      var t = String(b.getAttribute('aria-label') || b.innerText || '').trim().toLowerCase();
      return verb && t.indexOf(verb) === 0;
    })[0];
    trace('follow_confirm', { label: c.label, found: again ? String(again.innerText || '').trim().slice(0, 60) : null });
    if (again) { again.click(); add('app', 'Pressed \u201c' + String(again.innerText || again.getAttribute('aria-label') || '').trim() + '\u201d.'); }
    done();
  }, 400);
}
// Actions a page names itself (window.__talkActions: a moment on a timeline, the next slide): run with the sentence.
function pageAction(c) {
  var list = window.__talkActions || [], a = null;
  list.forEach(function (x, i) { if ('x' + (x.id || i) === c.target) a = x; });
  if (!a) { add('note', 'Could not find that on the page any more.'); return done(); }
  var t0 = Date.now();
  Promise.resolve().then(function () { return a.run(lastText || c.text || ''); }).then(function (r) {
    logEv('page_action', { id: c.target, ms: Date.now() - t0, ok: r !== false });
    add('app', typeof r === 'string' ? r : r === false ? 'That did not work here.' : 'Done: ' + a.text + '.');
    done();
  }).catch(function (e) { logEv('page_action', { id: c.target, err: String(e) }); add('note', 'That did not work: ' + String(e && e.message || e)); done(); });
}

var NUMS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, fifty: 50, hundred: 100 };
function typeInto(t, text) {
  if (t.tagName === 'SELECT') {
    // The option whose words match what was said ("Sonnet", "the cheapest one").
    var w = String(text || '').toLowerCase(), best = null;
    [].forEach.call(t.options, function (o) { var ot = String(o.textContent || '').toLowerCase(); if (!best && (ot === w || o.value.toLowerCase() === w)) best = o; });
    if (!best) [].forEach.call(t.options, function (o) { var ot = String(o.textContent || '').toLowerCase(); if (!best && (ot.indexOf(w) >= 0 || w.indexOf(ot) >= 0 || w.indexOf(o.value.toLowerCase()) >= 0)) best = o; });
    if (best) { t.value = best.value; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); }
    return;
  }
  if (t.type === 'range') {
    var m = /-?\d+(\.\d+)?/.exec(String(text)), v = m ? Number(m[0]) : NUMS[String(text).toLowerCase().replace(/[^a-z]/g, '')];
    if (v == null || isNaN(v)) return;
    v = Math.max(Number(t.min || 0), Math.min(Number(t.max || 100), v));
    var rs = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; rs.call(t, String(v));
    t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  t.focus();
  if (t.isContentEditable) { t.textContent = text; t.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
  var proto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(t, text);
  t.dispatchEvent(new Event('input', { bubbles: true }));
  t.dispatchEvent(new Event('change', { bubbles: true }));
}
function offerSubmit(t) {
  var f = t.form, b = null;
  if (f) b = f.querySelector('button[type=submit], button:not([type])');
  else {
    // A box outside a form ("What should change?" + "Send back to Agent 3"): the send-like button next to it.
    for (var box = t.parentElement, i = 0; box && i < 4 && !b; box = box.parentElement, i++)
      b = [].filter.call(box.querySelectorAll('button'), function (x) { return x.getClientRects().length && /^(send|ask|save|post|reply|answer)/i.test(String(x.innerText || x.getAttribute('aria-label') || '').trim()); })[0] || null;
    if (b) { var lab = String(b.innerText || 'Send').trim(); offerOn('Send it?', function () { if (CONFIRM_RX.test(lab)) { add('app', 'Pressed \u201c' + lab + '\u201d.'); } b.click(); }, lab.split(/\s+/)[0]); }
    return;
  }
  if (!b) return;
  offerOn('Send it?', function () { if (f.requestSubmit) f.requestSubmit(b); else b.click(); }, (b.innerText || 'Send').trim());
}

var offerState = null;
function offerOn(text, yes, yesLabel) {
  if (run) run.texts.push(text);
  offerState = { text: text || '', yes: yes, label: yesLabel || 'Go' };
  bOffer.innerHTML = '';
  var by = el('button', { type: 'button', class: 'talk-chip pri' }); by.textContent = yesLabel || 'Go';
  var bn = el('button', { type: 'button', class: 'talk-chip', 'aria-label': 'No' }); bn.textContent = 'No';
  by.onclick = function () { unlockAudio(); trace('offer_tap', { answer: 'yes', where: 'bar' }); offerOff(); yes(); };
  bn.onclick = function () { trace('offer_tap', { answer: 'no', where: 'bar' }); offerOff(); };
  bOffer.appendChild(by); bOffer.appendChild(bn);
  offer.innerHTML = '';
  var s = el('span'); s.textContent = text || '';
  var y = el('button', { type: 'button', class: 'talk-chip pri' }); y.textContent = yesLabel || 'Go';
  var n = el('button', { type: 'button', class: 'talk-chip' }); n.textContent = 'No';
  y.onclick = function () { offerOff(); yes(); };
  n.onclick = function () { offerOff(); };
  if (text) offer.appendChild(s);   // in a conversation the question is spoken (and in the log): buttons only
  offer.appendChild(y); offer.appendChild(n);
  offer.classList.add('on');
  barSync();
}
function offerOff() { offerState = null; offer.classList.remove('on'); offer.innerHTML = ''; if (bOffer) bOffer.innerHTML = ''; barSync(); }

// The chat lane may press buttons too: the same gate as the fast lane (it never stops, merges or deletes on its own).
function chatPress(b) {
  var label = String(b.getAttribute('aria-label') || b.innerText || '').trim().split('\n')[0];
  var c = { op: 'press', label: label, target: b.getAttribute('data-talk') };
  var g = gateOf(c);
  logEv('chat_press', { label: label, gate: g });
  if (g === 'refuse') { add('note', 'I left \u201c' + label + '\u201d for you to press.'); unmark(); mark(b); return; }
  if (g === 'confirm') { offerOn(confirmLine(c), function () { c.confirmed = true; act(c); }, confirmVerb(c)); return; }
  add('app', 'Pressed \u201c' + label + '\u201d.'); b.click();
}
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
      else if (a.name === 'press') { var b = byId(a.args.id); if (b) chatPress(b); }
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
  try { player.playbackRate = S.speed; player.preservesPitch = true; player.defaultPlaybackRate = S.speed; } catch (e) {}
  player.onplaying = function () { try { player.playbackRate = S.speed; } catch (e) {} logEv('speak_start', { chars: t.length, ms_first: Date.now() - t0, speed: S.speed }); };
  player.onerror = function () { logEv('speak_error', { chars: t.length }); phoneSay(t); };
  var p = player.play();
  if (p && p.catch) p.catch(function (e) { logEv('speak_blocked', { err: String(e) }); phoneSay(t); });
}

// ---- Listening ---------------------------------------------------------------
var rec = null, mr = null, chunks = [], stream = null, t0 = 0, tick = null, interimTimer = null, interimCalls = 0;
function setListening(on) {
  listening = on;
  micBtn.classList.toggle('on', on); micBtn.innerHTML = on ? ICON.stop : ICON.mic;
  if (cMic) { cMic.classList.toggle('on', on); cMic.innerHTML = on ? ICON.stop : ICON.mic; cMic.setAttribute('aria-label', on ? 'Stop' : 'Speak (hold for Talk)'); }
  if (cInto) { cInto.placeholder = on ? 'Listening\u2026' : (cInto.getAttribute('aria-label') || ''); var cf = cInto.closest('form'); if (cf && cf.__talkSync) cf.__talkSync(); }
  if (inp) { inp.classList.toggle('live', on); inp.placeholder = on ? 'Listening\u2026' : 'Say or type: open my calculator'; fitInp(); }
  micBtn.setAttribute('aria-label', on ? 'Stop' : 'Speak');
  clearInterval(tick);
  if (on) { t0 = Date.now(); tick = setInterval(function () { status('Listening ' + Math.floor((Date.now() - t0) / 1000) + 's'); }, 250); status('Listening'); }
  else if (!busy) status('');
  barSync();
}
function startListen() {
  trace('listen_start', { engine: S.engine, lang: S.lang, listening: listening, busy: busy });
  if (listening || busy) return;
  stopSpeaking();   // talking over the reply stops it
  offerOff(); live.textContent = '';
  if (S.engine === 'live') return startLive();
  if (S.engine === 'native') return startNative();
  return startWhisper();
}
function stopListen(cancel, send) {
  if (!listening) return;
  if (dcOn) return liveStop(cancel, send);
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

// ---- Deepgram live dictation (push-to-talk): the mic streams to the TalkVoice agent in dictate
// mode; Flux shows the words as they are said and ends the turn when the sentence is done (a pause
// to think does not end it); the words then go through the usual Talk flow. Kept connected while
// Talk is open so the mic starts at once; billed only while listening.
var dc = null, dcReady = false, dcOn = false, dcText = '', dcT0 = 0, dcBuf = [], dcQuiet = null;
// What was said so far: the finished pieces plus the one being said now.
function dcSaid(interim) { return dcBuf.concat(interim ? [interim] : []).join(' ').replace(/\s+/g, ' ').trim(); }
function dcArm() { clearTimeout(dcQuiet); if (S.mic === 'pause' && S.pause !== 'tap' && dcOn) dcQuiet = setTimeout(function () { if (dcOn) { trace('dc_stop', { how: 'quiet', pieces: dcBuf.length, ms: Date.now() - dcT0 }); liveFinish('', true); } }, Number(S.pause) || 2500); }
function dcWarm(cb) {
  if (dc && dcReady) return cb && cb();
  if (dc) { if (cb) dc.__wait = (dc.__wait || []).concat(cb); return; }
  loadKit(function () {
    var t0 = Date.now();
    dc = new window.TalkVoiceKit.VoiceClient({ agent: 'TalkVoice', name: me, silenceDurationMs: 900 });
    dc.__wait = cb ? [cb] : [];
    dc.addEventListener('connectionchange', function (on) {
      dcReady = !!on; logEv('dc_connection', { on: on, ms: Date.now() - t0 });
      if (!on) trace('dc_disconnect', { listening: dcOn });
      if (on) { try { dc.sendJSON({ type: 'mode', dictate: true, lang: S.lang }); } catch (e) {} var w = dc.__wait || []; dc.__wait = []; w.forEach(function (f) { f(); }); }
    });
    dc.addEventListener('interimtranscript', function (t) { if (dcOn) trace('dc_interim', { text: t || '', ms: Date.now() - dcT0 }); if (dcOn && t) { dcText = t; setInp(dcBase + dcSaid(t)); clearTimeout(dcQuiet); } });
    dc.addEventListener('statuschange', function (st) { trace('dc_status', { status: st, on: dcOn, ms: dcT0 ? Date.now() - dcT0 : undefined }); });
    dc.addEventListener('voiceerror', function (e) { trace('dc_voiceerror', { e: e && (e.code || e.message || String(e)) }); });
    dc.addEventListener('audiolevelchange', function (lv) { if (dcOn && lv > 0.05 && !dc.__heardSound) { dc.__heardSound = 1; trace('dc_sound', { level: Math.round(lv * 100) / 100, ms: Date.now() - dcT0 }); } });
    dc.addEventListener('custommessage', function (d) {
      if (!d || d.type !== 'talk-dictated') return;
      // Flux ended a turn: keep it and keep listening (a pause to think is not the end), send after the quiet.
      if (!dcOn) return;
      dcBuf.push(String(d.text || '').trim()); dcText = ''; setInp(dcBase + dcSaid(''));
      logEv('dc_piece', { text: String(d.text || ''), pieces: dcBuf.length, ms: Date.now() - dcT0 });
      dcArm();
    });
    dc.addEventListener('error', function (e) { if (e && !/no response generated/i.test(String(e))) logEv('dc_error', { err: String(e) }); });
    dc.connect();
  });
}
// The whole clip, recorded on the phone from the tap (like tmux-web): Deepgram's live words can miss
// the start (the call takes ~0.8 s to begin) and mishear names; Whisper reads the clip at the end and
// its text replaces the live words.
var clip = null, clipChunks = [], clipStream = null, clipT0 = 0, warmP = null;
function micOpts() { return { audio: { echoCancellation: true, noiseSuppression: true } }; }
// "Microphone: ready while Talk is open": the stream is opened when Talk opens (only if the mic was
// already allowed, so no permission prompt pops up) and kept until Talk closes, so a tap records at once.
function warmMic() {
  if (S.keep !== 'open' || S.engine !== 'live' || clipStream || warmP || !navigator.mediaDevices) return;
  var go = function () {
    var t = Date.now();
    warmP = navigator.mediaDevices.getUserMedia(micOpts()).then(function (st) { warmP = null; if (!root.classList.contains('open')) { st.getTracks().forEach(function (x) { x.stop(); }); return; } clipStream = st; trace('mic_warm', { ms: Date.now() - t }); }).catch(function (e) { warmP = null; trace('mic_warm_error', { err: String(e) }); });
  };
  try { navigator.permissions.query({ name: 'microphone' }).then(function (r) { if (r.state === 'granted') go(); }, function () {}); } catch (e) {}
}
function releaseMic() { if (clipStream && !clip) { clipStream.getTracks().forEach(function (x) { x.stop(); }); clipStream = null; trace('mic_release', {}); } }
function clipStart(ready) {
  clipChunks = []; clipT0 = Date.now();
  if (!navigator.mediaDevices || !window.MediaRecorder) return ready && ready();
  var begin = function (st) {
    if (!listening) { if (S.keep !== 'open') st.getTracks().forEach(function (x) { x.stop(); }); return; }
    clipStream = st;
    var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (x) { return MediaRecorder.isTypeSupported(x); })[0] || '';
    clip = new MediaRecorder(st, type ? { mimeType: type } : {});
    clip.ondataavailable = function (e) { if (e.data && e.data.size) clipChunks.push(e.data); };
    clip.start(250);
    trace('rec_start', { ms: Date.now() - clipT0, warm: !!warmUsed });
    if (ready) ready();
  };
  var warmUsed = !!(clipStream && clipStream.active);
  if (warmUsed) return begin(clipStream);
  (warmP || navigator.mediaDevices.getUserMedia(micOpts())).then(function (st) { begin(st || clipStream); }).catch(function (e) { trace('rec_error', { err: String(e) }); if (ready) ready(); });
}
// Owner only, when "Keep my recordings" is on: the clip goes to the Talk Worker's bucket (7 days) with what was
// heard live and what was sent, and its key lands in the trace (scripts/talk-trace.mjs --clip <key> plays it back).
function keepClip(blob, m) {
  if (!CLIPS || S.clips !== 'on' || !blob || blob.size < 800) return;
  var q = '?sid=' + encodeURIComponent(tsid || '') + '&path=' + encodeURIComponent(location.pathname) + '&live=' + encodeURIComponent((m.live || '').slice(0, 400)) + '&final=' + encodeURIComponent((m.final || '').slice(0, 400)) + '&how=' + encodeURIComponent(m.how || '');
  fetch('/api/talk/clip' + q, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob })
    .then(function (r) { return r.json(); }).then(function (j) { trace('clip_saved', { key: j.key, bytes: blob.size, err: j.error }); })
    .catch(function (e) { trace('clip_error', { err: String(e) }); });
}
function clipStop(cb) {
  var r = clip, st = clipStream; clip = null;
  if (!r) { if (cb) cb(null); return; }
  r.onstop = function () {
    if (S.keep !== 'open' || !root.classList.contains('open')) { if (st) st.getTracks().forEach(function (x) { x.stop(); }); clipStream = null; }
    if (cb) cb(new Blob(clipChunks, { type: r.mimeType || 'audio/webm' }));
  };
  try { r.stop(); } catch (e) { if (cb) cb(null); }
}
var dcBase = '';
function startLive() {
  setListening(true); status('Starting\u2026'); dcText = ''; dcBuf = []; clearTimeout(dcQuiet); live.textContent = '';
  dcBase = inpVal().trim() ? inpVal().trim() + ' ' : '';   // speak more after typing: the words are added
  clipStart(function () { if (listening) status('Listening, speak'); });
  dcWarm(function () {
    if (!listening) return;
    dcOn = true; dcT0 = Date.now(); dc.__heardSound = 0;
    try { dc.sendJSON({ type: 'mode', dictate: true, lang: S.lang }); } catch (e) {}
    dc.startCall().then(function () { logEv('dc_start', {}); })
      .catch(function (e) { dcOn = false; setListening(false); clipStop(null); add('note', 'Could not start the microphone: ' + (e && e.message || e)); });
  });
}
function liveFinish(text, sendIt) {
  if (!dcOn) return;
  dcOn = false; clearTimeout(dcQuiet);
  try { dc.endCall(); } catch (e) {}
  setListening(false); live.textContent = '';
  var t = (dcSaid(text || dcText) || '').trim();
  logEv('dc_final', { chars: t.length, pieces: dcBuf.length, ms: Date.now() - dcT0 });
  dcBuf = [];
  var sent = false;
  var base = dcBase;
  function send(final, how, extra) {
    if (sent) return; sent = true; status('');
    trace('dc_whisper', Object.assign({ how: how, live: t, final: final, send: !!sendIt }, extra || {}));
    keepClip(clipBlob, { live: t, final: final || '', how: how });
    var all = (base + (final || '')).trim();
    if (cInto) {
      setInp(all); var cf = cInto.closest('form'); cInto = null; cMic = null; if (cf && cf.__talkSync) cf.__talkSync();
      if (cf && cf.__sendAfter) { cf.__sendAfter = 0; if (all) { trace('cmic', { how: 'sent', chars: all.length }); if (cf.requestSubmit) cf.requestSubmit(); else cf.dispatchEvent(new Event('submit', { cancelable: true })); } }
      else if (cf && final && !base) suggestFromComposer(final, cf);
      return;
    }   // the page's composer: its own Send sends
    if (!sendIt) { setInp(all); if (!final) status('I did not hear anything'); return; }   // tap, speak, tap Send: the words wait in the box
    setInp('');
    if (all) { lastSpoken = true; submit(all); } else add('note', 'I did not hear anything.');
  }
  setInp((base + t).trim());
  var clipBlob = null;
  clipStop(function (blob) {
    clipBlob = blob;
    if (S.whisper === 'off' || !blob || blob.size < 2000) return send(t, S.whisper === 'off' ? 'live-only' : 'live', { bytes: blob ? blob.size : 0 });
    status('Checking the words\u2026');
    var w0 = Date.now();
    setTimeout(function () { send(t, 'live-timeout', { bytes: blob.size }); }, 6000);
    fetch('/api/talk/transcribe?names=1&lang=' + encodeURIComponent(S.lang), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type }, body: blob })
      .then(function (r) { return r.json(); })
      .then(function (j) { send((j && j.text) || t, j && j.text ? 'whisper' : 'live', { bytes: blob.size, whisper_ms: Date.now() - w0, err: j && j.error }); })
      .catch(function (e) { send(t, 'live-error', { err: String(e) }); });
  });
}
function liveStop(cancel, sendIt) {
  if (cancel) { dcOn = false; try { dc.endCall(); } catch (e) {} clipStop(null); setListening(false); live.textContent = ''; cInto = null; cMic = null; return; }
  // Stopped by hand (tap, or releasing the button): send what was heard, including the piece being said.
  trace('dc_stop', { how: 'hand', pieces: dcBuf.length, interim: dcText, ms: Date.now() - dcT0 });
  status('Finishing\u2026');
  var t = dcText;
  setTimeout(function () { if (dcOn) liveFinish(t, sendIt); }, 600);
}

// ---- Conversation (phase 2): mic streamed to the TalkVoice agent (src/talkvoice.ts)
// over a WebSocket with Cloudflare's voice client (/talk-voice.js); Flux hears and
// ends turns, the agent decides and speaks, this page does what it says.
var vc = null, vcSeen = 0, vcStatus = 'idle', vcLast = 0, vcIdle = null, vcLinks = null, vcPending = null;
var VC_QUIET_MS = 30000;
// In a conversation send the answer as written (the transcript shows its lines and lists); the agent cleans it for the voice.
function vcVoice() { if (vc) try { vc.sendJSON({ type: 'voice', model: S.voice === 'aura-1' ? 'aura-1' : 'aura-2', speaker: S.voice === 'aura-1' || S.voice === 'aura-2' ? S.speaker : '', speed: S.speed }); } catch (e) {} }
function speakOut(text) { if (vc) { try { vc.sendJSON({ type: 'say', text: String(text || '').slice(0, 1500) }); } catch (e) {} } else say(text); }
function vcActive() { vcLast = Date.now(); }
function loadKit(cb) {
  if (window.TalkVoiceKit) return cb();
  var sc = document.createElement('script'); sc.src = '/talk-voice.js'; sc.onload = cb;
  sc.onerror = function () { add('note', 'Could not load the conversation client.'); };
  document.head.appendChild(sc);
}
function vcScreen() { if (vc) try { vc.sendJSON({ type: 'screen', screen: screen(), pageText: pageText() }); } catch (e) {} }
function startConversation() {
  if (vc || !me) return;
  stopListen(true); stopSpeaking(); offerOff();
  open(true); status('Connecting\u2026');
  convBtn.classList.add('on'); convBtn.setAttribute('aria-label', 'End the conversation');
  loadKit(function () {
    var t0 = Date.now();
    vc = new window.TalkVoiceKit.VoiceClient({ agent: 'TalkVoice', name: me, silenceDurationMs: 600, interruptThreshold: 0.06 });
    vc.addEventListener('connectionchange', function (on) {
      logEv('vc_connection', { on: on, ms: Date.now() - t0 });
      if (!on || !vc) return;
      vcScreen();
      vcVoice();
      vc.startCall().then(function () { sset('call', true); vcActive(); }).catch(function (e) { add('note', 'Could not start: ' + (e && e.message || e)); endConversation('error'); });
    });
    vc.addEventListener('statuschange', function (st) {
      vcStatus = st; vcActive();
      if (st === 'listening' || st === 'idle') vcFlush(vc.transcript || [], true);
      status(st === 'listening' ? 'Listening' : st === 'thinking' ? 'Thinking\u2026' : st === 'speaking' ? 'Speaking' : '');
      bMic.classList.toggle('on', st !== 'idle');
    });
    vc.addEventListener('interimtranscript', function (t) { live.textContent = t || ''; if (t) vcActive(); });
    vc.addEventListener('transcriptchange', function (msgs) { vcFlush(msgs, false); vcActive(); });
    vc.addEventListener('custommessage', function (d) { onVoiceMsg(d); });
    vc.addEventListener('turnmetrics', function (t) { var m = { outcome: t.outcome, total_ms: t.turnTotalMs }; for (var k in t) if (/Ms$/.test(k) && typeof t[k] === 'number') m[k] = Math.round(t[k]); logEv('vc_turn', m); });
    // Silence is a choice (filler, a fragment, talk to someone else): the kit reports it as an error; keep it out of the sheet.
    vc.addEventListener('error', function (e) { if (!e) return; logEv('vc_error', { err: String(e) }); if (!/no response generated/i.test(String(e))) add('note', String(e)); });
    vc.addEventListener('voiceerror', function (e) { logEv('vc_voiceerror', { e: e && (e.code || e.message || String(e)) }); });
    vc.addEventListener('mutechange', function (m) { micBtn.classList.toggle('on', !m); micBtn.innerHTML = m ? ICON.mic : ICON.stop; });
    vc.connect();
    clearInterval(vcIdle);
    vcIdle = setInterval(function () {
      // Hang up after 30 s with nothing said or played: an open mic is billed by the minute.
      if (vc && vcStatus === 'listening' && !live.textContent && Date.now() - vcLast > VC_QUIET_MS) endConversation('quiet');
    }, 2000);
  });
}
// The assistant's reply streams in: add it to the log once its turn is over, not while empty.
function vcFlush(msgs, final) {
  for (var i = vcSeen; i < msgs.length; i++) {
    var m = msgs[i];
    if (m.role !== 'user' && i === msgs.length - 1 && !final) break;
    if (m.role === 'user') { live.textContent = ''; add('you', m.text); }
    else if (m.text) { add('ai', m.text, vcLinks || undefined); vcLinks = null; }
    vcSeen = i + 1;
  }
}
function endConversation(why) {
  clearInterval(vcIdle);
  if (vc) { try { vc.endCall(); } catch (e) {} try { vc.disconnect(); } catch (e) {} }
  vc = null; vcSeen = 0; vcStatus = 'idle'; sset('call', false);
  if (convBtn) { convBtn.classList.remove('on'); convBtn.setAttribute('aria-label', 'Start a conversation'); }
  bMic.classList.remove('on'); live.textContent = ''; status('');
  if (why === 'quiet') add('note', 'Ended the conversation after 30 seconds of quiet.');
  if (why === 'minutes') add('note', 'That is all the talking time for today.');
  logEv('vc_end', { why: why });
}
// Navigating keeps the conversation: leave once the reply has been spoken, continue on the next page.
function vcNavigate(c) {
  var waited = 0;
  (function wait() {
    if (vc && vcStatus === 'speaking' && waited < 8000) { waited += 200; return setTimeout(wait, 200); }
    sset('call', true);
    act(c);
  })();
}
function onVoiceMsg(d) {
  if (!d || typeof d !== 'object') return;
  logEv('vc_msg', { type: d.type, op: d.cmd && d.cmd.op, mode: d.cmd && d.cmd.mode, offer: !!(d.cmd && d.cmd.offer), heard: d.type === 'talk-heard' ? d.text : undefined, actions: d.actions ? d.actions.map(function (a) { return a.name; }) : undefined });
  vcActive();
  if (d.type === 'talk-ready') { vcSeen = vc ? vc.transcript.length : 0; return; }
  if (d.type === 'talk-end') return endConversation(d.why || 'minutes');
  if (d.type === 'talk-status') { vcLinks = d.links || null; return; }
  if (d.type === 'talk-cancel') { offerOff(); vcPending = null; return; }
  if (d.type === 'talk-confirm') { offerOff(); var p = d.cmd || vcPending; vcPending = null; if (!p) return; if (p.op === 'change') return voiceChange(p); return p.op === 'go' || p.op === 'back' ? vcNavigate(p) : act(p); }
  if (d.type === 'talk-chat') {
    (d.actions || []).forEach(function (a) {
      if (a.name === 'show') showSeq((a.args && a.args.ids) || []);
      else if (a.name === 'press') { var b = byId(a.args.id); if (b) chatPress(b); }
      else if (a.name === 'type_into') { var f = byId(a.args.id); if (f) { typeInto(f, String(a.args.text || '')); offerSubmit(f); } }
      // A page the answer chose by itself is offered, not opened: in a conversation nobody is watching the screen.
      else if (a.name === 'go') { var to = String(a.args.to || ''); var l = byId(to); var href = l ? l.getAttribute('href') : (to.charAt(0) === '/' ? to : null); if (href) { var g = { op: 'go', href: href, label: l ? (l.innerText || href).split('\n')[0] : href }; offerOn('Open ' + g.label + '?', function () { vcNavigate(g); }); } }
    });
    return;
  }
  if (d.type !== 'talk-cmd' || !d.cmd) return;
  var c = d.cmd;
  if (c.refused) { if (c.op === 'go' && c.href) offerOn('Take me to ' + (c.label || 'that page') + '?', function () { vcNavigate(c); }); return; }
  if (c.offer) { vcPending = c; offerOn('', function () { vcPending = null; vcNavigate(c); }); return; }
  if (c.op === 'change') { vcPending = c; offerOn('', function () { vcPending = null; voiceChange(c); }, c.mine ? 'Send' : 'Fork'); return; }
  if (c.op === 'code') return codeQuestion(c);
  if (c.op === 'go' || c.op === 'back') return vcNavigate(c);
  act(c);
}
function voiceChange(c) {
  var parts = String(c.slug || '').split('.'), owner = parts[0], name = parts.slice(1).join('.');
  if (c.mine) { busy = true; return sendChange(owner, name, c.text); }
  busy = true; status('Forking\u2026');
  projPost(owner, name, 'fork', {}).then(function (f) {
    if (f.error) { add('note', 'Could not fork: ' + f.error); return done(); }
    add('app', 'Forked to ' + f.owner + '/' + f.name + '.');
    sendChange(f.owner, f.name, c.text);
  }).catch(function () { add('note', 'Could not reach qodebase.'); done(); });
}

// ---- Boot ----------------------------------------------------------------
fetch('/api/talk/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
  if (!j.signedIn) return;
  me = j.handle;
  if (j.version && j.version.sha) VERSION = j.version.sha + (j.version.built ? ' ' + new Date(j.version.built).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '') + (j.version.talk && j.version.talk !== j.version.sha ? ' talk ' + j.version.talk : '');
  if (j.trace) traceStart(); else tq = [];
  CLIPS = !!j.clips;
  build();
  publishTools();
  // Coming back from a navigation Talk made: show the sheet, finish any pending question.
  if (sget('call', false)) {
    // Continue the conversation on this page. Sound needs a tap unless the browser still allows it.
    open(true);
    var probe = null; try { var C = window.AudioContext || window.webkitAudioContext; probe = C ? new C() : null; } catch (e) {}
    if (probe && probe.state === 'running') { probe.close(); startConversation(); }
    else { if (probe) probe.close(); offerOn('Keep talking?', function () { unlockAudio(); startConversation(); }, 'Talk'); }
  }
  // Coming from a page Talk opened: the bar (or the conversation, if it was open) says so, and a pending question is answered here.
  if (sget('open', false)) open(true);
  var last = hist[hist.length - 1];
  if (last && last.who === 'app' && /^Opening /.test(last.text)) { hist[hist.length - 1] = { who: 'app', text: last.text.replace(/^Opening (.*)…$/, 'Opened $1.') }; sset('log', hist); render(); }
  var p = sget('pending', null);
  if (p) { sset('pending', null); setTimeout(function () { ask(p.text, p.did); }, 300); }
}).catch(function () {});
})();`;
