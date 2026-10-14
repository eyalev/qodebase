#!/usr/bin/env node
// Talk workflow harness (qb7, 2026-10-14, manager's brief): voice-agent workflows across qodebase, run without speaking.
// Each scenario (scenarios/*.json) opens a start page in real Chrome at 390 px on the LIVE site with Eyal's session (the
// forq_session cookie copied from the debug Chrome on :9222; the run itself is its own headless Chrome, so it never opens
// tabs in a window someone uses), says a sequence of turns to Talk and checks each one: the lane picked, where it
// navigated (URL, HTTP 200, page loaded), fields filled, answer words, spoken once with no overlapping audio, risky
// actions offered and NOT done without a yes, no "Did you say", latency per stage.
//
// Writes never reach the server: every non-GET to qodebase.app is answered here (recorded as `writes`) unless it is on
// the read-only list (Talk's decide/chat/status/summary, the idea and settings suggesters, the fleet estimate).
// `--allow-writes --project owner/name` lets writes under /api/p/<owner>/<name>/ through, for a sandbox project only.
// Talk's experience trace, logs and clips are answered here too (Eyal's own trace stays clean); trace rows are kept in
// the result (the `latency` row of a spoken turn gives the per-stage ms).
//
//   npm run talk:e2e                         every scenario
//   node scripts/talk-e2e/run.mjs nav-mine   one scenario (id, or a substring / group name)
//   flags: --headed  --list  --out <dir>  --allow-writes --project eyal/sandbox  --base https://qodebase.app
// Output: <out>/results.jsonl (one line per turn), <out>/table.md, <out>/fail-<id>-<turn>.png; out defaults to
// ~/.local/share/qodebase-talk-e2e/<UTC stamp>/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(path.join(ROOT, 'video/package.json'));
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const BASE = opt('--base', 'https://qodebase.app');
const HOST = new URL(BASE).host;
const ALLOW = flag('--allow-writes') ? opt('--project', '') : '';
if (flag('--allow-writes') && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(ALLOW)) { console.error('--allow-writes needs --project owner/name (a sandbox project)'); process.exit(2); }
const valued = new Set(['--out', '--project', '--base', '--via']);
const pick = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
const VIA = opt('--via', 'webmcp');
const PASS_TRACE = flag('--pass-trace');   // webmcp (typed submit) | live (qb2's __talkTest.live: the dictation pipeline)
const OUT = opt('--out', path.join(os.homedir(), '.local/share/qodebase-talk-e2e', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)));

// ---- Scenarios ---------------------------------------------------------------------------------------------------
const all = [];
for (const f of fs.readdirSync(path.join(HERE, 'scenarios')).filter((f) => f.endsWith('.json')).sort()) {
  const group = f.replace(/\.json$/, '');
  for (const s of JSON.parse(fs.readFileSync(path.join(HERE, 'scenarios', f), 'utf8'))) all.push({ group, ...s });
}
const chosen = pick.length ? all.filter((s) => pick.some((p) => s.id === p || s.group === p || s.id.includes(p))) : all;
if (flag('--list')) { for (const s of chosen) console.log(`${s.id.padEnd(28)} ${s.group.padEnd(12)} ${s.title}`); process.exit(0); }
if (!chosen.length) { console.error('no scenario matches', pick.join(' ')); process.exit(2); }

// ---- Session: the forq_session cookie from the debug Chrome ------------------------------------------------------
async function session() {
  const tabs = await (await fetch('http://127.0.0.1:9222/json')).json();
  const ws = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  if (!ws) throw new Error('no debug Chrome page on :9222');
  const cookies = await new Promise((res, rej) => {
    const s = new WebSocket(ws);
    s.onopen = () => s.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
    s.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) { s.close(); res(d.result.cookies); } };
    s.onerror = rej;
  });
  const mine = cookies.filter((c) => c.domain.replace(/^\./, '') === HOST);
  if (!mine.some((c) => c.name === 'forq_session')) throw new Error(`no forq_session cookie for ${HOST} in the debug Chrome: sign in there first`);
  return mine.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: 'Lax', expires: c.expires > 0 ? c.expires : -1 }));
}

// ---- Writes ------------------------------------------------------------------------------------------------------
// Read-only POSTs that may reach the server (they answer, they change nothing that lasts).
const READ_POST = /^\/api\/(talk\/(decide|chat|status|summary|transcribe|conv\/title)|build\/(idea|suggest)|runs\/(estimate|count))$/;
// Canned answers for intercepted writes whose callers read the reply.
const MOCKS = [
  [/^\/api\/p\/[^/]+\/[^/]+\/ask$/, { id: 'e2e-ask' }],
  [/^\/api\/talk\/conv$/, { ok: true, id: 'e2e-conv' }],
  [/^\/api\/runs\/start$/, { ok: true, run: 'e2e-mocked' }],
  [/^\/api\/p\/[^/]+\/[^/]+\/requests$/, { ok: true, id: 'e2e-request' }],
];
const GET_MOCKS = [[/^\/api\/p\/[^/]+\/[^/]+\/ask-result$/, { state: 'done', answer: 'Mocked answer from the e2e harness.' }]];
const QUIET = /^\/api\/talk\/(trace|log|clip)$|^\/e$/;   // answered here, never reach the server; trace bodies kept

// ---- Page hooks (run before any page script) ---------------------------------------------------------------------
function initScript(o) {
  try { for (const [k, v] of Object.entries(o.ls || {})) localStorage.setItem(k, v); } catch (e) {}
  const E = (ev) => { try { window.__qbE2E(Object.assign({ t: Date.now() }, ev)); } catch (e) {} };
  // Audio: every element's playing/pause/ended, with the text it speaks (from the TTS URL, or the blob it was made from)
  const ttsText = (u) => { try { return new URL(u, location.href).searchParams.get('text') || ''; } catch (e) { return ''; } };
  const blobText = {}; let lastTts = '';
  const f0 = window.fetch;
  window.fetch = function (u) { const s = typeof u === 'string' ? u : (u && u.url) || ''; if (s.includes('/api/talk/tts')) lastTts = ttsText(s); return f0.apply(this, arguments); };
  const c0 = URL.createObjectURL;
  URL.createObjectURL = function (b) { const u = c0.call(URL, b); blobText[u] = lastTts; return u; };
  let nextId = 1;
  const p0 = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this;
    if (!el.__e2e) {
      el.__e2e = nextId++;
      const txt = () => (/^blob:/.test(el.src) ? blobText[el.src] || '' : ttsText(el.currentSrc || el.src));
      el.addEventListener('playing', () => E({ k: 'audio', ev: 'start', id: el.__e2e, text: txt() }));
      el.addEventListener('pause', () => E({ k: 'audio', ev: 'end', id: el.__e2e }));
      el.addEventListener('ended', () => E({ k: 'audio', ev: 'end', id: el.__e2e }));
    }
    return p0.apply(this, arguments);
  };
  if (window.speechSynthesis) {
    const sp = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = (u) => { const id = 'phone' + nextId++; E({ k: 'audio', ev: 'start', id, text: String(u.text || '') }); u.addEventListener('end', () => E({ k: 'audio', ev: 'end', id })); return sp(u); };
  }
}

// ---- Checks ------------------------------------------------------------------------------------------------------
const rx = (s) => (s instanceof RegExp ? s : new RegExp(s, 'i'));
const asList = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

async function fieldValue(page, spec) {
  return page.evaluate((spec) => {
    const vis = (e) => e && e.getClientRects().length;
    let e = null;
    if (spec.startsWith('css:')) e = document.querySelector(spec.slice(4));
    else {
      const want = spec.toLowerCase();
      const name = (x) => ((x.getAttribute('aria-label') || '') + ' ' + ((x.labels && x.labels[0] && x.labels[0].innerText) || '') + ' ' + (x.placeholder || '') + ' ' + (/^(BUTTON|A)$/.test(x.tagName) || x.getAttribute('role') ? x.innerText || '' : '')).replace(/\s+/g, ' ').trim().toLowerCase();
      const els = [...document.querySelectorAll('input,textarea,select,[role=switch],[role=tab],[aria-pressed],button')].filter((x) => !x.closest('#talk-root,#talk-bar,#talk-sheet'));
      e = els.find((x) => vis(x) && name(x).startsWith(want)) || els.find((x) => vis(x) && name(x).includes(want)) || els.find((x) => name(x).includes(want));
    }
    if (!e) return null;
    if (e.type === 'checkbox' || e.type === 'radio') return String(e.checked);
    if (e.getAttribute('aria-checked') != null) return e.getAttribute('aria-checked');
    if (e.getAttribute('aria-pressed') != null && !('value' in e && e.tagName !== 'BUTTON')) return e.getAttribute('aria-pressed');
    if (e.getAttribute('aria-selected') != null) return e.getAttribute('aria-selected');
    return 'value' in e && e.tagName !== 'BUTTON' ? String(e.value) : String(e.innerText || '').trim();
  }, spec).catch(() => null);
}

function check(turn, got) {
  const x = turn.expect || {}, fails = [];
  const lane = got.decide ? `${got.decide.mode}/${got.decide.op}` : got.mode ? `${got.mode}/${got.action}` : 'none/none';
  if (x.lane && !asList(x.lane).some((l) => (l.includes('/') ? lane === l : lane.split('/')[1] === l || lane.split('/')[0] === l))) fails.push(`lane ${lane}, wanted ${asList(x.lane).join('|')}`);
  if (x.nav) {
    const want = typeof x.nav === 'string' ? { url: x.nav } : x.nav;
    if (!rx(want.url).test(got.url)) fails.push(`at ${got.url}, wanted ${want.url}`);
    else if (!want.hash && got.navStatus !== 200) fails.push(`navigation status ${got.navStatus ?? 'none'}`);
    else if (!got.loaded) fails.push('page did not finish loading');
  }
  if (x.stay && got.url !== got.urlBefore) fails.push(`navigated to ${got.url}, wanted to stay`);
  for (const [k, v] of Object.entries(x.fields || {})) {
    const val = got.fields[k];
    if (val == null) fails.push(`field "${k}" not found`);
    else if (!rx(v).test(val)) fails.push(`field "${k}" = ${JSON.stringify(String(val).slice(0, 60))}, wanted ${v}`);
  }
  for (const w of asList(x.answer_has)) if (!rx(w).test(got.answer)) fails.push(`answer lacks ${w}`);
  for (const w of asList(x.answer_not)) if (rx(w).test(got.answer)) fails.push(`answer has ${w}`);
  if (x.spoken === 'once' || x.spoken === true) { if (!got.spoken.length) fails.push('nothing spoken'); }
  if (x.spoken === false || x.spoken === 'none') { if (got.spoken.length) fails.push(`spoke: ${got.spoken[0].slice(0, 60)}`); }
  if (got.dupes.length) fails.push(`spoken twice: ${got.dupes[0].slice(0, 60)}`);
  if (got.overlap) fails.push(`audio overlapped (${got.overlap})`);
  if (x.confirm) {
    if (!got.offer) fails.push('no confirm offer shown');
    if (got.writes.length) fails.push(`wrote before a yes: ${got.writes.join(', ')}`);
  }
  if (x.offer && !(got.offer && rx(x.offer).test(got.offer))) fails.push(`offer ${JSON.stringify(got.offer || '')}, wanted ${x.offer}`);
  if (x.no_offer && got.offer) fails.push(`offered ${got.offer}`);
  if (x.writes) for (const w of asList(x.writes)) if (!got.writes.some((p) => rx(w).test(p))) fails.push(`no write to ${w} (writes: ${got.writes.join(', ') || 'none'})`);
  if (x.no_writes && got.writes.length) fails.push(`wrote ${got.writes.join(', ')}`);
  if (/did you say/i.test(got.answer + ' ' + got.spoken.join(' ') + ' ' + (got.offer || ''))) fails.push('"Did you say" shown');
  if (x.max_ms && got.ms.total > x.max_ms) fails.push(`took ${got.ms.total} ms > ${x.max_ms}`);
  if (got.jsErrors.length) fails.push(`page error: ${got.jsErrors[0].slice(0, 80)}`);
  return { lane, fails };
}

// ---- One scenario ------------------------------------------------------------------------------------------------
async function runScenario(s, cookies, browserArgs) {
  // "~name" = a synthetic Aura clip from qb2's latency bench (TALK_E2E_AUDIO_DIR), never kept in this public repo
  const AUDIO_DIR = process.env.TALK_E2E_AUDIO_DIR || path.join(os.homedir(), '.local/share/forq-deploy/qb2-tests/lat/wav');
  const audio = !s.audio ? '' : s.audio.startsWith('~') ? path.join(AUDIO_DIR, s.audio.slice(1) + '.wav') : path.isAbsolute(s.audio) ? s.audio : path.join(ROOT, s.audio);
  if (audio && !fs.existsSync(audio)) return [{ id: s.id, turn: 0, skip: `audio fixture missing: ${audio}` }];
  const args = ['--autoplay-policy=no-user-gesture-required', ...(audio ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${audio}%noloop`] : [])];
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: !flag('--headed'), args });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: audio ? ['microphone'] : [] });
  await ctx.addCookies(cookies);
  // Defaults: replies spoken for typed turns too (so "spoken once" is testable), Aura-2, no Conversations unless asked.
  const ls = { 'qb-talk-when': 'always', 'qb-talk-voice': 'aura-2', 'qb-talk-test': '1', ...(s.ls || {}) };
  const ev = [];   // every event, in order: {t, k: audio|console|nav|write|trace|pageerror, ...}
  await ctx.exposeBinding('__qbE2E', (_src, e) => { ev.push(e); });
  await ctx.addInitScript(initScript, { ls });
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.host !== HOST) return route.continue();
    const m = req.method();
    if (QUIET.test(u.pathname)) {
      if (u.pathname === '/api/talk/trace') { try { const j = JSON.parse(req.postData() || '{}'); for (const r of j.rows || j.events || (Array.isArray(j) ? j : [])) ev.push({ t: Date.now(), k: 'trace', row: r }); } catch {} if (PASS_TRACE) return route.continue(); }   // --pass-trace: Talk's trace also reaches the server (qb2 reads it)
      return route.fulfill({ status: m === 'GET' ? 200 : 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (m === 'GET' || m === 'HEAD') {
      const gm = GET_MOCKS.find(([r]) => r.test(u.pathname));
      return gm ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gm[1]) }) : route.continue();
    }
    if (READ_POST.test(u.pathname)) return route.continue();
    if (ALLOW && u.pathname.startsWith(`/api/p/${ALLOW}/`)) { ev.push({ t: Date.now(), k: 'write', path: u.pathname, real: true }); return route.continue(); }
    // Talk's own conversation store (Conversations, ?conv=1) is page state, not an action: answered, not counted
    if (!/^\/api\/talk\/conv/.test(u.pathname)) ev.push({ t: Date.now(), k: 'write', path: u.pathname, method: m });
    const mk = MOCKS.find(([r]) => r.test(u.pathname));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mk ? mk[1] : { ok: true }) });
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { const t = m.text(); if (!t.includes('"module":"talk"')) return; try { ev.push({ t: Date.now(), k: 'console', row: JSON.parse(t) }); } catch {} });
  page.on('pageerror', (e) => ev.push({ t: Date.now(), k: 'pageerror', msg: String(e.message || e) }));
  page.on('response', (r) => { const q = r.request(); if (q.isNavigationRequest() && q.frame() === page.mainFrame()) ev.push({ t: Date.now(), k: 'nav', url: r.url(), status: r.status() }); });

  const rows = [];
  const ready = async () => { await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {}); return page.waitForFunction(() => window.__webmcp && document.getElementById('talk-bar'), null, { timeout: 15000 }).then(() => true).catch(() => false); };
  await page.goto(BASE + s.start, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  await ready();
  // a page that loads its data after the HTML (/runs: ~4 s) names a selector to wait for; without it Talk scans a half-built page
  if (s.wait_for) await page.waitForSelector(s.wait_for, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(s.wait_start ?? 1500);

  for (let i = 0; i < s.turns.length; i++) {
    const turn = typeof s.turns[i] === 'string' ? { say: s.turns[i] } : s.turns[i];
    const t0 = Date.now(), e0 = ev.length, urlBefore = page.url();
    let res = null, via = turn.via || (audio ? 'audio' : VIA);
    try {
      if (via === 'live') {
        const has = await page.evaluate(() => !!(window.__talkTest && window.__talkTest.live));
        if (!has) via = 'webmcp (no live hook yet)';
        else {
          // qb2's hook: the words enter the pipeline as if nova-3 ended the turn; the turn is over when Talk is no longer
          // busy and nothing is being said (state()); the answer is read from the Talk log
          const n0 = await page.evaluate(() => document.querySelectorAll('#talk-log > *').length).catch(() => 0);
          await page.evaluate(([w, o]) => window.__talkTest.live(w, o), [turn.say, turn.live || {}]);
          const end = Date.now() + 40000; let st = null;
          await page.waitForTimeout(400);
          while (Date.now() < end) {
            st = await page.evaluate(() => window.__talkTest && window.__talkTest.state()).catch(() => null);   // null = navigated away
            if (!st || (!st.busy && !st.speaking)) break;
            await page.waitForTimeout(250);
          }
          const said = await page.evaluate((n) => [...document.querySelectorAll('#talk-log > *')].slice(n).filter((c) => !/\byou\b/.test(c.className)).map((c) => c.innerText.replace(/\s+/g, ' ').trim()).join(' '), n0).catch(() => '');
          res = { ok: true, text: said || (st && st.last && (st.last.text || '')) || '' };   // last = the message object {who, text, links, …}
        }
      }
      if (via === 'audio') {
        // the file plays as the microphone from the first getUserMedia: open Talk in conversation mode
        await page.tap('#talk-bexp'); await page.waitForTimeout(500); await page.tap('#talk-head .talk-convt');
        await page.waitForFunction(() => [...document.querySelectorAll('#talk-log .you')].length > 0, null, { timeout: 25000 }).catch(() => {});
      } else if (via === 'tap') {
        await page.locator(turn.tap).first().tap({ timeout: 5000 });
      } else if (via.startsWith('webmcp')) {
        res = await Promise.race([
          page.evaluate((sentence) => window.__webmcp.call('talk', { sentence }), turn.say),
          new Promise((ok) => setTimeout(() => ok({ ok: false, text: '(no answer in 45 s)' }), 45000)),
        ]);
      }
    } catch (e) { res = { ok: false, text: '', err: String(e.message || e).slice(0, 160) }; }
    const tAns = Date.now();
    // Settle: navigation if one is expected (or started), then speech
    const x = turn.expect || {};
    let loaded = true;
    if (x.nav) {
      const want = rx(typeof x.nav === 'string' ? x.nav : x.nav.url);
      await page.waitForURL((u) => want.test(u.href), { timeout: 15000 }).catch(() => {});
      loaded = await ready();
    } else await page.waitForTimeout(turn.settle_ms ?? 1200);
    if (page.url() !== urlBefore && !x.nav) loaded = await ready();
    const speaking = () => { const open = new Set(); for (const e of ev.slice(e0)) if (e.k === 'audio') { if (e.ev === 'start') open.add(e.id); else open.delete(e.id); } return open.size; };
    const audioT = Date.now() + (x.spoken === false || x.spoken === 'none' ? 2500 : 20000);
    await page.waitForTimeout(800);
    while (Date.now() < audioT && (speaking() || (x.spoken && !ev.slice(e0).some((e) => e.k === 'audio')))) await page.waitForTimeout(300);
    await page.waitForTimeout(turn.after_ms ?? (via === 'audio' || via === 'live' ? 4500 : 300));   // trace rows flush every 4 s

    const E = ev.slice(e0);
    const con = (name) => E.filter((e) => e.k === 'console' && e.row.event === name).map((e) => e.row);
    const decide = con('decide').pop() || null;
    const navs = E.filter((e) => e.k === 'nav');
    const starts = E.filter((e) => e.k === 'audio' && e.ev === 'start');
    // overlap: an element starts while another one is still playing
    let overlap = '', open = new Map();
    for (const e of E.filter((e) => e.k === 'audio')) {
      if (e.ev === 'start') { for (const [id, st] of open) if (id !== e.id && e.t - st.t > 120) overlap = overlap || `${JSON.stringify(st.text.slice(0, 30))} + ${JSON.stringify(e.text.slice(0, 30))}`; open.set(e.id, e); }
      else open.delete(e.id);
    }
    const spoken = starts.map((e) => e.text || '(no text)');
    const seen = new Set(), dupes = [];
    for (const t of spoken) { if (t !== '(no text)' && seen.has(t)) dupes.push(t); seen.add(t); }
    const ui = await page.evaluate(() => {
      const log = document.getElementById('talk-log');
      // the offer shows in the bar (#talk-boffer) and in the open sheet (#talk-offer): its line + its buttons
      const off = ['talk-offer', 'talk-boffer'].map((id) => document.getElementById(id)).find((o) => o && o.getClientRects().length && o.querySelector('button'));
      return { offer: off ? ((off.id === 'talk-offer' ? off.innerText : document.getElementById('talk-btext')?.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 160) + ' [' + [...off.querySelectorAll('button')].map((b) => b.innerText.trim()).join('|') + ']' : '',
        log: log ? [...log.children].slice(-6).map((c) => c.innerText.replace(/\s+/g, ' ').trim()).join(' / ') : '' };
    }).catch(() => ({ offer: '', log: '' }));
    const fields = {};
    for (const k of Object.keys(x.fields || {})) fields[k] = await fieldValue(page, k);
    const latRow = E.filter((e) => e.k === 'trace' && e.row && e.row.ev === 'latency').map((e) => e.row).pop() || null;
    const firstAudio = starts.length ? starts[0].t - t0 : null;
    const stage = (n) => (con(n).pop() || {}).ms ?? null;
    const got = {
      mode: res && res.data && res.data.mode, action: res && res.data && res.data.action, decide, url: page.url(), urlBefore,
      navStatus: navs.length ? navs[navs.length - 1].status : (page.url() !== urlBefore && page.url().split('#')[0] === urlBefore.split('#')[0] ? 'hash' : null), loaded,
      answer: [res && res.text, ui.log].filter(Boolean).join(' || '), offer: ui.offer, fields, spoken, dupes, overlap,
      writes: E.filter((e) => e.k === 'write').map((e) => `${e.method || 'POST'} ${e.path}${e.real ? ' (REAL)' : ''}`),
      jsErrors: E.filter((e) => e.k === 'pageerror').map((e) => e.msg),
      ms: { total: tAns - t0, decide: decide ? decide.ms : null, status: stage('status'), chat: stage('chat'), page_action: stage('page_action'), first_audio: firstAudio, latency: latRow },
    };
    const { lane, fails } = check(turn, got);
    // every Talk trace row and console row of the turn (say_dupe and its caller chain, speak_*, decide…): kept for whoever
    // debugs a failure; trace rows flush every 4 s, so a few may land in the next turn
    const trace = E.filter((e) => e.k === 'trace').map((e) => e.row).slice(0, 300);
    const consoleRows = E.filter((e) => e.k === 'console').map((e) => e.row).slice(0, 200);
    const row = { id: s.id, group: s.group, title: s.title, turn: i + 1, say: turn.say || turn.tap || '(audio)', via, pass: !fails.length, fails, lane, ...got, err: res && res.err, trace, console: consoleRows };
    if (fails.length) { row.shot = path.join(OUT, `fail-${s.id}-${i + 1}.png`); await page.screenshot({ path: row.shot }).catch(() => {}); }
    rows.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${s.id}#${i + 1} ${JSON.stringify(row.say).slice(0, 60)} -> ${lane} ${fails.length ? '| ' + fails.join('; ') : ''}`);
    if (fails.length && turn.stop_on_fail !== false && i < s.turns.length - 1 && (turn.expect || {}).critical) break;
  }
  await b.close();
  return rows;
}

// ---- Main --------------------------------------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
const cookies = await session();
const results = [];
for (const s of chosen) {
  let rows;
  try { rows = await runScenario(s, cookies); }
  catch (e) { rows = [{ id: s.id, group: s.group, title: s.title, turn: 0, pass: false, fails: ['harness error: ' + String(e.message || e).slice(0, 200)] }]; console.log('FAIL', s.id, rows[0].fails[0]); }
  results.push(...rows);
  fs.appendFileSync(path.join(OUT, 'results.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// table: one line per scenario (pass only when every turn passed), then the failing turns
const by = new Map();
for (const r of results) { if (!by.has(r.id)) by.set(r.id, []); by.get(r.id).push(r); }
const ms = (v) => (v == null ? '' : (v / 1000).toFixed(1));
const lines = ['| scenario | group | result | turns | lanes | answer s | first sound s | what failed |', '|---|---|---|---|---|---|---|---|'];
let pass = 0, skip = 0;
for (const [id, rs] of by) {
  const sk = rs.find((r) => r.skip);
  const ok = !sk && rs.every((r) => r.pass);
  if (sk) skip++; else if (ok) pass++;
  lines.push(`| ${id} | ${rs[0].group || ''} | ${sk ? 'skip' : ok ? 'pass' : '**FAIL**'} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${rs.map((r) => r.lane || '').join(', ')} | ${rs.map((r) => ms(r.ms && r.ms.total)).join(', ')} | ${rs.map((r) => ms(r.ms && r.ms.first_audio)).join(', ')} | ${sk ? sk.skip : rs.filter((r) => !r.pass).map((r) => `#${r.turn}: ${r.fails.join('; ')}`).join(' / ').replace(/\|/g, '/').slice(0, 300)} |`);
}
const head = `Talk e2e (${VIA}) on ${BASE}, ${new Date().toISOString().slice(0, 16)}Z: ${pass}/${by.size - skip} scenarios pass${skip ? `, ${skip} skipped` : ''}, ${results.filter((r) => r.pass).length}/${results.filter((r) => !r.skip).length} turns.`;
fs.writeFileSync(path.join(OUT, 'table.md'), head + '\n\n' + lines.join('\n') + '\n');
console.log('\n' + head + '\n' + lines.join('\n') + `\n\nresults: ${OUT}`);
