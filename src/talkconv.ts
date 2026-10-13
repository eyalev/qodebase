// Conversations in Talk, the page side (qb5, manager's brief 2026-10-13, Eyal approved; server: src/talkthreads.ts).
// Concatenated into TALK_JS inside its IIFE (src/talkclient.ts), so it shares hist / chatHist / add / render / barSync.
// Hidden: nothing here runs, draws or fetches unless this device has the setting (`?conv=1` once; `?conv=0` turns it
// off). Every hook in talkclient.ts calls one of the conv* functions below, and each returns at once when it is off.
//
// A conversation = one thread of Talk: its own log (hist) and chat-lane memory (chatHist), its context (project chips),
// an automatic title, and a status (working / replied / needs you). Instant: '+' on the bar or saying "new
// conversation" opens one already listening. Saved on qodebase for the owner and people who said yes to "Help improve
// Talk" (30 days), on this device for everyone else. Plain ES5-ish JS in a raw string: no backticks or dollar-brace.
export const CONV_JS = String.raw`
// ---- Conversations (src/talkconv.ts) ------------------------------------------------------------------------
var CONV_ON = (function () {
  try { var m = /[?&]conv=(1|0)(&|$)/.exec(location.search); if (m) ls.setItem(KEY + 'threads', m[1] === '1' ? 'on' : 'off'); } catch (e) {}
  return get('threads', 'off') === 'on';
})();
var cv = { saving: null, list: [], cur: null, local: false, turn: '', bodies: {}, offers: {}, dirty: false, saveT: null, no: {}, ready: false };
var NEW_RX = /^\s*(ok(ay)?[, ]+|please[, ]+)?(start|open|begin|make)?\s*(a\s+)?new\s+(conversation|chat|thread|topic)\s*(please)?[.!?]*\s*$/i;
var CV_ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
};
var CV_CSS = [
  // The title in the sheet's header is the door to the list of conversations.
  '#talk-head{gap:0}',
  '#talk-head .st{flex:0 1 auto;min-width:0;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '#talk-cvt{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:4px;height:44px;border:0;background:transparent;color:var(--t-fg);font:600 15px var(--t-ff);text-align:left;padding:0 8px 0 0;cursor:pointer}',
  '#talk-cvt span{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '#talk-cvt svg{width:16px;height:16px;flex:none;color:var(--t-dim)}',
  '#talk-head>b{display:none}',
  '.talk-dot{width:8px;height:8px;border-radius:4px;flex:none;background:transparent}',
  '.talk-dot.working{background:var(--busy,#94600f)}',
  '.talk-dot.replied{background:var(--t-acc)}',
  '.talk-dot.needs{background:var(--t-warn)}',
  // Context chips: under the header; a faded one is a suggestion (tap to keep).
  '#talk-chips{display:none;flex-wrap:wrap;gap:8px;padding:8px 16px;border-bottom:1px solid var(--t-line)}',
  '#talk-chips.on{display:flex}',
  '.talk-cc{position:relative;display:inline-flex;align-items:center;height:32px;border-radius:4px;background:var(--t-chip);font:500 14px var(--t-ff);color:var(--t-fg)}',
  '.talk-cc.maybe{background:transparent;box-shadow:inset 0 0 0 1px var(--t-line);color:var(--t-dim)}',
  '.talk-cc button{position:relative;height:32px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0 4px 0 10px}',
  '.talk-cc button::after{content:"";position:absolute;inset:-6px 0}',
  '.talk-cc .x::after{inset:-6px}',
  '.talk-cc .x{width:32px;padding:0;display:flex;align-items:center;justify-content:center;color:var(--t-dim)}',
  '.talk-cc .x svg{width:14px;height:14px}',
  '#talk-ccm{display:none;flex-direction:column;padding:4px 8px 8px;border-bottom:1px solid var(--t-line)}',
  '#talk-ccm.on{display:flex}',
  '#talk-ccm p{margin:4px 8px;font-size:13px;color:var(--t-dim)}',
  '#talk-ccm button{min-height:44px;border:0;border-radius:10px;background:transparent;color:var(--t-fg);font:15px var(--t-ff);text-align:left;padding:0 8px;cursor:pointer}',
  '@media (hover:hover){#talk-ccm button:hover,.talk-cvr:hover{background:var(--t-chip)}}',
  // The list of conversations (from the header's title): newest first, one row each.
  '#talk-convs{display:none;flex-direction:column;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:8px}',
  '#talk-root.convs #talk-convs{display:flex}',
  '#talk-root.convs #talk-log,#talk-root.convs #talk-live,#talk-root.convs #talk-offer,#talk-root.convs #talk-chips,#talk-root.convs #talk-ccm{display:none!important}',
  '#talk-cvnew{display:flex;align-items:center;gap:8px;min-height:44px;margin:0 0 4px;padding:0 8px;border:0;border-radius:10px;background:transparent;color:var(--t-acc);font:600 15px var(--t-ff);cursor:pointer}',
  '#talk-cvnew svg{width:20px;height:20px}',
  '.talk-cvr{display:grid;grid-template-columns:8px 1fr auto;column-gap:12px;align-items:baseline;width:100%;min-height:56px;padding:8px;border:0;border-radius:10px;background:transparent;color:var(--t-fg);text-align:left;cursor:pointer;font:15px var(--t-ff)}',
  '.talk-cvr[aria-current=true]{background:var(--t-card)}',
  '.talk-cvr .talk-dot{align-self:center}',
  '.talk-cvr b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.talk-cvr time{font-size:13px;color:var(--t-dim);font-variant-numeric:tabular-nums}',
  '.talk-cvr .ln{grid-column:2 / 4;font-size:13px;color:var(--t-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.talk-cvr .cc{grid-column:2 / 4;display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}',
  '.talk-cvr .cc span{font-size:12px;padding:2px 6px;border-radius:4px;background:var(--t-chip);color:var(--t-dim)}',
  '#talk-convs .empty{padding:12px 8px;font-size:14px;color:var(--t-dim)}',
  // The bar: '+' (a new conversation, listening), the title over the words, a dot on the open button when another
  // conversation has something for you.
  '#talk-bnew{color:var(--t-dim)}',
  '#talk-bspk{display:none!important}',
  '#talk-root.live #talk-bnew,#talk-root.boffer #talk-bnew,#talk-root.draft #talk-bnew,#talk-root.miconly #talk-bnew{display:none}',
  '#talk-bmid{flex-direction:column;align-items:flex-start;justify-content:center}',
  '#talk-btitle{display:none;max-width:100%;font:500 12px/16px var(--t-ff);color:var(--t-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '#talk-root.cvt #talk-btitle{display:block}',
  '#talk-root.live #talk-btitle,#talk-root.boffer #talk-btitle{display:none}',
  '#talk-bexp{position:relative}',
  '#talk-bexp i{position:absolute;top:8px;right:6px;display:none}',
  '#talk-root.cvdot #talk-bexp i{display:block}',
  '#talk-s-cvnote{font-size:13px;color:var(--t-dim);margin:-4px 0 0}',
].join('\n');

function convNewId() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20); }
function cvTrace(how, data) { var d = { how: how, id: cv.cur ? cv.cur.id : '' }; for (var k in data || {}) d[k] = data[k]; trace('thread', d); }
function cvMeta(id) { for (var i = 0; i < cv.list.length; i++) if (cv.list[i].id === id) return cv.list[i]; return null; }
function cvName(c) { return (c && c.title) || 'New conversation'; }
function cvSlugName(slug) { var p = String(slug).split('.'); return (p[0] && p[0] !== me ? p[0] + '/' : '') + (p.slice(1).join('.') || slug); }
function cvAgo(t) { var m = Math.round((Date.now() - (t || 0)) / 60000); if (m < 1) return 'now'; if (m < 60) return m + ' min'; if (m < 48 * 60) return Math.round(m / 60) + ' h'; return Math.round(m / 1440) + ' d'; }

// ---- Storage: qodebase (owner / Help improve Talk) or this device ------------------------------------------------
function cvLocalAll() { try { return JSON.parse(ls.getItem(KEY + 'convs') || '{}') || {}; } catch (e) { return {}; } }
function cvLocalPut(c, body) {
  var all = cvLocalAll(); var o = {}; for (var k in c) o[k] = c[k];
  o.msgs = body ? body.msgs : (all[c.id] && all[c.id].msgs) || []; o.chat = body ? body.chat : (all[c.id] && all[c.id].chat) || [];
  o.updated = Date.now(); all[c.id] = o;
  var ids = Object.keys(all).sort(function (a, b) { return (all[b].updated || 0) - (all[a].updated || 0); });
  ids.slice(30).forEach(function (id) { delete all[id]; });   // 30 conversations on a device
  try { ls.setItem(KEY + 'convs', JSON.stringify(all)); } catch (e) { trace('thread_err', { where: 'local', err: String(e) }); }
}
function cvGet(id) {
  if (cv.bodies[id]) return Promise.resolve(cv.bodies[id]);
  if (cv.local) { var o = cvLocalAll()[id]; return Promise.resolve(o ? { msgs: o.msgs || [], chat: o.chat || [] } : { msgs: [], chat: [] }); }
  return fetch('/api/talk/conv?id=' + encodeURIComponent(id), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { var m = cvMeta(id); if (m && j && j.updated) m.srv = j.updated; return j && j.msgs ? { msgs: j.msgs, chat: j.chat || [], updated: j.updated } : { msgs: [], chat: [] }; });
}
function cvPayload(c, body) { return { base: c.srv || 0, dev: tsid, id: c.id, title: c.title || '', ctx: c.ctx || [], status: c.status || 'idle', unseen: !!c.unseen, n: c.n || 0, titledN: c.titledN || 0, msgs: body ? body.msgs : undefined, chat: body ? body.chat : undefined }; }
// Save one conversation (the active one with what is on screen; another one with its kept body, or its meta only).
function cvSave(c, body, beacon) {
  if (!c) return;
  c.updated = Date.now();
  if (cv.local) { cvLocalPut(c, body); return; }
  var s = JSON.stringify(cvPayload(c, body));
  if (beacon && navigator.sendBeacon && s.length < 60000) { try { if (navigator.sendBeacon('/api/talk/conv', new Blob([s], { type: 'application/json' }))) return; } catch (e) {} }
  return cv.saving = fetch('/api/talk/conv', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: s, keepalive: s.length < 60000 })
    .then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.local) { cv.local = true; cvLocalPut(c, body); return; }
      if (j && j.updated) c.srv = j.updated;
      // Another device wrote it since we read it: theirs wins, shown again here (nothing of theirs is overwritten).
      if (j && j.error === 'stale' && j.conv) { cvTrace('stale', { id: c.id }); for (var k in j.conv) if (k !== 'msgs' && k !== 'chat') c[k] = j.conv[k]; c.srv = j.conv.updated; cv.bodies[c.id] = { msgs: j.conv.msgs || [], chat: j.conv.chat || [] }; if (cv.cur === c && c.id !== cv.turn) cvShow(c, cv.bodies[c.id], 'stale'); }
    })
    .catch(function (e) { trace('thread_err', { where: 'save', err: String(e) }); });
}
function cvBody() { return { msgs: hist.slice(), chat: chatHist.slice() }; }
function cvSaveSoon() { if (!CONV_ON || !cv.cur) return; cv.dirty = true; sset('convat', Date.now()); clearTimeout(cv.saveT); cv.saveT = setTimeout(cvFlush, 1200); }
function cvFlush(beacon) { clearTimeout(cv.saveT); cv.saveT = null; if (!cv.dirty || !cv.cur) return; cv.dirty = false; cvSave(cv.cur, cvBody(), beacon); }

// ---- Hooks from talkclient.ts ----------------------------------------------------------------------------------
// add(): a reply for a conversation that is not on screen any more goes there (and lights its dot), not here.
function convAdd(m) {
  if (!CONV_ON || !cv.cur) return false;
  m.at = Date.now();
  if (cv.turn && cv.turn !== cv.cur.id) {
    var t = cvMeta(cv.turn), b = cv.bodies[cv.turn];
    if (t && b) {
      b.msgs.push(m); if (b.msgs.length > 40) b.msgs = b.msgs.slice(-40);
      t.n = (t.n || 0) + 1; t.last = m.text; t.unseen = true;
      cvSave(t, b); cvUi();
      return true;
    }
  }
  cv.cur.n = (cv.cur.n || 0) + 1; if (m.who !== 'you') cv.cur.last = m.text;
  cvSaveSoon();
  return false;
}
// The chat lane's memory, for the conversation that asked (it may not be on screen now).
function convChat(text, reply) {
  var into = chatHist, other = CONV_ON && cv.turn && cv.cur && cv.turn !== cv.cur.id && cv.bodies[cv.turn];
  if (other) into = other.chat;
  into.push({ role: 'user', content: text }); if (reply) into.push({ role: 'assistant', content: reply });
  into = into.slice(-12);
  if (other) { other.chat = into; return; }
  chatHist = into; sset('chat', chatHist); cvSaveSoon();
}
// The start of a turn: "new conversation" is handled here; anything else marks this conversation working and looks
// for projects in the sentence. True = the sentence is used up.
function convSaid(text) {
  if (!CONV_ON || !cv.cur) return false;
  if (NEW_RX.test(String(text || ''))) { cvTrace('new_by_voice', { text: text }); convNew('voice'); return true; }
  // A short yes / no answers the question on screen: not a new turn (its own path ends it).
  var said = String(text || '').trim();
  if (offerState && said.split(/\s+/).length <= 5 && (YES_RX.test(said) || NO_RX.test(said))) return false;
  cv.turn = cv.cur.id; cv.cur.status = 'working'; cvUi();
  cvSuggest(text, null);
  return false;
}
// The end of a turn (done()): replied, or needs you while a question waits for a yes. Then maybe a title.
function convDone() {
  if (!CONV_ON || !cv.turn) return;
  var id = cv.turn, c = cvMeta(id); cv.turn = '';
  if (!c) return;
  c.status = (offerState && id === (cv.cur && cv.cur.id)) || cv.offers[id] ? 'needs' : 'replied';
  if (cv.cur && id === cv.cur.id) { c.unseen = false; cvSaveSoon(); cvFlush(); } else { c.unseen = true; cvSave(c, cv.bodies[id]); }
  cvUi();
  var b = cv.cur && id === cv.cur.id ? cvBody() : cv.bodies[id];
  var answered = b && b.msgs.some(function (m) { return m.who === 'ai' || m.who === 'app'; }) && b.msgs.some(function (m) { return m.who === 'you'; });
  if (answered && (!c.title || (c.n || 0) - (c.titledN || 0) >= 6)) cvTitle(c, b);
}
// offerOn(): a question that comes back for a conversation that is not on screen any more waits in that one (needs you),
// so a "yes" here never answers it.
function convOfferAway(text, yes, label) {
  if (!CONV_ON || !cv.cur || !cv.turn || cv.turn === cv.cur.id) return false;
  var t = cvMeta(cv.turn); if (!t) return false;
  cv.offers[t.id] = { text: text || '', yes: yes, label: label || 'Go' }; t.status = 'needs'; t.unseen = true;
  cvSave(t, cv.bodies[t.id]); cvUi(); cvTrace('offer_away', { to: t.id });
  return true;
}
// offerOff(): the question was answered or dismissed (not just put aside by a switch): no longer "needs you".
function convOfferOff() {
  if (!CONV_ON || !cv.cur || cv.stashing || !offerState) return;
  if (cv.cur.status === 'needs') { cv.cur.status = 'idle'; cvSaveSoon(); cvUi(); }
}
// A change asked for in this conversation with no project named: the one project on it (fast lane, route()).
function convChange(c) {
  if (!CONV_ON || !cv.cur || c.slug) return;
  var on = (cv.cur.ctx || []).filter(function (x) { return x.state === 'on'; });
  if (on.length !== 1) return;
  c.slug = on[0].slug; c.mine = on[0].slug.split('.')[0] === me; c.text = c.text || lastText;
  trace('thread_ctx', { how: 'change_target', slug: c.slug });
}
// The chat lane's send_change: only into a project that exists and this person may see; theirs -> Send?, someone
// else's -> the Fork / suggest path. Always the one-line confirm of changeRequest(), never a direct send.
function convSendChange(args) {
  if (!CONV_ON || !cv.cur) return;
  var want = String(args && args.project || '').trim(), text = String(args && args.text || '').trim();
  if (!want || !text) return;
  var on = convCtxSlugs() || [];
  return projects().then(function (list) {
    var hits = findProject(list.filter(function (p) { return (p.owner === me || !p.private) && on.indexOf(p.owner + '.' + p.name) >= 0; }), want.replace(/\s*\/\s*/, '/'));
    var p = hits[0];
    trace('thread_ctx', { how: 'send_change', want: want, slug: p ? p.slug : null });
    if (!p) { add('note', 'I could not find ' + want + '.'); return; }
    changeRequest({ op: 'change', slug: p.owner + '.' + p.name, mine: p.owner === me, text: text });
  }).catch(function () { add('note', 'Could not reach qodebase.'); });
}
function convCtxSlugs() { if (!CONV_ON || !cv.cur) return undefined; var s = (cv.cur.ctx || []).filter(function (x) { return x.state === 'on'; }).map(function (x) { return x.slug; }); return s.length ? s : undefined; }
// From the fast lane: a change or a code question about a project puts that project on the conversation.
function convFromCmd(c) {
  if (!CONV_ON || !cv.cur || !c || !c.slug) return;
  if (c.op === 'change' || c.op === 'code') cvChip(c.slug, 'on', 'named');
}

// ---- Context chips ---------------------------------------------------------------------------------------------
function cvChip(slug, state, why) {
  var c = cv.cur; if (!c || cv.no[c.id + '|' + slug]) return false;
  c.ctx = c.ctx || [];
  for (var i = 0; i < c.ctx.length; i++) if (c.ctx[i].slug === slug) { if (state === 'on' && c.ctx[i].state !== 'on') { c.ctx[i].state = 'on'; cvTrace('chip', { slug: slug, state: 'on', why: why }); cvSaveSoon(); cvUi(); return true; } return false; }
  if (c.ctx.length >= 8) return false;
  c.ctx.push({ slug: slug, state: state, why: why }); cvTrace('chip', { slug: slug, state: state, why: why }); cvSaveSoon(); cvUi();
  return true;
}
// Projects said in a sentence (Talk's own name matching): the name said as words -> on when it is theirs and could
// not be an ordinary word; a near spelling, a short name or someone else's public project -> a faded suggestion.
function cvMatches(text, list) {
  var said = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9/ -]/g, ' ').replace(/\s+/g, ' ') + ' ';
  var words = said.trim().split(' ').filter(function (w) { return w.length >= 4; });
  var out = [];
  list.forEach(function (p) {
    if (SCAFFOLD_RX.test(p.name) || !(p.owner === me || !p.private)) return;
    var spaced = p.name.replace(/-/g, ' '), flat = p.name.replace(/-/g, '');
    var exact = said.indexOf(' ' + spaced + ' ') >= 0 || (flat.length >= 5 && said.indexOf(' ' + flat + ' ') >= 0) || said.indexOf(' ' + p.owner + '/' + p.name + ' ') >= 0;
    var named = exact && (said.indexOf(' ' + p.owner + '/' + p.name + ' ') >= 0 || spaced.indexOf(' ') > 0 || flat.length >= 7 || new RegExp('(my|the|in|on|to|for|about|of) ' + spaced + '( app| project| repo)?( |$)').test(said));
    var near = !exact && flat.length >= 5 && words.some(function (w) { return Math.abs(w.length - flat.length) <= 1 && dist(w, flat) <= 1; });
    if (exact || near) out.push({ slug: p.owner + '.' + p.name, state: exact && named && p.owner === me ? 'on' : 'maybe', why: exact ? 'said' : 'near' });
  });
  return out.sort(function (a, b) { return (a.state === 'on' ? 0 : 1) - (b.state === 'on' ? 0 : 1); }).slice(0, 3);
}
function cvSuggest(text) {
  if (!me) return;
  projects().then(function (list) { cvMatches(text, list).forEach(function (m) { cvChip(m.slug, m.state, m.why); }); }).catch(function () {});
}

// ---- Switching, new ones, titles -------------------------------------------------------------------------------
function cvShow(c, body, how) {
  if (offerState && cv.cur) { cv.offers[cv.cur.id] = offerState; cv.stashing = true; offerOff(); cv.stashing = false; }
  cv.cur = c; c.unseen = false;
  hist = body.msgs || []; chatHist = body.chat || [];
  sset('log', hist); sset('chat', chatHist); sset('convid', c.id); sset('convat', Date.now());
  set('conv-active', c.id);
  var o = cv.offers[c.id]; if (o) { delete cv.offers[c.id]; offerOn(o.text, o.yes, o.label); }
  histAtLoad = hist.length;
  render(); cvUi(); barSync();
  cvTrace(how || 'switch', { n: hist.length });
}
function convSwitch(id, how) {
  if (!CONV_ON || !cv.cur || id === cv.cur.id) return;
  var to = cvMeta(id); if (!to) return;
  cvFlush(); cv.bodies[cv.cur.id] = cvBody();
  cvGet(id).then(function (b) { cv.bodies[id] = b; cvShow(to, b, how); if (to.status === 'replied') to.status = 'idle'; cvSave(to); });
}
function convNew(how) {
  if (!CONV_ON) return;
  if (cv.cur) { cvFlush(); cv.bodies[cv.cur.id] = cvBody(); }
  var c = { id: convNewId(), title: '', ctx: [], status: 'idle', unseen: false, n: 0, created: Date.now(), updated: Date.now() };
  cv.list.unshift(c); cv.bodies[c.id] = { msgs: [], chat: [] };
  cvShow(c, cv.bodies[c.id], 'new');
  root.classList.remove('convs');
  cvSave(c, cv.bodies[c.id]);
  // Instant: already listening (a tap on '+' or the words "new conversation" brought us here).
  if (!listening && !busy && !vc) setTimeout(function () { if (!listening && !busy) startListen(); }, how === 'voice' ? 250 : 0);
}
function cvTitle(c, body) {
  var send = cv.local ? { id: c.id, title: c.title || '', n: c.n || 0, msgs: body.msgs } : { id: c.id };
  c.titledN = c.n || 0;
  // After the save in flight, so the title is made from what was just said.
  Promise.resolve(cv.saving).catch(function () {}).then(function () { return api('conv/title', send); }).then(function (r) {
    if (!r || !r.title) return;
    var was = c.title; c.title = r.title;
    if (cv.local) cvLocalPut(c, null);
    if (r.title !== was) cvTrace('title', { title: r.title, was: was || '', ms: r.ms });
    cvUi();
  }).catch(function (e) { trace('thread_err', { where: 'title', err: String(e) }); });
}
function cvRemoveChip(slug) {
  var c = cv.cur; if (!c) return;
  c.ctx = (c.ctx || []).filter(function (x) { return x.slug !== slug; });
  cv.no[c.id + '|' + slug] = 1; cvTrace('chip', { slug: slug, state: 'removed' }); cvSaveSoon(); cvUi();
}
function cvMoveChip(slug, toId) {
  var c = cv.cur, to = cvMeta(toId); if (!c || !to) return;
  var chip = (c.ctx || []).filter(function (x) { return x.slug === slug; })[0]; if (!chip) return;
  c.ctx = c.ctx.filter(function (x) { return x.slug !== slug; });
  to.ctx = (to.ctx || []).filter(function (x) { return x.slug !== slug; }).concat([{ slug: slug, state: 'on', why: 'moved' }]).slice(0, 8);
  cvTrace('chip', { slug: slug, state: 'moved', to: toId }); cvSaveSoon(); cvSave(to, cv.bodies[toId]); cvUi();
}

// ---- Drawing ---------------------------------------------------------------------------------------------------
var cvEls = {};
function convBuild() {
  if (!CONV_ON) return;
  var st = el('style'); st.textContent = CV_CSS; document.head.appendChild(st);
  var head = document.getElementById('talk-head');
  cvEls.title = el('button', { id: 'talk-cvt', type: 'button', 'aria-label': 'Your conversations', 'aria-expanded': 'false' });
  head.insertBefore(cvEls.title, head.firstChild);
  cvEls.title.addEventListener('click', function () { cvList(!root.classList.contains('convs')); });
  cvEls.chips = el('div', { id: 'talk-chips', role: 'list', 'aria-label': 'Projects in this conversation' });
  cvEls.menu = el('div', { id: 'talk-ccm' });
  head.after(cvEls.chips); cvEls.chips.after(cvEls.menu);
  cvEls.convs = el('div', { id: 'talk-convs', role: 'list', 'aria-label': 'Your conversations' });
  logEl.before(cvEls.convs);
  // The bar: '+' next to the words, the title over them, a dot on the open button.
  var bMid = document.getElementById('talk-bmid');
  cvEls.bnew = el('button', { id: 'talk-bnew', class: 'talk-bb', type: 'button', 'aria-label': 'New conversation' }, CV_ICON.plus);
  bMid.before(cvEls.bnew);
  cvEls.bnew.addEventListener('click', function () { unlockAudio(); trace('bar', { how: 'new' }); convNew('plus'); });
  cvEls.btitle = el('span', { id: 'talk-btitle' }); bMid.insertBefore(cvEls.btitle, bMid.firstChild);
  var bx = document.getElementById('talk-bexp'); if (bx) bx.appendChild(el('i', { class: 'talk-dot needs', 'aria-hidden': 'true' }));
  // Swipe the conversation sideways: the next / previous one in the list.
  var x0 = null, y0 = 0;
  logEl.addEventListener('touchstart', function (e) { var t = e.touches[0]; x0 = e.target.closest && e.target.closest('pre, table, code') ? null : t.clientX; y0 = t.clientY; }, { passive: true });
  logEl.addEventListener('touchend', function (e) {
    if (x0 == null) return; var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > 40) return;
    var i = cv.list.indexOf(cv.cur), j = dx < 0 ? i + 1 : i - 1;
    if (cv.list[j]) convSwitch(cv.list[j].id, 'swipe');
  }, { passive: true });
  // Settings: the switch, where they are kept, delete all.
  var setp = document.getElementById('talk-set'), models = document.getElementById('talk-s-models');
  var row = el('div');
  row.innerHTML = '<label>Conversations<select id="talk-s-conv"><option value="on">On: several conversations, each with its projects</option><option value="off">Off: one conversation</option></select></label><p id="talk-s-cvnote"></p><button type="button" class="talk-chip" id="talk-s-cvwipe">Delete all my conversations</button>';
  (models ? models.parentNode : setp.lastChild).before(row);
  var sc = document.getElementById('talk-s-conv'); sc.value = 'on';
  sc.onchange = function () { set('threads', sc.value); trace('setting', { threads: sc.value }); location.reload(); };
  document.getElementById('talk-s-cvwipe').onclick = function () {
    var b = this;
    if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = 'Tap again to delete them all'; return; }
    cvTrace('wipe', {});
    try { ls.removeItem(KEY + 'convs'); } catch (e) {}
    api('conv/wipe', {}).then(function () { cv.list = []; cv.bodies = {}; hist = []; chatHist = []; sset('log', hist); sset('chat', chatHist); cv.cur = null; set('conv-active', ''); render(); convStart([]); b.textContent = 'Deleted'; b.removeAttribute('data-sure'); });
  };
  window.addEventListener('pagehide', function () { cvFlush(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') cvFlush(true); });
  // Load: qodebase's copy (or this device's), then pick the one this tab was showing.
  fetch('/api/talk/conv', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
    cv.local = !!(j && j.local);
    var list = cv.local ? cvLocalList() : (j && j.convs) || [];
    convStart(list);
  }).catch(function (e) { trace('thread_err', { where: 'load', err: String(e) }); cv.local = true; convStart(cvLocalList()); });
}
function cvLocalList() { var all = cvLocalAll(); return Object.keys(all).map(function (id) { var o = all[id], c = {}; for (var k in o) if (k !== 'msgs' && k !== 'chat') c[k] = o[k]; return c; }).sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }); }
function convStart(list) {
  cv.list = list; cv.ready = true;
  // A turn cut off by a reload or a closed tab leaves "working" behind: after 2 minutes it is not working.
  list.forEach(function (c) { c.srv = c.updated; if (c.status === 'working' && Date.now() - (c.updated || 0) > 120000) c.status = 'idle'; });
  var note = document.getElementById('talk-s-cvnote');
  if (note) note.textContent = cv.local ? 'Kept on this device only.' : 'Kept on qodebase for 30 days after their last message, so you can come back from any device.';
  var want = get('conv-active', ''), c = cvMeta(want) || null;
  // A device that never chose one, with nothing said in this tab yet: the newest conversation, not another empty one.
  if (!c && list.length && !hist.length) c = list[0];
  if (!c) {
    // The first time: today's Talk thread becomes the first conversation.
    c = { id: convNewId(), title: '', ctx: [], status: 'idle', unseen: false, n: hist.length, created: Date.now(), updated: Date.now() };
    cv.list.unshift(c); cv.cur = c; set('conv-active', c.id); sset('convid', c.id);
    cvSave(c, cvBody()); cvTrace('first', { n: hist.length });
    if (hist.some(function (m) { return m.who === 'you'; }) && hist.some(function (m) { return m.who === 'ai'; })) cvTitle(c, cvBody());
    cvUi(); return;
  }
  // This tab already shows that conversation (sessionStorage) and nothing newer was saved elsewhere: keep it.
  if (sget('convid', '') === c.id && (sget('convat', 0) || 0) >= (c.updated || 0) - 2000) { cv.cur = c; cvUi(); return; }
  cvGet(c.id).then(function (b) { cv.bodies[c.id] = b; cvShow(c, b, 'load'); });
}
function cvList(on) {
  root.classList.toggle('convs', !!on); root.classList.remove('settings');
  cvEls.title.setAttribute('aria-expanded', on ? 'true' : 'false');
  cvTrace('list', { open: !!on });
  if (!on) return;
  cvDrawList();
  // Fresh from qodebase (another device may have added one).
  if (!cv.local) fetch('/api/talk/conv', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
    if (!j || !j.convs) return;
    j.convs.forEach(function (s) { var m = cvMeta(s.id); if (!m) cv.list.push(s); else if (m !== cv.cur && s.id !== cv.turn && (s.updated || 0) > (m.srv || 0)) { for (var k in s) m[k] = s[k]; m.srv = s.updated; delete cv.bodies[s.id]; } });
    cv.list.sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });
    if (root.classList.contains('convs')) cvDrawList(); cvUi();
  }).catch(function () {});
}
function cvDot(c) { if (c.status === 'working') return 'working'; if (c.status === 'needs') return 'needs'; if (c.unseen) return 'replied'; return ''; }
function cvDotWord(d) { return d === 'working' ? 'working' : d === 'needs' ? 'needs you' : d === 'replied' ? 'replied' : ''; }
function cvDrawList() {
  var box = cvEls.convs; box.innerHTML = '';
  var nb = el('button', { id: 'talk-cvnew', type: 'button' }, CV_ICON.plus + '<span>New conversation</span>');
  nb.onclick = function () { unlockAudio(); convNew('list'); };
  box.appendChild(nb);
  cv.list.forEach(function (c) {
    var d = cvDot(c);
    var r = el('button', { type: 'button', class: 'talk-cvr', role: 'listitem', 'aria-current': c === cv.cur ? 'true' : 'false' });
    r.innerHTML = '<i class="talk-dot ' + d + '"' + (d ? ' role="img" aria-label="' + cvDotWord(d) + '"' : ' aria-hidden="true"') + '></i><b></b><time></time><span class="ln"></span>' + ((c.ctx || []).length ? '<span class="cc"></span>' : '');
    r.querySelector('b').textContent = cvName(c);
    r.querySelector('time').textContent = cvAgo(c.updated);
    r.querySelector('.ln').textContent = c.last || (c === cv.cur && !hist.length ? 'Empty' : '');
    var cc = r.querySelector('.cc'); if (cc) (c.ctx || []).filter(function (x) { return x.state === 'on'; }).forEach(function (x) { var s = el('span'); s.textContent = cvSlugName(x.slug); cc.appendChild(s); });
    r.onclick = function () { root.classList.remove('convs'); cvEls.title.setAttribute('aria-expanded', 'false'); convSwitch(c.id, 'list'); };
    box.appendChild(r);
  });
  if (cv.list.length === 2) box.appendChild(el('p', { class: 'empty' }, 'Swipe a conversation sideways to go to the next one.'));
}
function cvMenu(slug) {
  var m = cvEls.menu; m.innerHTML = '';
  if (!slug || m.getAttribute('data-slug') === slug) { m.classList.remove('on'); m.removeAttribute('data-slug'); return; }
  m.setAttribute('data-slug', slug); m.classList.add('on');
  var p = el('p'); p.textContent = cvSlugName(slug).replace(/-/g, ' '); m.appendChild(p);
  var open = el('button', { type: 'button' }); open.textContent = 'Open the project';
  open.onclick = function () { var x = slug.split('.'); location.assign('/p/' + x[0] + '/' + x.slice(1).join('.')); };
  m.appendChild(open);
  cv.list.filter(function (c) { return c !== cv.cur; }).slice(0, 5).forEach(function (c) {
    var b = el('button', { type: 'button' }); b.textContent = 'Move to “' + cvName(c) + '” (' + cvAgo(c.updated) + ')';
    b.onclick = function () { cvMenu(null); cvMoveChip(slug, c.id); };
    m.appendChild(b);
  });
  var rm = el('button', { type: 'button' }); rm.textContent = 'Remove from this conversation';
  rm.onclick = function () { cvMenu(null); cvRemoveChip(slug); };
  m.appendChild(rm);
}
function cvUi() {
  if (!CONV_ON || !cvEls.title) return;
  var c = cv.cur;
  cvEls.title.innerHTML = '<span></span>' + CV_ICON.down;
  cvEls.title.firstChild.textContent = cvName(c);
  // Chips.
  var box = cvEls.chips; box.innerHTML = '';
  ((c && c.ctx) || []).forEach(function (x) {
    var w = el('span', { class: 'talk-cc' + (x.state === 'maybe' ? ' maybe' : ''), role: 'listitem' });
    var nm = el('button', { type: 'button', 'aria-label': x.state === 'maybe' ? 'Keep ' + cvSlugName(x.slug) + ' in this conversation' : cvSlugName(x.slug) + ': options' }); nm.textContent = cvSlugName(x.slug);
    nm.onclick = function () { if (x.state === 'maybe') { cvChip(x.slug, 'on', 'kept'); } else cvMenu(x.slug); };
    var xb = el('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + cvSlugName(x.slug) }, ICON.x);
    xb.onclick = function () { cvRemoveChip(x.slug); };
    w.appendChild(nm); w.appendChild(xb); box.appendChild(w);
  });
  box.classList.toggle('on', !!(c && c.ctx && c.ctx.length));
  // Bar: the title over the words; a dot when another conversation replied or needs you.
  var others = cv.list.filter(function (o) { return o !== c && (o.status === 'needs' || o.unseen); });
  var needs = others.some(function (o) { return o.status === 'needs'; });
  root.classList.toggle('cvdot', others.length > 0);
  var dot = document.querySelector('#talk-bexp i'); if (dot) dot.className = 'talk-dot ' + (needs ? 'needs' : 'replied');
  var bx = document.getElementById('talk-bexp'); if (bx) bx.setAttribute('aria-label', others.length ? 'Open the conversation (' + others.length + ' other' + (others.length > 1 ? 's have' : ' has') + ' news)' : 'Open the conversation');
  cvEls.btitle.textContent = c && c.title ? c.title : '';
  root.classList.toggle('cvt', !!(c && c.title));
  if (root.classList.contains('convs')) cvDrawList();
}
`;
