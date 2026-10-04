// UI variants for the redesign (2026-10-02). Three takes on the project page,
// served by thin preview Workers (variants/) that forward to forq with
// `x-forq-ui: a|b|c`. Research and reasoning: docs/design-v2.md.
//
// Shared first principles, whatever the layout:
//  - the person thinks in *changes* to a running app, not in router agents,
//    reviewer agents, boxes or agent ids: those stay one tap deeper;
//  - every change has one plain state and at most one primary action;
//  - half the words: no explanations a person has to read to act.

import type { Entry } from './registry';
import type { Agent, ProjectInfo } from './project';
import type { BoxStatus, Overview } from './ui';
import { esc, path, label, STEPS } from './ui';
import { FRESH_CSS, freshHelp, freshLegend, freshTag } from './fresh';
import { markdown } from './md';
import { SHEET_CSS, SHEET_HTML, SHEET_JS, shortId } from './sheet';
import { runUrl } from './runurl';
export { runUrl };

// 'c' is the views design (src/v3.ts); 'd' keeps the first chat take for comparison.
export type UI = 'a' | 'b' | 'c' | 'd';
export const uiOf = (request: Request): UI | null => {
  const v = request.headers.get('x-forq-ui');
  return v === 'a' || v === 'b' || v === 'c' || v === 'd' ? v : null;
};
const NAMES: Record<UI, string> = { a: 'Views, home tabs (two bars)', b: 'Views, one bar', c: 'Views', d: 'Views, global top, project bottom' };

// ---- the change model ------------------------------------------------------

export type State = 'working' | 'checking' | 'ready' | 'fix' | 'waiting' | 'paused' | 'merged';
export type Change = { a: Agent; title: string; state: State; word: string; busy: boolean; since?: number; tryUrl?: string; notes?: string };

export const BUSY = /busy|thinking|working|running|tool/;
/** Merge taps go through the router agent as "Merge <id>": not something the person typed. */
export const isMerge = (t?: string) => !!t && /^Merge [a-z0-9]+$/.test(t);
export const fromIssues = (t?: string) => !!t && t.startsWith('Production error from Cloudflare Issues');

/** A change's title: its task's first sentence (the page clamps it to two lines). */
export function titleOf(task: string) {
  const t = task.replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{12,}?[.!?])(\s|$)/);
  return (m ? m[1] : t).replace(/[.]$/, '');
}

export function changeOf(info: ProjectInfo, a: Agent, s: BoxStatus | undefined, runBase: string): Change {
  const worker = info.kind === 'worker';
  const tryUrl = worker ? (a.preview?.status === 'live' && a.preview.url ? `${a.preview.url}/` : undefined) : runUrl(runBase, a.fork, info.entry || '');
  const base = { a, title: titleOf(a.task), tryUrl, busy: false } as Change;
  const r = a.review;
  if (a.state === 'merged' || a.state === 'stopped') return { ...base, state: 'merged', word: a.state === 'merged' ? 'Merged' : 'Stopped' };
  if (a.state === 'blocked') return { ...base, state: 'waiting', word: 'Needs your answer', notes: a.note };
  if (a.state === 'pushed') {
    if (r?.state === 'sent') return { ...base, state: 'working', word: 'Fixing', busy: true, since: r.at };
    if (r?.state === 'queued' || r?.state === 'reviewing') return { ...base, state: 'checking', word: 'Checking', busy: true, since: r.at };
    if (r?.state === 'changes') return { ...base, state: 'fix', word: 'Needs a fix', notes: r.notes };
    return { ...base, state: 'ready', word: 'Ready to merge', notes: r?.notes };
  }
  const st = s || { awake: false, cc: 'asleep' };
  if (st.booting || !st.taskSent || (st.awake && BUSY.test(st.cc))) return { ...base, state: 'working', word: 'Working', busy: true, since: a.createdAt };
  if (st.awake) return { ...base, state: 'waiting', word: 'Waiting for you' };
  return { ...base, state: 'paused', word: 'Paused' };
}

export function changesOf(info: ProjectInfo, status: Record<string, BoxStatus>, runBase: string) {
  const all = info.agents.map((a) => changeOf(info, a, status[a.id], runBase));
  // What needs you first (Codex-style), newest first within each state.
  const open = all.filter((c) => c.state !== 'merged').reverse().sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state));
  const done = all.filter((c) => c.a.state === 'merged').reverse();
  return { open, done };
}
export const ORDER: State[] = ['waiting', 'fix', 'ready', 'working', 'checking', 'paused', 'merged'];

/** One line for the whole project: what needs you first. */
export function summaryOf(open: Change[], planning: string): { html: string; state: State | ''; busy: boolean } {
  if (planning) return { html: planning, state: 'working', busy: true };
  if (!open.length) return { html: 'No changes in progress', state: '', busy: false };
  const n = (s: State) => open.filter((c) => c.state === s).length;
  const moving = n('working') + n('checking');
  // The most urgent thing only (critique 2026-10-02: a list of counts is read, not scanned).
  const top = n('waiting') ? `${n('waiting')} waiting for your answer` : n('fix') ? `${n('fix')} need${n('fix') > 1 ? '' : 's'} a fix` : n('ready') ? `${n('ready')} ready to merge`
    : moving ? `${moving} in progress` : `${n('paused')} paused`;
  const state = (['waiting', 'fix', 'ready', 'working', 'paused'] as State[]).find((s) => (s === 'working' ? moving : n(s)) > 0) || '';
  return { html: top, state, busy: moving > 0 };
}

/** The router agent's progress as one plain line ('' when idle). */
export function planningOf(info: ProjectInfo, r: BoxStatus): { line: string; failed?: string; said?: string } {
  const q = info.lastRequest;
  const since = (t: number) => `<span data-since="${t}">0s</span>`;
  if (!q) return { line: '' };
  if (q.state === 'failed') return { line: '', failed: q.error || 'unknown error' };
  const doing = isMerge(q.text) ? 'Merging' : 'Planning your request';
  if (q.state === 'waking') return { line: `${doing} ${since(q.at)}` };
  if (q.state === 'sent' && (BUSY.test(r.cc) || Date.now() - (q.sentAt || 0) < 8000)) {
    if (isMerge(q.text)) return { line: `Merging ${since(q.sentAt || q.at)}` };
    const n = info.agents.filter((a) => a.createdAt >= q.at).length;
    return { line: `Planning your request ${since(q.sentAt || q.at)}${n ? `, ${n} change${n > 1 ? 's' : ''} started` : ''}` };
  }
  return { line: '', said: r.said };
}

// ---- shared pieces -----------------------------------------------------------

const since = (t?: number) => (t ? ` <span class="t" data-since="${t}">0s</span>` : '');
const dot = (c: Change) => `<span class="dot s-${c.state}"></span>`;

/** The one thing to do with a change. Accent only on the page's most urgent one. */
export function primary(c: Change, accent = false) {
  const k = accent ? 'btn' : 'chipbtn';
  if (c.state === 'ready') return `<button class="${k}" data-merge="${esc(c.a.id)}">Merge</button>`;
  if (c.state === 'fix') return `<button class="${k}" data-fix="${esc(c.a.id)}">Ask to fix</button>`;
  if (c.state === 'waiting') return `<button class="${k}" data-sheet="${esc(c.a.id)}" data-name="${esc(c.title)}" data-mode="chat">Reply</button>`;
  return '';
}
/** Which change gets the page's one accent button. */
export const accentOf = (cs: Change[]) => cs.find((c) => primary(c))?.a.id;

/** Everything a change can do besides its primary action. */
function secondary(info: ProjectInfo, c: Change, opts: { tryIt?: boolean } = {}) {
  const a = c.a;
  const out: string[] = [];
  if (opts.tryIt !== false && c.tryUrl && c.state !== 'merged') out.push(`<button type="button" class="chipbtn" data-try="${esc(c.tryUrl)}" data-title="${esc(c.title)}" data-agent="${esc(a.id)}" data-state="${c.state}">Try it</button>`);
  // The rest are quiet links: rarely needed, never competing with the main action.
  const links = [`<a href="/p/${info.owner}/${info.name}/changes/${shortId(a.id)}">See the code</a>`];
  if (c.state !== 'merged') links.push(`<button type="button" class="lnk" data-sheet="${esc(a.id)}" data-name="${esc(c.title)}" data-mode="chat">Talk to its agent</button>`);
  if (c.state === 'fix') links.push(`<button type="button" class="lnk" data-merge="${esc(a.id)}">Merge anyway</button>`);
  return `${out.join('')}<span class="links">${links.join('')}</span>`;
}

/** The detail under a change: what it was asked, what it did, what the check said. */
function detail(info: ProjectInfo, c: Change) {
  const a = c.a;
  const rv = a.review;
  const check = rv?.state === 'approved' ? `<p><b>Checked.</b> ${esc(rv.notes || '')}</p>`
    : rv?.state === 'changes' ? `<p><b>The check found a problem.</b> ${esc(rv.notes || '')}</p>`
    : c.state === 'checking' ? `<p>The reviewer agent is trying it in a preview.</p>` : '';
  const pv = a.preview?.status === 'building' ? `<p>Building its preview${since(a.preview.at)}</p>` : a.preview?.status === 'failed' ? `<p>Its preview did not build: ${esc(a.preview.error || '')}. <a href="/p/${info.owner}/${info.name}/build-log?agent=${shortId(a.id)}">Build log</a></p>` : '';
  return `<div class="more">
${a.note ? `<p><b>What it did.</b> ${esc(a.note)}</p>` : ''}${check}${pv}
<p class="dim"><b>${fromIssues(a.request) ? 'Reported by Cloudflare Issues.' : a.request ? 'You asked.' : 'Task.'}</b> ${esc(fromIssues(a.request) ? a.task : a.request || a.task)}</p>
<div class="acts">${secondary(info, c)}</div></div>`;
}

const ROW_STEPS = STEPS;

/** A change as a list row: title, state, primary action; tap to open the detail. */
export function changeRow(info: ProjectInfo, c: Change, now: number, accentId?: string) {
  const act = primary(c, c.a.id === accentId);
  return `<div class="chg s-${c.state}${c.busy ? ' busy' : ''}" data-id="${esc(c.a.id)}" id="c-${esc(shortId(c.a.id))}"><div class="chg-row">
<div class="chg-h" data-open role="button" tabindex="0" aria-expanded="false"><span class="chg-t">${esc(c.title)}</span>
<span class="chg-s">${dot(c)}<span class="w">${c.word}${since(c.since)}</span>${freshTag(c.a.noteAt || c.a.createdAt, now, ROW_STEPS)}</span></div>
${act ? `<div class="chg-p">${act}</div>` : ''}</div>${detail(info, c)}</div>`;
}
export const legend = (n: number) => (n ? freshLegend(STEPS) : '');
export const TRYBAR = `<div class="trybar" id="trybar" hidden><div class="tt">Trying <b></b></div><button type="button" class="btn" data-trymerge>Merge</button><button type="button" class="chipbtn" data-trylive>Back to live</button></div>`;
export const SEND = `<button class="send chipbtn">Send</button>`;
export const VISIT = `<p class="visit">On forq. Fork it to make it yours and ask agents for changes.</p>`;

export function planningHtml(p: ReturnType<typeof planningOf>, q?: ProjectInfo['lastRequest']) {
  if (p.failed) return `<div class="plan bad">Could not start: ${esc(p.failed)} <button class="chipbtn" data-retry="${esc(q?.text || '')}">Retry</button></div>`;
  if (p.line) return `<div class="plan busy">${p.line}</div>`;
  return '';
}

// ---- CSS ---------------------------------------------------------------------

const TOKENS = `
:root{--bg:#fff;--card:#f6f7f8;--chip:#eceef1;--line:#e2e5e9;--fg:#15171a;--dim:#5f6670;--acc:#17695a;--acc-fg:#fff;--busy:#b7791f;--warn:#b42d1f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1112;--card:#171a1c;--chip:#202427;--line:#272b2f;--fg:#e8eaec;--dim:#9ba2a9;--acc:#4fbf9f;--acc-fg:#0f1112;--busy:#e0a948;--warn:#f08a7e;color-scheme:dark}}`;

const BASE_CSS = `${TOKENS}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 'Instrument Sans',sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--acc);text-decoration:none}
input:focus,textarea:focus{outline:none;border-color:var(--acc)!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 22%,transparent)}
a:focus-visible,button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.btn,.chipbtn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:8px;border:0;font:500 15px 'Instrument Sans',sans-serif;cursor:pointer;transition:background-color .12s;white-space:nowrap;text-decoration:none}
.btn{background:var(--acc);color:var(--acc-fg)}
.chipbtn{background:var(--chip);color:var(--fg)}
.btn[disabled],.chipbtn[disabled]{opacity:.6}
.dim{color:var(--dim)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--line);flex:none}
.dot.s-working,.dot.s-checking{background:var(--busy)}
.dot.s-ready{background:var(--acc)}
.dot.s-fix,.dot.s-waiting{background:var(--warn)}
.dot.s-merged{background:var(--dim)}
.busy .dot{animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.busy .dot{animation:none}}
/* change rows */
.chg{background:var(--card);border-radius:12px;overflow:hidden}
.chg-h{display:block;width:100%;text-align:left;background:none;border:0;padding:12px 14px 10px;color:inherit;font:inherit;cursor:pointer}
.chg-t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:15px;font-weight:500;line-height:1.35}
.chg-s{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;color:var(--dim)}
.chg-s .w{flex:1;min-width:0;font-variant-numeric:tabular-nums}
.chg.s-ready .chg-s .w{color:var(--acc);font-weight:500}
.chg.s-fix .chg-s .w,.chg.s-waiting .chg-s .w{color:var(--warn);font-weight:500}
.chg-row{display:flex;align-items:center}
.chg-row .chg-h{flex:1;min-width:0}
.chg-p{flex:none;padding:0 12px 0 0}
.chg-p .btn,.chg-p .chipbtn{min-height:40px;padding:0 14px;font-size:14px}
.links{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 16px;margin-left:4px}
.links a,.lnk{font:500 14px 'Instrument Sans',sans-serif;color:var(--acc);background:none;border:0;padding:10px 0;cursor:pointer}
.chg .more{display:none;padding:0 14px 14px;font-size:14px;border-top:1px solid var(--line);margin-top:2px}
.chg.open .more{display:block}
.more p{margin:10px 0 0;overflow-wrap:anywhere}
.more b{font-weight:600}
.acts{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}
.acts .chipbtn,.acts .btn{min-height:40px;padding:0 12px;font-size:14px}
.plan{font-size:14px;color:var(--fg);display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-variant-numeric:tabular-nums}
.plan.busy::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--busy);animation:pulse 1.6s ease-in-out infinite}
.plan .chipbtn{min-height:36px;padding:0 12px;font-size:14px}
.said{font-size:14px;color:var(--dim);white-space:pre-wrap;overflow-wrap:anywhere;max-height:9.5em;overflow:auto}
.empty{color:var(--dim);font-size:14px;margin:0}
.fresh-legend{margin:8px 2px 0}
/* Trying a change: a strip above the app, never over it. */
.trybar{flex:none;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 8px 8px 14px;background:var(--fg);color:var(--bg)}
.trybar .tt{flex:1 1 180px;min-width:0;font-size:14px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.trybar .tt b{font-weight:600}
.trybar .btn,.trybar .chipbtn{min-height:40px;padding:0 14px;font-size:14px}
.trybar .chipbtn{background:color-mix(in srgb,var(--bg) 20%,var(--fg));color:var(--bg)}
.ask .send.chipbtn{color:var(--dim)}
.visit{color:var(--dim);font-size:14px;margin:0}
.ask textarea{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:none}
.readme{font-size:15px;overflow-wrap:anywhere}
.readme h2,.readme h3,.readme h4{margin:16px 0 6px;font-size:17px}
.readme code{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:1px 4px}
.readme .tbl{overflow-x:auto;margin:0 0 14px}
.readme table{border-collapse:collapse;font-size:14px;min-width:100%}
.readme th,.readme td{overflow-wrap:normal;word-break:normal;text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line)}
.readme th{font-weight:600}
.readme pre{overflow-x:auto;background:var(--chip);border-radius:8px;padding:10px}
.readme hr{border:0;border-top:1px solid var(--line);margin:16px 0}
.files{display:flex;flex-wrap:wrap;gap:6px}
.files a{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:6px 8px;color:var(--fg)}
.vtag{font-size:12px;color:var(--dim);border:1px solid var(--line);border-radius:4px;padding:2px 6px;margin-left:8px;font-weight:400;vertical-align:2px}
@media (hover:hover){.chipbtn:hover{background:var(--line)}.chg-h:hover{background:var(--chip)}}
${FRESH_CSS}${SHEET_CSS}`;

export function shell2(ui: UI, title: string, body: string, css: string, bodyClass = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)} (${ui.toUpperCase()})</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${BASE_CSS}${css}</style></head><body class="${bodyClass}">${body}${freshHelp(STEPS)}</body></html>`;
}

/** Page script shared by the variants: polling, actions, Try it, row toggles. */
export function pageJs(info: ProjectInfo, pollQ = '') {
  return `<script>
const API='/api/p/${esc(info.owner)}/${esc(info.name)}';
const live=document.getElementById('live');
const tick=()=>{for(const el of document.querySelectorAll('[data-since]')){const s=Math.max(0,Math.round((Date.now()-Number(el.dataset.since))/1000));el.textContent=s<60?s+'s':Math.floor(s/60)+'m '+(s%60)+'s';}};
setInterval(tick,1000);tick();
const openIds=new Set();
function restore(){for(const id of openIds){const r=document.querySelector('.chg[data-id="'+CSS.escape(id)+'"]');if(r){r.classList.add('open');r.querySelector('[data-open]')?.setAttribute('aria-expanded','true');}}}
let timer=null;
async function poll(){clearTimeout(timer);
 if(live&&!document.hidden){try{const r=await fetch(API+'/agents-html${pollQ}');if(r.ok){const j=await r.json();live.innerHTML=j.html;restore();tick();window.forqAfterPoll&&window.forqAfterPoll(j);}}catch{}}
 timer=setTimeout(poll,document.querySelector('#live .busy,#live .plan.busy')?2000:5000);}
// The design fixture shows sample data: never replace it with the real project's.
if(live&&!location.pathname.startsWith('/design-fixture')){document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});timer=setTimeout(poll,2000);}
async function post(verb,body){const r=await fetch(API+'/'+verb,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})});const j=await r.json().catch(()=>({}));return r.ok?j:Promise.reject(new Error(j.error||'Failed'));}
async function ask(text){window.forqAsked&&window.forqAsked(text);
 if(live){const p=live.querySelector('.plan');const h='<div class="plan busy">Sending <span data-since="'+Date.now()+'">0s</span></div>';if(p)p.outerHTML=h;else live.insertAdjacentHTML('afterbegin',h);tick();}
 try{await post('router',{text});poll();return true;}catch(e){const p=live&&live.querySelector('.plan');if(p){p.className='plan bad';p.textContent=e.message;}else{const ta=document.querySelector('form.ask textarea');if(ta)ta.placeholder=e.message;}return false;}}
document.addEventListener('keydown',(e)=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-open]')){e.preventDefault();e.target.click();}});
// Trying a change: the app shows its preview under a strip that says so.
const frame=document.getElementById('app'),ext=document.getElementById('ext'),tbar=document.getElementById('trybar');
const liveSrc=frame&&(frame.getAttribute('src')||frame.dataset.src);let trying=null;
function forqTry(src,title,agent,state){if(!frame||!tbar)return;window.forqBeforeTry&&window.forqBeforeTry();
 frame.src=src;if(ext)ext.href=src;trying=agent;tbar.querySelector('b').textContent=title;
 tbar.querySelector('[data-trymerge]').hidden=state!=='ready';tbar.hidden=false;document.body.classList.add('trying');window.forqAfterTry&&window.forqAfterTry();}
function backLive(){if(!frame)return;frame.src=liveSrc;if(ext)ext.href=liveSrc;if(tbar)tbar.hidden=true;trying=null;document.body.classList.remove('trying');}
for(const f of document.querySelectorAll('form.ask')){
 const ta=f.querySelector('textarea'),sb=f.querySelector('.send');
 // Send is quiet until there is something to send: one accent per screen.
 const lit=()=>{if(sb)sb.className='send '+(ta.value.trim()?'btn':'chipbtn');};
 const grow=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,160)+'px';lit();};ta.addEventListener('input',grow);
 ta.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&matchMedia('(hover:hover)').matches){e.preventDefault();f.requestSubmit();}});
 // Pressing Send must not take focus from the box first: on a phone that closes the
 // keyboard, the page re-lays out, Send moves and the tap misses (2026-10-04, measured
 // 57 px at 390 px wide). Keeping focus keeps Send where the finger is.
 if(sb)sb.addEventListener('pointerdown',(e)=>{if(document.activeElement===ta)e.preventDefault();});
 // A suggested change (from the home page's Try row) is waiting in the box, not sent.
 const sug=new URLSearchParams(location.search).get('ask');if(sug&&!ta.value){ta.value=sug.slice(0,500);grow();}
 f.onsubmit=async(e)=>{e.preventDefault();const t=ta.value.trim();if(!t)return;ta.value='';grow();if(!(await ask(t))){ta.value=t;grow();}else if(window.forqAskedGo)location.href=window.forqAskedGo;};}
document.addEventListener('click',async(e)=>{
 const o=!e.target.closest('.fresh')&&e.target.closest('[data-open]');if(o){const r=o.closest('.chg');const on=r.classList.toggle('open');o.setAttribute('aria-expanded',on);on?openIds.add(r.dataset.id):openIds.delete(r.dataset.id);return;}
 const t=e.target.closest('[data-try]');if(t){forqTry(t.dataset.try,t.dataset.title,t.dataset.agent,t.dataset.state);return;}
 if(e.target.closest('[data-trylive]')){backLive();return;}
 const tm=e.target.closest('[data-trymerge]');if(tm){tm.disabled=true;tm.textContent='Merging';try{await post('merge',{agent:trying});backLive();}catch(err){tm.textContent=err.message;return;}tm.disabled=false;tm.textContent='Merge';poll();return;}
 const rt=e.target.closest('[data-retry]');if(rt){rt.disabled=true;ask(rt.dataset.retry);return;}
 const b=e.target.closest('[data-merge],[data-fix]');if(!b)return;
 b.disabled=true;const m=!!b.dataset.merge;b.textContent=m?'Merging':'Sending to its agent';
 try{await post(m?'merge':'fix',{agent:b.dataset.merge||b.dataset.fix});window.forqMerged&&m&&window.forqMerged(b.dataset.merge);}catch(err){b.textContent=err.message;}
 poll();});
</script><script>${SHEET_JS}</script>`;
}

/** Fork / sign-in for someone who does not own the project. */
export function forkAction(info: ProjectInfo, me: string, myForks: Entry[], cls = 'btn') {
  if (myForks.length) return `<a class="${cls}" href="${path(myForks[0].slug)}">Open your copy</a>`;
  if (me) return `<button class="${cls}" id="fork">Fork to change it</button>`;
  return `<a class="${cls}" href="/login?next=${encodeURIComponent(path(info.slug))}">Sign in to fork</a>`;
}
export const FORK_JS = `<script>const fk=document.getElementById('fork');if(fk)fk.onclick=async()=>{fk.disabled=true;fk.textContent='Forking';const r=await fetch(location.pathname.replace(/\\/$/,'').replace(/^\\/p\\//,'/api/p/')+'/fork',{method:'POST'});const j=await r.json();const ak=new URLSearchParams(location.search).get('ask');if(r.ok)location.href=j.path+(ak?'?ask='+encodeURIComponent(ak):'');else{fk.disabled=false;fk.textContent=j.error||'Fork failed';}};</script>`;

export type ProjectArgs = { info: ProjectInfo; entry: Entry; forks: Entry[]; overview: Overview; me: string; runBase: string; liveHtml: string; needsKey?: boolean };

export function appUrl(o: ProjectArgs) {
  const { info, overview, runBase } = o;
  const isWorker = (overview.kind ?? info.kind) === 'worker';
  const dep = overview.app ?? info.app;
  if (isWorker) return dep?.url ? `${dep.url}/` : '';
  const at = overview.entry ?? info.entry;
  return at === null ? '' : runUrl(runBase, info.repo, at || '');
}

/** What to show where the app would be, when there is no app to show. */
export function noApp(o: ProjectArgs) {
  const isWorker = (o.overview.kind ?? o.info.kind) === 'worker';
  const dep = o.overview.app ?? o.info.app;
  if (o.overview.importing) return `<div class="noapp">Importing from GitHub<script>setTimeout(()=>location.reload(),3000)</script></div>`;
  if (isWorker && dep?.status === 'building') return `<div class="noapp">Deploying <span data-since="${dep.at}">0s</span><script>setTimeout(()=>location.reload(),6000)</script></div>`;
  if (isWorker && dep?.status === 'failed') return `<div class="noapp">The deploy failed: ${esc(dep.error || '')}. <a href="/p/${o.info.owner}/${o.info.name}/build-log">Build log</a></div>`;
  return `<div class="noapp">This project has no web page to show.</div>`;
}

export const keyNote = `<p class="empty">Agents run on your own Anthropic API key. <a href="/settings">Add it in Settings</a>.</p>`;

// ---- Variant A: the app is the page -----------------------------------------

const A_CSS = `
body.app{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.abar{display:flex;align-items:center;gap:4px;height:52px;padding:0 8px 0 4px;border-bottom:1px solid var(--line);flex:none}
.abar .home{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;font-weight:600;color:var(--fg)}
.abar .nm{flex:1;min-width:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.abar .nm .o{color:var(--dim)}
.abar .lnk{padding:10px 8px}
.abar .chipbtn{min-height:36px;padding:0 12px;font-size:14px;gap:6px}
.ico{width:14px;height:14px;flex:none}
.stage{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--card)}
.stage iframe{flex:1;width:100%;border:0;display:block;background:#fff}
.noapp{display:flex;align-items:center;justify-content:center;flex:1;padding:24px;text-align:center;color:var(--dim);font-size:15px}
.dock{flex:none;border-top:1px solid var(--line);background:var(--bg);padding:4px 12px calc(8px + env(safe-area-inset-bottom))}
.status{display:flex;align-items:center;gap:8px;width:100%;min-height:48px;background:none;border:0;padding:0 2px;color:var(--fg);font:500 15px 'Instrument Sans',sans-serif;text-align:left;cursor:pointer;font-variant-numeric:tabular-nums}
.status .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status.s-fix .tx,.status.s-waiting .tx{color:var(--warn)}
.status.s-ready .tx{color:var(--acc)}
.status .up{width:10px;height:10px;border-left:2px solid var(--dim);border-top:2px solid var(--dim);transform:rotate(45deg);margin:4px 6px 0}
.dock .ask{display:flex;gap:8px;align-items:flex-end}
.dock .ask textarea{flex:1;min-height:44px;max-height:160px;padding:10px 12px}
.list{position:fixed;left:0;right:0;bottom:0;z-index:19;max-width:720px;margin:0 auto;max-height:80dvh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-bottom:0;border-radius:16px 16px 0 0;box-shadow:0 -8px 32px rgb(0 0 0 / .18);transform:translateY(105%);transition:transform .22s ease;visibility:hidden}
.list.open{transform:none;visibility:visible}
.list .lh{display:flex;align-items:center;padding:4px 8px 4px 16px;border-bottom:1px solid var(--line);flex:none}
.list .lh b{flex:1;font-weight:600}
.list .x{width:44px;height:44px;border:0;background:none;color:var(--dim);font-size:24px;cursor:pointer}
.list .lb>*{flex:none}
.list .lb{overflow-y:auto;padding:12px 12px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;overscroll-behavior:contain}
.list .sec{font-size:13px;color:var(--dim);margin:12px 4px 0}
.scrim{position:fixed;inset:0;z-index:18;background:rgb(0 0 0 / .25);opacity:0;pointer-events:none;transition:opacity .22s}
.scrim.on{opacity:1;pointer-events:auto}
.info .lb p{margin:0}
.dock .visit{margin:6px 2px 8px}
/* Desktop: the app on the left, the changes always open on the right. */
@media (min-width:1000px){
 body.app .stage{margin-right:400px}
 body.app #list{left:auto;right:0;top:52px;bottom:64px;width:400px;max-width:none;max-height:none;margin:0;transform:none;visibility:visible;border:0;border-left:1px solid var(--line);border-radius:0;box-shadow:none;z-index:5}
 body.app #list .x{display:none}
 body.app .dock{position:fixed;right:0;bottom:0;width:400px;border-left:1px solid var(--line);padding-top:8px}
 body.app .status{display:none}
}
`;

const OPEN_ICON = `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5"/></svg>`;

export function liveA(info: ProjectInfo, open: Change[], done: Change[], plan: ReturnType<typeof planningOf>) {
  const now = Date.now();
  const sum = summaryOf(open, plan.line);
  const accent = accentOf(open);
  return `<template id="sum" data-state="${plan.failed ? 'fix' : sum.state}" data-busy="${sum.busy ? 1 : ''}">${plan.failed ? `Could not start: ${esc(plan.failed)}` : sum.html}</template>
${planningHtml(plan, info.lastRequest)}${plan.said ? `<div class="said">${esc(plan.said)}</div>` : ''}
${open.map((c) => changeRow(info, c, now, accent)).join('') || (plan.line ? '' : '<p class="empty">Nothing in progress. Ask for a change below.</p>')}
${done.length ? `<p class="sec">Merged</p>${done.slice(0, 8).map((c) => changeRow(info, c, now)).join('')}` : ''}${legend(open.length + done.length)}`;
}

export function projectA(o: ProjectArgs) {
  const { info, me, forks, overview } = o;
  const own = info.owner === me;
  const app = appUrl(o);
  const myForks = forks.filter((e) => e.owner === me);
  return shell2('a', `${info.owner}/${info.name} · forq`, `
<header class="abar"><a class="home" href="/" aria-label="All projects">forq</a><span class="nm"><span class="o">${esc(info.owner)} /</span> ${esc(info.name)}</span>
<button type="button" class="lnk" id="info-b">About</button>${app ? `<a class="chipbtn" id="ext" href="${esc(app)}" target="_blank" rel="noopener">Open app${OPEN_ICON}</a>` : ''}</header>
<div class="stage">${TRYBAR}${app ? `<iframe id="app" src="${esc(app)}" title="${esc(info.name)}"></iframe>` : noApp(o)}</div>
<div class="dock">${own ? (o.needsKey ? keyNote : `<button type="button" class="status" id="status" aria-label="Show changes"><span class="dot"></span><span class="tx">No changes in progress</span><span class="up"></span></button>
<form class="ask"><textarea rows="1" placeholder="Ask for a change" enterkeyhint="send" aria-label="Ask for a change"></textarea>${SEND}</form>`)
    : `${VISIT}<div style="display:flex">${forkAction(info, me, myForks, 'btn" style="flex:1')}</div>`}</div>
<div class="scrim" id="scrim"></div>
${own ? `<div class="list" id="list" aria-hidden="true"><div class="lh"><b>Changes</b><button type="button" class="x" data-close aria-label="Close">×</button></div><div class="lb" id="live">${o.liveHtml}</div></div>` : ''}
<div class="list info" id="info" aria-hidden="true"><div class="lh"><b>${esc(info.name)}</b><button type="button" class="x" data-close aria-label="Close">×</button></div><div class="lb">
${info.description ? `<p>${esc(info.description)}</p>` : ''}
<p class="dim" style="font-size:14px">${info.forkedFrom ? `Forked from <a href="${path(info.forkedFrom)}">${esc(label(info.forkedFrom))}</a>. ` : ''}${forks.length ? `${forks.length} fork${forks.length > 1 ? 's' : ''}. ` : ''}${info.importedFrom ? `From <a href="${esc(info.importedFrom.url)}" rel="noopener">GitHub</a>.` : ''}</p>
<div class="acts"><a class="chipbtn" href="/p/${info.owner}/${info.name}/code/">Code</a>${own ? `<button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="chat">Router agent</button><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="chat">Reviewer agent</button>` : ''}</div>
${overview.readme ? `<div class="readme">${markdown(overview.readme)}</div>` : ''}</div></div>
${own ? SHEET_HTML : ''}
${pageJs(info)}${FORK_JS}
<script>
(function(){
 const scrim=document.getElementById('scrim');
 const sheets=[...document.querySelectorAll('.list')];
 function show(el){for(const s of sheets)s.classList.toggle('open',s===el);scrim.classList.toggle('on',!!el);}
 scrim.onclick=()=>show(null);
 for(const x of document.querySelectorAll('[data-close]'))x.onclick=()=>show(null);
 document.getElementById('info-b').onclick=()=>show(document.getElementById('info'));
 const st=document.getElementById('status'),list=document.getElementById('list');
 if(st)st.onclick=()=>show(list);
 // Opening an agent's chat closes the list first (one surface at a time).
 document.addEventListener('click',(e)=>{if(e.target.closest('[data-sheet]'))show(null);},true);
 function sync(){const s=document.getElementById('sum');if(!s||!st)return;st.querySelector('.tx').innerHTML=s.innerHTML;
  st.className='status'+(s.dataset.state?' s-'+s.dataset.state:'')+(s.dataset.busy?' busy':'');
  st.querySelector('.dot').className='dot'+(s.dataset.state?' s-'+s.dataset.state:'');tick();}
 sync();window.forqAfterPoll=sync;
 window.forqAsked=()=>{if(st){st.querySelector('.tx').textContent='Sending';st.classList.add('busy');}};
 window.forqBeforeTry=()=>show(null);
})();
</script>`, A_CSS, 'app');
}

// ---- Variant B: a task list under the app -------------------------------------

const B_CSS = `
main{max-width:720px;margin:0 auto;padding:4px 16px calc(32px + env(safe-area-inset-bottom))}
.top{display:flex;align-items:center;justify-content:space-between;height:48px}
.top .home{font-weight:600;font-size:18px;color:var(--fg)}
.top .me{font-size:14px;color:var(--dim)}
h1{font-size:24px;line-height:1.2;margin:8px 0 4px;font-weight:600;word-break:break-word}
h1 .o{color:var(--dim);font-weight:400}
.lede{color:var(--dim);margin:0;font-size:15px}
h2{font-size:15px;font-weight:600;margin:24px 0 10px}
.frame{margin-top:16px;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card);scroll-margin-top:8px}
.frame .fh{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 6px 0 14px;border-bottom:1px solid var(--line);font-size:14px;color:var(--dim)}
.frame .fh span{flex:1}
.frame .fh .chipbtn{min-height:36px;padding:0 12px;font-size:14px;gap:6px}
body.trying .frame .fh{display:none}
.ico{width:14px;height:14px;flex:none}
.frame iframe{width:100%;height:min(520px,56dvh);border:0;display:block;background:#fff}
.own .frame iframe{height:min(420px,38dvh)}
.noapp{padding:32px 16px;text-align:center;color:var(--dim);font-size:15px}
.ask{display:flex;gap:8px;align-items:flex-end}
.ask textarea{flex:1;min-height:44px;max-height:160px;padding:10px 12px}
#live{display:flex;flex-direction:column;gap:8px;margin-top:12px}
details.fold{border-top:1px solid var(--line);margin-top:24px}
details.fold summary{display:flex;align-items:center;min-height:52px;font-weight:600;font-size:15px;cursor:pointer;list-style:none}
details.fold summary::-webkit-details-marker{display:none}
details.fold summary .n{margin-left:8px;color:var(--dim);font-weight:400}
details.fold summary::after{content:'';margin-left:auto;width:8px;height:8px;border-right:2px solid var(--dim);border-bottom:2px solid var(--dim);transform:rotate(45deg);transition:transform .12s}
details.fold[open] summary::after{transform:rotate(-135deg)}
details.fold .in{padding-bottom:16px;display:flex;flex-direction:column;gap:8px}
#live details.fold{margin-top:16px}
.forkbar{margin-top:16px;display:flex}
.forkbar .btn{flex:1}
.lede+.visit{margin-top:6px}
`;

const OPEN_ICON_B = `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5"/></svg>`;

export function liveB(info: ProjectInfo, open: Change[], done: Change[], plan: ReturnType<typeof planningOf>) {
  const now = Date.now();
  const accent = accentOf(open);
  return `${planningHtml(plan, info.lastRequest)}${plan.said ? `<div class="said">${esc(plan.said)}</div>` : ''}
${open.map((c) => changeRow(info, c, now, accent)).join('') || (plan.line ? '' : '<p class="empty">No changes in progress.</p>')}
${legend(open.length + done.length)}
${done.length ? `<details class="fold"><summary>Merged<span class="n">${done.length}</span></summary><div class="in">${done.slice(0, 10).map((c) => changeRow(info, c, now)).join('')}</div></details>` : ''}`;
}

export function projectB(o: ProjectArgs) {
  const { info, me, forks, overview } = o;
  const own = info.owner === me;
  const app = appUrl(o);
  const myForks = forks.filter((e) => e.owner === me);
  return shell2('b', `${info.owner}/${info.name} · forq`, `<main>
<header class="top"><a class="home" href="/">forq</a>${me ? `<a class="me" href="/settings">${esc(me)}</a>` : `<a class="chipbtn" href="/login">Sign in</a>`}</header>
<h1><span class="o">${esc(info.owner)} /</span> ${esc(info.name)}</h1>
${info.description ? `<p class="lede">${esc(info.description)}</p>` : ''}${own ? '' : VISIT}
${own ? '' : `<div class="forkbar">${forkAction(info, me, myForks)}</div>`}
<div class="frame">${TRYBAR}<div class="fh"><span>Live app</span>${app ? `<a class="chipbtn" id="ext" href="${esc(app)}" target="_blank" rel="noopener">Open app${OPEN_ICON_B}</a>` : ''}</div>
${app ? `<iframe id="app" src="${esc(app)}" title="${esc(info.name)}" loading="lazy"></iframe>` : noApp(o)}</div>
${own ? `<h2>Changes</h2>${o.needsKey ? keyNote : `<form class="ask"><textarea rows="1" placeholder="Ask for a change" enterkeyhint="send" aria-label="Ask for a change"></textarea>${SEND}</form>
<div id="live">${o.liveHtml}</div>`}` : ''}
<details class="fold"><summary>About this project</summary><div class="in">
<p class="dim" style="margin:0;font-size:14px">${info.forkedFrom ? `Forked from <a href="${path(info.forkedFrom)}">${esc(label(info.forkedFrom))}</a>. ` : ''}${forks.length ? `${forks.length} fork${forks.length > 1 ? 's' : ''}. ` : ''}${info.importedFrom ? `Imported from <a href="${esc(info.importedFrom.url)}" rel="noopener">GitHub</a>.` : ''}</p>
${overview.readme ? `<div class="readme">${markdown(overview.readme)}</div>` : ''}</div></details>
<details class="fold"><summary>Code<span class="n">${overview.files.length} item${overview.files.length === 1 ? '' : 's'}</span></summary><div class="in">
<div class="files">${overview.files.map((f) => `<a href="/p/${info.owner}/${info.name}/code/${esc(f.name)}${f.dir ? '/' : ''}">${esc(f.name)}${f.dir ? '/' : ''}</a>`).join('')}</div>
<div class="acts"><a class="chipbtn" href="/p/${info.owner}/${info.name}/code/">Browse and search</a>${own ? `<button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="chat">Router agent</button><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="chat">Reviewer agent</button>` : ''}</div></div></details>
</main>${own ? SHEET_HTML : ''}${pageJs(info)}${FORK_JS}
<script>window.forqAfterTry=()=>document.querySelector('.frame').scrollIntoView({behavior:'smooth',block:'start'});</script>`, B_CSS, own ? 'own' : '');
}

// ---- Variant C: the project as a conversation ---------------------------------

const C_CSS = `
body.chat{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.cbar{flex:none;border-bottom:1px solid var(--line);padding:0 12px}
.cbar .r1{display:flex;align-items:center;gap:4px;height:48px}
.cbar .home{font-weight:600;color:var(--fg);min-height:44px;display:inline-flex;align-items:center;padding-right:8px}
.cbar .nm{flex:1;min-width:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cbar .nm .o{color:var(--dim)}
.cbar .lnk{padding:10px 8px}
.cbar .chipbtn{min-height:36px;padding:0 12px;font-size:14px;gap:6px}
.ico{width:14px;height:14px;flex:none}
.tabs{display:flex;gap:4px;padding-bottom:8px}
.tabs button{flex:1;min-height:40px;border:0;border-radius:8px;background:none;color:var(--dim);font:500 15px 'Instrument Sans',sans-serif;cursor:pointer}
.tabs button.on{background:var(--chip);color:var(--fg)}
.pane{flex:1;min-height:0;display:none;flex-direction:column}
.pane.on{display:flex}
.thread>*,.them>*{flex:none}
.thread{flex:1;overflow-y:auto;padding:0 12px 8px;display:flex;flex-direction:column;gap:12px;overscroll-behavior:contain}
.thread>:nth-child(2){margin-top:16px}
.needbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;min-height:44px;margin:0 -12px;padding:0 12px;background:var(--bg);border-bottom:1px solid var(--line);font:500 14px 'Instrument Sans',sans-serif;color:var(--warn)}
.needbar.none{display:none}
.needbar .tx{flex:1}
.needbar i{font-style:normal;color:var(--acc)}
.you{align-self:flex-end;max-width:86%;background:var(--chip);color:var(--fg);border-radius:12px 12px 4px 12px;padding:10px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.you.sys{align-self:stretch;max-width:none;background:none;border:1px solid var(--line);border-radius:12px;font-size:14px}
.you.sys b{display:block;font-weight:600;margin-bottom:2px}
.when{align-self:center;font-size:12px;color:var(--dim)}
.them{display:flex;flex-direction:column;gap:8px;max-width:100%}
.them .said{color:var(--fg);font-size:15px;max-height:none}
.thread .plan{padding:2px 2px}
.compose{flex:none;border-top:1px solid var(--line);padding:8px 12px calc(8px + env(safe-area-inset-bottom));background:var(--bg)}
.compose .ask{display:flex;gap:8px;align-items:flex-end}
.compose .ask textarea{flex:1;min-height:44px;max-height:160px;padding:10px 12px}
.appw{flex:1;min-height:0;display:flex;flex-direction:column}
.appw iframe{flex:1;width:100%;border:0;background:#fff}
.noapp{padding:32px 16px;text-align:center;color:var(--dim)}
.codep{overflow-y:auto;padding:16px}
.codep h2{font-size:15px;margin:20px 0 8px}
.forkbar{padding:8px 12px calc(8px + env(safe-area-inset-bottom));border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
.forkbar .btn{flex:1}
/* Desktop: a conversation reads best in a column; the app keeps the full width. */
@media (min-width:800px){.cbar,.thread,.compose,.codep,.forkbar{padding-left:max(12px,calc(50% - 360px));padding-right:max(12px,calc(50% - 360px))}.needbar{margin:0 calc(-1 * max(12px,calc(50% - 360px)));padding:0 max(12px,calc(50% - 360px))}}
`;

export const OPEN_ICON_C = `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5"/></svg>`;

type Group = { text: string; at: number; issues: boolean; changes: Change[] };

export function liveC(info: ProjectInfo, all: Change[], plan: ReturnType<typeof planningOf>) {
  const now = Date.now();
  const groups: Group[] = [];
  for (const c of [...all].sort((x, y) => x.a.createdAt - y.a.createdAt)) {
    const text = c.a.request || '';
    const g = groups.find((x) => x.text === text && Math.abs(c.a.createdAt - x.at) < 6 * 3600_000);
    if (g) g.changes.push(c); else groups.push({ text, at: c.a.createdAt, issues: fromIssues(text), changes: [c] });
  }
  const q = info.lastRequest;
  const lastHasAgents = q && groups.some((g) => g.text === q.text && g.at >= q.at - 60_000);
  if (q && !lastHasAgents && !isMerge(q.text)) groups.push({ text: q.text, at: q.at, issues: fromIssues(q.text), changes: [] });
  // What needs you, pinned on top: the thread is in time order, so it may be far up.
  const needs = all.filter((c) => primary(c)).sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state));
  const accent = needs[0]?.a.id;
  const need = needs.length
    ? `<a class="needbar" href="#c-${esc(shortId(needs[0].a.id))}"><span class="dot s-${needs[0].state}"></span><span class="tx">${needs.length} need${needs.length > 1 ? '' : 's'} you</span><i>Show</i></a>`
    : '<div class="needbar none"></div>';
  const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  let lastDay = '';
  const out = groups.map((g, i) => {
    const d = day(g.at);
    const when = d !== lastDay ? `<div class="when">${d}</div>` : '';
    lastDay = d;
    const isLast = i === groups.length - 1;
    const you = !g.text ? '' : g.issues
      ? `<div class="you sys"><b>Cloudflare Issues reported an error</b>${esc(g.text.replace(/^Production error from Cloudflare Issues:\s*/, '').slice(0, 220))}</div>`
      : `<div class="you">${esc(g.text)}</div>`;
    const tail = isLast && !(q && isMerge(q.text)) ? `${planningHtml(plan, q)}${plan.said ? `<div class="said">${esc(plan.said)}</div>` : ''}` : '';
    return `${when}${you}<div class="them">${g.changes.map((c) => changeRow(info, c, now, accent)).join('')}${tail}</div>`;
  });
  if (q && isMerge(q.text)) out.push(`${planningHtml(plan, q)}`);
  return need + (out.join('') || `<p class="empty" style="text-align:center;margin-top:24px">Ask for a change. forq splits it into tasks, an agent does each one, and a reviewer checks it before you merge.</p>`) + legend(all.length);
}

export function projectC(o: ProjectArgs) {
  const { info, me, forks, overview } = o;
  const own = info.owner === me;
  const app = appUrl(o);
  const myForks = forks.filter((e) => e.owner === me);
  const codeHref = `/p/${info.owner}/${info.name}/code/`;
  return shell2('c', `${info.owner}/${info.name} · forq`, `
<header class="cbar"><div class="r1"><a class="home" href="/">forq</a><span class="nm"><span class="o">${esc(info.owner)} /</span> ${esc(info.name)}</span>${own ? '' : `<a class="lnk" href="${codeHref}">Code</a>`}${app ? `<a class="chipbtn" id="ext" href="${esc(app)}" target="_blank" rel="noopener">Open app${OPEN_ICON_C}</a>` : ''}</div>
${own ? `<nav class="tabs" role="tablist"><button type="button" role="tab" data-tab="chat" class="on">Changes</button><button type="button" role="tab" data-tab="app">App</button><button type="button" role="tab" data-tab="code">Code</button></nav>` : ''}</header>
${own ? `<section class="pane on" id="p-chat"><div class="thread" id="live">${o.liveHtml}</div>
<div class="compose">${o.needsKey ? keyNote : `<form class="ask"><textarea rows="1" placeholder="Ask for a change" enterkeyhint="send" aria-label="Ask for a change"></textarea>${SEND}</form>`}</div></section>` : ''}
<section class="pane${own ? '' : ' on'}" id="p-app"><div class="appw">${TRYBAR}${app ? `<iframe id="app" ${own ? 'data-src' : 'src'}="${esc(app)}" title="${esc(info.name)}"></iframe>` : noApp(o)}</div>
${own ? '' : `<div class="forkbar">${VISIT}${forkAction(info, me, myForks)}</div>`}</section>
${own ? `<section class="pane" id="p-code"><div class="codep">
${info.description ? `<p style="margin:0 0 8px">${esc(info.description)}</p>` : ''}
<div class="acts" style="margin-top:0"><a class="chipbtn" href="${codeHref}">Browse and search the code</a></div>
<h2>Files</h2><div class="files">${overview.files.map((f) => `<a href="${codeHref}${esc(f.name)}${f.dir ? '/' : ''}">${esc(f.name)}${f.dir ? '/' : ''}</a>`).join('')}</div>
<h2>The agents behind it</h2><div class="acts" style="margin-top:0"><button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="chat">Router agent</button><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="chat">Reviewer agent</button></div>
${overview.readme ? `<h2>README</h2><div class="readme">${markdown(overview.readme)}</div>` : ''}</div></section>` : ''}
${own ? SHEET_HTML : ''}${pageJs(info)}${FORK_JS}
<script>
(function(){
 const panes={},btns=document.querySelectorAll('.tabs button');for(const b of btns)panes[b.dataset.tab]=document.getElementById('p-'+b.dataset.tab);
 const fr=document.getElementById('app');
 function tab(t){for(const b of btns)b.classList.toggle('on',b.dataset.tab===t);for(const k in panes)panes[k].classList.toggle('on',k===t);
  if(t==='app'&&fr&&!fr.getAttribute('src'))fr.src=fr.dataset.src;}
 for(const b of btns)b.onclick=()=>tab(b.dataset.tab);
 const th=document.getElementById('live');const bottom=()=>{if(th)th.scrollTop=th.scrollHeight;};bottom();
 (document.fonts?document.fonts.ready:Promise.resolve()).then(()=>requestAnimationFrame(bottom));
 window.forqBeforeTry=()=>tab('app');
 const near=()=>th&&th.scrollHeight-th.scrollTop-th.clientHeight<120;
 let stick=true;if(th)th.addEventListener('scroll',()=>{stick=near();});
 window.forqAfterPoll=()=>{if(stick)bottom();};
 window.forqAsked=(t)=>{if(!th)return;const e=document.createElement('div');e.className='you';e.textContent=t;th.appendChild(e);bottom();};
 // The needs-you bar jumps to the card, inside the thread's own scroller.
 document.addEventListener('click',(e)=>{const a=e.target.closest('.needbar[href]');if(!a)return;e.preventDefault();
  const c=document.querySelector(a.getAttribute('href'));if(c){c.scrollIntoView({behavior:'smooth',block:'center'});c.classList.add('open');}});
})();
</script>`, C_CSS, 'chat');
}

// ---- Home (all variants) ------------------------------------------------------

const HOME_CSS = `
main{max-width:720px;margin:0 auto;padding:4px 16px calc(32px + env(safe-area-inset-bottom))}
.top{display:flex;align-items:center;justify-content:space-between;height:52px}
.top .home{font-weight:600;font-size:20px;color:var(--fg)}
.top .tr{display:flex;align-items:center;gap:8px}
.top .chipbtn{min-height:40px;font-size:14px;padding:0 12px}
.top .me{font-size:14px;color:var(--dim);padding:8px 4px}
.hero{margin:12px 0 4px;font-size:22px;line-height:1.25;font-weight:600;letter-spacing:-.01em}
.sub{color:var(--dim);margin:0 0 8px;font-size:15px}
h2{display:flex;align-items:baseline;font-size:15px;font-weight:600;margin:28px 0 10px}
h2 a{margin-left:auto;font-weight:500;font-size:14px}
.rows{display:flex;flex-direction:column;gap:8px}
.prow{position:relative;display:block;background:var(--card);border-radius:12px;padding:12px 14px;color:inherit}
.prow .t{display:block;font-size:15px;color:var(--fg)}
.prow .t b{font-weight:600}.prow .t .o{color:var(--dim)}
.prow .d{color:var(--dim);font-size:14px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prow .m{display:flex;align-items:center;gap:8px 12px;margin-top:8px;font-size:13px;color:var(--dim);white-space:nowrap;overflow:hidden}
.prow .m .st{display:inline-flex;align-items:center;gap:6px;color:var(--fg);font-weight:500}
.prow .m .st.ready{color:var(--acc)}
.stretch::after{content:'';position:absolute;inset:0;border-radius:12px}
.prow button.fresh{position:relative;z-index:1}
.foot{margin-top:32px;font-size:14px;display:flex;gap:16px}
.vnote{display:block;margin:8px 0 4px;padding:12px 14px;border-radius:12px;border:1px solid var(--line);color:var(--fg);font-size:15px}
.vnote b{display:block;font-weight:600}
@media (hover:hover){.prow:hover{background:var(--chip)}}
`;

export type HomeStatus = { ready: number; fix: number; working: number };

export function homeV2(ui: UI, entries: Entry[], me: string, status: Record<string, HomeStatus>) {
  const now = Date.now();
  const mine = entries.filter((e) => e.owner === me).sort((a, b) => b.updatedAt - a.updatedAt);
  const others = entries.filter((e) => e.owner !== me);
  const forks = (slug: string) => entries.filter((e) => e.forkedFrom === slug).length;
  const st = (s?: HomeStatus) => {
    if (!s) return '';
    if (s.ready) return `<span class="st ready"><span class="dot s-ready"></span>${s.ready} ready to merge</span>`;
    if (s.fix) return `<span class="st"><span class="dot s-fix"></span>${s.fix} need${s.fix > 1 ? '' : 's'} a fix</span>`;
    if (s.working) return `<span class="st"><span class="dot s-working"></span>${s.working} in progress</span>`;
    return '';
  };
  const row = (e: Entry, withStatus: boolean) => `<div class="prow"><a class="t stretch" href="${path(e.slug)}"><span class="o">${esc(e.owner)} /</span> <b>${esc(e.name)}</b></a>
${e.description ? `<div class="d">${esc(e.description)}</div>` : ''}
<div class="m">${withStatus ? st(status[e.slug]) : ''}${freshTag(e.updatedAt, now, STEPS)}${!withStatus && forks(e.slug) ? `<span>${forks(e.slug)} fork${forks(e.slug) > 1 ? 's' : ''}</span>` : ''}${e.importedFrom ? `<span>${e.importedFrom.stars >= 1000 ? (e.importedFrom.stars / 1000).toFixed(1) + 'k' : e.importedFrom.stars} stars</span>` : ''}</div></div>`;
  return shell2(ui, 'forq', `<main>
<header class="top"><a class="home" href="/">forq<span class="vtag">Variant ${ui.toUpperCase()}: ${NAMES[ui]}</span></a><span class="tr">${me ? `<a class="chipbtn" href="/import">Import</a><a class="me" href="/settings">${esc(me)}</a>` : `<a class="chipbtn" href="/login">Sign in</a>`}</span></header>
${ui === 'c' ? `<a class="vnote" href="/design-fixture"><b>The views design lives inside a project.</b> Open any project below, or see the sample with every state</a>` : ''}
${mine.length ? '' : `<p class="hero">Projects that run, and agents that change them.</p><p class="sub">Open one to use it. Fork it, then ask for a change in plain words.</p>`}
${mine.length ? `<h2>Your projects</h2><div class="rows">${mine.map((e) => row(e, true)).join('')}</div>` : ''}
<h2>${mine.length ? 'Explore' : 'Projects'}</h2><div class="rows">${others.map((e) => row(e, false)).join('') || '<p class="empty">Nothing here yet.</p>'}</div>
<p class="foot"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/feedback">Feedback</a></p></main>`, HOME_CSS, 'home');
}

export function projectV2(ui: UI, o: ProjectArgs) {
  return ui === 'a' ? projectA(o) : ui === 'b' ? projectB(o) : projectC(o);
}

export function liveV2(ui: UI, info: ProjectInfo, router: BoxStatus, status: Record<string, BoxStatus>, runBase: string) {
  const { open, done } = changesOf(info, status, runBase);
  const plan = planningOf(info, router);
  if (ui === 'a') return liveA(info, open, done, plan);
  if (ui === 'b') return liveB(info, open, done, plan);
  return liveC(info, [...done.slice(0, 12).reverse(), ...open.slice().reverse()].sort((x, y) => x.a.createdAt - y.a.createdAt), plan);
}

// ---- Fixture: every change state at once, for design review (variant hosts only) ----

export function fixtureV2(ui: UI, runBase: string, mode: string) {
  const f = fixtureData(runBase, mode);
  return projectV2(ui, { info: f.info, entry: f.entry, forks: [], overview: f.overview, me: 'eyal', runBase, liveHtml: liveV2(ui, f.info, f.router, f.status, runBase) });
}

/** Sample data with every change state at once (design review on the variant hosts). */
export function fixtureData(runBase: string, mode: string) {
  const now = Date.now();
  const m = 60_000;
  const ask = "Two changes: a switch that rounds each person's share up to the next whole number, and a Copy button next to the per-person amount.";
  const mk = (id: string, task: string, extra: Partial<Agent>): Agent => ({ id: `eyal.tipsplit--${id}`, task, fork: 'eyal.tipsplit', remote: '', createdAt: now - 20 * m, state: 'working', ...extra });
  const agents: Agent[] = mode === 'empty' ? [] : [
    mk('m1', 'Add a dark theme that follows the system setting.', { state: 'merged', createdAt: now - 3 * 86400_000, note: 'Dark theme via prefers-color-scheme; all colours moved to CSS variables.', noteAt: now - 3 * 86400_000 }),
    mk('m2', 'Remember the last tip percentage between visits.', { state: 'merged', createdAt: now - 26 * 3600_000, note: 'Saved in localStorage, restored on load.', noteAt: now - 26 * 3600_000 }),
    mk('r1', 'Add a toggle that rounds each person\'s share up to the next whole number, and show how much extra that adds.', { state: 'pushed', request: ask, createdAt: now - 14 * m, note: 'Added a "Round up each share" switch; shows the extra in a row under Total.', noteAt: now - 4 * m, review: { state: 'approved', at: now - 2 * m, notes: 'Works at phone size: 3 people on 47.50 with 15% gives 19 each and 2.38 extra. Toggle state is clear.' } }),
    mk('f1', 'Add a Copy button next to the per-person amount that copies it to the clipboard.', { state: 'pushed', request: ask, createdAt: now - 14 * m, note: 'Copy button next to Each, with a "Copied" confirmation.', noteAt: now - 5 * m, review: { state: 'changes', at: now - 1 * m, notes: 'The button overlaps the amount on a 360 px screen. Move it under the amount or shrink the label.' } }),
    ...(mode === 'full' ? [
      mk('c1', 'Show the bill split as a short text you can paste into a group chat.', { state: 'pushed', request: 'Make it easy to send the split to friends', createdAt: now - 9 * m, note: 'Added "Share text" with the per-person line.', noteAt: now - 1 * m, review: { state: 'reviewing', at: now - 40_000 } }),
      mk('w1', 'Add a currency picker with EUR, USD, GBP and ILS.', { request: 'Make it easy to send the split to friends', createdAt: now - 3 * m }),
      mk('b1', 'Support splitting unevenly by item.', { state: 'blocked', request: 'Uneven splits', createdAt: now - 30 * m, note: 'Should items be typed in, or picked from a photo of the receipt?', noteAt: now - 20 * m }),
    ] : []),
  ];
  const info: ProjectInfo = { slug: 'eyal.tipsplit', owner: 'eyal', name: 'tipsplit', description: 'Split a bill: amount, tip, people.', repo: 'eyal.tipsplit', remote: '', forkedFrom: 'forq.tipsplit', createdAt: now - 5 * 86400_000, entry: '', kind: 'static', agents,
    lastRequest: mode === 'planning' ? { text: 'Add a history of past bills', at: now - 12_000, state: 'sent', sentAt: now - 9_000 } : mode === 'empty' ? undefined : { text: 'Make it easy to send the split to friends', at: now - 9 * m, state: 'sent', sentAt: now - 9 * m } };
  const busy = { awake: true, taskSent: true, cc: 'working' } as BoxStatus;
  const status: Record<string, BoxStatus> = { 'eyal.tipsplit--w1': busy, 'eyal.tipsplit--b1': { awake: true, taskSent: true, cc: 'idle' } };
  const router: BoxStatus = mode === 'planning' ? busy : { awake: false, cc: 'asleep' };
  const entry: Entry = { slug: info.slug, owner: 'eyal', name: 'tipsplit', description: info.description, forkedFrom: 'forq.tipsplit', createdAt: info.createdAt, updatedAt: now - 4 * m };
  const overview: Overview = { kind: 'static', entry: '', commits: [], files: [{ name: 'index.html', dir: false }, { name: 'README.md', dir: false }, { name: 'LICENSE', dir: false }], readme: '# Tip split\n\nSplit a restaurant bill: type the amount, pick a tip, set how many people. One HTML file, no dependencies.' };
  return { info, entry, overview, status, router };
}
