// /talk.js: the Talk layer on every qodebase page. A talk button (bottom
// right) opens a sheet: speak (phone's own dictation, or Whisper on
// Cloudflare) or type a sentence; the app previews what it will do (the target
// outlined), does it, answers in the sheet (spoken too, if set), or both. The
// conversation survives page changes (sessionStorage). Settings: dictation
// engine, language, speak replies. Written as plain ES5-ish JS in a raw string:
// no backticks or dollar-brace inside.
import { SCAN_JS } from './talkscan';
import { CONV_JS } from './talkconv';

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
// One id per utterance (Eyal, 2026-10-13, full traceability): from the tap (or the typed sentence) to what Talk did,
// every row carries it, the API calls send it (the server adds its rows), and the recording is named by it.
var curU = '', uSaid = false;
function newU() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
function trace(ev, data) {
  if (!tOn && tq.length > 300) return;
  var r = { ts: Date.now(), ev: ev, path: location.pathname };
  if (curU) r.u = curU;
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
  say: get('say', 'short'),             // what is said aloud: short (a 1-3 sentence summary, default) | full (the whole answer)
  voice: get('voice', 'aura-2'),        // spoken replies: off | aura-1 | aura-2 | phone (on by default since 2026-10-13, Eyal via the manager; 'when' keeps it to replies to speech)
  speaker: get('speaker', ''),          // Aura speaker ('' = the model's default)
  when: get('when', 'voice'),           // voice (only when I spoke) | always
  speed: Number(get('speed', '1.25')) || 1.25,   // reply speed, pitch kept (Ask's Jarvis default)
  pause: get('pause', '1500'),          // mic 'pause': send after this many ms of quiet (1.5 s, tmux-web's default)
  convmode: get('convmode', 'off'),     // Conversation mode (Eyal, 2026-10-13): after a 1.5 s pause it sends, speaks the answer, listens again; per device
  mic: get('mic', 'send'),              // how the mic works: send (tap, speak, tap Send, like tmux-web; default) | pause (sends when I stop) | hold | conv (conversation)
  whisper: get('whisper', 'on'),        // re-read the whole clip with Whisper before sending (Deepgram live only)
  merge: get('merge', 'off'),
  answer: get('answer', ''),            // answering model ('' = Talk's default, Gemini 3.1 Flash-Lite); per device           // also merge live words + Whisper with a model (off: it lost to Whisper alone on Eyal's dictations, 2026-10-13)
  keep: get('keepmic', 'open'),
  prewarm: get('prewarm', 'off'),
  fast: get('fast', 'on'),               // quick replies (latency work, 2026-10-13): act on the live words, end turns on nova-3's endpointing, guess early, short ack, socket kept warm
  clips: get('clips', 'on'),            // owner only: keep my recordings for debugging (14 days); on for the owner since 2026-10-13 (traceability)         // open = keep the mic ready while Talk is open (first words never lost) | use = only while speaking
};
// Aura-2 is the default voice since 2026-10-07 (Eyal): devices that had Aura-1 only because it was the default move once.
try { if (!ls.getItem(KEY + 'v2')) { if (ls.getItem(KEY + 'voice-on') === 'aura-1') ls.setItem(KEY + 'voice-on', 'aura-2'); if (S.voice === 'aura-1') { S.voice = 'aura-2'; S.speaker = ''; ls.setItem(KEY + 'voice', 'aura-2'); ls.removeItem(KEY + 'speaker'); } ls.setItem(KEY + 'v2', '1'); } } catch (e) {}
var CLIPS = false;   // the owner may keep recordings (set from /api/talk/me)
var MODELS = {};      // which model does what, from the running Talk Worker (/api/talk/me)
var ANSWER = null;    // { default, choices: [{ id, label, model, ok, why, price }] } from /api/talk/me
var CONSENT = null;  // others: null for the owner (always traced); true/false = their "Help improve Talk" answer
var LANGS = { en: 'en-US', he: 'he-IL', auto: 'en-US' };
var me = null, busy = false, listening = false, lastSpoken = false;
var hist = sget('log', []);             // [{who:'you'|'app'|'ai'|'note', text}]
var chatHist = sget('chat', []);       // [{role, content}] for the chat lane

// ---- DOM -------------------------------------------------------------------
var css = [
  '#talk-root{--t-frame:var(--frame,#d9dbe0);--t-acc:var(--acc,#6a2ff0);--t-accfg:var(--acc-fg,#fff);--t-bg:var(--bg,#fff);--t-card:var(--card,#f6f7f8);--t-chip:var(--chip,#eceef1);--t-line:var(--line,#e2e5e9);--t-fg:var(--fg,#15171a);--t-dim:var(--dim,#5f6670);--t-warn:var(--warn,#b42d1f);font:16px/1.45 var(--t-ff);color:var(--t-fg);-webkit-tap-highlight-color:transparent}',
  // The voice bar (2026-10-13, manager's brief): a mini-player on every page, above the page's own bottom bars.
  // Mic + what you are saying (growing to 3 lines) or the last answer in one line; tap it to open the whole
  // conversation, which folds back into the bar. Its height is kept free at the end of the page.
  // Docked edge to edge like a tab bar (Eyal, 2026-10-13: not a floating card): a hairline on top, the phone's
  // bottom inset inside it; above the page's own bottom bars when it has some. A card bottom-right on wide screens.
  '#talk-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:flex-end;gap:4px;padding:6px 8px calc(6px + var(--talk-inset,env(safe-area-inset-bottom))) 8px;min-height:56px;box-sizing:border-box;background:var(--t-chip);background:var(--acc-soft,color-mix(in srgb,var(--t-acc) 9%,var(--t-bg)));border-top:1px solid var(--t-frame);box-shadow:0 -2px 12px rgba(0,0,0,.08);color:var(--t-fg)}',
  // The minimized bar stands apart from the page (Eyal, 2026-10-13: it blended in): an accent-tinted surface from the
  // tokens, a hairline and a soft shadow on top, the mic a filled accent circle.
  '.talk-somic{background:var(--t-acc)!important;color:var(--t-accfg)!important;border-radius:50%!important;width:48px;height:48px}',   // signed-out bar: the same filled mic (qb5's critique)
  '#talk-root:not(.arming) #talk-bmic:not(.on){background:var(--t-acc);color:var(--t-accfg);border-radius:50%}',
  '@media (min-width:720px){#talk-bar{left:auto;right:16px;bottom:16px;width:420px;padding:6px;border:0;border-radius:14px;background:var(--t-card);background:var(--acc-soft,color-mix(in srgb,var(--t-acc) 9%,var(--t-bg)));box-shadow:inset 0 0 0 1px var(--t-frame),0 4px 16px rgba(0,0,0,.10)}}',
  '#talk-root.open #talk-bar{display:none}',
  '.talk-bb{width:44px;height:44px;flex:none;border:0;border-radius:10px;background:transparent;color:var(--t-fg);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}',
  '.talk-bb svg{width:22px;height:22px}',
  '.talk-bb.pri{background:var(--t-chip);color:var(--t-fg)}',
  '#talk-bmic{width:48px;height:48px;border-radius:12px}',
  '#talk-bmic svg{width:24px;height:24px}',
  '#talk-bspk,#talk-bexp{width:40px}',
  // The bar's own mic is a filled accent circle at rest since Eyal's ask (2026-10-13, the bar blended in); the
  // composer's buttons below keep the old rule (accent only while live). DESIGN.md's radius rule names this circle.
  '#talk-root.live .talk-bb.pri,#talk-bsend.talk-bb.pri{background:var(--t-acc);color:var(--t-accfg)}',
  '#talk-bexp{color:var(--t-dim)}',
  '#talk-bspk[aria-pressed=true]{color:var(--t-acc)}',
  '#talk-root.miconly #talk-bspk,#talk-root.boffer #talk-bspk,#talk-root.live #talk-bspk{display:none}',
  '.talk-bb.on{background:var(--t-warn)}',
  '@media (hover:hover){.talk-bb:not(.pri):hover{background:var(--t-chip)}}',
  '#talk-bmid{flex:1;min-width:0;min-height:44px;display:flex;align-items:center;border:0;background:transparent;color:inherit;text-align:left;padding:0 6px;font:15px/20px var(--t-ff);cursor:pointer}',
  '#talk-btext{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;overflow-wrap:anywhere}',
  '#talk-btext.dim{color:var(--t-dim)}',
  '#talk-root.live #talk-btext{-webkit-line-clamp:3}',
  // A question waiting for a yes: the words get the whole width (4 lines), the chips go under them, right.
  // A question is one compact row (~56 px): text clamped to two lines, chips on the right (qb3's rehearsal 2026-10-14:
  // the wrapped two-row card covered Build's presets).
  '#talk-root.boffer #talk-bar{flex-wrap:nowrap;align-items:center;pointer-events:none}',
  // ... and its empty area lets taps through to the page (qb3's take: Build's preset tiles under the row took no taps);
  // only its words and buttons catch them.
  '#talk-root.boffer #talk-bar #talk-btext,#talk-root.boffer #talk-bar button{pointer-events:auto}',
  '#talk-root.boffer #talk-bmic{display:none}',
  '#talk-root.boffer #talk-bmid{flex:1 1 auto;min-width:0;padding:4px 6px}',
  '#talk-root.boffer #talk-btext{-webkit-line-clamp:2;font-size:15px;line-height:1.3}',
  '#talk-root.boffer #talk-boffer{margin-left:auto}',
  '#talk-boffer{display:none;gap:6px;flex:none}',
  '#talk-root.boffer #talk-boffer{display:flex}',
  '#talk-root.boffer #talk-bexp,#talk-root.live #talk-bexp{display:none}',
  '#talk-bsend{display:none}',
  '#talk-root.live #talk-bsend,#talk-root.draft #talk-bsend{display:flex}',
  // Not listening yet (the mic is still opening): the stop button stays quiet, so nobody starts talking too early.
  '#talk-root.arming .talk-bb.on,#talk-root.arming #talk-mic.on{background:var(--t-chip);color:var(--t-fg)}',
  '#talk-root.draft #talk-bexp{display:none}',
  '#talk-bclr{display:none;color:var(--t-dim)}',
  '#talk-root.draft #talk-bclr{display:flex}',
  '#talk-root.draft #talk-bspk{display:none}',
  '#talk-root.draft #talk-btext{-webkit-line-clamp:3}',
  '#talk-boffer .talk-chip{min-height:44px;padding:0 12px}',
  // Pages with a composer (form.ask) keep the mic in its row: the bar there is the door to Talk, without a mic.
  '#talk-root.slim #talk-bmic{display:none}',
  '#talk-root.slim #talk-bar{min-height:48px;padding:2px 2px 2px 6px}',
  // Above a composer the bar shows only when it has something to say (an answer, a question, live words); the way
  // in at rest is the composer mic (hold it: Talk listens). Three layers at the bottom were too many (critique).
  '#talk-root.slim.rest #talk-bar,#talk-root.tall.rest #talk-bar{display:none}',
  '#talk-spacer{height:0;pointer-events:none}',
  '.talk-convt{min-height:36px;padding:0 10px;border:0;border-radius:10px;background:var(--t-chip);color:var(--t-fg);font:500 13px var(--t-ff);cursor:pointer;white-space:nowrap}',
  '.talk-convt[aria-pressed=true]{background:var(--t-acc);color:var(--t-accfg)}',
  '#talk-log .talk-sh{margin:8px 0 2px;font-weight:600;font-size:14px}',
  '#talk-log .talk-lead{margin:0 0 2px}',
  '#talk-log .talk-sl{margin:0;padding-left:18px;white-space:normal}',
  '#talk-log .talk-sl li{margin:2px 0}',
  '#talk-log .talk-sl a{color:inherit;text-decoration-color:var(--t-line);text-underline-offset:3px}',
  '#talk-log .talk-more{color:var(--t-dim);list-style:none;margin-left:-18px}',
  '.talk-via{display:block;margin-top:6px;padding:4px 0;min-height:28px;border:0;background:transparent;color:var(--t-dim);font:12px var(--t-ff);text-align:left;cursor:pointer;font-variant-numeric:tabular-nums}',
  '#talk-set dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:13px;color:var(--t-fg)}',
  '#talk-set dt{color:var(--t-dim)}',
  '#talk-set dd{margin:0;overflow-wrap:anywhere}',
  '#talk-again{display:none;align-self:flex-start;margin:0 16px 8px;min-height:36px;font-size:14px}',
  '#talk-root.canagain #talk-again{display:inline-flex;align-items:center}',
  // Things to say (Eyal, 2026-10-13: a first-time visitor should know what they can say): a rotating line in the
  // bar at rest (tap = say it), and grouped chips in the empty conversation.
  // On the tinted bar --dim fell below 4.5:1 (critique 2026-10-13): the hint is --fg, the example set apart by weight.
  '#talk-root.ex #talk-btext{color:var(--t-fg);font-weight:400}',
  '#talk-root.ex #talk-btext q{color:var(--t-fg);font-weight:500;quotes:"\\201C" "\\201D"}',
  '.talk-ex{display:flex;flex-direction:column;gap:12px}',
  '.talk-ex h3{margin:0 0 6px;font:600 13px var(--t-ff);color:var(--t-dim)}',
  '.talk-ex div{display:flex;flex-wrap:wrap;gap:8px}',
  '.talk-ex .talk-exs{font-size:15px;color:var(--t-fg)}',
  '.talk-ex div{column-gap:16px;row-gap:4px}',
  // A clear (×) inside text boxes, only while they hold text (Eyal, 2026-10-13): Talk's own input and the page's
  // idea / change boxes.
  '.talk-clr::after{content:"";position:absolute;inset:-6px}',
  '.talk-clr{position:absolute;width:32px;height:32px;border:0;border-radius:10px;background:var(--chip);color:var(--dim);display:none;align-items:center;justify-content:center;cursor:pointer;padding:0;z-index:2}',
  '.talk-clr svg{width:16px;height:16px}',
  '.talk-clr.on{display:flex}',
  '#talk-inwrap{position:relative;flex:1;min-width:0;display:flex}',
  '#talk-inwrap #talk-in{padding-right:40px}',
  '#talk-inwrap .talk-clr{right:6px;top:6px}',
  // A page can ask for less: data-talk-bar="mic" on <body> (a deck: only the mic, the words show while in use),
  // "off" (no bar; ?clean on any URL does the same, for recordings).
  '#talk-root.miconly #talk-bar{left:auto;width:auto;min-height:0;padding:0 16px 0 0;background:transparent;box-shadow:none;border:0;bottom:8px}',
  '#talk-root.miconly #talk-bmic{width:52px;height:52px;border-radius:14px;background:var(--t-card);box-shadow:inset 0 0 0 1px var(--t-line)}',
  '#talk-root.miconly #talk-bmid,#talk-root.miconly #talk-bexp{display:none}',
  '#talk-root.nobar #talk-bar{display:none}',
  // Pages with a composer (form.ask, [data-talk-composer]) get the mic inside it, WhatsApp-style, and no floating button.
  'body.talk-composer #talk-ver{display:none!important}',
  '.talk-cmic{width:44px;height:44px;flex:none;border-radius:12px;border:0;background:var(--acc,#6a2ff0);color:var(--acc-fg,#fff);display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}',
  '.talk-cmic svg{width:22px;height:22px}',
  '.talk-cmic.on{background:var(--warn,#b42d1f)}',
  'form.talk-hassend-off .send{display:none!important}',
  'form.talk-hassend-on .talk-cmic{display:none!important}',
  '@media (max-width:600px){#talk-ver{display:none!important}}',
  '#talk-ver{position:fixed;z-index:2147483000;font:11px/1 var(--t-ff);color:var(--t-dim);font-variant-numeric:tabular-nums;pointer-events:none;text-align:center;width:72px}',
  '#talk-root.open #talk-ver{display:none}',
  '#talk-head .ver{font-size:11px;color:var(--t-dim);font-variant-numeric:tabular-nums}',
  '#talk-head:has(.st:not(:empty)) .ver{display:none}',   // the status ("Listening 3s") takes the version label\'s place on a phone
  '#talk-head .st{white-space:nowrap}',
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
  '#talk-mic{width:48px;height:48px;border-radius:8px;border:0;background:var(--t-acc);color:var(--t-accfg);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}',
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
  '.talk-mark{outline:3px solid var(--acc,#6a2ff0)!important;outline-offset:3px!important;border-radius:8px;transition:outline-color .12s}',
  '.talk-mark.dash{outline-style:dashed!important}',
].join('\n');

var ICON = {
  conv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

var root, sheet, logEl, live, offer, inp, micBtn, sendBtn, stEl, spk, convBtn;
var bar, bMic, bText, bOffer, bSend, bExp, bSpk, spacer;
// The input grows with what you say or type (up to a third of the screen), then scrolls to the newest words.
function fitInp() { if (!inp) return; if (root) root.classList.toggle('canagain', !!(lastClip && inp.value.trim() && !listening && Date.now() - lastClip.at < 10 * 60000)); inp.style.height = 'auto'; inp.style.height = Math.max(44, inp.scrollHeight + 2) + 'px'; inp.scrollTop = inp.scrollHeight; if (sendBtn) sendBtn.classList.toggle('ready', !!inp.value.trim() || listening); }
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
  // The × in the home idea box (top right, clear of its own mic at the bottom).
  [].forEach.call(document.querySelectorAll('.askbox textarea'), function (t) {
    if (t.__talkClr) return;
    clearer(t, t.parentNode, function () { if (listening && cInto === t) stopListen(true); });
    var x = t.parentNode.querySelector('.talk-clr'); if (x) { x.style.right = '8px'; x.style.top = '8px'; }
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
// The × in a text box: shown while it holds text; clears it (and stops listening into it), focus stays in the box.
function clearer(ta, box, before) {
  if (!ta || ta.__talkClr) return;
  ta.__talkClr = 1;
  var b = el('button', { type: 'button', class: 'talk-clr', 'aria-label': 'Clear the text' }, ICON.x);
  if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
  box.appendChild(b);
  var sync = function () { b.classList.toggle('on', !!ta.value); };
  ta.addEventListener('input', sync); setInterval(sync, 700); sync();
  b.addEventListener('pointerdown', function (e) { e.preventDefault(); });   // keep the keyboard up
  b.addEventListener('click', function () {
    if (before) before();
    var proto = ta.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true })); sync(); trace('clear', { box: ta.id || ta.name || ta.getAttribute('aria-label') || '' });
  });
}
function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
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
  // Spoken replies, one tap (remembered on this device): the same switch as the sheet's speaker.
  bSpk = el('button', { id: 'talk-bspk', class: 'talk-bb', type: 'button' });
  // Right-thumb reach (Eyal, 2026-10-13): open and spoken replies on the left, the words, then Send and the mic at the right edge.
  // A clear (×) whenever the bar holds words (manager, 2026-10-13).
  var bClr = el('button', { id: 'talk-bclr', class: 'talk-bb', type: 'button', 'aria-label': 'Clear the words' }, ICON.x);
  bClr.addEventListener('click', function () { trace('bar', { how: 'clear' }); setInp(''); lastClip = null; barSync(); });
  bar.appendChild(bExp); bar.appendChild(bSpk); bar.appendChild(bMid); bar.appendChild(bClr); bar.appendChild(bOffer); bar.appendChild(bSend); bar.appendChild(bMic);
  // Examples are hints, never sent (Eyal, 2026-10-13: a tap near the bar sent 'how does it work?' twice). A tap opens Talk.
  bMid.addEventListener('click', function () { unlockAudio(); trace('bar', { how: 'open' }); open(true); });
  bExp.addEventListener('click', function () { unlockAudio(); trace('bar', { how: 'expand' }); open(true); });
  bSend.addEventListener('click', function () {
    unlockAudio(); trace('bar', { how: 'send' });
    if (listening) return stopListen(false, true);
    var v = inp.value.trim(); if (!v) return; setInp(''); lastSpoken = true; submit(v);
  });
  sheet = el('section', { id: 'talk-sheet', 'aria-label': 'Talk' });
  var head = el('div', { id: 'talk-head' });
  head.innerHTML = '<b>Talk</b><span class="st" id="talk-st"></span>';
  spk = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Spoken replies' }, ICON.mute);
  var gear = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Talk settings' }, ICON.gear);
  // Minimize, never an X: nothing in the header may look like deleting the conversation (Eyal, 2026-10-13).
  var close = el('button', { class: 'talk-ib', type: 'button', 'aria-label': 'Minimize' }, ICON.down);
  // Conversation mode, visible in the open conversation (Eyal, 2026-10-13): on = hands-free turns; off = dictate, then Send.
  convBtn = el('button', { class: 'talk-convt', type: 'button', 'aria-pressed': S.convmode === 'on' ? 'true' : 'false', title: 'Conversation mode: it sends after a pause, speaks the answer and listens again' }, 'Conversation');
  convBtn.addEventListener('click', function () { unlockAudio(); toggleConv('head'); });
  head.appendChild(convBtn); head.appendChild(spk); head.appendChild(gear); head.appendChild(close);
  var setp = el('div', { id: 'talk-set' });
  setp.innerHTML =
    '<label>Dictation<select id="talk-s-engine"><option value="live">Deepgram live (Cloudflare): words as you speak</option><option value="native">Phone’s own (Chrome), free, live words</option><option value="whisper">Whisper on Cloudflare, steadier with names</option></select></label>' +
    '<label>How the mic works<select id="talk-s-mic"><option value="send">Tap the mic, speak, tap Send (like tmux-web)</option><option value="pause">Tap the mic; it sends when I stop talking</option><option value="hold">Hold the mic while I talk; letting go sends</option></select></label>' +
    '<label>Quick replies<select id="talk-s-fast"><option value="on">On: answer from the live words, Whisper double-checks</option><option value="off">Off: wait for Whisper before answering</option></select></label>' +
    '<label>Conversation mode<select id="talk-s-convmode"><option value="off">Off: tap the mic, speak, tap Send</option><option value="on">On: it sends after a pause, speaks the answer, and listens again</option></select></label>' +
    '<label>Send after a pause of<select id="talk-s-pause"><option value="1500">1.5 s</option><option value="2500">2.5 s</option><option value="4000">4 s</option></select></label>' +
    '<label>Check the words with Whisper<select id="talk-s-whisper"><option value="on">On: the whole recording is read again (steadier, about 1.5 s)</option><option value="off">Off: send the live words right away</option></select></label>' +
    '<label>Clean up the words with a model<select id="talk-s-merge"><option value="off">Off: Whisper\u2019s words</option><option value="on">On: live words + Whisper merged, your project names kept (about 1 s more)</option></select></label>' +
    '<label>Microphone<select id="talk-s-keep"><option value="open">Ready while Talk is open (your first words are never lost)</option><option value="use">Only while I speak</option></select></label>' +
    '<label>Language<select id="talk-s-lang"><option value="en">English</option><option value="he">עברית (Hebrew)</option><option value="auto">Auto (Whisper detects)</option></select></label>' +
    '<label>Answering model<select id="talk-s-answer"></select></label>' +
    '<label>Spoken replies<select id="talk-s-say"><option value="short">Short summary</option><option value="full">Read the full answer</option><option value="off">Off</option></select></label>' +
    '<label>Voice<select id="talk-s-voice"><option value="off">Off</option><option value="aura-2">Natural voice (Cloudflare Aura 2)</option><option value="aura-1">Lighter voice (Aura 1, half the price)</option><option value="phone">The phone\u2019s own voice</option></select></label>' +
    '<label>Speaker<select id="talk-s-speaker"></select></label>' +
    '<label>Speed<select id="talk-s-speed"><option value="1">1\u00d7</option><option value="1.1">1.1\u00d7</option><option value="1.15">1.15\u00d7</option><option value="1.25">1.25\u00d7</option><option value="1.4">1.4\u00d7</option><option value="1.6">1.6\u00d7</option></select></label>' +
    '<label>Speak<select id="talk-s-when"><option value="voice">When I talked</option><option value="always">Always</option></select></label>' +
    (CLIPS ? '<label>Keep my recordings (only you can hear them, deleted after 14 days)<select id="talk-s-clips"><option value="on">On, for debugging</option><option value="off">Off</option></select></label>' : '') +
    (CONSENT !== null ? '<label>Help improve Talk<select id="talk-s-consent"><option value="off">Off: nothing is kept</option><option value="on">On: keep what I say and what Talk did, 14 days (no audio)</option></select></label>' : '') +
    '<div><b style="font-size:13px;font-weight:600">Models</b><dl id="talk-s-models"></dl></div>' +
    '<button type="button" class="talk-chip" id="talk-s-clear">Clear the conversation</button>' +
    '<button type="button" class="talk-chip pri" id="talk-s-done">Done</button>';
  logEl = el('div', { id: 'talk-log', 'aria-live': 'polite' });
  live = el('div', { id: 'talk-live' });
  offer = el('div', { id: 'talk-offer' });
  var form = el('form', { id: 'talk-form' });
  inp = el('textarea', { id: 'talk-in', rows: '1', enterkeyhint: 'send', autocomplete: 'off', placeholder: 'Say or type', 'aria-label': 'Talk to qodebase' });
  micBtn = el('button', { id: 'talk-mic', type: 'button', 'aria-label': 'Speak' }, ICON.mic);
  sendBtn = el('button', { id: 'talk-send', type: 'submit', 'aria-label': 'Send' }, ICON.send);
  var again = el('button', { id: 'talk-again', type: 'button', class: 'talk-chip' }, 'Hear it again');
  again.addEventListener('click', function () { unlockAudio(); hearAgain(); });
  var inWrap = el('div', { id: 'talk-inwrap' }); inWrap.appendChild(inp);
  form.appendChild(inWrap); form.appendChild(sendBtn); form.appendChild(micBtn);   // the mic at the right edge, Send next to it
  clearer(inp, inWrap, function () { if (listening) stopListen(true); });
  inp.addEventListener('input', function () { fitInp(); });
  inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); } });
  var grab = el('button', { id: 'talk-grab', type: 'button', 'aria-label': 'Drag to resize Talk, tap to fold it into the bar' }, '<i></i>');
  sheet.appendChild(grab); sheet.appendChild(head); sheet.appendChild(setp); sheet.appendChild(logEl); sheet.appendChild(live); sheet.appendChild(offer); sheet.appendChild(again); sheet.appendChild(form);
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
  bMic.addEventListener('pointerdown', function () { if (!listening && S.engine === 'live') warmMic(true); });
  bMic.addEventListener('pointerdown', function () { if (S.mic !== 'hold' || vc || listening) return; unlockAudio(); bHeld = false; bHoldT = setTimeout(function () { bHeld = true; startListen(); try { navigator.vibrate && navigator.vibrate(20); } catch (e) {} }, 150); });
  var bHoldEnd = function () { clearTimeout(bHoldT); if (S.mic === 'hold' && bHeld && listening) { trace('bar', { how: 'release' }); stopListen(false, true); } };
  bMic.addEventListener('pointerup', bHoldEnd); bMic.addEventListener('pointercancel', bHoldEnd); bMic.addEventListener('pointerleave', bHoldEnd);
  bMic.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  bMic.addEventListener('click', function () {
    unlockAudio();
    if (S.mic === 'hold') { if (bHeld) { bHeld = false; return; } if (!listening) { bNote('Hold the mic while you talk'); } return; }
    if (S.mic === 'conv') { if (vc) endConversation('you'); else { startConversation(); } return; }
    if (vc) { vc.toggleMute(); return; }
    // Tap again: stop; the words stay for a look (and an edit: tap them), then Send (Eyal: like tmux-web, never sent by itself).
    if (listening) { trace('bar', { how: 'stop-tap', mode: S.mic }); stopListen(false, S.mic === 'pause'); return; }
    trace('bar', { how: 'mic', mode: S.mic }); startListen();
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
  var scon = document.getElementById('talk-s-consent');
  if (scon) { scon.value = CONSENT ? 'on' : 'off'; scon.onchange = function () { api('consent', { on: scon.value === 'on' }).then(function (r) { CONSENT = !!r.on; if (CONSENT && !tOn) traceStart(); else if (!CONSENT) { tOn = false; tq = []; } }); }; }
  var sclp = document.getElementById('talk-s-clips');
  if (sclp) { sclp.value = S.clips; sclp.onchange = function () { S.clips = sclp.value; set('clips', S.clips); trace('setting', { clips: S.clips }); }; }
  // Answering model: the choices the running Talk offers this person (Claude: owner only, while the account has credits).
  var sans = document.getElementById('talk-s-answer'), AC = (ANSWER && ANSWER.choices) || [];
  sans.innerHTML = AC.map(function (c) { return '<option value="' + c.id + '"' + (c.ok ? '' : ' disabled') + '>' + esc(c.label) + (c.id === ANSWER.default ? ' (default)' : '') + (c.ok ? '' : ' \u2013 ' + esc(c.why || 'not available')) + '</option>'; }).join('');
  sans.value = S.answer && AC.some(function (c) { return c.id === S.answer && c.ok; }) ? S.answer : (ANSWER && ANSWER.default) || '';
  sans.onchange = function () { S.answer = sans.value; set('answer', S.answer); trace('setting', { answer: S.answer }); };
  var ssay = document.getElementById('talk-s-say');
  ssay.value = S.voice === 'off' ? 'off' : S.say;
  ssay.onchange = function () { if (ssay.value === 'off') { S.voice = 'off'; } else { S.say = ssay.value; set('say', S.say); if (S.voice === 'off') S.voice = get('voice-on', 'aura-2'); } set('voice', S.voice); sv.value = S.voice; fillSpeakers(); voiceBtn(); trace('setting', { say: ssay.value }); };
  // Models: what the running Talk uses for each step (from /api/talk/me), never typed in here.
  var mdl = document.getElementById('talk-s-models'), ROWS = [['live', 'Live words'], ['final', 'Final words'], ['cleanup', 'Clean-up'], ['decide', 'Picking the action'], ['chat', 'Answering'], ['status', 'What\u2019s going on'], ['code', 'Questions about code'], ['summary', 'Spoken summary'], ['voice', 'Voice']];
  mdl.innerHTML = ROWS.filter(function (r) { return MODELS[r[0]]; }).map(function (r) { var m = MODELS[r[0]]; return '<dt>' + r[1] + '</dt><dd>' + esc(m.model ? shortModel(m.model) : 'no model') + ' \u00b7 ' + esc(m.provider) + (m.note ? '<br><span style="color:var(--t-dim)">' + esc(m.note) + '</span>' : '') + '</dd>'; }).join('') + (MODELS.gateway ? '<dt>Gateway</dt><dd>' + esc(MODELS.gateway) + '</dd>' : '');
  var sfa = document.getElementById('talk-s-fast'); sfa.value = S.fast; sfa.onchange = function () { S.fast = sfa.value; set('fast', S.fast); trace('setting', { fast: S.fast }); };
  var scm = document.getElementById('talk-s-convmode'); scm.value = S.convmode; scm.onchange = function () { if ((scm.value === 'on') !== convOn()) toggleConv('settings'); };
  var smg = document.getElementById('talk-s-merge'); smg.value = S.merge; smg.onchange = function () { S.merge = smg.value; set('merge', S.merge); trace('setting', { merge: S.merge }); };
  var smic = document.getElementById('talk-s-mic'), swh = document.getElementById('talk-s-whisper'), skp = document.getElementById('talk-s-keep');
  var showMic = function () { spz.parentNode.style.display = S.mic === 'pause' ? '' : 'none'; swh.parentNode.style.display = S.engine === 'live' && S.mic !== 'conv' ? '' : 'none'; micBtn.setAttribute('aria-label', S.mic === 'hold' ? 'Hold to speak' : S.mic === 'conv' ? 'Start a conversation' : 'Speak'); };
  smic.value = S.mic; swh.value = S.whisper; skp.value = S.keep; showMic();
  smic.onchange = function () { S.mic = smic.value; set('mic', S.mic); trace('setting', { mic: S.mic }); showMic(); };
  swh.onchange = function () { S.whisper = swh.value; set('whisper', S.whisper); trace('setting', { whisper: S.whisper }); };
  skp.onchange = function () { S.keep = skp.value; set('keepmic', S.keep); trace('setting', { keep: S.keep }); if (S.keep === 'open') warmMic(); else releaseMic(); };
  var sspd = document.getElementById('talk-s-speed'); sspd.value = String(S.speed);
  sspd.onchange = function () { S.speed = Number(sspd.value) || 1.25; set('speed', String(S.speed)); trace('setting', { speed: S.speed }); vcVoice(); if (S.voice !== 'off') { unlockAudio(); lastSpoken = true; say('This is how fast I talk.'); } };
  var toggleVoice = toggleVoiceFn = function (where) { unlockAudio(); S.voice = S.voice === 'off' ? get('voice-on', 'aura-2') : 'off'; set('voice', S.voice); sv.value = S.voice; fillSpeakers(); voiceBtn(); trace('voice_toggle', { on: S.voice !== 'off', where: where }); if (S.voice === 'off') stopSpeaking(); };
  spk.addEventListener('click', function () { toggleVoice('sheet'); });
  bSpk.addEventListener('click', function () { toggleVoice('bar'); });
  voiceBtn();
  se.onchange = function () { S.engine = se.value; set('engine2', S.engine); trace('setting', { engine: S.engine }); showMic(); };
  sl.onchange = function () { S.lang = sl.value; set('lang', S.lang); };
  document.getElementById('talk-s-done').onclick = function () { root.classList.remove('settings'); trace('settings', { open: false }); };
  document.getElementById('talk-s-clear').onclick = function () { hist = []; chatHist = []; sset('log', hist); sset('chat', chatHist); render(); root.classList.remove('settings'); };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('open')) { stopListen(true); open(false); }
  });
  histAtLoad = hist.length;
  render();
  convBuild();   // Conversations (src/talkconv.ts): nothing unless this device has the hidden setting
}

function open(on) { if (on && S.engine === 'live' && me) warmMic(); if (!on && S.keep !== 'open') releaseMic('closed'); trace('sheet', { open: !!on, bar: root.classList.contains('bar') }); root.classList.toggle('open', !!on); sset('open', !!on); barSync(); if (on && hist.length) setTimeout(function () { logEl.scrollTop = logEl.scrollHeight; }, 50); }
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
  // A tall dock (Build's estimate panel, a third of the screen and more) does not lift the bar into the middle of the
  // page (live 2026-10-13): the bar rests hidden there and shows at the bottom only with something to say.
  var tall = false, tallTop = window.innerHeight;
  [].forEach.call(document.querySelectorAll('[data-talk-dock]'), function (d) {
    var r = d.getBoundingClientRect();
    if (!(r.height > 0 && r.bottom > window.innerHeight - 48 && r.top < window.innerHeight)) return;
    if (r.height > window.innerHeight * 0.3) { tall = true; tallTop = Math.min(tallTop, r.top); return; }
    lift = Math.max(lift, window.innerHeight - r.top);
  });
  if (root.classList.contains('tall') !== tall) { root.classList.toggle('tall', tall); barSync(); }
  // A question over a tall panel (Build's settings: 'Build it?' covered the presets, qb3's rehearsal 2026-10-14):
  // the bar sits on the panel's top edge, so everything in the panel stays visible.
  // A question sits at the very bottom, over the page's own action panel (which holds the same Build it), not lifted
  // onto the settings above it (qb3's rehearsal 2026-10-14: 'Build it?' covered the presets). One compact row.
  if (root.classList.contains('boffer') && window.innerWidth < 720) lift = 0;
  lift = Math.round(lift);
  if (window.innerWidth < 720 && !root.classList.contains('miconly')) { bar.style.bottom = lift ? lift + 'px' : '0px'; bar.style.setProperty('--talk-inset', lift ? '0px' : 'env(safe-area-inset-bottom)'); }
  else bar.style.bottom = 'calc(' + (lift ? lift + 8 : (window.innerWidth < 720 ? 8 : 16)) + 'px + env(safe-area-inset-bottom))';
  var vb = document.getElementById('talk-ver');
  if (vb) { vb.style.right = '6px'; vb.style.bottom = 'calc(' + (lift + bar.offsetHeight + 12) + 'px + env(safe-area-inset-bottom))'; }
  reserve(lift);
}
// The bar covers the last ~64 px above the page's own bottom bars: the page gets that much more room at its end.
// Body-scrolling pages: a spacer after everything. Pages that scroll a panel of their own (a project page's view
// between its header and its composer): that panel's bottom padding, measured once the page has drawn.
function reserve(lift) {
  var r = bar.getBoundingClientRect(), need = Math.round(r.height + (window.innerWidth < 720 ? 8 : 24));
  if (root.classList.contains('open')) return;
  if (!r.height) {   // the bar is hidden (resting above a composer): give the room back
    if (spacer.offsetHeight) spacer.style.height = '0px';
    (scrollers || []).forEach(function (e) { if (e.__talkAdd) { e.__talkAdd = 0; e.style.paddingBottom = (e.__talkPad || 0) + 'px'; } });
    return;
  }
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
function add(who, text, links, extra) { if (run && who !== 'you') run.texts.push(String(text)); if (who !== 'you' && lat) latMark('data'); var m = { who: who, text: String(text), links: links || undefined }; if (extra) { if (extra.sections) m.sections = extra.sections; if (extra.via) m.via = extra.via; if (extra.lead) m.lead = extra.lead; if (extra.brief) m.brief = extra.brief; } if (convAdd(m)) return; hist.push(m); if (hist.length > 40) hist = hist.slice(-40); sset('log', hist); render(); }
// "How this was answered" (manager, 2026-10-13): what heard it, what picked the action, what answered, how long.
var viaNow = null;   // the utterance in flight: { heard, decide: {model, ms}, answer: {lane, model, ms} }
function viaShort(v) { if (!v || !v.answer) return ''; var a = v.answer; return (a.label || (a.model ? shortModel(a.model) : a.lane + ', no model')) + (a.fellBack ? ' (fallback)' : '') + (a.ms != null ? ', ' + (a.ms / 1000).toFixed(1) + ' s' : ''); }
function viaLong(v) {
  var out = [];
  if (v.heard) out.push('Heard: ' + v.heard);
  if (v.decide) out.push('Picked by ' + shortModel(v.decide.model) + (v.decide.ms != null ? ' in ' + (v.decide.ms / 1000).toFixed(1) + ' s' : ''));
  if (v.answer) out.push('Answered by ' + (v.answer.label || (v.answer.model ? shortModel(v.answer.model) : v.answer.lane + ' (read from your projects, no model)')) + (v.answer.ms != null ? ' in ' + (v.answer.ms / 1000).toFixed(1) + ' s' : '') + (v.answer.fellBack ? ' (fell back: ' + v.answer.fellBack + ')' : ''));
  if (v.spoken) out.push('Said aloud: ' + v.spoken);
  return out.join(' \u00b7 ');
}
function shortModel(m) { return String(m || '').replace(/^@cf\/[^/]+\//, ''); }
function render() {
  logEl.innerHTML = '';
  if (!hist.length) {
    var box = el('div', { class: 'talk-ex' });
    examples().slice(0, 3).forEach(function (g) {
      var sec = el('section'), h = el('h3'); h.textContent = g.h; sec.appendChild(h);
      var row = el('div'); g.xs.forEach(function (x) { var b = el('span', { class: 'talk-exs' }); b.textContent = '\u201c' + x + '\u201d'; row.appendChild(b); });
      sec.appendChild(row); box.appendChild(sec);
    });
    logEl.appendChild(box);
    setTimeout(function () { logEl.scrollTop = 0; }, 60);
    barSync();
    return;
  }
  var lastMsg = hist.length ? hist[hist.length - 1] : null;
  barSync();
  hist.forEach(function (m) {
    var d = el('div', { class: m.who });
    // Answers from the code reader come as light markdown: show it as plain lines.
    d.textContent = m.who === 'ai' ? String(m.text).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\x60([^\x60]+)\x60/g, '$1').replace(/^\s*[-*] /gm, '\u2022 ') : m.text;
    // A status answer in sections (Building now, Waiting for you…), each line a link: for reading, not a wall of text.
    if (m.sections && m.sections.length) {
      d.textContent = '';
      if (m.lead) { var ld = el('p', { class: 'talk-lead' }); ld.textContent = m.lead; d.appendChild(ld); }
      m.sections.forEach(function (sec) {
        var h = el('p', { class: 'talk-sh' }); h.textContent = sec.title; d.appendChild(h);
        var ul = el('ul', { class: 'talk-sl' });
        sec.items.forEach(function (it) { var li = el('li'); if (it.href && /^\/[^/]/.test(it.href)) { var a = el('a', { href: it.href }); a.textContent = it.text; li.appendChild(a); } else li.textContent = it.text; ul.appendChild(li); });
        if (sec.more) { var li2 = el('li', { class: 'talk-more' }); li2.textContent = 'and ' + sec.more + ' more'; ul.appendChild(li2); }
        d.appendChild(ul);
      });
    }
    if (m.via && m.via.answer) {
      var vb = el('button', { type: 'button', class: 'talk-via', 'aria-expanded': 'false' }); vb.textContent = viaShort(m.via);
      vb.onclick = (function (v, b) { return function () { var on = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', on ? 'true' : 'false'); b.textContent = on ? viaLong(v) : viaShort(v); }; })(m.via, vb);
      d.appendChild(vb);
    }
    if (m.links && m.links.length && !(m.sections && m.sections.length)) {
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
  var draft = !listening && !offerState && !busy && !!inp.value.trim() && !root.classList.contains('open');
  root.classList.toggle('draft', draft);
  root.classList.toggle('boffer', !!offerState);
  var t = '', dim = false, last = null, ex = '';
  for (var i = hist.length - 1; i >= 0; i--) if (hist[i].who !== 'you') { last = hist[i]; break; }
  if (offerState) t = offerState.text || (last ? last.text : 'Go ahead?');
  else if (draft) t = inp.value.trim();
  else if (mine) { t = inp.value.trim(); if (!t) { t = root.classList.contains('arming') ? 'Starting the mic\u2026' : 'Listening\u2026'; dim = true; } }
  else if (busy && stEl.textContent) { t = stEl.textContent; dim = true; }
  else if (last && hist.length !== histAtLoad) t = last.brief || last.text;   // a status answer folds to its count line
  else ex = exampleLine();
  root.classList.toggle('ex', !!ex);
  if (ex) { bText.innerHTML = ''; bText.appendChild(document.createTextNode('Try saying ')); var qq = el('q'); qq.textContent = ex; bText.appendChild(qq); bar.querySelector('#talk-bmid').setAttribute('aria-label', 'Open Talk'); }
  else { bText.textContent = String(t).replace(/\s+/g, ' ').trim(); bar.querySelector('#talk-bmid').setAttribute('aria-label', 'Open the conversation'); }
  bText.classList.toggle('dim', dim);
  // Above a composer: hidden at rest; shown for live words, a question, work in progress, or a fresh answer (8 s).
  var happening = mine || draft || !!offerState || busy || (vc && vcStatus !== 'idle');
  if (happening) { root.classList.remove('rest'); clearTimeout(restT); restT = null; }
  else if (hist.length !== histAtLoad && !restT && (root.classList.contains('slim') || root.classList.contains('tall')) && !root.classList.contains('rest')) restT = setTimeout(function () { restT = null; histAtLoad = hist.length; root.classList.add('rest'); }, 8000);
  else if (hist.length === histAtLoad && !restT) root.classList.add('rest');
  if (root.classList.contains('rest') !== !!root.__rest) { root.__rest = root.classList.contains('rest'); setTimeout(placeBar, 30); }
  if (root.classList.contains('boffer') !== !!root.__boffer) { root.__boffer = root.classList.contains('boffer'); setTimeout(placeBar, 30); }
  var on = (listening && !cInto) || (vc && vcStatus !== 'idle');
  bMic.classList.toggle('on', !!on); bMic.innerHTML = on ? ICON.stop : ICON.mic;
  bMic.setAttribute('aria-label', on ? 'Stop' : 'Speak to qodebase');
  barMode();
}
function bNote(t) { add('note', t); }
// What a person can say, by page: a fixed, curated set, never a project name (Eyal, 2026-10-13: 'Try saying "open my will
// help help"' reads weird). Names only in answers and chips. The bar shows one of the page's own, picked per page load.
var PAGE_EX = [
  [/^\/$/, ['build a habit tracker', 'what\u2019s going on with my builds?', 'show me how it works']],
  [/^\/mine/, ['open my newest project', 'which builds are waiting for me?']],
  [/^\/runs/, ['open the last run', 'what happened at one minute?']],
  [/^\/deck/, ['next slide', 'go to slide 5']],
  [/^\/p\//, ['add a dark mode', 'what changed today?']],
  [/.*/, ['what\u2019s going on with my builds?', 'open my projects', 'build a habit tracker']],
];
function pageExamples() { for (var i = 0; i < PAGE_EX.length; i++) if (PAGE_EX[i][0].test(location.pathname)) return PAGE_EX[i][1]; return []; }
function examples() {
  var groups = [
    { h: 'Build', xs: ['build a habit tracker', 'show me a medium idea', 'use the cheapest settings'] },
    { h: 'Find your way', xs: ['show me how it works', 'open explore', 'open my newest project'] },
    { h: 'Your projects', xs: ['what\u2019s going on with my builds?', 'which builds are waiting for me?', 'list my projects'] },
  ];
  var here = pageExamples();
  if (!/^\/$/.test(location.pathname)) groups.unshift({ h: 'On this page', xs: here });
  return groups;
}
var latestOwn = '', exI = Math.floor(Math.random() * 1000), exT = null;   // one example per page load, picked at random
function exampleLine() { var xs = pageExamples(); return xs[exI % xs.length]; }
function runExample(t) { trace('example', { text: t, where: root.classList.contains('open') ? 'sheet' : 'bar' }); unlockAudio(); lastSpoken = false; submit(t); }
var miniT = null, restT = null, histAtLoad = -1;
function barMode() {
  var m = document.body.getAttribute('data-talk-bar') || '';
  if (/[?&](clean|rec=1)\b/.test(location.search) || document.body.classList.contains('rec')) m = 'off';
  root.classList.toggle('nobar', m === 'off');
  if (m !== 'mic') { root.classList.remove('miconly'); return; }
  // Mic only, unless something is happening; the last answer stays readable for 6 s.
  var active = listening || busy || !!offerState || (vc && vcStatus !== 'idle');
  clearTimeout(miniT);
  if (active) { root.classList.remove('miconly'); root.__wasActive = 1; return; }
  // Until something happens on this page: only the mic, at once. After an answer: readable for 6 s first.
  if (!root.__wasActive) { root.classList.add('miconly'); return; }
  miniT = setTimeout(function () { root.classList.add('miconly'); placeBar(); }, 6000);
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
  if (curU && tOn) { body.uid = curU; body.sid = tsid; }
  return fetch('/api/talk/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
    .then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
}

// ---- The one entry point: a sentence --------------------------------------
var toggleVoiceFn = null;   // the speaker toggle (built with the sheet), for 'turn off spoken replies'
var preview = null;   // { text, cmd } from interim speech
var whisperP = null;  // { live, p: Promise<whisper words>, taken } for the turn that acted on the live words
var spec = null, specCalls = 0, specT = null;   // { text, p } a decide made on the live words while they were still talking
var STATUS_RX = /^\s*((ok(ay)?|so|hey|hi|and)[,\s]+)?(what'?s|what is|whats)\s+(going on|happening)(\s+(with|in|across)\s+(all\s+)?(my|the)\s+(projects?|builds?|work|apps?))?(\s+(today|right now|now|at the moment))?\s*[?.!]*\s*$|^\s*(status|status update|any updates?|give me (a|the) status( update)?)\s*[?.!]*\s*$/i;
function normWords(x) { return wordsOf(x).join(' '); }
function guess(text, now) {
  clearTimeout(specT);
  if (S.fast !== 'on' || !convOn() || !dcOn || specCalls >= 3) return;
  var t = String(text || '').trim();
  if (t.split(/\s+/).length < 2 || STATUS_RX.test(t) || (spec && normWords(spec.text) === normWords(t))) return;
  specT = setTimeout(function () {
    if (!dcOn && !now) return;
    specCalls++;
    var p = api('decide', { utterance: t, screen: screen() });
    spec = { text: t, p: p, at: Date.now() };
    trace('decide_guess', { text: t, n: specCalls });
  }, now ? 0 : 350);
}
var lastText = '';
function submit(text) {
  if (!curU || uSaid) curU = newU();
  uSaid = true;
  lastText = String(text || '');
  trace('said', { text: text, spoken: lastSpoken, engine: lastSpoken ? S.engine : 'typed', conv: convOn() || undefined });
  if (busy) return;
  if (convSaid(text)) return;   // Conversations (hidden setting): "new conversation", the turn, project chips
  // A short yes / no answers the question on screen (Stop this run? Send it to the agents?): no model.
  var said = String(text || '').trim(), short = said.split(/\s+/).length <= 5;
  // 'switch to dark mode': a theme toggle on the page if there is one, else say how (manager, 2026-10-14).
  var dm = /^\s*(please\s+)?((switch|change|turn)\s+(to|on)\s+(the\s+)?(dark|light)( mode| theme)?|(dark|light) (mode|theme)( please)?)\s*[.!]*\s*$/i.exec(said);
  if (dm) {
    add('you', said);
    var dark = /dark/i.test(said), tog = [].filter.call(document.querySelectorAll('button, [role=switch], input[type=checkbox]'), function (e) { return !e.closest('#talk-root') && e.getClientRects().length && /dark|theme|light mode|appearance/i.test((e.getAttribute('aria-label') || '') + ' ' + (e.innerText || '') + ' ' + (e.title || '')); })[0];
    if (tog) { tog.click(); add('app', 'Pressed \u201c' + String(tog.getAttribute('aria-label') || tog.innerText).trim() + '\u201d.'); trace('act', { op: 'press', label: 'theme toggle' }); return finish(); }
    var ml = 'qodebase follows your phone\u2019s ' + (dark ? 'dark' : 'light') + ' mode setting, so there\u2019s no switch here. To add a ' + (dark ? 'dark' : 'light') + ' mode to an app, say \u201cadd a ' + (dark ? 'dark' : 'light') + ' mode to the app\u201d on its page.';
    add('ai', ml); if (lastSpoken) say(ml); trace('theme', { has_toggle: false }); return finish();
  }
  // 'show the index check' on /runs: the API index line on a run's card, read out (qb3's scene 3e).
  if (/^\/runs/.test(location.pathname) && /\b(index check|api index|the index)\b/i.test(said) && /\b(show|open|read|what|how)\b/i.test(said)) {
    var ix = [].filter.call(document.querySelectorAll('.rc-ix'), function (e) { return e.getClientRects().length; })[0];
    add('you', said);
    if (ix) { ix.scrollIntoView({ block: 'center', behavior: 'smooth' }); unmark(); mark(ix); var it = ix.innerText.replace(/\s+/g, ' ').trim(); add('ai', it); if (lastSpoken) say(it); trace('act', { op: 'show', label: 'index check' }); }
    else { var nx = 'This run has no API index check yet: it shows on a run that writes docs/API.md.'; add('ai', nx); if (lastSpoken) say(nx); }
    return finish();
  }
  // Talk's own settings by voice (qb7's e2e: no route to them): spoken replies, conversation mode.
  var setv = /^\s*(please\s+)?(turn|switch)\s+(off|on)\s+(the\s+)?(spoken replies|voice replies|replies out loud|speaking|talking back|voice)\s*[.!]*\s*$|^\s*(mute|unmute)( talk| replies| yourself)?\s*[.!]*\s*$|^\s*(stop|start) (talking|speaking)( out loud)?\s*[.!]*\s*$/i.exec(said);
  if (setv) {
    var on = /\bon\b|unmute|start/i.test(said) && !/\boff\b|^\s*mute|stop/i.test(said);
    add('you', said); if ((S.voice !== 'off') !== on && toggleVoiceFn) toggleVoiceFn('voice'); trace('setting', { voice: S.voice, by: 'voice' });
    add('app', on ? 'Spoken replies are on.' : 'Spoken replies are off.'); if (on) say('Spoken replies are on.'); return finish();
  }
  var setc = /^\s*(please\s+)?((turn|switch)\s+(on|off)\s+conversation( mode)?|(start|stop|end)\s+(the\s+)?conversation( mode)?|conversation mode\s+(on|off))\s*[.!]*\s*$/i.exec(said);
  if (setc) {
    var con = /\bon\b|start/i.test(said) && !/\boff\b|stop|end/i.test(said);
    add('you', said); add('app', con ? 'Conversation mode is on: I\u2019ll listen again after each answer.' : 'Conversation mode is off.');
    if (convOn() !== con) toggleConv('voice'); return finish();
  }
  if (lastIdea && Date.now() - lastIdea.at < 10 * 60000 && /^\s*(another( one)?|one more|a different one|next( one)?|try again)\b/i.test(said)) { add('you', said); busy = true; offerOff(); return ideaFlow(lastIdea.size); }
  // Punctuation is not words: the recogniser writes 'Yes. Start.' or 'Yes, build it.' (qb3's take, 2026-10-14: 'Yes. Start.'
  // went to the model instead of answering the pending 'Start?').
  var bare = said.replace(/[.,!?;:\u2026]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (offerState && short && YES_RX.test(bare)) { var y = offerState.yes; trace('offer_voice', { answer: 'yes', text: said }); add('you', said); offerOff(); y(); return; }
  if (offerState && bare.split(/\s+/).length <= 3 && NO_RX.test(bare)) { trace('offer_voice', { answer: 'no', text: said }); add('you', said); offerOff(); add('app', 'Okay, I left it.'); return finish(); }
  busy = true; unmark(); offerOff();
  add('you', text);
  status('Thinking…');
  var t0 = Date.now();
  talkUsedAt = Date.now();
  // No round trip for fixed phrases (STATUS_RX mirrors the server's), and a guess made while they were still talking
  // is used when its words are the final words (quick replies, 2026-10-13).
  var quickSt = S.fast === 'on' && STATUS_RX.test(String(text || ''));
  var specHit = spec && normWords(spec.text) === normWords(text);
  var reuse = quickSt ? Promise.resolve({ cmd: { mode: 'ask', op: 'status', p: 1, why: 'status words (page)' }, ms: { total: 0 } })
    : preview && preview.text === text ? Promise.resolve({ cmd: preview.cmd, ms: { total: 0 } })
    : specHit ? spec.p : api('decide', { utterance: text, screen: screen() });
  if (lat) lat.quick = quickSt ? 'status' : specHit ? 'spec' : '';
  if (specHit || quickSt) trace('decide_reuse', { how: quickSt ? 'status words' : 'guessed while talking', text: text });
  preview = null; spec = null;
  reuse.then(function (r) {
    if (r.error) { if (run) run.ok = false; add('note', r.why || 'Something went wrong.'); return done(); }
    var c = r.cmd;
    if (lat) { latMark('decide'); lat.lane = c.mode + '/' + c.op; }
    viaNow = { heard: lastSpoken ? (S.engine === 'live' ? 'live words + ' + (S.merge === 'on' ? 'Whisper, cleaned up' : 'Whisper') : S.engine) : 'typed', decide: { model: MODELS.decide && MODELS.decide.model, ms: r.ms && r.ms.total } };
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
    // A project whose agents asked you something (X5 ask-person): a sentence that is not a build order is offered
    // as the answer (qb3's shot 2d: "Use Stripe test mode; here is the test key.").
    var pm = /^\/p\/([^/]+)\/([^/]+)/.exec(location.pathname);
    if (pm && !c.answerChecked && !ORDER_RX.test(text) && (c.mode === 'none' || c.mode === 'ask' || ['change', 'none', 'explain', 'type'].indexOf(c.op) >= 0 || (c.p || 0) < 0.45)) {
      c.answerChecked = true;
      return openAsks(pm[1], pm[2]).then(function (open) {
        if (!open.length) return route(c, text);
        var a = open[0], who = a.by === 'router' ? 'the router' : 'Agent ' + String(a.by).split('--').pop();
        var q = 'Answer ' + who + '\u2019s question (\u201c' + String(a.question).slice(0, 90) + '\u201d) with this?';
        add('ai', q); say('Answer ' + who + '?');
        offerOn(q, function () { busy = true; answerAsk(pm[1], pm[2], a, text); }, 'Answer');
        trace('ask_offer', { by: a.by, open: open.length });
        done();
      }).catch(function () { route(c, text); });
    }
    route(c, text);
  }).catch(function (e) { if (run) run.ok = false; add('note', 'Could not reach qodebase.'); logEv('error', { where: 'decide', err: String(e) }); done(); });
}
var ORDER_RX = /^\s*(please\s+|can you\s+|could you\s+|let'?s\s+)?(build|add|make|create|implement|fix|change|remove|delete|rename|give|put|update|improve|redesign|replace|write|refactor|start|turn|open|show|go|take)\b/i;
function openAsks(owner, name) {
  return fetch('/api/p/' + owner + '/' + name + '/asks', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
    var out = [];
    (j.asks || []).forEach(function (x) { (x.asked || []).forEach(function (q) { if (q.state === 'open') out.push(q); }); });
    return out.sort(function (a, b) { return b.at - a.at; });
  });
}
// The answer goes into the asker's own session (qb6): an agent by its id, the router as a router request.
function answerAsk(owner, name, a, text) {
  status('Sending\u2026');
  var p = a.by === 'router' ? projPost(owner, name, 'router', { text: text, from: 'talk' })
    : fetch('/api/agents/' + encodeURIComponent(a.by) + '/send', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text }) }).then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }); });
  p.then(function (r) {
    logEv('ask_answer', { by: a.by, ok: !(r && r.error), err: r && r.error || null });
    if (r && r.error) { add('note', 'Could not send the answer: ' + r.error); return done(); }
    add('app', 'Answered ' + (a.by === 'router' ? 'the router' : 'Agent ' + String(a.by).split('--').pop()) + '.', a.href ? [{ text: 'Open it', href: a.href }] : undefined);
    done();
  }).catch(function () { add('note', 'Could not reach qodebase.'); done(); });
}
function route(c, text) {
    if (c.mode === 'none') {
      // Not understood from the live words ("Give me a small ID."): Whisper is still reading the clip; when it heard
      // something else, its words are the turn (no question asked), else the line is said aloud.
      var wp = whisperP && whisperP.live === text ? whisperP : null;
      var cut = function () { var nl = (c.complete || 0) < 0.5 ? 'Sounds cut off. Say it again?' : 'I did not catch a request there.'; add('note', nl); if (lastSpoken) say(nl); return done(); };
      if (!wp) return cut();
      status('Checking the words\u2026'); wp.taken = true;
      return Promise.race([wp.p, new Promise(function (ok) { setTimeout(function () { ok(''); }, 4000); })]).then(function (w) {
        w = wordsOnly(w);
        if (w && normWords(w) !== normWords(text)) { trace('whisper_redo', { how: 'not understood', live: text, text: w }); busy = false; status(''); lastSpoken = true; return submit(w); }
        cut();
      });
    }
    if (c.op === 'status') return whatsGoingOn(text);
    if (c.op === 'list') {
      var n = Number(c.target) || 0;
      var line = n ? 'You have ' + n + ' project' + (n === 1 ? '' : 's') + '. The latest: ' + c.text + '.' : 'You have no projects yet. Say what you want to build.';
      add('ai', line); say(line);
      // Only when asked to show or open them; otherwise offer it (Eyal, 2026-10-13: "don't navigate unasked").
      if (n && location.pathname !== '/mine') {
        if (/\b(show|open|take me|go to|bring up)\b|תראה|הראה|תפתח|פתח|קח אותי|תעביר אותי/i.test(lastText)) { sset('last', 'your projects'); setTimeout(function () { act({ op: 'go', href: '/mine', label: 'your projects' }); }, 400); return; }
        offerOn('Open your projects?', function () { act({ op: 'go', href: '/mine', label: 'your projects' }); }, 'Open');
      }
      return done();
    }
    if (c.op === 'which') return whichOne(c);
    if (c.op === 'idea') return ideaFlow(c.text || 'Medium', c.target);
    if (c.op === 'latest') {
      var ago = c.updatedAt ? agoWords(Date.now() - c.updatedAt) : '';
      var line2 = 'Your latest is ' + String(c.label || '').split('/').pop().replace(/-/g, ' ') + (c.text ? ': ' + String(c.text).replace(/\s+/g, ' ').slice(0, 140).replace(/[.\s]+$/, '') : '') + (ago ? ', changed ' + ago + ' ago' : '') + '.';
      if (viaNow) viaNow.answer = { lane: 'your projects', model: null, ms: 0 };
      // Said short (name + when): the ~200-character line with its description took 3-7 s to start speaking.
      var said2 = 'Your latest is ' + String(c.label || '').split('/').pop().replace(/-/g, ' ') + (ago ? ', changed ' + ago + ' ago' : '') + '. Want to open it?';
      add('ai', line2 + ' Open it?', null, { via: viaNow }); var s2 = new String(said2); s2.__short = true; say(s2);
      offerOn('', function () { act({ op: 'go', href: c.href, label: c.label }); }, 'Open');
      return done();
    }
    convFromCmd(c); if (c.op === 'change') convChange(c);   // Conversations: the project goes on it / the one on it is the target
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
}
function done() { busy = false; status(''); finish(); convAfter(); latSilent(); convDone(); }
// ---- Latency of a spoken turn (manager, 2026-10-13): ms from the stop to words ready, decided, answer ready, first ack,
// first sound; 'end' = last word heard -> stop. One 'latency' trace row per turn (/admin/talk shows p50/p90).
var lat = null, lastWordAt = 0;
function latStart(how) { lat = { t0: Date.now(), how: how, end: lastWordAt ? Date.now() - lastWordAt : null, marks: {}, lane: '' }; }
function latMark(k, extra) { if (!lat || lat.marks[k] != null) return; lat.marks[k] = Date.now() - lat.t0; if (extra) for (var x in extra) lat[x] = extra[x]; if (k === 'audio') latEmit(''); }
function latEmit(why) {
  if (!lat) return; var m = lat.marks, L = lat; lat = null;
  trace('latency', { how: L.how, lane: L.lane, heard: L.heard || '', end: L.end, final: m.final, decide: m.decide, data: m.data, ack: m.ack, audio: m.audio,
    total: m.audio != null && L.end != null ? m.audio + L.end : null, why: why, fast: S.fast, quick: L.quick || undefined });
}
function latSilent() { setTimeout(function () { if (lat && !speakPending && !speakingQ && !ackPlaying) latEmit('no sound'); }, 3000); }
// Words compared the way a person hears them: no case or punctuation, plural s and doubled words ignored.
// Only words someone said ever reach the page's logic or a 'Did you say': no code, markup, methods or empties
// (2026-10-13: "function text() { [native code] }" was quoted to Eyal). Mirrors src/talkstt.ts wordsOnly.
function wordsOnly(s) {
  var t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  if (!t || !/\p{L}/u.test(t)) return '';
  if (/\bfunction\s*\w*\s*\(|\[native code\]|=>|^\s*[{[<]|\bundefined\b|\[object \w+\]/.test(t)) return '';
  return t;
}
function wordsOf(x) { return String(x || '').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean).map(function (w) { return w.replace(/'s$/, '').replace(/(..)s$/, '$1'); }).filter(function (w, i, a) { return i === 0 || w !== a[i - 1]; }); }
function wordDist(a, b) { var d = []; for (var i = 0; i <= a.length; i++) { d[i] = [i]; for (var j = 1; j <= b.length; j++) d[i][j] = i === 0 ? j : Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); } return d[a.length][b.length]; }
// Quick replies act on the live words; Whisper reads the clip meanwhile and, when it heard something materially
// different, the answer is offered again for its words (traced either way).
function whisperCheck(live, j, w0) {
  var w = (j && j.whisper) || '';
  if (!w) { trace('whisper_missing', { why: (j && j.err) || 'no text', after: 'live-first' }); return; }
  var A = wordsOf(live), B = wordsOf(w), d = wordDist(A, B), r = d / Math.max(1, A.length, B.length);
  var material = d >= 1;   // after the normalising above, any word left different counts ("parking" vs "packing" list, Eyal 2026-10-13)
  trace('dc_whisper_check', { live: live, whisper: w, dist: d, ratio: Math.round(r * 100) / 100, material: material, whisper_ms: Date.now() - w0 });
  // Talk has already answered by now: never a 'Did you say…?' over or after the answer (Eyal, 2026-10-13: it quoted
  // a bad string and talked over the answer). The difference stays in the trace for the bench; a turn the live
  // words did not make sense of uses Whisper's words before answering (the 'none' path in route()).
}
// "What's going on" kept ready while Talk is in use (every 30 s while the page shows, and after each turn), so the
// answer comes from memory; the call has its own cap (status_warm) and is not tied to an utterance.
var stCache = null, signedInNow = false, talkUsedAt = 0;
function warmStatus(why) {
  if (!signedInNow || document.visibilityState === 'hidden') return;
  if (!(convOn() || Date.now() - talkUsedAt < 10 * 60000 || (root && root.classList.contains('open')))) return;
  if (stCache && stCache.loading) return;
  var t0 = Date.now(); stCache = Object.assign(stCache || {}, { loading: true });
  fetch('/api/talk/status', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ utterance: '', warm: 1 }) })
    .then(function (r) { return r.json(); }).then(function (r) { stCache = r && r.ok !== false && !r.error ? { at: Date.now(), r: r, ms: Date.now() - t0 } : (stCache && stCache.r ? Object.assign(stCache, { loading: false }) : null); })
    .catch(function () { if (stCache) stCache.loading = false; });
}
setInterval(function () { warmStatus('tick'); }, 30000);
// A short "One moment." when the answer will take a while (chat, code, ideas), so the first sound comes at once.
var ACK = 'One moment.', ackPlaying = false;
function ack() {
  if (S.fast !== 'on' || S.voice === 'off' || S.voice === 'phone' || !lastSpoken || !lat || lat.marks.audio != null || speakingQ || ackPlaying) return;
  unlockAudio(); ackPlaying = true; latMark('ack');
  player.onplaying = null; player.onended = function () { ackPlaying = false; }; player.onerror = function () { ackPlaying = false; };
  player.src = ttsUrl(ACK);
  var pp = player.play(); if (pp && pp.catch) pp.catch(function () { ackPlaying = false; });
}
// ---- Conversation mode: hands-free turns over the dictation path (no voice kit). A 1.5 s pause after words sends them;
// when the answer has been spoken, it listens again. Two turns with nothing heard, or the toggle, end it.
var convEmpty = 0, speakPending = false;
function convOn() { return S.convmode === 'on'; }
function toggleConv(where) {
  S.convmode = convOn() ? 'off' : 'on'; set('convmode', S.convmode); convEmpty = 0;
  if (convBtn) convBtn.setAttribute('aria-pressed', convOn() ? 'true' : 'false');
  var scm = document.getElementById('talk-s-convmode'); if (scm) scm.value = S.convmode;
  trace('conv_mode', { on: convOn(), where: where });
  if (convOn()) { if (S.voice === 'off') { S.voice = get('voice-on', 'aura-2'); set('voice', S.voice); voiceBtn(); } if (!listening && !busy) startListen(); }
  else if (listening) stopListen(false, false);
  barSync();
}
function convAfter() {
  if (!convOn() || !lastSpoken) return;
  prewarmWs();   // the next turn's socket, whatever ended this one
  var t0 = Date.now();
  (function wait() {
    if (!convOn()) return;
    var talking = speakPending || speakingQ || ackPlaying || (player && !player.paused && !player.ended && player.currentTime > 0) || (window.speechSynthesis && speechSynthesis.speaking);
    if ((talking || busy) && Date.now() - t0 < 30000) return setTimeout(wait, 300);
    // A question on screen is answered by voice too: listen (a spoken yes/no answers it, anything else is a new turn).
    // It used to stop here, so 'Want to open it?' was asked out loud and never heard (2026-10-13 user test).
    if (offerState) trace('conv_listen_offer', { offer: String(offerState.text || '').slice(0, 60) });
    if (!listening) { trace('conv_listen_again', { ms: Date.now() - t0 }); startListen(); }
  })();
}
var quietT = null;
// Conversation mode: after words, 1.5 s of quiet ends the turn (tmux-web's default pause).
function armQuiet() {
  clearTimeout(quietT);
  if (!convOn() || !dcOn) return;   // the 'pause' mic mode keeps its own timer (dcArm)
  quietT = setTimeout(function () {
    if (!dcOn) return;
    if (!(dcBuf.length || dcText)) return;
    if (S.fast === 'on' && dcBuf.length && !dcText) return endTurn('quiet');
    trace('dc_stop', { how: 'quiet', conv: convOn(), pieces: dcBuf.length, ms: Date.now() - dcT0 });
    latStart('quiet');
    liveStop(false, true);
  }, 1500);
}
function agoWords(ms) { var m = Math.round(ms / 60000); return m < 60 ? m + ' min' : m < 48 * 60 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' days'; }
// "Give me an idea": the page's own generator ('Need an idea?' sizes) fills the box with an idea and its settings;
// Talk says it in a sentence and offers Build it ("another" asks again). Never types a placeholder like "a new app".
var lastIdea = null;   // { size, at }
function ideaFlow(size, targetId) {
  var btn = (targetId && byId(targetId)) || [].filter.call(document.querySelectorAll('button'), function (b) { return new RegExp('^' + size + '\\b').test(String(b.innerText || '').trim()); })[0];
  var box = document.querySelector('.askbox textarea, textarea[aria-label="What do you want to build?"]');
  if (!btn || !box) { add('note', 'Ideas are on the home page.'); sset('then', { text: 'give me a ' + size.toLowerCase() + ' idea', at: Date.now() }); act({ op: 'go', href: '/', label: 'home' }); return; }
  var before = box.value; lastIdea = { size: size, at: Date.now() };
  status('Thinking of an idea\u2026'); trace('idea', { size: size });
  if (lat) { lat.lane = lat.lane || 'idea'; ack(); }   // the generator takes 2-10 s: 'One moment.' at once
  btn.click();
  var t0 = Date.now();
  (function wait() {
    if (box.value && box.value !== before) {
      var idea = box.value.replace(/\s+/g, ' ').trim(), first = (idea.match(/^[^.!?]+[.!?]?/) || [idea])[0];
      if (viaNow) viaNow.answer = { lane: 'the idea generator', model: null, ms: Date.now() - t0 };
      add('ai', 'Here\u2019s a ' + size.toLowerCase() + ' idea: ' + first + ' It\u2019s in the box with settings that suit it. Want another, or build it?', null, { via: viaNow });
      say('Here\u2019s an idea: ' + first + ' Want another, or build it?');
      var b2 = [].filter.call(document.querySelectorAll('button'), function (b) { return /^build it$/i.test(String(b.innerText || '').trim()) && b.getClientRects().length; })[0];
      if (b2) offerOn('', function () { add('app', 'Pressed \u201cBuild it\u201d.'); trace('act', { op: 'press', label: 'Build it', confirmed: true }); b2.click(); }, 'Build it');
      return done();
    }
    if (Date.now() - t0 > 15000) { add('note', 'No idea came back. Try again?'); return done(); }
    setTimeout(wait, 300);
  })();
}
// The gate (same words as talkdecide.ts gate(), which the conversation agent uses).
var CONFIRM_RX = /^(stop|pause|resume|merge|build it|build|send back|start|watch a run|run for real|replay|replace|connect my plan|save the key|shot|fork|import)\b/i;
var DESTROY_RX = /^(remove|delete|revoke|sign out|log out|uninstall|disconnect|make (it )?(private|public)|clear)\b/i;
// The whole sentence is the answer ('go back' is a new turn, not a yes: qb7's e2e, 2026-10-13).
var YES_RX = /^\s*(yes|yeah|yep|yup|sure|ok(ay)?|do it|go( ahead)?|please( do)?|confirm|send( it)?|fork( it)?|stop it|go for it|open( it)?|build( it)?|start( it| building| the run| the job)?|yes,? (please|do it|go ahead|open it|send it|start( it| building)?|build it)|go ahead and (start|build)( it)?)\s*(please|then|now)?[.!]*\s*$/i;
var NO_RX = /^\s*(no|nope|nah|cancel|don'?t|never ?mind|not now|leave it|no,? thanks?|no thank you|no,? (not now|not yet|cancel|stop|don'?t|leave it|wait|never ?mind))\s*(then|now)?[.!]*\s*$/i;
function gateOf(c) {
  if (['press', 'go', 'type'].indexOf(c.op) < 0) return (c.risky || 0) >= 0.5 && ['status', 'list', 'code', 'none', 'latest', 'idea', 'which'].indexOf(c.op) < 0 ? 'refuse' : null;
  var label = String(c.label || '').trim();
  if ((c.destroys || 0) >= 0.5 || DESTROY_RX.test(label)) return 'refuse';
  if (c.op === 'press' && /^x/.test(String(c.target || ''))) return null;   // a page's own action: its UI asks for the real step
  if (c.op === 'press' && /^(Fastest|Balanced|Cheapest|Suggest from my idea|Small|Medium|Large|Huge)\b/.test(label)) return null;   // a preset only changes the settings
  if (c.op === 'press' && /^build it$/i.test(label) && location.pathname === '/') return null;   // home's Build it opens the brief, which asks before anything starts
  if (c.op === 'go' && (c.then || c.href === '/runs' || /^\/p\//.test(String(c.href || '')))) return null;   // opening a page
  if (c.op === 'type') return null;   // filling a box is safe; its Send / Build it asks
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
  return 'Hi. Say what to build, where to go, or ask \u201cwhat\u2019s going on?\u201d';
}

// ---- "What's going on": real data across their projects (/api/talk/status, no model).
function whatsGoingOn(text) {
  if (lat) lat.lane = 'status';
  var fresh = stCache && stCache.r && Date.now() - stCache.at < 45000 && !/\btoday\b/i.test(text || '');
  status('Looking at your projects\u2026');
  (fresh ? Promise.resolve(Object.assign({}, stCache.r, { ready: Date.now() - stCache.at })) : api('status', { utterance: text })).then(function (r) {
    if (fresh) { trace('status_ready', { age_ms: r.ready }); setTimeout(function () { warmStatus('used'); }, 1500); }
    if (r.error) { if (run) run.ok = false; add('note', r.why || 'Could not look.'); return done(); }
    if (viaNow) viaNow.answer = { lane: 'status', model: null, ms: r.ms };
    add('ai', r.text, r.links, { sections: r.sections, via: viaNow, lead: r.lead, brief: r.brief });
    if (r.spoken) { var sp = new String(r.spoken); sp.__short = true; say(sp); } else say(r.text);
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
  // Someone else's project, and the sentence suggests ("suggest to this project: …", "ask the owner to …"):
  // a request to its owner (qb7's Requests, POST …/requests), confirmed first like a change.
  var sug = SUGGEST_RX.exec(String(text || ''));
  if (!c.mine && sug) {
    var what = String(text).slice(sug[0].length).replace(/^[\s:,-]+/, '').trim() || text;
    var q = what.length > 160 ? what.slice(0, 150).replace(/\s+\S*$/, '') + '\u2026' : what;
    offerOn('Suggest to ' + owner + '/' + name + '\u2019s owner: \u201c' + q + '\u201d?', function () { busy = true; suggest(owner, name, what); }, 'Suggest');
    return done();
  }
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
// Same as talkdecide.ts SCAFFOLD_RX: projects a harness made never become examples or "which project?" chips.
var SCAFFOLD_RX = /^(kata|fleet|lab|real|selftest|self-test|test|tmp|smoke|bench|dial|sim)[-_]|[-_][0-9a-f]{5}([-_]|$)|[-_]r\d+[a-z]?$|[-_]\d+$|(^|[-_])(test|lab|crew|busy|team|demo|copy|fixture|real)([-_]|$)/i;
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
var SUGGEST_RX = /^\s*(please\s+)?(suggest|request|propose|ask the owner( to)?|tell the owner( to)?)(\s+(to|for|on)\s+(this|the|that)\s+(project|app))?/i;
function suggest(owner, name, text) {
  status('Sending\u2026');
  projPost(owner, name, 'requests', { text: String(text).slice(0, 1000) }).then(function (r) {
    logEv('suggest', { project: owner + '/' + name, ok: !r.error, err: r.error || null });
    if (r.error) { add('note', /HTTP 404/.test(r.error) ? 'This project does not take requests yet.' : 'Could not send it: ' + r.error); return done(); }
    add('app', 'Sent to ' + owner + '/' + name + '\u2019s owner as a request.', [{ text: 'Requests', href: '/p/' + owner + '/' + name + '/requests' }]);
    done();
  }).catch(function () { add('note', 'Could not reach qodebase.'); done(); });
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
      // Never open a page that is not there (a made-up /p/forq showed raw JSON): check it first, else ask which one.
      return checkHref(c.href, c.target && byId(c.target)).then(function (ok) {
        logEv('nav_check', { href: c.href, ok: ok });
        if (!ok) return whichOne(c);
        add('app', 'Opening ' + (c.label || c.href) + '…');
        sset('last', c.label || c.href);
        sset('nav', { u: curU, href: c.href, at: Date.now() });
        if (c.then) sset('then', { text: c.then, at: Date.now() });
        trace('act', { op: 'go', href: c.href, label: c.label });
        busy = false;
        leave(function () { traceFlush(true); location.assign(c.href); });
      });
    }
    if (c.op === 'back') { add('app', 'Going back…'); trace('act', { op: 'back' }); busy = false; leave(function () { history.back(); }); return; }
    if (c.op === 'press' && c.target && /^x/.test(c.target)) { return pageAction(c); }
    if (c.op === 'press' && target) {
      var before = visibleButtons();
      add('app', 'Pressed \u201c' + plainLabel(c.label) + '\u201d.'); target.click(); trace('act', { op: 'press', label: c.label, confirmed: !!c.confirmed });
      // A preset picked by voice with the idea box filled: 'Build it?' again (picking one used to drop the question).
      if (location.pathname === '/' && /^(Fastest|Balanced|Cheapest|Suggest from my idea)\b/.test(String(c.label || ''))) { var ib = document.querySelector('.askbox textarea'); if (ib && ib.value.trim()) setTimeout(function () { offerSubmit(ib); }, 250); }
      // A button that asks again ("Stop" → "Stop this run", "Remove" → tap again): after a yes, press the second one too.
      if (c.confirmed) return followConfirm(c, before);
    }
    else if (c.op === 'type' && target && c.preset) {
      // The idea goes in, the preset is picked (its panel opens), then Build it is offered.
      trace('act', { op: 'type', label: c.label, text: c.text, preset: c.preset }); typeInto(target, c.text); add('app', 'Typed \u201c' + c.text + '\u201d.');
      var pb = [].filter.call(document.querySelectorAll('button'), function (b) { return String(b.innerText || b.textContent || '').trim().toLowerCase().indexOf(c.preset.toLowerCase()) === 0; })[0];
      var pick = function () { if (pb) { pb.click(); add('app', 'Picked \u201c' + c.preset + '\u201d.'); trace('act', { op: 'press', label: c.preset }); } offerSubmit(target); after(); };
      if (pb && !pb.getClientRects().length) return reveal(pb, pick);
      return pick();
    }
    else if (c.op === 'type' && target) { trace('act', { op: 'type', label: c.label, text: c.text }); typeInto(target, c.text); add('app', target.tagName === 'SELECT' || target.type === 'range' ? 'Set \u201c' + plainLabel(c.label) + '\u201d to ' + (target.tagName === 'SELECT' ? (target.selectedOptions[0] || {}).textContent : target.value) + '.' : 'Typed \u201c' + c.text + '\u201d.'); if (target.tagName !== 'SELECT' && target.type !== 'range') offerSubmit(target); }
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
// A link the page itself shows is a real place. A project link must name a project that exists; anything else is
// asked for (GET, same origin, an HTML page that answers 2xx/3xx).
var KNOWN = /^\/(|mine|explore|inbox|build|import|settings|cli|personal-agents|own|about|how|lab|runs|deck\/?|privacy|feedback)(\?.*)?$/;
function checkHref(href, fromPage) {
  var u; try { u = new URL(href, location.href); } catch (e) { return Promise.resolve(false); }
  if (u.origin !== location.origin) return Promise.resolve(!!fromPage);
  if (fromPage && fromPage.tagName === 'A') return Promise.resolve(true);
  var m = /^\/p\/([^/]+)(?:\/([^/]+))?/.exec(u.pathname);
  if (m) {
    if (!m[2]) return Promise.resolve(false);   // /p/<owner> alone is not a page
    return projects().then(function (l) { return l.some(function (p) { return p.owner === m[1] && p.name === m[2]; }); }).catch(function () { return true; });
  }
  if (KNOWN.test(u.pathname + u.search)) return Promise.resolve(true);
  return fetch(u.href, { credentials: 'same-origin', redirect: 'follow' }).then(function (r) { return r.ok && /html/.test(r.headers.get('content-type') || ''); }).catch(function () { return false; });
}
function whichOne(c) {
  return projects().then(function (l) {
    var mine = l.filter(function (p) { return p.owner === me && !SCAFFOLD_RX.test(p.name); }).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }).slice(0, 5);
    var links = mine.map(function (p) { return { text: p.name, href: '/p/' + p.owner + '/' + p.name }; }).concat([{ text: 'All your projects', href: '/mine' }]);
    var q = 'Which project? Your newest:';
    add('ai', q, links); say('Which project?'); open(true);   // the chips live in the conversation
    done();
  }).catch(function () { add('note', 'That page is not there.'); done(); });
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
// Spoken numbers as digits for a page's own action ('with a thousand agents' -> 'with 1000 agents': the fleet form
// reads digits only and fell back to 200/$3 in qb3's take, 2026-10-14). 'a/one hundred', 'five hundred', 'two
// thousand', 'twenty five', 'one point five'.
function numberWords(t) {
  var U = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  var W = '(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';
  var re = new RegExp('\\b(' + W + '(?:[ -]' + W + ')?)(?:\\s+(hundred|thousand))?(?:\\s+(?:and\\s+)?(' + W + '(?:[ -]' + W + ')?)\\s+(hundred))?\\b(?=\\s+(agents?|dollars?|bucks|files?|minutes?|reviewers?|copies|people)\\b)', 'gi');
  var val = function (p) { return String(p).toLowerCase().split(/[ -]/).reduce(function (n, w) { return n + (U[w] || 0); }, 0); };
  return String(t || '').replace(re, function (m, a, mult, b) {
    var n = val(a); if (mult) n *= mult.toLowerCase() === 'hundred' ? 100 : 1000; if (b) n += val(b) * 100;
    return n ? String(n) : m;
  }).replace(/\b(\d+)\s+thousand\b/gi, function (m, d) { return String(+d * 1000); }).replace(/\b(\d+)\s+hundred\b/gi, function (m, d) { return String(+d * 100); });
}
function pageAction(c) {
  var list = window.__talkActions || [], a = null;
  list.forEach(function (x, i) { if ('x' + (x.id || i) === c.target) a = x; });
  if (!a) { add('note', 'Could not find that on the page any more.'); return done(); }
  var t0 = Date.now();
  // The fleet form takes a few seconds to fill and estimate: say so at once (manager, 2026-10-14).
  if (c.target === 'xfleet-job' && lastSpoken && S.voice !== 'off') { var fm = new String('One moment, getting the estimate.'); fm.__short = true; say(fm); }
  var said = numberWords(lastText || c.text || '');
  if (said !== (lastText || c.text || '')) trace('number_words', { from: lastText, to: said });
  Promise.resolve().then(function () { return a.run(said); }).then(function (r) {
    logEv('page_action', { id: c.target, ms: Date.now() - t0, ok: r !== false });
    // The fleet form filled by voice: ask out loud with the size and the hard cap; a spoken yes presses its Start
    // (manager, 2026-10-14: everything by voice, a safety question first; silence or 'no' never starts).
    var go = c.target === 'xfleet-job' && r !== false && document.getElementById('nj-go');
    if (go && go.getClientRects().length && !c.__estWait) {
      // the estimate line updates after its own request: wait for it (up to 3 s), never read the placeholder
      var w0 = Date.now();
      return (function waitEst() {
        var e0 = String((document.getElementById('nj-est') || {}).innerText || '');
        if ((!e0 || /pick a copy|estimating|…/i.test(e0)) && Date.now() - w0 < 3000) return setTimeout(waitEst, 250);
        c.__estWait = true; fleetAsk(go, /pick a copy|estimating/i.test(e0) ? '' : e0);
      })();
    }
    function fleetAsk(go, est) {
      var cap = (document.querySelector('#nj input[name=budget], #nj-budget, input[aria-label^="Budget"]') || {}).value;
      var copy = ((document.getElementById('nj-copy') || {}).selectedOptions || [])[0];
      // 'This will start 1,000 agents on VS Code (4,064 files): about 2 to 3 minutes and $1.36 to $2.53. It stops at $5.00 whatever happens. Start?'
      var files = (est.match(/([\d,]+)\s+files/) || [])[1], rest = est.replace(/^[^:]*:\s*/, '').replace(/\bmin\b/, 'minutes').replace(/\s+/g, ' ').trim();
      var capLine = /stops at/i.test(rest) ? '' : (cap ? ' It stops at the $' + cap + ' budget.' : '');
      var q = String(go.innerText || 'Start').trim().replace(/^Start/, 'This will start') + (copy ? ' on ' + String(copy.textContent).replace(/\s*\(.*$/, '') : '') + (files ? ' (' + files + ' files)' : '') + (rest ? ': ' + rest.replace(/\.?$/, '.') : '.') + capLine + ' Start?';
      add('ai', q); trace('fleet_confirm', { q: q });
      offerOn(q, function () { add('app', 'Pressed \u201c' + String(go.innerText).trim() + '\u201d.'); trace('act', { op: 'press', label: go.innerText, confirmed: true }); go.click(); }, 'Start');
      return done();
    }
    if (c.__estWait) return;
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
  if (briefAsk && location.pathname === '/build') { var a2 = briefAsk; setTimeout(function () { a2(true); }, 300); return; }
  // Something was filled on the page and its Send / Build it is offered: fold the sheet into the bar, so the page
  // (Build's preset tiles) can be seen and tapped while the question waits (qb3's take, 2026-10-14: the open sheet
  // covered the tiles and taps never landed).
  if (root && root.classList.contains('open')) setTimeout(function () { if (offerState) open(false); }, 50);
  var f = t.form, b = null;
  if (f) b = f.querySelector('button[type=submit], button:not([type])');
  else {
    // A box outside a form ("What should change?" + "Send back to Agent 3"): the send-like button next to it.
    for (var box = t.parentElement, i = 0; box && i < 4 && !b; box = box.parentElement, i++)
      b = [].filter.call(box.querySelectorAll('button'), function (x) { return x.getClientRects().length && /^(send|ask|save|post|reply|answer|build)/i.test(String(x.innerText || x.getAttribute('aria-label') || '').trim()); })[0] || null;
    if (b) { var lab = String(b.innerText || 'Send').trim(); offerOn('Send it?', function () { if (CONFIRM_RX.test(lab)) { add('app', 'Pressed \u201c' + lab + '\u201d.'); } b.click(); }, lab.split(/\s+/)[0]); }
    return;
  }
  if (!b) return;
  var bl = (b.innerText || 'Send').trim();
  offerOn(bl + '?', function () { if (f.requestSubmit) f.requestSubmit(b); else b.click(); }, bl);
}

var offerState = null;
function offerOn(text, yes, yesLabel) {
  if (convOfferAway(text, yes, yesLabel)) return;   // Conversations: a question for a conversation not on screen waits there
  if (run && text && run.texts[run.texts.length - 1] !== text) run.texts.push(text);
  offerState = { text: text || '', yes: yes, label: yesLabel || 'Go' };
  // A question asked after a spoken turn is said too, short (the quoted request stays on screen), unless something is
  // already being said (a confirm line says itself): in conversation mode it was silent and waited for an unheard yes.
  if (text && lastSpoken && S.voice !== 'off' && !speakPending && !speakingQ && !ackPlaying) { var sq = new String(String(text).replace(/:\s*\u201c[^\u201d]*\u201d/, '').replace(/\s+\?$/, '?')); sq.__short = true; say(sq); }
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
function offerOff() { convOfferOff(); offerState = null; offer.classList.remove('on'); offer.innerHTML = ''; if (bOffer) bOffer.innerHTML = ''; barSync(); }

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
  if (lat) { lat.lane = lat.lane || 'chat'; ack(); }
  status('Answering…');
  api('chat', { utterance: text, did: did, screen: screen(), pageText: pageText(), history: chatHist, model: S.answer || undefined, context: convCtxSlugs() }).then(function (r) {
    if (r.error) { if (run) run.ok = false; add('note', r.why || 'No answer.'); return done(); }
    var reply = r.reply || '';
    convChat(text, reply);
    if (viaNow) viaNow.answer = { lane: 'chat', model: r.model, label: r.modelLabel, fellBack: r.fellBack, ms: r.ms && r.ms.model };
    if (reply) { add('ai', reply, null, { via: viaNow }); say(reply); }
    var acts = r.actions || [];
    logEv('chat', { text: text, reply_len: reply.length, actions: acts.map(function (a) { return a.name; }), ms: r.ms && r.ms.model });
    var nav = null, sendCh = null;
    acts.forEach(function (a) {
      if (a.name === 'show') showSeq((a.args && a.args.ids) || []);
      else if (a.name === 'send_change') sendCh = a.args;   // Conversations: changeRequest()'s confirm, below
      else if (a.name === 'press') { var b = byId(a.args.id); if (b) chatPress(b); }
      else if (a.name === 'type_into') { var f = byId(a.args.id); if (f) { typeInto(f, String(a.args.text || '')); offerSubmit(f); } }
      else if (a.name === 'idea') { var sz = String(a.args.size || 'Medium'); sz = sz.charAt(0).toUpperCase() + sz.slice(1).toLowerCase(); nav = null; setTimeout(function () { busy = true; ideaFlow(/^(Small|Medium|Large|Huge)$/.test(sz) ? sz : 'Medium'); }, 300); }
      else if (a.name === 'go' && !did) {
        var to = String(a.args.to || ''); var l = byId(to);
        var href = l ? l.getAttribute('href') : (to.charAt(0) === '/' ? to : null);
        var pm = /^\/p\/([^/]+)\/([^/?]+)\/?([a-z]*)/.exec(href || '');
        if (href) nav = { href: href, label: l ? (l.innerText || href).split('\n')[0] : pm ? pm[1] + '/' + pm[2] + (pm[3] ? ' (' + pm[3] + ')' : '') : href };
      }
    });
    if (nav) { var c = { op: 'go', href: nav.href, label: nav.label }; setTimeout(function () { act(c); }, reply ? 900 : 0); return; }
    if (sendCh) { var sp = convSendChange(sendCh); if (sp) { sp.then(function () { if (busy) done(); }); return; } }
    done();
  }).catch(function (e) { if (run) run.ok = false; add('note', 'Could not reach qodebase.'); logEv('error', { where: 'chat', err: String(e) }); done(); });
}

// ---- Spoken replies --------------------------------------------------------
var SPEAKERS = {
  'aura-1': ['helios', 'angus', 'arcas', 'orion', 'orpheus', 'perseus', 'zeus', 'athena', 'asteria', 'luna', 'hera', 'stella'],
  'aura-2': ['draco', 'apollo', 'arcas', 'atlas', 'hermes', 'orion', 'zeus', 'asteria', 'athena', 'aurora', 'cora', 'helena', 'hera', 'iris', 'juno', 'luna', 'minerva', 'thalia'],
};
var player = null, actx = null;
function voiceBtn() { var on = S.voice !== 'off'; [spk, bSpk].forEach(function (b) { if (!b) return; b.innerHTML = on ? ICON.sound : ICON.mute; b.setAttribute('aria-label', on ? 'Spoken replies on (tap for text only)' : 'Text only (tap for spoken replies)'); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
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
  saySeq++; speakingQ = false; ackPlaying = false;
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
  try { if (player) { player.onended = null; player.onerror = null; player.pause(); } } catch (e) {}
  try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(text); u.onstart = function () { latMark('audio'); }; u.lang = /[\u0590-\u05ff]/.test(text) ? 'he-IL' : 'en-US'; speechSynthesis.speak(u); } catch (e) {}
}
var lastSay = { t: '', at: 0 };
function say(text) {
  if (S.voice === 'off' || (S.when === 'voice' && !lastSpoken)) return;
  var t = spoken(text);
  if (!t) return;
  // The same sentence twice within 6 s is never said again (qb7's e2e, 1 run in 3: the status line started twice);
  // the second caller is traced so the cause shows up.
  if (t === lastSay.t && Date.now() - lastSay.at < 6000) { trace('say_dupe', { text: t.slice(0, 80), ms: Date.now() - lastSay.at, from: String(new Error().stack || '').split('\n').slice(2, 6).map(function (x) { return x.trim().replace(/^at\s+/, '').replace(/\s*\(.*$/, ''); }).join(' < ') }); return; }
  lastSay = { t: t, at: Date.now() };
  // A long answer is summarised for the ear (the text stays on screen); 4 s at most, else its first two sentences.
  speakPending = true; setTimeout(function () { speakPending = false; }, 8000);
  if (S.say === 'short' && t.length > 200 && !text.__short) {
    var v = viaNow, done1 = false, t0 = Date.now();
    var go = function (x, how) { if (done1) return; done1 = true; if (v) v.spoken = how; trace('summary', { how: how, ms: Date.now() - t0, chars: x.length }); var o = new String(x); o.__short = true; say(o); };
    setTimeout(function () { go((t.match(/[^.!?]+[.!?]+/g) || [t]).slice(0, 2).join(' '), 'first sentences (summary too slow)'); }, S.fast === 'on' ? 700 : 4000);
    api('summary', { text: t, question: lastText }).then(function (r) { if (r && r.spoken) go(r.spoken, 'summary by ' + shortModel(r.model) + ', ' + ((r.ms || 0) / 1000).toFixed(1) + ' s'); }).catch(function () {});
    return;
  }
  if (S.voice === 'phone') return phoneSay(t);
  unlockAudio();
  playParts(S.fast === 'on' ? sentencesOf(t) : [t], t);
}
function ttsUrl(t) { return '/api/talk/tts?model=' + encodeURIComponent(S.voice) + '&speaker=' + encodeURIComponent(S.speaker || '') + '&text=' + encodeURIComponent(t); }
// Sentence by sentence (latency work, 2026-10-13): a short first sentence comes back from Aura fastest; the next one is
// fetched while the first plays. A short first piece is kept short; tiny later ones join their neighbour.
function sentencesOf(t) {
  var parts = String(t).match(/[^.!?]+[.!?]+[\u201d\u2019"')]*|[^.!?]+$/g) || [t], out = [];
  parts.forEach(function (x) { x = x.trim(); if (!x) return; if (out.length > 1 && out[out.length - 1].length < 40) out[out.length - 1] += ' ' + x; else out.push(x); });
  return out.length ? out : [t];
}
var saySeq = 0, speakingQ = false;
// The first sentence streams into a MediaSource from our own fetch: sound starts on the first chunk, and the audio
// element never requests the URL itself (its media request got an intermittent 500 on 'Hi.' that a fetch did not,
// 2026-10-13). No MediaSource for MP3 -> the plain URL.
function streamSrc(text) {
  var MS = window.MediaSource;
  if (S.fast !== 'on' || !MS || !MS.isTypeSupported || !MS.isTypeSupported('audio/mpeg')) return null;
  var ms = new MS(), url = URL.createObjectURL(ms);
  ms.addEventListener('sourceopen', function () {
    var sb, q = [], ended = false;
    try { sb = ms.addSourceBuffer('audio/mpeg'); } catch (e) { logEv('speak_mse', { err: String(e) }); return; }
    var pump = function () { if (sb.updating) return; if (q.length) { try { sb.appendBuffer(q.shift()); } catch (e) { logEv('speak_mse', { err: String(e) }); } } else if (ended && ms.readyState === 'open') { try { ms.endOfStream(); } catch (e) {} } };
    sb.addEventListener('updateend', pump);
    fetch(ttsUrl(text), { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok || !r.body) throw new Error('tts ' + r.status);
      var rd = r.body.getReader();
      (function read() { rd.read().then(function (x) { if (x.done) { ended = true; pump(); return; } q.push(x.value); pump(); read(); }).catch(function (e) { ended = true; pump(); }); })();
    }).catch(function (e) { logEv('speak_mse', { err: String(e) }); try { ms.endOfStream('network'); } catch (_) {} });
  }, { once: true });
  return url;
}
function playParts(parts, whole) {
  var seq = ++saySeq, i = 0, urls = {}, t0 = Date.now();
  speakingQ = true;
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}   // one voice at a time
  var pre = function (k) { if (k >= parts.length || urls[k]) return; urls[k] = fetch(ttsUrl(parts[k]), { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }).then(function (b) { return URL.createObjectURL(b); }).catch(function () { return null; }); };
  var next = function () {
    if (seq !== saySeq) return;
    if (i >= parts.length) { speakingQ = false; return; }
    var k = i++;
    var src = k === 0 ? Promise.resolve(streamSrc(parts[0]) || ttsUrl(parts[0])) : (pre(k), urls[k]);
    pre(k + 1);
    src.then(function (u) {
      if (seq !== saySeq) return;
      if (!u) return next();
      player.src = u;
      try { player.playbackRate = S.speed; player.preservesPitch = true; player.defaultPlaybackRate = S.speed; } catch (e) {}
      player.onplaying = function () { started = true; speakPending = false; try { player.playbackRate = S.speed; } catch (e) {} if (k === 0) { latMark('audio'); logEv('speak_start', { chars: whole.length, parts: parts.length, ms_first: Date.now() - t0, speed: S.speed }); } };
      player.onended = next;
      // A clip that fails (an intermittent 500 on a fresh text, 2026-10-13) is fetched whole ONCE, then the phone voice.
      // The element's error and play()'s rejection both report the same failure: handled once (two voices otherwise).
      var failed = 0, started = false;
      var fail = function (why) {
        if (seq !== saySeq || failed === 2) return;
        // Cut off after it had started (a stream that broke mid-way): go on, never say it again from the start
        // (qb7's e2e heard 'Your latest is…' twice, 2026-10-13).
        if (started) { failed = 2; logEv('speak_cut', { part: k, why: why, at: Math.round(player.currentTime * 10) / 10 }); return next(); }
        if (failed === 1 && why !== 'retry') return;
        failed++;
        if (failed === 1) {
          logEv('speak_retry', { part: k, why: why });
          fetch(ttsUrl(parts[k]), { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); })
            .then(function (b) { if (seq !== saySeq) return; player.src = URL.createObjectURL(b); var p2 = player.play(); if (p2 && p2.catch) p2.catch(function (e) { fail('retry'); }); })
            .catch(function (e) { fail('retry'); });
          return;
        }
        logEv('speak_error', { chars: parts[k].length, part: k, why: why });
        if (k === 0) { speakingQ = false; phoneSay(whole); } else next();
      };
      player.onerror = function () { fail(failed ? 'retry' : 'element'); };
      var p = player.play();
      if (p && p.catch) p.catch(function (e) { if (/NotAllowed/.test(String(e))) { logEv('speak_blocked', { err: String(e) }); if (k === 0 && !failed) { failed = 2; speakingQ = false; phoneSay(whole); } return; } fail(failed ? 'retry' : 'play'); });
    });
  };
  // An acknowledgement still playing finishes first.
  (function waitAck() { if (seq !== saySeq) return; if (ackPlaying) return setTimeout(waitAck, 60); next(); })();
}

// ---- Listening ---------------------------------------------------------------
var rec = null, mr = null, chunks = [], stream = null, t0 = 0, tick = null, interimTimer = null, interimCalls = 0;
function setListening(on) {
  listening = on;
  if (!on) root.classList.remove('arming');
  micBtn.classList.toggle('on', on); micBtn.innerHTML = on ? ICON.stop : ICON.mic;
  if (cMic) { cMic.classList.toggle('on', on); cMic.innerHTML = on ? ICON.stop : ICON.mic; cMic.setAttribute('aria-label', on ? 'Stop' : 'Speak (hold for Talk)'); }
  if (cInto) { cInto.placeholder = on ? 'Listening\u2026' : (cInto.getAttribute('aria-label') || ''); var cf = cInto.closest('form'); if (cf && cf.__talkSync) cf.__talkSync(); }
  if (inp) { inp.classList.toggle('live', on); inp.placeholder = on ? 'Listening\u2026' : 'Say or type'; fitInp(); }
  micBtn.setAttribute('aria-label', on ? 'Stop' : 'Speak');
  clearInterval(tick);
  if (on) { t0 = Date.now(); tick = setInterval(function () { status('Listening ' + Math.floor((Date.now() - t0) / 1000) + 's'); }, 250); status('Listening'); }
  else if (!busy) status('');
  barSync();
}
function startListen() {
  if (!listening && !busy) { curU = newU(); uSaid = false; }
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
  if (cancel) trace('listen_cancel', {});
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
function leave(go) { if (convOn() && lastSpoken) sset('convresume', Date.now()); if (run) { finish(); setTimeout(go, 80); } else go(); }
// Home's 'Build it' (pressed by Talk or by hand) opens the brief: keep its estimate, so the brief can ask out loud
// 'This will start …, about … and …. Start?' before 'Start building' (manager, 2026-10-14). Talk's own press is untrusted.
function keepEstimate(t, voice) {
  if (!t || (t.closest && t.closest('#talk-root')) || location.pathname !== '/' || !/^build it$/i.test(String(t.innerText || '').trim())) return;
  var box = document.getElementById('bsopen'), ln = box ? String(box.innerText || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean) : [];
  var team = (ln[0] || '').replace(/^[^:]*:\s*/, ''), tc = ln[1] || '', time = (tc.match(/[\d.]+\s*(to|-)\s*[\d.]+\s*min/) || [''])[0], cost = (tc.match(/\$[\d.,]+\s*(to|-)\s*\$[\d.,]+/) || [''])[0];
  sset('est', { team: team, time: time, cost: cost, voice: voice, at: Date.now() });
}
document.addEventListener('click', function (e) { keepEstimate(e.target && e.target.closest && e.target.closest('button'), !e.isTrusted || lastSpoken); }, true);
// Talk's yes to 'Build it?' submits the form (requestSubmit), which fires no click.
document.addEventListener('submit', function (e) { keepEstimate(e.submitter, !e.isTrusted || lastSpoken); }, true);
var briefAsk = null;   // the brief's start question, asked again after the name is changed by voice
function briefQuestion() {
  var est = sget('est', null);
  if (location.pathname !== '/build' || !est || !est.voice || Date.now() - est.at > 5 * 60000) return;
  sset('est', null);
  var tries = 0;
  (function ask1() {
    var go = document.getElementById('go');
    if (!go || !go.getClientRects().length) { if (++tries < 30) setTimeout(ask1, 300); return; }
    var q = 'This will start ' + (est.team || 'the agents') + (est.time ? ', about ' + est.time.replace(/min$/, 'minutes') : '') + (est.cost ? ' and ' + est.cost : '') + '. Start?';
    lastSpoken = true; add('ai', q); trace('build_confirm', { q: q });
    // Asked again after the name was changed: short, never the same sentence twice ('Start building home-things-2?').
    briefAsk = function (again) { var nmv = (document.getElementById('pname') || {}).value; var q2 = again ? 'Start building' + (nmv ? ' ' + nmv : '') + '?' : q; offerOn(q2, function () { briefAsk = null; add('app', 'Pressed \u201cStart building\u201d.'); trace('act', { op: 'press', label: 'Start building', confirmed: true }); go.click(); }, 'Start'); };
    briefAsk();
  })();
}

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
function dcArm() { clearTimeout(dcQuiet); if (S.mic === 'pause' && S.pause !== 'tap' && dcOn) dcQuiet = setTimeout(function () { if (dcOn) { trace('dc_stop', { how: 'quiet', pieces: dcBuf.length, ms: Date.now() - dcT0 }); latStart('pause'); liveFinish('', true); } }, Number(S.pause) || 2500); }
var dcLoading = null;   // callbacks waiting while the kit loads (a press-down and the tap both ask: one client only)
function dcWarm(cb) {
  if (dc && dcReady) return cb && cb();
  if (dc) { if (cb) dc.__wait = (dc.__wait || []).concat(cb); return; }
  if (dcLoading) { if (cb) dcLoading.push(cb); return; }
  dcLoading = cb ? [cb] : [];
  loadKit(function () {
    var t0 = Date.now();
    dc = new window.TalkVoiceKit.VoiceClient({ agent: 'TalkVoice', name: me, silenceDurationMs: 900 });
    dc.__wait = dcLoading || []; dcLoading = null;
    dc.addEventListener('connectionchange', function (on) {
      dcReady = !!on; logEv('dc_connection', { on: on, ms: Date.now() - t0 });
      if (!on) trace('dc_disconnect', { listening: dcOn });
      if (on) { try { dc.sendJSON({ type: 'mode', dictate: true, lang: S.lang }); } catch (e) {} var w = dc.__wait || []; dc.__wait = []; w.forEach(function (f) { f(); }); }
    });
    dc.addEventListener('interimtranscript', function (t) { if (dcOn) trace('dc_interim', { text: t || '', ms: Date.now() - dcT0 }); if (dcOn && t && !nativePreview) { dcText = t; setInp(dcBase + dcSaid(t)); clearTimeout(dcQuiet); } });
    dc.addEventListener('statuschange', function (st) { trace('dc_status', { status: st, on: dcOn, ms: dcT0 ? Date.now() - dcT0 : undefined }); });
    dc.addEventListener('voiceerror', function (e) {
      var code = e && (e.code || e.message || String(e));
      trace('dc_voiceerror', { e: code });
      // Live words could not start (Workers AI refused the stream): the phone's own dictation shows the words instead;
      // the recording from the tap still goes to Whisper for the final text.
      if (dcOn && /startup|failed to start/i.test(String(code)) && !nativePreview) startNativePreview();
    });
    dc.addEventListener('audiolevelchange', function (lv) { if (dcOn && lv > 0.05 && !dc.__heardSound) { dc.__heardSound = 1; trace('dc_sound', { level: Math.round(lv * 100) / 100, ms: Date.now() - dcT0 }); } });
    dc.addEventListener('custommessage', function (d) {
      if (!d || d.type !== 'talk-dictated') return;
      // Flux ended a turn: keep it and keep listening (a pause to think is not the end), send after the quiet.
      if (!dcOn || nativePreview) return;
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
// Warm like tmux-web (Eyal, 2026-10-13: "the start of what I say is cut off"; the cold mic took 0.7-0.8 s after the tap
// and both the live words and the Whisper clip lost it): once the mic has been used, its stream stays open for 5 min
// of quiet, is released at once when the page is hidden (a held mic keeps Android in call audio), and a press on the
// bar's mic starts opening it before the tap ends.
var warmTimer = null;
function warmMic(force) {
  if (S.keep !== 'open' || S.engine !== 'live' || clipStream || warmP || !navigator.mediaDevices) return;
  var go = function () {
    var t = Date.now();
    warmP = navigator.mediaDevices.getUserMedia(micOpts()).then(function (st) { warmP = null; if (document.visibilityState === 'hidden') { st.getTracks().forEach(function (x) { x.stop(); }); return; } clipStream = st; trace('mic_warm', { ms: Date.now() - t, force: !!force }); warmIdle(); }).catch(function (e) { warmP = null; trace('mic_warm_error', { err: String(e) }); });
  };
  if (force) return go();
  try { navigator.permissions.query({ name: 'microphone' }).then(function (r) { if (r.state === 'granted') go(); }, function () {}); } catch (e) {}
}
function warmIdle() { clearTimeout(warmTimer); warmTimer = setTimeout(function () { if (!listening) releaseMic('idle'); }, 5 * 60 * 1000); }
function releaseMic(why) { if (clipStream && !clip) { clipStream.getTracks().forEach(function (x) { x.stop(); }); clipStream = null; trace('mic_release', { why: why || '' }); } }
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && !listening) releaseMic('hidden'); });
function clipStart(ready) {
  clipChunks = []; clipT0 = Date.now();
  if (!navigator.mediaDevices || !window.MediaRecorder) return ready && ready();
  var begin = function (st) {
    if (!listening) { if (S.keep !== 'open') st.getTracks().forEach(function (x) { x.stop(); }); return; }
    clipStream = st;
    var type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].filter(function (x) { return MediaRecorder.isTypeSupported(x); })[0] || '';
    clip = new MediaRecorder(st, type ? { mimeType: type } : {});
    clip.ondataavailable = function (e) { if (e.data && e.data.size) { clipChunks.push(e.data); liveChunk(e.data); } };
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
  var q = '?sid=' + encodeURIComponent(tsid || '') + '&u=' + encodeURIComponent(curU || '') + '&path=' + encodeURIComponent(location.pathname) + '&live=' + encodeURIComponent((m.live || '').slice(0, 400)) + '&final=' + encodeURIComponent((m.final || '').slice(0, 400)) + '&how=' + encodeURIComponent(m.how || '');
  fetch('/api/talk/clip' + q, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type || 'audio/webm' }, body: blob })
    .then(function (r) { return r.json(); }).then(function (j) { trace('clip_saved', { key: j.key, bytes: blob.size, err: j.error }); })
    .catch(function (e) { trace('clip_error', { err: String(e) }); });
}
function clipStop(cb) {
  var r = clip, st = clipStream; clip = null;
  if (!r) { if (cb) cb(null); return; }
  r.onstop = function () {
    if (S.keep !== 'open') { if (st) st.getTracks().forEach(function (x) { x.stop(); }); clipStream = null; } else warmIdle();
    if (cb) cb(new Blob(clipChunks, { type: r.mimeType || 'audio/webm' }));
  };
  try { r.stop(); } catch (e) { if (cb) cb(null); }
}
var dcBase = '';
var lastClip = null;   // the last dictation's recording, for "Hear it again"
// Whisper on the whole recording, then (setting "Clean up the words") the merge with the live words, 3.5 s at most.
function hearText(blob, live) {
  var w0 = Date.now();
  return fetch('/api/talk/transcribe?names=1&lang=' + encodeURIComponent(S.lang) + (live ? '&live=' + encodeURIComponent(String(live).slice(0, 500)) : ''), { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type }, body: blob })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.pick === 'live') trace('dc_pick', { pick: 'live', why: j.why, live: live, whisper: j.whisper });
      var w = wordsOnly(j && j.text), out = { text: w || live, how: w ? 'whisper' : 'live', whisper_ms: Date.now() - w0, err: j && j.error, whisper: w };
      if (!w || S.merge !== 'on' || !live) return out;
      var m0 = Date.now();
      return Promise.race([
        api('merge', { live: live, whisper: w, lang: S.lang }).then(function (m) { return m && m.merged && m.text ? Object.assign(out, { text: m.text, how: 'whisper+merge', merge_ms: Date.now() - m0 }) : Object.assign(out, { merge_ms: Date.now() - m0 }); }),
        new Promise(function (ok) { setTimeout(function () { ok(Object.assign(out, { merge_ms: 'timeout' })); }, 3500); }),
      ]).catch(function () { return out; });
    });
}
// "Hear it again": the same recording through Whisper once more (Whisper spikes and misses; tmux-web has a Retry too).
function hearAgain() {
  if (!lastClip || busy) return;
  trace('hear_again', { bytes: lastClip.blob.size });
  status('Hearing it again\u2026');
  hearText(lastClip.blob, lastClip.live).then(function (j) {
    status(''); var all = (lastClip.base + (j.text || '')).trim();
    trace('dc_whisper', { how: 'again-' + j.how, live: lastClip.live, final: j.text, whisper_ms: j.whisper_ms });
    if (all) { setInp(all); open(true); try { inp.focus(); } catch (e) {} }
  }).catch(function () { status('Could not hear it again'); });
}
var nativePreview = null;
function startNativePreview() {
  var R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { trace('native_preview', { ok: false, why: 'none' }); return; }
  try {
    var r = new R(); r.lang = LANGS[S.lang] || 'en-US'; r.interimResults = true; r.continuous = true;
    var done = '';
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) done += e.results[i][0].transcript + ' '; else interim += e.results[i][0].transcript; }
      if (dcOn) { dcText = (done + interim).trim(); setInp(dcBase + dcText); if (dcText) armQuiet(); }
    };
    r.onerror = function (e) { trace('native_preview', { ok: false, why: e.error }); };
    r.onend = function () { if (nativePreview === r) nativePreview = null; };
    r.start(); nativePreview = r; trace('native_preview', { ok: true });
  } catch (e) { trace('native_preview', { ok: false, why: String(e) }); }
}
function stopNativePreview() { if (nativePreview) { try { nativePreview.stop(); } catch (e) {} nativePreview = null; } }
function unrepeat(text, live) {
  var s = String(text || ''); if (!s) return s;
  var count = function (str, ph) { var n = 0, i = 0; str = str.toLowerCase(); ph = ph.toLowerCase(); while ((i = str.indexOf(ph, i)) >= 0) { n++; i += ph.length; } return n; };
  return s.replace(/\b((?:[\p{L}\p{N}']+[\s,.!?]*){1,4}?)(?:\1){2,}/giu, function (m, ph) {
    var core = ph.replace(/[\s,.!?]+$/, '');
    var times = m.length / ph.length;
    return count(live || '', core) >= times ? m : ph;
  });
}
// Dictation like tmux-web (manager, 2026-10-13, after Eyal's 'What should I build next?' lost its first word and never
// got a Whisper pass): ONE recorder from the tap feeds both the Whisper clip and our own socket to Workers AI nova-3
// (/api/talk/stt-live in the Talk Worker); every chunk recorded before the socket opens waits in a queue and goes first,
// in order; no server-side turns, nothing is sent by itself; at the stop, Whisper reads the whole recording.
var liveWs = null, liveQ = [], liveSent = 0, liveClosedAt = 0;
function liveChunk(blob) {
  if (!dcOn || !blob || !blob.size) return;
  if (liveWs && liveWs.readyState === 1) { liveWs.send(blob); liveSent++; }
  else liveQ.push(blob);
}
function liveOpen() {
  if (S.lang === 'he') { startNativePreview(); return; }   // Workers AI's nova-3 has no Hebrew: the phone's recogniser shows the words
  var t0 = Date.now(), gotWords = false, reused = false;
  if (nextWs && nextWs.readyState <= 1 && nextWs.__lang === S.lang) { liveWs = nextWs; liveWs.__used = true; nextWs = null; reused = true; }
  else {
    if (S.fast === 'on' && convOn()) trace('stt_prewarm_miss', { had: !!nextWs, state: nextWs ? nextWs.readyState : null });
    try { liveWs = new WebSocket(sttUrl()); }
    catch (e) { trace('stt_ws_error', { err: String(e) }); startNativePreview(); return; }
  }
  var ws = liveWs;
  ws.onopen = function () {
    var queued = liveQ.length;
    while (liveQ.length && ws.readyState === 1) { ws.send(liveQ.shift()); liveSent++; }
    trace('stt_ws_open', { ms: Date.now() - t0, flushed: queued, warm: reused });
  };
  if (reused && ws.readyState === 1) ws.onopen();
  ws.onmessage = function (ev) {
    var d = null; try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (!dcOn && d.type !== 'final') return;
    if (d.type === 'interim' || d.type === 'final') {
      var txt = String(d.text || '').trim();
      if (!gotWords && txt) { gotWords = true; convEmpty = 0; trace('stt_first_words', { ms: Date.now() - dcT0, text: txt }); }
      if (d.type === 'final') { if (txt) dcBuf.push(txt); dcText = ''; } else dcText = txt;
      if (txt) { lastWordAt = Date.now(); clearTimeout(endT); armQuiet(); guess(dcSaid(dcText)); }
      // nova-3's endpointing heard them stop (speech_final): in conversation mode the turn ends now, not 1.5 s later.
      // nova-3's speech_final sometimes comes seconds after the final words (2.3 s, 2026-10-13): a final that ends a
      // sentence ('…project?') and sounds finished ends the turn too, after 0.6 s with no new words.
      var sentenceEnd = d.type === 'final' && /[.?!]["\u201d\u2019)]*$/.test(txt);
      if ((d.end || sentenceEnd) && dcBuf.length && !dcText && convOn() && S.fast === 'on' && soundsDone(dcSaid(''))) { guess(dcSaid(''), true); endT = setTimeout(function () { if (dcOn && !dcText) endTurn(d.end ? 'endpoint' : 'sentence'); }, sentenceEnd ? 450 : 1000); }   // no closing punctuation ('What's going'): wait longer   // + nova-3's 300 ms = ~0.75 s of quiet
      if (!nativePreview) setInp(dcBase + dcSaid(dcText));
    } else if (d.type === 'error') { trace('stt_ws_server_error', { err: d.error }); if (!gotWords && dcOn && !nativePreview) startNativePreview(); }
  };
  ws.onerror = function () { trace('stt_ws_error', { open: ws.readyState === 1, sent: liveSent }); };
  ws.onclose = function (e) {
    liveClosedAt = Date.now();
    trace('stt_ws_close', { code: e.code, reason: String(e.reason || '').slice(0, 80), sent: liveSent, words: gotWords, ms: Date.now() - t0 });
    if (dcOn && !gotWords && !nativePreview) startNativePreview();   // the live words failed: the phone's recogniser instead
  };
}
var nextWs = null, endT = null, convQuietT = null;
// A pause after "…update for" is a breath, not the end (Eyal's 'What is the latest update for … my projects?' was cut,
// 2026-10-13): end early only when the words sound finished; otherwise the 1.5 s quiet rule decides.
var DANGLING = /\b(for|the|a|an|to|and|or|of|my|with|in|on|at|is|are|was|what|how|about|from|into|that|this|so|but|if|then|because|like|um|uh|can|could|would|should|please|me|i|you|your|our|their|its)\s*$/i;
function soundsDone(t) { t = String(t || '').trim(); return !!t && (/[.?!]["\u201d\u2019)]*$/.test(t) || !DANGLING.test(t.replace(/[,;:]+$/, ''))) && !/[,;:]$/.test(t); }
function sttUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/talk/stt-live?lang=' + encodeURIComponent(S.lang); }
// Conversation mode: the next turn's socket opens while the answer is being given (nova-3 kept alive server-side),
// so listening again does not wait for a new connection. Closed if unused for 55 s.
function prewarmWs() {
  // Off by default (2026-10-13): a prewarmed socket left idle ~5 s heard nothing (nova-3 upstream went deaf), and the
  // gain is small (audio recorded before a socket opens is queued and flushed). localStorage qb-talk-prewarm=on to try.
  if (S.prewarm !== 'on' || S.fast !== 'on' || !convOn() || S.lang === 'he' || (nextWs && nextWs.readyState <= 1)) return;
  try { var w = new WebSocket(sttUrl()), w0 = Date.now(); w.__lang = S.lang; nextWs = w; trace('stt_ws_prewarm', {});
    w.addEventListener('open', function () { trace('stt_prewarm_open', { ms: Date.now() - w0 }); });
    w.addEventListener('message', function (ev) { if (nextWs === w) { var d = null; try { d = JSON.parse(ev.data); } catch (e) {} if (d && d.type !== 'interim' && d.type !== 'final') trace('stt_prewarm_msg', { type: d.type, err: d.error, code: d.code }); } });
    w.addEventListener('close', function (e) { if (nextWs === w || !w.__used) trace('stt_prewarm_close', { code: e.code, reason: String(e.reason || '').slice(0, 80), ms: Date.now() - w0, used: !!w.__used }); if (nextWs === w) nextWs = null; });
    setTimeout(function () { if (nextWs === w) { nextWs = null; try { w.close(); } catch (e) {} } }, 55000); } catch (e) {}
}
// End a conversation turn that already has its final words: no flush wait (the hand stop waits 0.85 s for the last chunk).
function endTurn(how) {
  if (!dcOn) return;
  clearTimeout(quietT); clearTimeout(endT);
  trace('dc_stop', { how: how, conv: true, pieces: dcBuf.length, ms: Date.now() - dcT0, since_word: Date.now() - lastWordAt });
  latStart(how);
  liveFinish('', true); liveClose();
}
function startLive() {
  specCalls = 0; spec = null; clearTimeout(endT); lastWordAt = 0; talkUsedAt = Date.now();
  if (convOn() && (!stCache || Date.now() - (stCache.at || 0) > 25000)) warmStatus('listen');
  setListening(true); status('Starting\u2026'); dcText = ''; dcBuf = []; clearTimeout(dcQuiet); clearTimeout(quietT); live.textContent = '';
  // Nothing heard for 10 s ends this turn: the timer belongs to this turn only (a fast answer's next turn was cancelled
  // 2 s in by the previous turn's timer, 2026-10-13).
  clearTimeout(convQuietT);
  if (convOn()) convQuietT = setTimeout(function () { if (dcOn && !dcBuf.length && !dcText) { convEmpty++; trace('conv_quiet', { empty: convEmpty }); stopListen(true); if (convEmpty >= 2) { toggleConv('quiet'); add('note', 'Conversation mode is off: nothing heard twice.'); } else convAfter(); } }, 10000);
  else convEmpty = 0;
  dcOn = true; dcT0 = Date.now(); liveQ = []; liveSent = 0;
  dcBase = inpVal().trim() ? inpVal().trim() + ' ' : '';   // speak more after typing: the words are added
  root.classList.add('arming'); status('Starting the mic\u2026');
  liveOpen();
  clipStart(function () { root.classList.remove('arming'); if (listening) { status('Listening, speak'); try { navigator.vibrate && navigator.vibrate(15); } catch (e) {} barSync(); } });
}
function liveFinish(text, sendIt) {
  if (!dcOn) return;
  clearTimeout(convQuietT);
  dcOn = false; clearTimeout(dcQuiet); stopNativePreview();
  setListening(false); live.textContent = '';
  var t = (dcSaid(text || dcText) || '').trim();
  logEv('dc_final', { chars: t.length, pieces: dcBuf.length, ms: Date.now() - dcT0 });
  dcBuf = [];
  var sent = false;
  var base = dcBase;
  function send(final, how, extra) {
    if (sent) return; sent = true; status('');
    // Whisper on a quiet or noisy clip repeats itself ("Hello, hello, hello, hello, hello."): a phrase said 3+ times
    // in a row that the live words did not hear that often is kept once.
    var fixed = unrepeat(final, t);
    if (fixed !== final) { extra = Object.assign({ unrepeated: final }, extra || {}); final = fixed; }
    trace('dc_whisper', Object.assign({ how: how, live: t, final: final, send: !!sendIt }, extra || {}));
    if (sendIt && lat) latMark('final', { heard: how });
    if (sendIt) prewarmWs();
    keepClip(clipBlob, { live: t, final: final || '', how: how });
    var all = (base + (final || '')).trim();
    if (cInto) {
      setInp(all); var cf = cInto.closest('form'); cInto = null; cMic = null; if (cf && cf.__talkSync) cf.__talkSync();
      if (cf && cf.__sendAfter) { cf.__sendAfter = 0; if (all) { trace('cmic', { how: 'sent', chars: all.length }); if (cf.requestSubmit) cf.requestSubmit(); else cf.dispatchEvent(new Event('submit', { cancelable: true })); } }
      else if (cf && final && !base) suggestFromComposer(final, cf);
      return;
    }   // the page's composer: its own Send sends
    if (!sendIt) {   // tap, speak, tap Send: the words wait in the box
      // Whisper came late and they already changed the live words (or sent them): leave theirs.
      if (/^whisper/.test(how) && inp.value.trim() !== (base + t).trim()) { trace('dc_whisper_late', { kept: 'theirs' }); return; }
      setInp(all); if (!final) status('I did not hear anything'); return;
    }
    setInp('');
    if (all) { lastSpoken = true; submit(all); } else add('note', 'I did not hear anything.');
  }
  setInp((base + t).trim());
  var clipBlob = null;
  clipStop(function (blob) {
    clipBlob = blob;
    // Whisper always reads the whole recording; a turn where it could not is an error in the trace (it was silent before).
    if (!blob || blob.size < 2000) { trace('whisper_missing', { why: blob ? 'too short' : 'no recording', bytes: blob ? blob.size : 0 }); return send(t, 'live', { bytes: blob ? blob.size : 0 }); }
    var w0 = Date.now();
    // Quick replies: answer from the live words now; Whisper double-checks in the background (whisperCheck).
    // Only where nobody reviews the words first (conversation mode, the 'sends when I stop' mic): tap-then-Send keeps
    // waiting for Whisper as before.
    if (sendIt && t && !cInto && S.fast === 'on' && S.lang !== 'he' && (convOn() || S.mic === 'pause')) {
      lastClip = { blob: blob, live: t, base: base, at: Date.now() };
      send(t, 'live-first', { bytes: blob.size });
      var wpo = { live: t, taken: false };
      wpo.p = hearText(blob, t).then(function (j) { if (!wpo.taken) whisperCheck(t, j, w0); else trace('dc_whisper_check', { live: t, whisper: (j && j.whisper) || '', used: 'not understood', whisper_ms: Date.now() - w0 }); return (j && j.whisper) || ''; })
        .catch(function (e) { trace('whisper_missing', { why: String(e), after: 'live-first' }); return ''; });
      whisperP = wpo;
      return;
    }
    status('Checking the words\u2026');
    // Reviewing before Send (the words are on screen already): wait up to 15 s for Whisper, then keep the live words.
    // Sending now: 8 s. (Whisper on Workers AI usually 1.5-4.5 s, spikes past 6 s: 2026-10-13.)
    var late = false;
    var into = !!cInto;   // a page's composer (its Send may be waiting on this): 8 s too
    setTimeout(function () { if (!sendIt && !into) { late = true; status(''); return; } send(t, 'live-timeout', { bytes: blob.size }); }, sendIt || into ? 8000 : 15000);
    lastClip = { blob: blob, live: t, base: base, at: Date.now() };
    hearText(blob, t).then(function (j) { if (!j.whisper) trace('whisper_missing', { why: j.err || 'no text', bytes: blob.size }); send(j.text || t, j.how, { bytes: blob.size, whisper_ms: j.whisper_ms, merge_ms: j.merge_ms, whisper: j.whisper, err: j.err, late: late || undefined }); })
      .catch(function (e) { trace('whisper_missing', { why: String(e), bytes: blob.size }); send(t, 'live-error', { err: String(e) }); });
  });
}
function liveClose() { var ws = liveWs; liveWs = null; if (ws && ws.readyState === 1) { try { ws.send('close'); } catch (e) {} setTimeout(function () { try { ws.close(); } catch (e) {} }, 1500); } else if (ws) { try { ws.close(); } catch (e) {} } }
function liveStop(cancel, sendIt) {
  if (cancel) { dcOn = false; stopNativePreview(); liveClose(); clipStop(null); setListening(false); live.textContent = ''; cInto = null; cMic = null; return; }
  // Stopped by hand: the recorder's last chunk goes to the socket, which then finishes its words (up to 0.8 s).
  trace('dc_stop', { how: 'hand', pieces: dcBuf.length, interim: dcText, ms: Date.now() - dcT0, sent: liveSent, queued: liveQ.length });
  if (sendIt && !lat) latStart('hand');
  status('Finishing\u2026');
  try { if (clip && clip.state === 'recording') clip.requestData(); } catch (e) {}
  setTimeout(function () {
    if (liveWs && liveWs.readyState === 1) try { liveWs.send('close'); } catch (e) {}
    setTimeout(function () { if (dcOn) { var t = dcText; liveFinish(t, sendIt); liveClose(); } }, 700);
  }, 150);
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
    if (m.role === 'user') { live.textContent = ''; curU = newU(); uSaid = true; trace('said', { text: m.text, spoken: true, engine: 'conversation' }); add('you', m.text); }
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
  if (c.op === 'change') { vcPending = c; offerOn('', function () { vcPending = null; voiceChange(c); }, c.mine ? 'Send' : SUGGEST_RX.test(String(c.text || '')) ? 'Suggest' : 'Fork'); return; }
  if (c.op === 'code') return codeQuestion(c);
  if (c.op === 'which') return whichOne(c);
  if (c.op === 'go' || c.op === 'back') return vcNavigate(c);
  act(c);
}
function voiceChange(c) {
  var parts = String(c.slug || '').split('.'), owner = parts[0], name = parts.slice(1).join('.');
  var sug = SUGGEST_RX.exec(String(c.text || ''));
  if (!c.mine && sug) { busy = true; return suggest(owner, name, String(c.text).slice(sug[0].length).replace(/^[\s:,-]+/, '').trim() || c.text); }
  if (c.mine) { busy = true; return sendChange(owner, name, c.text); }
  busy = true; status('Forking\u2026');
  projPost(owner, name, 'fork', {}).then(function (f) {
    if (f.error) { add('note', 'Could not fork: ' + f.error); return done(); }
    add('app', 'Forked to ' + f.owner + '/' + f.name + '.');
    sendChange(f.owner, f.name, c.text);
  }).catch(function () { add('note', 'Could not reach qodebase.'); done(); });
}

// Signed out, on the home page: the bar is a door to sign in (talking costs, so it is for signed-in people).
function signedOutBar() {
  if (location.pathname !== '/' || document.body.getAttribute('data-talk-bar') === 'off' || /[?&](clean|rec=1)\b/.test(location.search)) return;
  var st = el('style'); st.textContent = css; document.head.appendChild(st);
  root = el('div', { id: 'talk-root' }); root.style.setProperty('--t-ff', getComputedStyle(document.body).fontFamily || 'sans-serif');
  bar = el('a', { id: 'talk-bar', href: '/login?to=' + encodeURIComponent(location.pathname), 'aria-label': 'Sign in to talk to qodebase', style: 'text-decoration:none;align-items:center' });
  bar.innerHTML = '<span class="talk-bb pri talk-somic">' + ICON.mic + '</span><span id="talk-bmid" style="cursor:pointer"><span id="talk-btext">Sign in, then say \u201cbuild a habit tracker\u201d</span></span>';
  root.appendChild(bar); document.body.appendChild(root);
  spacer = el('div', { id: 'talk-spacer', 'aria-hidden': 'true' }); document.body.insertBefore(spacer, root);
  bMic = bar.firstChild; bText = document.getElementById('talk-btext');
  placeBar(); setTimeout(placeBar, 800); window.addEventListener('resize', placeBar);
  bar.addEventListener('click', function () { trace('bar', { how: 'signin' }); });
}

` + CONV_JS + String.raw`
// ---- Test hook (qb7's Talk workflow harness, 2026-10-13): words fed into the SAME pipeline as live dictation, as if
// nova-3 delivered them and an end: lastSpoken, a latency row, quickCmd/STATUS_RX, the guessed decide, the Whisper
// double-check (whisper defaults to the same words) and spoken replies all run. Off unless this device opted in:
// localStorage qb-talk-test=1 or ?talktest=1. Returns the utterance id; the trace rows carry test:true.
var TEST_ON = (function () { try { return localStorage.getItem('qb-talk-test') === '1' || /[?&]talktest=1\b/.test(location.search); } catch (e) { return false; } })();
if (TEST_ON) window.__talkTest = {
  live: function (words, o) {
    o = o || {};
    words = String(words || '').trim();
    if (!words) return Promise.reject(new Error('no words'));
    if (busy) return Promise.reject(new Error('busy'));
    curU = newU(); uSaid = false;
    lastWordAt = Date.now() - 300;   // as if the last word came 0.3 s before nova-3's end
    latStart('test');
    var w = o.whisper == null ? words : String(o.whisper), t0 = Date.now();
    trace('dc_whisper', { how: 'test-live', live: words, final: words, send: true, test: true, conv: !!o.conv });
    latMark('final', { heard: 'test-live' });
    var wpo = { live: words, taken: false };
    wpo.p = new Promise(function (ok) { setTimeout(function () { ok(wordsOnly(w)); }, Number(o.whisperMs) || 1500); });
    wpo.p.then(function (ww) { if (!wpo.taken) whisperCheck(words, { whisper: ww }, t0); });
    whisperP = wpo;
    lastSpoken = true;
    submit(words);
    return Promise.resolve({ u: curU });
  },
  state: function () { return { busy: busy, listening: listening, conv: convOn(), speaking: !!(speakPending || speakingQ || ackPlaying), offer: offerState ? offerState.text : null, last: hist.length ? hist[hist.length - 1] : null }; },
};

// ---- Boot ----------------------------------------------------------------
fetch('/api/talk/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
  if (!j.signedIn) return signedOutBar();
  me = j.handle; signedInNow = true;
  if (convOn()) setTimeout(function () { warmStatus('load'); }, 1500);
  if (j.version && j.version.sha) VERSION = j.version.sha + (j.version.built ? ' ' + new Date(j.version.built).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '') + (j.version.talk && j.version.talk !== j.version.sha ? ' talk ' + j.version.talk : '');
  if (j.trace) traceStart(); else tq = [];
  CLIPS = !!j.clips; MODELS = j.models || {}; ANSWER = j.answer || null;
  CONSENT = j.consent === undefined ? null : j.consent;
  build();
  // Arrived on a page Talk opened: say how it went (status, time), tied to the utterance that asked for it.
  var nv = sget('nav', null);
  if (nv && nv.u) {
    sset('nav', null);
    var navE = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    var keepU = curU; curU = nv.u; trace('arrived', { href: nv.href, at: location.pathname + location.search + location.hash, status: navE.responseStatus, ms: Date.now() - nv.at }); curU = keepU;
  }
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
  briefQuestion();
  // Conversation mode carries over a page Talk opened: listen again here once the page has spoken (hands-free across pages).
  var cr = sget('convresume', 0);
  if (cr && convOn() && Date.now() - cr < 60000) { sset('convresume', 0); lastSpoken = true; setTimeout(function () { trace('conv_resume', {}); convAfter(); }, 1500); }
  // Said on another page for an action that lives here (a fleet job on /runs): say it again once the page has drawn its actions.
  var th = sget('then', null);
  if (th && Date.now() - th.at < 60000) {
    sset('then', null);
    // Wait for the page to settle: its own actions present and the number of things on it steady for a second
    // (live 2026-10-13: said again while /runs had drawn 5 items, before its fleet-job action was there).
    var waited = 0, lastN = -1, steady = 0;
    (function again() {
      var n = talkScan(document).length, acts = (window.__talkActions || []).length;
      steady = n === lastN ? steady + 1 : 0; lastN = n;
      // A page that keeps redrawing (/runs) never holds still: its actions plus 6 s is enough.
      if ((acts && (steady >= 2 || waited >= 6000)) || waited >= 20000) { trace('then', { text: th.text, waited: waited, items: n, actions: acts }); lastSpoken = false; submit(th.text); return; }
      waited += 500; setTimeout(again, 500);
    })();
  }
}).catch(function () {});
})();`;
