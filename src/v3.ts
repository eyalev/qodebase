// Design v3, "views" (variant C, 2026-10-02): a project is a set of views on
// the same thing, each at its own URL, switched from a bottom tab bar (a left
// rail on desktop). Views are a small registry: a new one is one entry here.
// Why: docs/design-v2.md ("Views").

import { siteHeader, type HeaderCtx } from './header';
import { JOIN_SPEECH } from './speechjoin';
import type { Entry } from './registry';
import type { ProjectInfo } from './project';
import type { BoxStatus, Overview } from './ui';
import { esc, path, label, STEPS, ownerLabel } from './ui';
import { freshTag } from './fresh';
import { markdown } from './md';
import { SHEET_HTML, shortId } from './sheet';
import { SPECULATE, WORLD_CSS, worldBody, type WorldTab } from './world';
import { CATALOG_CSS, ITEMS, catalogPage } from './catalog';
import { BUILD_CSS, buildBody } from './newproject';
import { workBody, workJs } from './landingui/view';
import {
  type Change, type ProjectArgs, type UI, ORDER, OPEN_ICON_C as OPEN_ICON, SEND, VISIT, BUSY,
  accentOf, appUrl, changeRow, changesOf, fixtureData, forkAction, FORK_JS, fromIssues, isMerge, keyNote, legend,
  noApp, pageJs, planningHtml, planningOf, primary, shell2,
  md,
} from './v2';

export type ViewId = 'readme' | 'changes' | 'app' | 'code' | 'history' | 'more' | 'agents' | 'errors' | 'work' | 'asks';
export const VIEW_IDS: ViewId[] = ['readme', 'changes', 'app', 'code', 'history', 'more', 'agents', 'errors', 'work', 'asks'];

/** The project's documents (README first) and the one being read. */
export type Docs = { list: { path: string; label: string }[]; current: string | null; text: string | null };

/** Which files count as documents, and in what order they are offered. */
export function docRank(path: string): number | null {
  const name = path.split('/').pop()!;
  const base = name.replace(/\.[a-z]+$/i, '').toUpperCase();
  const isText = /\.(md|markdown|mdx|txt|rst)$/i.test(name) || /^(LICEN[CS]E|COPYING|AUTHORS|NOTICE|CHANGELOG|CHANGES)$/i.test(name);
  if (!isText) return null;
  if (path.includes('/')) return /\.(md|markdown)$/i.test(name) ? 5 : null;
  if (base === 'README') return 0;
  if (base === 'CONTRIBUTING') return 1;
  if (/^(CHANGELOG|CHANGES|HISTORY|NEWS|RELEASES)$/.test(base)) return 2;
  if (/^(AGENTS|CLAUDE)$/.test(base)) return 3;
  if (/^(LICEN[CS]E|COPYING|NOTICE)$/.test(base)) return 9;
  return 4;
}
export const docLabel = (path: string) => path.replace(/\.(md|markdown|mdx|txt|rst)$/i, '');

/** Everything a view can draw from. Statuses are only fetched for the owner. */
export type Ctx = ProjectArgs & {
  own: boolean; worker: boolean; base: string;
  status: Record<string, BoxStatus>; router: BoxStatus; reviewer: BoxStatus;
  open: Change[]; done: Change[]; plan: ReturnType<typeof planningOf>; tryAgent?: string; docs?: Docs;
};

type View = {
  id: ViewId; label: string; short?: string; icon: string; tab?: boolean; desc?: string;
  when: (c: Ctx) => boolean;
  href?: (c: Ctx) => string;
  render?: (c: Ctx) => { body: string; action?: string; compose?: string; js?: string; poll?: boolean; full?: boolean };
};

const I = (d: string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  changes: I('<path d="M4 5h16v11H9l-5 4z"/>'),
  app: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>'),
  code: I('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>'),
  history: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  asks: I('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="m3.5 6.5 1.2 1.2 2.3-2.4M3.5 12l1.2 1.2 2.3-2.4"/><circle cx="5" cy="17.5" r="1.3"/>'),
  more: I('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  agents: I('<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
  errors: I('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>'),
  about: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
  readme: I('<path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M8.5 13h7M8.5 16.5h5"/>'),
  work: I('<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7M17.5 14v7"/>'),
};

export const needsOf = (open: Change[]) => open.filter((c) => primary(c));

/** About, Privacy, Feedback. Feedback carries the page it was sent from (baseline: /feedback?from=). */
export const FOOT = `<p class="foot3"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/feedback" data-fb>Feedback</a></p>
<script>for(const a of document.querySelectorAll('a[data-fb]'))a.href='/feedback?from='+encodeURIComponent(location.pathname+location.search);</script>`;

/** How the site navigates (2026-10-02, two to compare):
 *  'a': home pages get their own bottom bar (Projects, Inbox, Explore, Account);
 *       inside a project the bottom bar is the project's views, "‹ forq" goes back.
 *  'b': one global bottom bar everywhere; a project's views are tabs at the top.
 *  'c': no home tabs (the first views build).
 *  'd': the global tabs at the top everywhere; a project's views at the bottom. */
export type Nav = 'a' | 'b' | 'c' | 'd';
export type Global = { nav: Nav; inbox: number };

// ---- the views ---------------------------------------------------------------

/** The "Ask for a change" box. On your own project it sits above the tabs on every
 *  view, not only Changes (Eyal, 2026-10-04: after forking he landed on the README
 *  and could not tell how to change anything); sent from another view, it goes on to
 *  Changes, where the work shows. */
const askBox = (c: Ctx) => c.needsKey ? `<div class="compose">${keyNote}</div>` : `<div class="compose"><form class="ask"><textarea rows="1" placeholder="Ask for a change" enterkeyhint="send" aria-label="Ask for a change"></textarea>${SEND}</form></div>${c.own ? '<script src="/lab/attach.js" defer></script>' : ''}`;

/** Changes: what is in progress, as a conversation, newest at the bottom. */
function changesView(c: Ctx) {
  return {
    body: `<div class="thread"><div class="tin" id="live">${liveChanges(c)}</div></div>`,
    compose: askBox(c),
    poll: true,
    // Your message and a "Sending" line appear at the bottom at once; the poll replaces both.
    js: `window.forqAsked=(t)=>{const th=document.getElementById('live');for(const p of th.querySelectorAll('.plan,.hello'))p.remove();const e=document.createElement('div');e.className='you';e.textContent=t;th.appendChild(e);th.insertAdjacentHTML('beforeend','<div class="plan busy">Sending</div>');};`,
  };
}

type Group = { text: string; at: number; changes: Change[] };

export function liveChanges(c: Ctx) {
  const { info, open, done, plan } = c;
  const now = Date.now();
  const groups: Group[] = [];
  for (const ch of [...open].sort((x, y) => x.a.createdAt - y.a.createdAt)) {
    const text = ch.a.request || '';
    const g = groups.find((x) => x.text === text);
    if (g) g.changes.push(ch); else groups.push({ text, at: ch.a.createdAt, changes: [ch] });
  }
  const q = info.lastRequest;
  if (q && !isMerge(q.text) && !groups.some((g) => g.text === q.text) && (q.state !== 'sent' || plan.line || Date.now() - q.at < 15 * 60_000)) groups.push({ text: q.text, at: q.at, changes: [] });
  const accent = accentOf([...open].sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state)));
  // Estimated vs elapsed (qb6 stores the estimate shown at Build; /lab/est-bar.js draws it and ticks the clock).
  const est = (info as { estimate?: { startedAt?: number } }).estimate;
  const estBar = est?.startedAt ? `<div class="estmount" data-estbar="${esc(JSON.stringify({ e: est, p: (info as { progress?: unknown }).progress || null }))}"></div><script src="/lab/est-bar.js" defer></script>` : '';
  const out = groups.map((g, i) => {
    const you = !g.text ? '' : fromIssues(g.text)
      ? `<div class="you sys"><b>Cloudflare Issues reported an error</b>${esc(g.text.replace(/^Production error from Cloudflare Issues:\s*/, '').slice(0, 220))}</div>`
      : `<div class="you">${esc(g.text)}</div>`;
    const last = i === groups.length - 1;
    const tail = last && !(q && isMerge(q.text)) ? `${planningHtml(plan, q)}${plan.said ? `<div class="said">${md(plan.said)}</div>` : ''}` : '';
    return `${you}${g.changes.map((ch) => changeRow(info, ch, now, accent)).join('')}${tail}`;
  });
  if (q && isMerge(q.text)) out.push(planningHtml(plan, q));
  const landedWord = (info as { autoLand?: boolean }).autoLand ? 'landed' : 'merged';
  const merged = done.length ? `<a class="older" href="${c.base}/history">${done.length} ${landedWord} change${done.length > 1 ? 's' : ''} in History</a>` : '';
  // A copy you just made: say it is yours and what to do with it.
  const fresh = info.forkedFrom && !info.agents.length && !q;
  const empty = !out.join('').trim() ? fresh ? `<div class="hello"><b>This is your copy.</b><p>Forked from <a href="/p/${esc(info.forkedFrom!.replace('.', '/'))}">${esc(info.forkedFrom!.replace('.', ' / '))}</a>. Say what to change below, in plain words: qodebase splits it into tasks, an agent does each one, and a reviewer checks it before you merge. The original is not touched.</p></div>` : `<div class="hello"><b>Nothing in progress.</b><p>Ask for a change in plain words. qodebase splits it into tasks, an agent does each one on its own fork, and a reviewer checks it before you merge.</p></div>` : '';
  return `<template id="needs" data-n="${needsOf(open).length}"></template>${estBar}${merged}${empty}${out.join('')}`;
}

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };
/** The frame's address: the app's host, or for an agent's fork ('ag-<id>--name--owner…') whose version it is. */
const addrOf = (u: string) => { const h = hostOf(u); const m = /^ag-([a-z0-9]+)--/.exec(h); return m ? `Agent ${m[1]}'s version` : h; };
const SHOT_ICON = `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 5.5h2.5L6 3.5h4l1.5 2H14v7.5H2z"/><circle cx="8" cy="9" r="2.3"/></svg>`;
const PICK_ICON = `<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 2.5l9.5 4-4 1.5-1.5 4z"/><path d="M8.5 8.5l4 4"/></svg>`;

/** App: the running app, with a picker for Live or any change you can try. */
function appView(c: Ctx) {
  const app = appUrl(c);
  const tryable = c.own ? c.open.filter((ch) => ch.tryUrl) : [];
  const sel = tryable.find((ch) => shortId(ch.a.id) === c.tryAgent);
  const src = sel?.tryUrl || app;
  const picker = tryable.length ? `<div class="pick" role="tablist"><button type="button" role="tab" data-pick="${esc(app)}" class="${sel ? '' : 'on'}">Live</button>${tryable.map((ch) =>
    `<button type="button" role="tab" data-pick="${esc(ch.tryUrl!)}" data-agent="${esc(shortId(ch.a.id))}" data-state="${ch.state}"${ch.auto ? ' data-auto="1"' : ''} data-id="${esc(ch.a.id)}" data-word="${esc(ch.word)}" class="${sel === ch ? 'on' : ''}"><span class="dot s-${ch.state}"></span>${esc(ch.title)}</button>`).join('')}</div>
<div class="pstrip" id="pstrip"${sel ? '' : ' hidden'}><span id="pword">${sel ? esc(sel.word) : ''}</span><button type="button" class="btn" id="pmerge"${sel?.state === 'ready' && !sel.auto ? '' : ' hidden'}>Merge</button></div>` : '';
  return {
    full: true,
    // Eyal, 2026-10-12: the running app must read as a VIEW of his app inside qodebase, so it sits in a framed
    // card with its own strip (address, Pick, Shot, open); qodebase's controls stay outside the frame.
    action: '',
    body: `${picker}${app ? `<div class="appwrap"><div class="appframe" id="appframe"><div class="afbar">
<a class="afurl" id="afurl" href="${esc(src)}" target="_blank" rel="noopener" aria-label="Open your app in a new tab" title="${esc(hostOf(src))}"><span>${esc(addrOf(src))}</span></a>
<span class="afpick" id="pickhint" hidden role="status">Tap something in your app</span>
${c.own ? `<button type="button" class="afb" id="qbpick" aria-pressed="false" aria-label="Pick an element in your app to add to your message">${PICK_ICON}<span>Pick</span></button><button type="button" class="afb" id="qbshot" aria-label="Take a screenshot of your app and add it to your message">${SHOT_ICON}<span>Shot</span></button><button type="button" class="afb afdone" id="pickdone" hidden>Done</button>` : ''}<a class="afb" id="ext" href="${esc(src)}" target="_blank" rel="noopener" aria-label="Open your app in a new tab">${OPEN_ICON}</a></div>
<iframe id="app" src="${esc(src)}" title="${esc(c.info.name)}, your app"></iframe></div></div>` : noApp(c)}${c.own ? '' : `<div class="forkbar">${VISIT}${forkAction(c.info, c.me, c.forks.filter((e) => e.owner === c.me))}</div>`}`,
    js: `(function(){const f=document.getElementById('app'),x=document.getElementById('ext'),ps=document.getElementById('pstrip'),pm=document.getElementById('pmerge');let cur=null;
// Pick (S2): the app host injects its picker only with ?__qbpick=1 (qb6); we switch it on and off by postMessage
// to the app's origin and take picks only from that origin. Each pick becomes a chip in the composer (attach.js).
const pb=document.getElementById('qbpick'),ph=document.getElementById('pickhint');let picking=false;
const appOrigin=()=>{try{return new URL(f.src).origin;}catch(e){return null;}};
const withPick=(u)=>{try{const x=new URL(u);x.searchParams.set('__qbpick','1');return x.toString();}catch(e){return u;}};
const say=(on)=>{const o=appOrigin();if(o&&f.contentWindow)f.contentWindow.postMessage({type:'qb-pick',on:on},o);};
const fr=document.getElementById('appframe'),au=document.getElementById('afurl'),pd=document.getElementById('pickdone'),sh=document.getElementById('qbshot');
function setPick(on){picking=on;if(pb){pb.setAttribute('aria-pressed',String(on));pb.classList.toggle('on',on);pb.hidden=on;}if(ph)ph.hidden=!on;if(au)au.hidden=on;if(pd)pd.hidden=!on;if(sh)sh.hidden=on;if(fr)fr.classList.toggle('picking',on);
 if(on){if(!/[?&]__qbpick=1/.test(f.src)){f.addEventListener('load',()=>say(picking),{once:true});f.src=withPick(f.src);}else say(true);}else say(false);
 console.log(JSON.stringify({module:'pick',event:on?'on':'off'}));}
if(pb)pb.addEventListener('click',()=>setPick(!picking));
document.getElementById('pickdone')?.addEventListener('click',()=>setPick(false));
let lastSel=null;
addEventListener('message',(e)=>{const d=e.data;if(!d||d.type!=='qb-picked'||e.origin!==appOrigin())return;
 console.log(JSON.stringify({module:'pick',event:'picked',selector:d.selector,tag:d.tag}));lastSel=d.selector||null;
 if(window.qbAddPick)window.qbAddPick(d);});
// Screenshot (S3): Cloudflare Browser Rendering on the server (qb6) shoots the app at 390 px, the last picked
// element outlined, and keeps it as an attachment; it becomes an image chip like a photo.
const sb2=document.getElementById('qbshot');
if(sb2)sb2.addEventListener('click',async()=>{const lab=sb2.querySelector('span');sb2.disabled=true;lab.textContent='Shooting\u2026';const pend=window.qbPendingAttachment?window.qbPendingAttachment('Taking a screenshot…'):null;
 const url=(()=>{try{const x=new URL(f.src);x.searchParams.delete('__qbpick');return x.toString();}catch(e){return f.src;}})();
 try{const r=await fetch(API+'/screenshot',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:url,selector:lastSel||undefined,width:390})});const d=await r.json().catch(()=>({}));
  console.log(JSON.stringify({module:'shot',event:'done',status:r.status,id:d.id||null}));
  if(!r.ok||!d.id)throw new Error(d.error||('Screenshot failed ('+r.status+')'));
  if(pend)pend.done({id:d.id,name:'screenshot.png'});else if(window.qbAddAttachment)window.qbAddAttachment({id:d.id,name:'screenshot.png'});lab.textContent='Shot';}
 catch(err){lab.textContent='Shot';sb2.title=err.message;if(pend)pend.fail(err.message);const t=document.querySelector('form.ask textarea');if(t&&!t.value)t.placeholder=err.message;}
 sb2.disabled=false;});
document.addEventListener('click',async(e)=>{const b=e.target.closest('[data-pick]');if(b){f.src=b.dataset.pick;if(x)x.href=b.dataset.pick;{const a=document.getElementById('afurl');if(a){a.href=b.dataset.pick;try{const h=new URL(b.dataset.pick).host,m=/^ag-([a-z0-9]+)--/.exec(h);a.title=h;a.firstElementChild.textContent=m?'Agent '+m[1]+"'s version":h;}catch(_){}}}for(const o of document.querySelectorAll('[data-pick]'))o.classList.toggle('on',o===b);
 cur=b.dataset.id||null;if(ps){ps.hidden=!cur;document.getElementById('pword').textContent=b.dataset.word||'';pm.hidden=b.dataset.state!=='ready'||b.dataset.auto==='1';}
 history.replaceState(null,'',location.pathname+(b.dataset.agent?'?try='+b.dataset.agent:''));return;}
 if(e.target===pm){pm.disabled=true;pm.textContent='Merging';try{await post('merge',{agent:cur});location.href=location.pathname;}catch(err){pm.textContent=err.message;}}});
if(${JSON.stringify(sel?.a.id || '')})cur=${JSON.stringify(sel?.a.id || '')};})();`,
  };
}

/** History: what happened to the project, newest first, by day. */
/** Asks (github-parity G4): the agent-age issues list. The page fetches GET …/asks (qb6; anonymous on watch
 *  projects like /landing) and draws one row per ask: a state dot, the text, who asked, how many changes it became,
 *  duplicates folded under the ask they repeat. Tap a row for its changes (each opens its record in Agents at work). */
function asksView(c: Ctx) {
  const api = `/api/p/${encodeURIComponent(c.info.owner)}/${encodeURIComponent(c.info.name)}`;
  return { body: `<div class="pad asks"><h2 class="ah">Asks</h2><p class="lede">Every request the agents got, from a person, from Talk or from Cloudflare Issues, and every task on the list they share. Repeats are marked, so the same thing is not built twice.</p>
<div class="afil" role="group" aria-label="Show"></div><ul class="alist" id="alist"><li class="aempty">Loading the asks…</li></ul></div>
<style>${ASKS_CSS}</style><script>${ASKS_JS.replace('%API%', api).replace('%BASE%', c.base)}</script>` };
}
const ASKS_CSS = `.asks .ah{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:4px 0 6px}
.afil{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.afil button{min-height:40px;padding:0 12px;border:0;border-radius:10px;background:var(--chip);color:var(--fg);font:500 14px 'Geist',sans-serif;cursor:pointer}
.afil button[aria-pressed="true"]{background:var(--fg);color:var(--bg)}
.afil b{font-variant-numeric:tabular-nums;margin-left:4px;font-weight:600}
.alist{list-style:none;margin:0;padding:0}
.alist>li{box-shadow:inset 0 -1px 0 var(--line)}
.alist>li:last-child{box-shadow:none}
.arow{display:grid;grid-template-columns:auto 1fr auto;gap:2px 10px;align-items:baseline;width:100%;padding:12px 0;min-height:44px;border:0;background:none;color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.arow .t{font-size:15px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.arow .w{font-size:13px;color:var(--dim);white-space:nowrap}
.arow .m{grid-column:2/-1;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px;color:var(--dim)}
.adot{width:9px;height:9px;border-radius:50%;background:var(--dim);transform:translateY(-1px)}
.adot.working{background:var(--busy)}.adot.in-line{background:var(--fg)}.adot.landed{background:var(--acc)}.adot.bounced{background:var(--warn)}.adot.planning{background:transparent;box-shadow:inset 0 0 0 1.5px var(--dim)}
.adup{font-size:13px;color:var(--dim);margin:-4px 0 10px 19px}
.adup b{font-weight:500;color:var(--fg)}
.achg{list-style:none;margin:0 0 12px 19px;padding:0}
.achg a{display:flex;gap:8px;align-items:center;min-height:44px;color:var(--acc);text-decoration:none;font-size:14px}
.achg .w{color:var(--dim);font-size:13px;margin-left:auto}
.aempty{padding:16px 0;color:var(--dim);font-size:15px}
@media (hover:hover){.arow:hover{background:color-mix(in srgb,var(--chip) 60%,transparent)}}`;
const ASKS_JS = `(function(){
var API='%API%',BASE='%BASE%',list=document.getElementById('alist'),fil=document.querySelector('.afil'),data=null,show='all',open={},titles=null;
var FROM={person:'A person',talk:'Talk',issues:'Cloudflare Issues',board:'The task list',script:'The demo script'};
var WORD={planning:'Planning',working:'Working','in-line':'In line',landed:'Landed',bounced:'Sent back',mixed:'In progress',pushed:'In review',reviewing:'In review',queued:'In line',testing:'Being tested',replaying:'Replaying','with-lead':'With its lead'};
// Change titles come from the landing view, fetched once, the first time a row is opened.
function loadTitles(){if(titles)return;titles={};fetch(API+'/landing',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){(j&&j.changes||[]).forEach(function(c){titles[c.id]=String(c.title||c.intent||'').split('. ')[0]});render()}).catch(function(){})}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function ago(t){if(!t)return'';var s=Math.max(0,Math.round((Date.now()-t)/1000));return s<60?'just now':s<3600?Math.floor(s/60)+' min ago':s<86400?Math.floor(s/3600)+' h ago':Math.floor(s/86400)+' d ago'}
function open_(a){return a.state!=='landed'}
function render(){
 if(!data){return}
 var asks=data.asks||[],byId={};asks.forEach(function(a){byId[a.id]=a});
 var dups=asks.filter(function(a){return a.duplicateOf});
 var main=asks.filter(function(a){return!a.duplicateOf});
 var n={all:main.length,open:main.filter(open_).length,landed:main.filter(function(a){return a.state==='landed'}).length,dups:dups.length};
 fil.innerHTML=[['all','All'],['open','Open'],['landed','Landed'],['dups','Repeats']].filter(function(x){return x[0]!=='dups'||n.dups}).map(function(x){return'<button type="button" data-f="'+x[0]+'" aria-pressed="'+(show===x[0])+'">'+x[1]+'<b>'+n[x[0]]+'</b></button>'}).join('');
 var rows=show==='dups'?dups:main.filter(function(a){return show==='all'||(show==='open'?open_(a):a.state==='landed')});
 if(!rows.length){list.innerHTML='<li class="aempty">'+(asks.length?'Nothing here.':'No asks recorded yet. Requests to the router and tasks on the list show up here.')+'</li>';return}
 list.innerHTML=rows.sort(function(a,b){return(b.at||0)-(a.at||0)}).map(function(a){
  var ch=a.changes||[],reps=asks.filter(function(d){return d.duplicateOf===a.id});
  var meta=[FROM[a.from]||a.from||'',ch.length?ch.length+' change'+(ch.length===1?'':'s'):'',ago(a.at)].filter(Boolean).map(function(x){return'<span>'+esc(x)+'</span>'}).join('');
  var dupOf=a.duplicateOf&&byId[a.duplicateOf]?'<p class="adup">Same as <b>'+esc(byId[a.duplicateOf].text)+'</b></p>':'';
  var repl=reps.length&&!(a.aliases||[]).length?'<p class="adup">Asked again '+reps.length+'×'+(reps[0].text&&reps[0].text!==a.text?' as <b>'+esc(reps[0].text)+'</b>':'')+'</p>':'';
  var al=(a.aliases||[]).length?'<p class="adup">Also called <b>'+(a.aliases||[]).map(esc).join('</b>, <b>')+'</b></p>':'';
  var cs=a.changeStates||{};var chl=open[a.id]&&ch.length?'<ul class="achg">'+ch.map(function(c){var id=typeof c==='string'?c:c.id,t=(titles&&titles[id])||'',w=WORD[cs[id]]||cs[id]||'';return'<li><a href="'+BASE+'/work#/change/'+encodeURIComponent(id)+'">'+esc(t||('#'+String(id).split('--').pop()))+'<span class="w">'+esc(w)+'</span></a></li>'}).join('')+'</ul>':'';
  return'<li><button type="button" class="arow" data-a="'+esc(a.id)+'" aria-expanded="'+!!open[a.id]+'"><i class="adot '+esc(a.state||'')+'"></i><span class="t">'+esc(a.text)+'</span><span class="w">'+esc(a.delivery==='failed'?'Not delivered':a.delivery==='waking'?'Waking the router':(WORD[a.state]||''))+'</span><span class="m">'+meta+'</span></button>'+dupOf+repl+al+chl+'</li>'}).join('');
}
fil.addEventListener('click',function(e){var b=e.target.closest('[data-f]');if(b){show=b.dataset.f;render()}});
list.addEventListener('click',function(e){var b=e.target.closest('[data-a]');if(b){open[b.dataset.a]=!open[b.dataset.a];loadTitles();render()}});
function load(){fetch(API+'/asks',{cache:'no-store'}).then(function(r){if(r.status===404)return{asks:[],missing:true};return r.ok?r.json():null}).then(function(j){if(!j){list.innerHTML='<li class="aempty">Could not load the asks. Pull to refresh.</li>';return}data=j;render()}).catch(function(e){console.log(JSON.stringify({event:'asks_load_failed',error:String(e)}))})}
load();setInterval(function(){if(!document.hidden)load()},15000);
})();`;

type Landed = { id: string; title?: string; intent?: string; agent?: string; verdict?: 'approved' | 'auto' | 'changes' | null; reviewer?: string; replayed?: boolean; how?: 'clean' | 'handler' | 'model' | null; stackedOn?: string; landedAt?: number };
/** G2: the one-line 'why' under a landed commit: its intent, how it was reviewed, how it landed (qb6's info.landed). */
function whyLine(l: Landed) {
  const intent = (l.intent || l.title || '').replace(/\s+/g, ' ').trim();
  const short = intent.length > 110 ? `${intent.slice(0, 107).replace(/\s+\S*$/, '')}…` : intent;
  const rv = l.verdict === 'auto' ? 'auto-approved (scripted)' : l.verdict === 'approved' ? `reviewed${l.reviewer ? ` by ${l.reviewer}` : ''}` : l.verdict === 'changes' ? 'landed after a requested fix' : '';
  const how = l.replayed || l.how === 'handler' || l.how === 'model' ? `replayed on the newest code${l.how === 'model' ? ' by a model' : ''}` : '';
  return [short && `Why: ${short}`, rv, how].filter(Boolean).join('; ');
}
function historyView(c: Ctx) {
  const now = Date.now();
  type Item = { at: number; html: string };
  const items: Item[] = [];
  const landed = ((c.info as { landed?: Record<string, Landed> }).landed) || {};
  const byId = new Map(Object.values(landed).map((l) => [l.id, l] as const));
  const lookup = (hash: string) => landed[hash] || Object.entries(landed).find(([k]) => k.startsWith(hash) || hash.startsWith(k))?.[1];
  const record = (id: string) => `/p/${c.info.owner}/${c.info.name}/work#/change/${encodeURIComponent(id)}`;
  for (const ch of c.done) if (byId.has(ch.a.id)) { const l = byId.get(ch.a.id)!; items.push({ at: l.landedAt || ch.a.noteAt || ch.a.createdAt, html: `<a class="hrow" href="${record(ch.a.id)}"><span class="k">Landed</span><span class="t">${esc(ch.title)}</span><span class="why">${esc(whyLine(l))}</span></a>` }); } else items.push({ at: ch.a.noteAt || ch.a.createdAt, html: `<span class="k">Merged</span><span class="t">${esc(ch.title)}</span><a class="sub" href="/p/${c.info.owner}/${c.info.name}/changes/${shortId(ch.a.id)}">See the code</a>` });
  for (const cm of c.overview.commits) {
    if (/^Merge /.test(cm.message)) continue;
    const l = lookup(cm.hash);
    if (l && c.done.some((ch) => ch.a.id === l.id)) continue;   // already listed as its change, above
    items.push({ at: cm.at, html: l
      ? `<a class="hrow" href="${record(l.id)}"><span class="k">Commit</span><span class="t">${esc(cm.message)}</span><span class="why">${esc(whyLine(l))}</span><code class="sub">${esc(cm.hash.slice(0, 7))}</code></a>`
      : `<span class="k">Commit</span><span class="t">${esc(cm.message)}</span><code class="sub">${esc(cm.hash.slice(0, 7))}</code>` });
  }
  const dep = c.overview.app ?? c.info.app;
  if (dep?.status === 'live') items.push({ at: dep.at, html: `<span class="k">Deployed</span><span class="t"><a href="${esc(dep.url || '')}" target="_blank" rel="noopener">${esc((dep.url || '').replace('https://', ''))}</a></span>` });
  for (const f of c.forks) items.push({ at: f.createdAt, html: `<span class="k">Forked</span><span class="t"><a href="${path(f.slug)}">${esc(label(f.slug))}</a></span>` });
  items.push({ at: c.info.createdAt, html: `<span class="k">${c.info.forkedFrom ? 'Forked from' : c.info.importedFrom ? 'Imported' : 'Created'}</span><span class="t">${c.info.forkedFrom ? `<a href="${path(c.info.forkedFrom)}">${esc(label(c.info.forkedFrom))}</a>` : c.info.importedFrom ? `<a href="${esc(c.info.importedFrom.url)}" rel="noopener">${esc(c.info.importedFrom.fullName)}</a>` : esc(c.info.name)}</span>` });
  items.sort((a, b) => b.at - a.at);
  const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  let last = '';
  const rows = items.map((it) => { const d = day(it.at); const h = d !== last ? `<h3>${d}</h3>` : ''; last = d; return `${h}<div class="hi">${it.html}${freshTag(it.at, now, STEPS)}</div>`; }).join('');
  return { body: `<div class="pad">${rows}</div>` };
}

/** Agents: the machinery, for when you want it. */
function agentsView(c: Ctx) {
  return { body: `<div class="pad" id="live">${liveAgents(c)}</div>`, poll: true };
}
export function liveAgents(c: Ctx) {
  const { info, router, reviewer, open, plan } = c;
  const row = (id: string, name: string, word: string, busy: boolean, sub = '') => `<div class="ag${busy ? ' busy' : ''}"><div class="agh"><span class="dot ${busy ? 's-working' : ''}"></span><b>${esc(name)}</b><span class="w">${word}</span></div>${sub}
<div class="acts"><button type="button" class="chipbtn" data-sheet="${esc(id)}" data-name="${esc(name)}" data-mode="chat">Chat</button><button type="button" class="chipbtn" data-sheet="${esc(id)}" data-name="${esc(name)}" data-mode="term">Terminal</button></div></div>`;
  const doing = info.agents.find((a) => a.review?.state === 'reviewing');
  const st = (s: BoxStatus) => (s.awake ? (BUSY.test(s.cc) ? 'Working' : 'Idle') : 'Asleep');
  return `<p class="lede">Every change is made by its own agent, on its own fork, in its own container. These are their conversations and terminals.</p>
${row(`${info.slug}--router`, 'Router agent', plan.line || st(router), !!plan.line || BUSY.test(router.cc), '<p class="sub">Reads your requests and starts one agent per task. Does the merges.</p>')}
${row(`${info.slug}--review`, 'Reviewer agent', doing ? 'Reviewing' : st(reviewer), !!doing, '<p class="sub">Tries every push in a preview before you merge.</p>')}
${open.length ? '<h3>Change agents</h3>' : ''}${open.map((ch) => row(ch.a.id, ch.title, `${esc(ch.word)} <code>${esc(shortId(ch.a.id))}</code>`, ch.busy)).join('')}`;
}

/** Errors (Worker projects): production errors from Cloudflare Issues and their fixes. */
function errorsView(c: Ctx) {
  const now = Date.now();
  const all = [...c.open, ...c.done].filter((ch) => fromIssues(ch.a.request)).sort((x, y) => y.a.createdAt - x.a.createdAt);
  const q = c.info.lastRequest;
  const pending = q && fromIssues(q.text) && !all.some((ch) => ch.a.request === q.text)
    ? `<div class="you sys"><b>Reported ${freshTag(q.at, now, STEPS)}</b>${esc(q.text.replace(/^Production error from Cloudflare Issues:\s*/, '').slice(0, 300))}</div>${planningHtml(c.plan, q)}` : '';
  return { body: `<div class="pad"><p class="lede">When this app throws errors in production, Cloudflare Issues reports them here and the router agent starts a fix: it reproduces the error first, then hands it to an agent.</p>
${pending}${all.map((ch) => changeRow(c.info, ch, now, accentOf(c.open))).join('') || (pending ? '' : '<p class="empty">No production errors reported.</p>')}</div>` };
}

/** Readme, the first view: what this project is, its README, and its other documents. */
function readmeView(c: Ctx) {
  const { info, forks } = c;
  const d = c.docs || { list: [], current: null, text: null };
  const cur = d.current;
  const chips = d.list.length > 1 ? `<nav class="docs" aria-label="Documents">${d.list.map((x) =>
    `<a href="${c.base}/readme${x.path === d.list[0].path ? '' : `?doc=${encodeURIComponent(x.path)}`}" class="${x.path === cur ? 'on' : ''}"${x.path === cur ? ' aria-current="page"' : ''}>${esc(x.label)}</a>`).join('')}</nav>` : '';
  const isMd = cur && /\.(md|markdown|mdx)$/i.test(cur);
  const doc = !cur ? `<p class="empty">This project has no README yet.${c.own ? ' Ask for one in <a href="' + c.base + '/changes">Changes</a>.' : ''}</p>`
    : d.text == null ? `<p class="empty">This file could not be shown. <a href="/p/${info.owner}/${info.name}/code/${esc(cur)}">Open it in Code</a>.</p>`
    : isMd ? `<div class="readme">${markdown(d.text)}</div>` : `<pre class="plain">${esc(d.text)}</pre>`;
  const origin = [info.forkedFrom ? `Forked from <a href="${path(info.forkedFrom)}">${esc(label(info.forkedFrom))}</a>` : '',
    info.importedFrom ? `From <a href="${esc(info.importedFrom.url)}" rel="noopener">${esc(info.importedFrom.fullName)}</a> on GitHub` : '',
    forks.length ? `${forks.length} fork${forks.length > 1 ? 's' : ''}` : ''].filter(Boolean);
  return { body: `<div class="pad">${info.description ? `<p class="big">${esc(info.description)}</p>` : ''}${origin.length ? `<p class="lede">${origin.join('. ')}.</p>` : ''}
${c.own ? '' : `<div class="forkbar in">${VISIT}${forkAction(info, c.me, forks.filter((e) => e.owner === c.me))}</div>`}
${chips}${doc}${cur ? `<p class="srcl"><a href="/p/${info.owner}/${info.name}/code/${esc(cur)}">${esc(cur)} in Code</a></p>` : ''}${FOOT}</div>` };
}


/** More: the views that do not fit the tab bar, plus the account. */
function moreMenu(c: Ctx) {
  const tabs = tabsFor(c).map((v) => v.id);
  const extra = VIEWS.filter((v) => !tabs.includes(v.id) && v.id !== 'more' && v.id !== 'changes' && v.when(c) && (v.desc || v.id === 'readme'))
    .map((v) => (v.id === 'readme' ? { ...v, desc: 'The project\'s README and other documents' } : v));
  return `${c.own ? visibilityRow(c) : ''}<div class="menu">${extra.map((v) => `<a class="mi" href="${c.base}/${v.id}">${v.icon}<span><b>${v.label}</b><span>${v.desc}</span></span></a>`).join('')}
<a class="mi" href="/settings">${ICONS.about}<span><b>Account</b><span>Your name${c.own ? '' : ', your Anthropic API key'}, sign out</span></span></a>
<a class="mi" href="/">${ICONS.app}<span><b>All projects</b><span>Your projects and Explore</span></span></a>
<a class="mi" href="/feedback" data-fb>${ICONS.changes}<span><b>Feedback</b><span>Something missing, confusing or broken? Tell us.</span></span></a></div>`;
}
function moreView(c: Ctx) {
  return { body: `<div class="pad">${moreMenu(c)}</div>` };
}
/** Owner: public or private (POST /api/p/<o>/<n>/visibility). */
function visibilityRow(c: Ctx) {
  const pv = !!c.info.private;
  return `<div class="visrow"><div><b>${pv ? `${LOCK} Private` : 'Public'}</b><span>${pv ? 'Only you can see this project, its code and its app.' : 'Anyone can see this project, try its app and fork it.'}</span></div>
<button type="button" class="chipbtn" data-visto="${pv ? 'public' : 'private'}">${pv ? 'Make public' : 'Make private'}</button></div>
<p class="err" data-vismsg role="status"></p>
<script>(function(){if(window.__visBound)return;window.__visBound=1;
// The menu can be on the page twice (the More view and the More sheet): one handler for every button.
document.addEventListener('click',async(e)=>{const b=e.target.closest&&e.target.closest('[data-visto]');if(!b)return;
document.querySelectorAll('[data-visto]').forEach((x)=>x.disabled=true);
const r=await fetch('/api/p/${esc(c.info.owner)}/${esc(c.info.name)}/visibility',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({private:b.dataset.to==='private'})});
if(r.ok)location.reload();else{document.querySelectorAll('[data-visto]').forEach((x)=>x.disabled=false);document.querySelectorAll('[data-vismsg]').forEach((m)=>m.textContent='Could not change it. Try again.');}});})();</script>`;
}

const VIEWS: View[] = [
  { id: 'readme', label: 'Readme', icon: ICONS.readme, tab: true, when: () => true, render: readmeView },
  { id: 'changes', label: 'Changes', icon: ICONS.changes, tab: true, when: (c) => c.own, render: changesView },
  { id: 'app', label: 'App', icon: ICONS.app, tab: true, when: () => true, render: appView },
  { id: 'code', label: 'Code', icon: ICONS.code, tab: true, when: () => true, href: (c) => `/p/${c.info.owner}/${c.info.name}/code/` },
  { id: 'more', label: 'More', icon: ICONS.more, tab: true, when: (c) => c.own, render: moreView },
  { id: 'history', label: 'History', icon: ICONS.history, desc: 'Merged changes, commits, deploys and forks, by day', when: () => true, render: historyView },
  { id: 'agents', label: 'Agents', icon: ICONS.agents, desc: 'The router, the reviewer and each change\'s agent: chat or terminal', when: (c) => c.own, render: agentsView },
  // Agents at work (qb7, src/landingui): many agents at once, the merge queue, who works where.
  { id: 'work', label: 'Agents at work', short: 'Agents', icon: ICONS.work, desc: 'Every agent changing the project at once: where they work, the line their changes wait in, how each landed', when: () => true,
    render: (c) => ({ body: workBody({ owner: c.info.owner, name: c.info.name, own: c.own }), js: workJs() }) },
  // Asks (G4, qb3): every request the agents got and every task on the board, with state, agent and duplicates.
  { id: 'asks', label: 'Asks', icon: ICONS.asks, desc: 'Every request the agents got and every task on the list: state, agents, duplicates', when: (c) => !!c.info.landing, render: asksView },
  { id: 'errors', label: 'Errors', icon: ICONS.errors, desc: 'Production errors from Cloudflare Issues and the fixes they started', when: (c) => c.worker, render: errorsView },
];

/** Tabs for this person: the owner's five, or a visitor's four (History instead of Changes and More). */
function tabsFor(c: Ctx) {
  const tabs = c.own ? VIEWS.filter((v) => v.tab && v.when(c)) : VIEWS.filter((v) => ['readme', 'app', 'code', ...(c.info.landing ? ['asks'] : []), 'history'].includes(v.id));
  // A landing-system project (qb6/qb7) leads with Agents at work in Readme's place; Readme stays under More.
  return c.info.landing ? tabs.map((v) => (v.id === 'readme' ? VIEWS.find((x) => x.id === 'work')! : v)) : tabs;
}

export function tabBar(c: Pick<Ctx, 'own' | 'base' | 'worker' | 'info'> & Partial<Ctx>, active: ViewId, needs: number, top = false) {
  const tabs = tabsFor(c as Ctx);
  return `<nav class="${top ? 'ptop' : 'tabbar'}" aria-label="Project views">${tabs.map((v) => {
    const on = v.id === active || (v.id === 'more' && !tabs.some((t) => t.id === active));
    const href = v.href ? v.href(c as Ctx) : `${c.base}/${v.id}`;
    // More opens a sheet over the current view; a second tap closes it (Eyal, 2026-10-02).
    if (v.id === 'more') return `<a href="${href}" class="tab${on ? ' on' : ''}" data-more aria-expanded="false" aria-controls="moresheet">${v.icon}<span>${v.label}</span></a>`;
    const badge = v.id === 'changes' && needs ? `<span class="badge" id="badge">${needs}</span>` : v.id === 'changes' ? '<span class="badge" id="badge" hidden></span>' : '';
    return `<a href="${href}" class="tab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''}${v.short ? ` aria-label="${v.label}"` : ''}>${v.icon}${badge}<span>${v.short || v.label}</span></a>`;
  }).join('')}</nav>`;
}

// ---- page ----------------------------------------------------------------------

export const V3_CSS = `
body.v3{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.h3{flex:none;display:flex;align-items:center;gap:4px;height:48px;padding:0 4px 0 4px;border-bottom:1px solid var(--line);background:var(--bg)}
.h3 .home{font-weight:600;color:var(--fg);min-height:44px;display:inline-flex;align-items:center;padding:0 10px}
.h3 .nm{flex:1;min-width:0;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.h3 .nm .o{color:var(--dim)}
.h3 .nm b{font-weight:600}
.hact{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;color:var(--fg)}
.hact .ico{width:18px;height:18px}
/* The app as a framed view inside qodebase: a 8 px surround in --chip, the frame with a --line border and the app
   preview radius (12 px, DESIGN.md), a strip on the frame with the address and the app's own controls. Pick mode:
   the border takes the accent and the strip asks for a tap. */
.appwrap{flex:1;min-height:0;display:flex;padding:8px;background:var(--chip)}
.appframe{flex:1;min-height:0;width:100%;max-width:1200px;margin:0 auto;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:var(--bg);box-shadow:0 0 0 1px var(--frame)}
.appframe.picking{box-shadow:0 0 0 2px var(--acc)}
.afbar{flex:none;display:flex;align-items:center;gap:4px;min-height:52px;padding:4px 4px 4px 12px;border-bottom:1px solid var(--frame);background:var(--chip)}
.afurl{flex:1;min-width:0;min-height:44px;display:flex;align-items:center;overflow:hidden;font-size:13px;color:var(--dim)}
.afurl span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:underline;text-decoration-color:var(--dim);text-underline-offset:3px}
.afpick{flex:1;font-size:14px;font-weight:600;color:var(--acc)}
.afb{flex:none;display:inline-flex;align-items:center;gap:6px;min-width:44px;min-height:44px;justify-content:center;padding:0 8px;border:0;border-radius:10px;background:none;color:var(--fg);font:inherit;font-size:14px;cursor:pointer}
.afb .ico{width:17px;height:17px}.afb:focus-visible,.afurl:focus-visible{outline:2px solid var(--acc);outline-offset:-2px}
.afdone{background:var(--acc);color:var(--acc-fg)}
.appframe iframe{flex:1;min-height:0;width:100%;border:0;display:block;background:#fff}
.ico{width:14px;height:14px;flex:none}
.view{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.view.full{display:flex;flex-direction:column;overflow:hidden}
.pad{padding:16px 16px 24px;max-width:760px;margin:0 auto}
.lede{color:var(--dim);font-size:14px;margin:0 0 16px}
.big{font-size:17px;margin:0 0 8px}
h3{font-size:13px;font-weight:600;color:var(--dim);margin:24px 0 8px}
.pad>h3:first-child{margin-top:4px}
/* Changes: a scroller that starts at the bottom without script (column-reverse). */
.thread{height:100%;overflow-y:auto;display:flex;flex-direction:column-reverse;overscroll-behavior:contain}
.tin{display:flex;flex-direction:column;gap:10px;padding:16px 12px 12px;max-width:760px;width:100%;margin:0 auto}
/* The estimate bar sits at the top of the view while the conversation stays at the bottom (the thread stacks
   from the bottom, so without this the bar floated mid-screen above a gap). */
.tin:has(.estmount){min-height:100%}.tin .estmount{margin-bottom:auto}
.tin>*{flex:none}
.you{align-self:flex-end;max-width:86%;background:var(--chip);color:var(--fg);border-radius:12px 12px 4px 12px;padding:10px 14px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px}
.you.sys{align-self:stretch;max-width:none;background:none;border:1px solid var(--line);border-radius:12px;font-size:14px}
.you.sys b{display:block;font-weight:600;margin-bottom:2px}
.older{align-self:center;font-size:13px;padding:8px 12px}
.hello{margin:auto 0 0;padding:24px 8px;color:var(--dim);font-size:15px}
.hello b{display:block;color:var(--fg);font-size:17px;margin-bottom:4px}
.hello p{margin:0}
.compose{flex:none;border-top:1px solid var(--line);padding:8px 12px;background:var(--bg)}
.compose .ask{display:flex;gap:8px;align-items:flex-end;max-width:760px;margin:0 auto}
.compose .ask textarea{flex:1;min-height:44px;max-height:160px;padding:10px 12px}
/* App */
.view.full iframe{flex:1;width:100%;border:0;display:block;background:#fff}
.pick{flex:none;display:flex;gap:6px;padding:8px 12px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--line)}
.pick::-webkit-scrollbar{display:none}
.pick button{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;max-width:min(70vw,280px);padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--dim);font:500 14px 'Geist',sans-serif;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pick button.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.pstrip{flex:none;display:flex;align-items:center;gap:8px;padding:6px 8px 6px 14px;background:var(--card);border-bottom:1px solid var(--line);font-size:14px;color:var(--dim)}
.pstrip span{flex:1}
.pstrip .btn{min-height:36px;padding:0 14px;font-size:14px}
.noapp{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:var(--dim)}
.forkbar{flex:none;padding:8px 12px;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
.forkbar.in{border:0;padding:0;margin:8px 0 0}
.forkbar .btn{width:100%}
/* History */
.hi{display:flex;align-items:baseline;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);font-size:15px}
.hi .k{flex:none;width:6.5em;color:var(--dim);font-size:13px}
/* G2: a landed commit is one tappable row (opens its change record) with a grey 'why' line under the title. */
.hi:has(>.hrow){display:block;padding:0}
.hrow{display:grid;grid-template-columns:6.5em 1fr;column-gap:10px;row-gap:2px;padding:10px 0;color:inherit;text-decoration:none;align-items:baseline}
.hrow .k{grid-row:1 / span 3}.hrow .t{color:var(--fg)}
.hrow .why{grid-column:2;font-size:13px;color:var(--dim)}
.hrow code.sub{grid-column:2;justify-self:start}
@media (hover:hover){.hrow:hover .t{text-decoration:underline;text-underline-offset:3px}}
.hrow:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.hi .t{flex:1;min-width:0;overflow-wrap:anywhere}
.hi .sub{display:none}
.hi code{font:12px 'JetBrains Mono',monospace;color:var(--dim)}
.hi button.fresh{flex:none}
@media (min-width:600px){.hi .sub{display:inline;font-size:13px;flex:none}}
/* Agents */
.ag{background:var(--card);border-radius:12px;padding:12px 14px;margin-bottom:8px}
.agh{display:flex;align-items:center;gap:8px;font-size:15px}
.agh b{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.agh .w{font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums;white-space:nowrap}
.agh code{font:12px 'JetBrains Mono',monospace}
.ag .sub{margin:4px 0 0;font-size:14px;color:var(--dim)}
.ag .acts{margin-top:10px}
/* More */
.menu{display:flex;flex-direction:column}
.mi{display:flex;align-items:center;gap:14px;padding:14px 4px;border-bottom:1px solid var(--line);color:var(--fg)}
.mi svg{flex:none;color:var(--dim)}
.mi b{display:block;font-weight:600}
.mi span span{display:block;color:var(--dim);font-size:14px}
/* Readme: the project's documents as a row of tabs over the rendered file. */
.docs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:16px -16px 8px;padding:0 16px 10px;border-bottom:1px solid var(--line)}
.docs::-webkit-scrollbar{display:none}
.docs a{flex:none;display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);color:var(--dim);font:500 14px 'Geist',sans-serif}
.docs a.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.plain{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.55 'JetBrains Mono',monospace;background:var(--card);border-radius:8px;padding:12px}
.srcl{font-size:13px;margin:24px 0 0}
.forkbar.in .visit{margin:0}
/* More: a sheet over the current view, toggled by its tab. */
.scrim3{position:fixed;inset:0;z-index:24;background:rgb(0 0 0 / .25);opacity:0;pointer-events:none;transition:opacity .2s}
.scrim3.on{opacity:1;pointer-events:auto}
.moresheet{position:fixed;left:0;right:0;bottom:calc(57px + env(safe-area-inset-bottom));z-index:25;max-width:720px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-bottom:0;border-radius:16px 16px 0 0;box-shadow:0 -8px 32px rgb(0 0 0 / .16);padding:4px 16px;transform:translateY(calc(100% + 60px));transition:transform .22s ease;visibility:hidden}
.moresheet.open{transform:none;visibility:visible}
.moresheet .mi:last-child{border-bottom:0}
.tab[data-more].open{color:var(--fg)}
.tabbar{position:relative;z-index:26}
@media (min-width:900px){.moresheet{left:88px;right:auto;bottom:16px;width:360px;border:1px solid var(--line);border-radius:12px;transform:translateX(-12px);opacity:0;transition:opacity .15s,transform .15s}.moresheet.open{transform:none;opacity:1}}
.foot3{display:flex;gap:16px;margin:32px 0 8px;font-size:14px}
/* Tab bar: bottom on a phone, a left rail on a desktop. */
.tabbar{flex:none;display:flex;border-top:1px solid var(--line);background:var(--bg);padding-bottom:env(safe-area-inset-bottom)}
.tab{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:56px;color:var(--dim);font-size:12px;font-weight:500}
/* The active tab is unmistakable, phone-native (Material 3 / iOS): accent icon + label, label weight up, a soft
   accent pill behind the icon; others muted. The pill's padding is there in every state, so nothing moves. */
.tab>svg{box-sizing:content-box;width:22px;height:22px;padding:4px 18px;border-radius:16px;transition:background-color .15s,color .15s}
.tab.on{color:var(--acc);font-weight:650}
.tab.on>svg{background:color-mix(in srgb,var(--acc) 16%,transparent);stroke-width:2.2}
@media (prefers-reduced-motion:reduce){.tab>svg{transition:none}}
.badge{position:absolute;top:6px;left:calc(50% + 6px);min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--warn);color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
body.typing .tabbar{display:none}
@media (min-width:900px){
 body.v3{display:grid;grid-template-columns:80px 1fr;grid-template-rows:48px 1fr auto}
 .tabbar{grid-column:1;grid-row:1 / 4;flex-direction:column;justify-content:flex-start;border-top:0;border-right:1px solid var(--line);padding:56px 0 0}
 .tab{flex:none;min-height:64px}
 .h3,.view,.compose{grid-column:2}
 body.typing .tabbar{display:flex}
}
@media (hover:hover){.tab:hover{color:var(--fg)}.mi:hover{background:var(--card)}}

.priv{display:inline-flex;align-items:center;gap:4px;color:var(--dim)}.lockic{flex:none}
.visrow{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0 16px;border-bottom:1px solid var(--line);margin-bottom:8px}
.visrow b{display:inline-flex;align-items:center;gap:6px;font-weight:600}.visrow span{display:block;color:var(--dim);font-size:14px;margin-top:2px}
.visrow .chipbtn{flex:none;min-height:44px}
`;

export function projectV3(o: ProjectArgs & { view: ViewId | null; status: Record<string, BoxStatus>; router: BoxStatus; reviewer: BoxStatus; tryAgent?: string; base?: string; docs?: Docs; g?: Global }) {
  const g: Global = o.g || { nav: 'c', inbox: 0 };
  const { info, me } = o;
  const own = info.owner === me;
  const worker = (o.overview.kind ?? info.kind) === 'worker';
  const { open, done } = changesOf(info, o.status, o.runBase);
  const c: Ctx = { ...o, own, worker, base: o.base || `/p/${info.owner}/${info.name}`, status: o.status, router: o.router, reviewer: o.reviewer, open, done, plan: planningOf(info, o.router), tryAgent: o.tryAgent, docs: o.docs };
  // The page opens where the work is: the owner on Changes, a visitor on the app.
  // Every project opens on its README (Eyal, 2026-10-02).
  let id: ViewId = o.view || (info.landing ? 'work' : 'readme');
  let v = VIEWS.find((x) => x.id === id && x.when(c) && x.render);
  if (!v) { id = 'readme'; v = VIEWS.find((x) => x.id === id)!; }
  const r = v.render!(c);
  const needs = own ? needsOf(open).length : 0;
  // A: the way back to the home tabs is "‹ forq", carrying the Inbox count.
  const home = g.nav === 'a'
    ? `<a class="home back" href="/" aria-label="All projects${g.inbox ? `, ${g.inbox} need you` : ''}">${CHEV}qodebase${g.inbox ? `<span class="hbadge">${g.inbox}</span>` : ''}</a>`
    : `<a class="home" href="/" aria-label="All projects">qodebase</a>`;
  return shell2(g.nav as UI, `${v.label} · ${info.owner}/${info.name} · qodebase`, `${g.nav === 'd' ? globalTop(own ? 'projects' : 'explore', g.inbox, me, { owner: info.owner, ownerLabel: ownerLabel(info.owner), name: info.name, href: c.base, private: !!info.private, action: r.action || '' }) : ''}
${g.nav === 'd' ? '' : `<header class="h3">${home}<a class="nm" href="${c.base}" style="color:inherit"><span class="o">${esc(ownerLabel(info.owner))} /</span> <b>${esc(info.name)}</b>${info.private ? ` <span class="priv" title="Private: only you">${LOCK}</span>` : ''}</a>${r.action || ''}</header>`}
${g.nav === 'b' ? tabBar(c, id, needs, true) : ''}
<main class="view${r.full ? ' full' : ''}" id="view">${r.body}</main>${r.compose || (own ? askBox(c) : '')}
${g.nav === 'b' ? globalBar('projects', g.inbox, me) : tabBar(c, id, needs)}
${own ? `<div class="scrim3" id="scrim3"></div><div class="moresheet" id="moresheet" aria-hidden="true">${moreMenu(c)}</div>` : ''}
${own ? SHEET_HTML : ''}${pageJs(info, r.poll ? `?view=${id}` : '?view=none')}${FORK_JS}
<script>
${r.poll ? '' : 'clearTimeout(timer);'}
window.forqAfterPoll=(j)=>{const n=document.getElementById('needs');const b=document.getElementById('badge');if(n&&b){const k=Number(n.dataset.n);b.hidden=!k;b.textContent=k;}};
// "Try it" in a change opens the App view on that change.
forqTry=(src,title,agent)=>{location.href='${c.base}/app?try='+encodeURIComponent(agent.split('--')[1]||agent);};
// More toggles a sheet over the current view; tap More again (or outside) to close it.
(function(){const ms=document.getElementById('moresheet'),sc=document.getElementById('scrim3'),mt=document.querySelector('[data-more]');if(!ms||!mt)return;
 const set=(on)=>{ms.classList.toggle('open',on);sc.classList.toggle('on',on);mt.classList.toggle('open',on);mt.setAttribute('aria-expanded',on);ms.setAttribute('aria-hidden',!on);};
 mt.addEventListener('click',(e)=>{e.preventDefault();set(!ms.classList.contains('open'));});
 sc.addEventListener('click',()=>set(false));document.addEventListener('keydown',(e)=>{if(e.key==='Escape')set(false);});})();
// The keyboard covers half a phone: hide the tab bar while typing.
document.addEventListener('focusin',(e)=>{if(e.target.matches('textarea,input'))document.body.classList.add('typing');});
// …and bring it back only after focus has really left, so nothing moves under a tap.
document.addEventListener('focusout',()=>setTimeout(()=>{if(!document.activeElement?.matches('textarea,input'))document.body.classList.remove('typing');},250));
${!r.compose && own ? `window.forqAskedGo='${c.base}/changes';` : ''}
${r.js || ''}
</script>`, V3_CSS + NAV_CSS, `v3 nav-${g.nav}`);
}

/** The polled part of a view (Changes, Agents). */
export function liveV3(view: string, o: ProjectArgs & { status: Record<string, BoxStatus>; router: BoxStatus; reviewer: BoxStatus }) {
  const own = o.info.owner === o.me;
  const { open, done } = changesOf(o.info, o.status, o.runBase);
  const c: Ctx = { ...o, own, worker: o.info.kind === 'worker', base: `/p/${o.info.owner}/${o.info.name}`, open, done, plan: planningOf(o.info, o.router) };
  return view === 'agents' ? liveAgents(c) : liveChanges(c);
}

/** Wrap a code-browser page (an older full page) with the tab bar on the Code tab. */
export function withTabs(html: string, info: ProjectInfo, me: string, g: Global = { nav: 'c', inbox: 0 }) {
  const own = info.owner === me;
  const { open } = changesOf(info, {}, '');
  const pc = { own, base: `/p/${info.owner}/${info.name}`, worker: info.kind === 'worker', info };
  const n = own ? needsOf(open).length : 0;
  if (g.nav === 'b') {
    const css = `<style>${V3_CSS.slice(V3_CSS.indexOf('/* Tab bar'))}${NAV_CSS}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30}
body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
.ptop{position:sticky;top:0;z-index:20;margin:0 0 8px}
@media (min-width:900px){.tabbar{right:auto;top:0;bottom:0;width:80px}body{padding-bottom:0;padding-left:80px}}
.badge{position:absolute}</style>`;
    return html.replace('</head>', `${css}</head>`).replace(/<body([^>]*)>/, `<body$1>${tabBar(pc, 'code', n, true)}`).replace('</body>', `${globalBar('projects', g.inbox, me)}</body>`);
  }
  if (g.nav === 'd') {
    const css = `<style>${V3_CSS.slice(V3_CSS.indexOf('/* Tab bar'))}${NAV_CSS}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30}
body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
.gtop{margin:0 0 8px}
@media (min-width:900px){.tabbar{right:auto;top:48px;bottom:0;width:80px}body{padding-bottom:0;padding-left:80px}.gtop{margin-left:-80px}}
.badge{position:absolute}.gtop .badge{position:static}</style>`;
    return html.replace('</head>', `${css}</head>`).replace(/<body([^>]*)>/, `<body$1>${globalTop(own ? 'projects' : 'explore', g.inbox, me, { owner: info.owner, ownerLabel: ownerLabel(info.owner), name: info.name, href: `/p/${info.owner}/${info.name}`, private: !!info.private })}`).replace('</body>', `${tabBar(pc, 'code', n)}</body>`);
  }
  const bar = tabBar(pc, 'code', n);
  const css = `<style>${V3_CSS.slice(V3_CSS.indexOf('/* Tab bar'))}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30}
body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
@media (min-width:900px){.tabbar{right:auto;top:0;bottom:0;width:80px}body{padding-bottom:0;padding-left:80px}}
.badge{position:absolute}</style>`;
  return html.replace('</head>', `${css}</head>`).replace('</body>', `${bar}</body>`);
}

/** Sample data for /design-fixture on the views host. */
export function fixtureV3(runBase: string, mode: string, view: ViewId | null, tryAgent?: string, g?: Global) {
  const f = fixtureData(runBase, mode);
  const docs: Docs = { list: ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'docs/sharing.md', 'LICENSE'].map((p) => ({ path: p, label: docLabel(p) })), current: 'README.md', text: f.overview.readme };
  return projectV3({ info: f.info, entry: f.entry, forks: [], overview: f.overview, me: 'eyal', runBase, liveHtml: '', view, status: f.status, router: f.router, reviewer: { awake: true, cc: 'idle' }, tryAgent, base: '/design-fixture', docs, g });
}


// ---- Home with tabs (nav 'a' and 'b') ---------------------------------------------

const CHEV = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>`;
const HI: Record<string, string> = {
  projects: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  inbox: I('<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>'),
  explore: I('<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  account: I('<circle cx="12" cy="9" r="3.5"/><path d="M5 20c1.2-3.5 4-5 7-5s5.8 1.5 7 5"/>'),
  home: I('<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>'),
  mine: I('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
};
export type HomeTab = 'projects' | 'inbox' | 'explore' | 'account' | 'home' | 'mine' | 'build';

/** The site-wide bar: home tabs (A), or everywhere (B). */
export function globalBar(active: HomeTab, inbox: number, me: string) {
  const tabs: [HomeTab, string, string][] = me
    ? [['projects', 'Projects', '/'], ['inbox', 'Inbox', '/inbox'], ['explore', 'Explore', '/explore'], ['account', 'Account', '/settings']]
    : [['explore', 'Explore', '/'], ['account', 'Sign in', '/login']];
  return `<nav class="tabbar" aria-label="qodebase">${tabs.map(([id, labelT, href]) => {
    const on = id === active;
    const badge = id === 'inbox' ? `<span class="badge"${inbox ? '' : ' hidden'}>${inbox || ''}</span>` : '';
    return `<a href="${href}" class="tab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''}>${HI[id]}${badge}<span>${labelT}</span></a>`;
  }).join('')}</nav>`;
}

export const NAV_CSS = `
.gtop{flex:none;display:flex;align-items:stretch;height:48px;padding:0 4px;border-bottom:1px solid var(--line);background:var(--bg);overflow-x:auto;scrollbar-width:none}
.gtop::-webkit-scrollbar{display:none}
.gtop .mark{display:flex;align-items:center;padding:0 10px 0 8px;font-weight:600;font-size:16px;color:var(--fg)}
.gtop .g{flex:none;display:flex;align-items:center;gap:6px;padding:0 7px;font:500 14px 'Geist',sans-serif;color:var(--dim);border-bottom:2px solid transparent}
.gtop .g.on{color:var(--fg);border-bottom-color:var(--fg)}
.gtop .gbuild{flex:none;align-self:center;margin-left:auto;min-height:34px;padding:0 12px;font-size:14px;border-radius:8px}
/* Sign in and ☰ sit at the right end. Build (margin-left:auto) usually pushes them there;
   on the home page Build is hidden, so they push themselves (2026-10-07). */
.gtop .g.signin{margin-left:auto}
.gtop .signin~.gbuild{margin-left:8px}
body:has(.land) .gtop .gmenu{margin-left:auto}
body:has(.land) .gtop .signin~.gmenu{margin-left:0}
.gtop .mark{gap:6px}.gtop .markq{display:none;flex:none}
@media (max-width:430px){.gtop:has(.gcost) .markq{display:block}.gtop:has(.gcost) .markt{display:none}}
.gtop .gcost{flex:none;align-self:center;display:inline-flex;align-items:center;gap:4px;height:34px;margin-left:6px;padding:0 8px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);font:500 13px 'Geist',sans-serif;font-variant-numeric:tabular-nums;cursor:pointer;-webkit-tap-highlight-color:transparent}
.gcostpop{padding:10px 12px}.gcostpop .gcr{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;font-size:15px}.gcostpop .gcr b{font-weight:600;font-variant-numeric:tabular-nums}
.gcostpop .gcs{margin:-2px 0 4px;font-size:12px;color:var(--dim)}.gcostpop .gch{margin:10px 0 2px;font-size:12px;color:var(--dim)}.gcostpop .gcl{color:var(--dim);font-size:14px}
.gcostpop a.gca{display:block;margin-top:8px;padding:10px 0 2px;border-top:1px solid var(--line);color:var(--acc);font-weight:500}
body:has(.land) .gtop .gcost{margin-left:auto}
body:has(.land) .gtop .gcost~.gmenu{margin-left:0}
.gtop .gmenu{flex:none;align-self:center;display:inline-flex;align-items:center;justify-content:center;width:40px;height:44px;margin-left:0;border:0;background:none;color:var(--fg);cursor:pointer;-webkit-tap-highlight-color:transparent}
.gmenupop{position:fixed;inset:52px 8px auto auto;margin:0;width:min(300px,calc(100vw - 16px));padding:6px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--fg);box-shadow:0 8px 32px rgb(0 0 0 / .16)}
.gmenupop a{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:8px;color:var(--fg);text-decoration:none}
.gmenupop a b{font-weight:500;font-size:15px}.gmenupop a span{font-size:13px;color:var(--dim)}
.gmenupop a[aria-current]{background:var(--card)}
@media (hover:hover){.gmenupop a:hover{background:var(--card)}}
/* Home, Explore, Yours, Inbox, Build: the page itself scrolls (so Chrome's pull-to-refresh
   works) under a sticky header. Project pages keep the app shell: their Changes thread
   scrolls on its own, starting at the bottom. */
body.v3.dhome{height:auto;min-height:100dvh;display:block;overflow:visible}
body.dhome>.gtop{position:sticky;top:0;z-index:20}
body.dhome>.view{overflow:visible;min-height:0}
.gtop .badge{position:static;margin:0;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--warn);color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center}
.h3.sub{height:44px;background:var(--card)}
.h3.sub .nm{padding-left:12px}
@media (min-width:900px){body.nav-d{grid-template-rows:48px 44px 1fr auto}body.nav-d>.gtop{grid-column:1 / 3;grid-row:1}body.nav-d>.h3{grid-row:2}body.nav-d>.tabbar{grid-row:2 / 5;padding-top:8px}}
.h3 .home.back{gap:2px;padding-left:6px;position:relative}
.hbadge{margin-left:6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--warn);color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center}
.ptop{flex:none;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;border-bottom:1px solid var(--line);background:var(--bg);padding:0 8px}
.ptop::-webkit-scrollbar{display:none}
.ptop .tab{flex:none;flex-direction:row;gap:6px;min-height:44px;padding:0 12px;font-size:14px;border-bottom:2px solid transparent}
.ptop .tab svg{display:none}
@media (max-width:599px){.ptop{justify-content:space-between}}
.ptop .tab{padding:0 10px}
.ptop .tab.on{border-bottom-color:var(--fg)}
.ptop .badge{position:static;margin-left:2px}
@media (min-width:900px){body.nav-b{grid-template-rows:48px auto 1fr auto}body.nav-b .ptop{grid-column:2}body.nav-b>.tabbar{grid-row:1 / 5}}
.htitle{flex:1;font-size:15px;font-weight:600}
.home-list{display:flex;flex-direction:column;gap:8px}
.prow{position:relative;display:block;background:var(--card);border-radius:12px;padding:12px 14px;color:inherit}
.prow .t{display:block;font-size:15px;color:var(--fg)}
.prow .t b{font-weight:600}.prow .t .o{color:var(--dim)}
.prow .d{color:var(--dim);font-size:14px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.prow .m{display:flex;align-items:center;gap:8px 12px;margin-top:8px;font-size:13px;color:var(--dim);white-space:nowrap;overflow:hidden}
.prow .m .st{display:inline-flex;align-items:center;gap:6px;font-weight:500}
.prow .m .st.ready{color:var(--acc)}.prow .m .st.fix{color:var(--warn)}.prow .m .st.working{color:var(--fg)}
.stretch::after{content:'';position:absolute;inset:0;border-radius:12px}
.prow button.fresh{position:relative;z-index:1}
.hrow{display:flex;align-items:center;gap:8px;margin:0 0 12px}
.hrow .btn,.hrow .chipbtn{min-height:40px;padding:0 14px;font-size:14px}
.ibx h3 a{color:var(--fg)}
.ibx .chg{margin-bottom:8px}
@media (hover:hover){.prow:hover{background:var(--chip)}}
`;

export type InboxItem = { entry: Entry; info: ProjectInfo; open: Change[] };

const LOCK = `<svg class="lockic" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
function projRow(e: Entry, now: number, st?: { ready: number; fix: number; working: number }, forks = 0) {
  const s = !st ? '' : st.fix ? `<span class="st fix"><span class="dot s-fix"></span>${st.fix} need${st.fix > 1 ? '' : 's'} you</span>`
    : st.ready ? `<span class="st ready"><span class="dot s-ready"></span>${st.ready} ready to merge</span>`
    : st.working ? `<span class="st working"><span class="dot s-working"></span>${st.working} in progress</span>` : '';
  return `<div class="prow"><a class="t stretch" href="${path(e.slug)}"><span class="o">${esc(ownerLabel(e.owner))} /</span> <b>${esc(e.name)}</b></a>
${e.description ? `<div class="d">${esc(e.description)}</div>` : ''}
<div class="m">${e.private ? `<span class="priv">${LOCK}Private</span>` : ''}${s}${freshTag(e.updatedAt, now, STEPS)}${forks ? `<span>${forks} fork${forks > 1 ? 's' : ''}</span>` : ''}${e.importedFrom ? `<span>${e.importedFrom.stars >= 1000 ? (e.importedFrom.stars / 1000).toFixed(1) + 'k' : e.importedFrom.stars} stars</span>` : ''}</div></div>`;
}

/** The home pages with tabs: Projects, Inbox, Explore (Account is the settings page). */
export function homeV3(nav: Nav, tab: HomeTab, entries: Entry[], me: string, items: InboxItem[], world: WorldTab = 'projects', wopts: { tag?: string; sort?: string } = {}, selfHost = false) {
  const now = Date.now();
  const inboxN = items.reduce((n, it) => n + needsOf(it.open).length, 0);
  const forks = (slug: string) => entries.filter((e) => e.forkedFrom === slug).length;
  const mine = entries.filter((e) => me && e.owner === me).sort((a, b) => b.updatedAt - a.updatedAt);
  const others = entries.filter((e) => e.owner !== me);
  const st = (slug: string) => {
    const it = items.find((x) => x.entry.slug === slug);
    if (!it) return undefined;
    const n = (k: string) => it.open.filter((c) => c.state === k).length;
    return { ready: n('ready'), fix: n('fix') + n('waiting'), working: n('working') + n('checking') };
  };
  let title = '', body = '';
  if (tab === 'home' && nav === 'd') {
    // Home is one question and one way out (Eyal, 2026-10-04: "really simple, a call
    // to action, build something, or browse public projects; not a lot of mental strength").
    title = 'qodebase';
    body = landBody(entries, selfHost);
  } else if (tab === 'explore' && nav === 'd') {
    title = 'Explore';
    body = worldBody(world, entries, !!me, wopts);
  } else if (tab === 'home') {
    title = 'qodebase';
    body = worldBody(world, entries, !!me, wopts);
  } else if (tab === 'projects' || tab === 'mine') {
    title = 'Your projects';
    body = `<div class="hrow"><span class="lede" style="flex:1;margin:0">${mine.length} project${mine.length === 1 ? '' : 's'}</span><a class="chipbtn" href="/import">Import from GitHub</a></div>
<div class="home-list">${mine.map((e) => projRow(e, now, st(e.slug))).join('') || `<p class="empty">No projects yet. Fork one from <a href="/explore">Explore</a>.</p>`}</div>`;
  } else if (tab === 'inbox') {
    title = 'Inbox';
    const need = items.map((it) => ({ ...it, need: needsOf(it.open).sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state)) })).filter((it) => it.need.length);
    const moving = items.flatMap((it) => it.open.filter((c) => c.state === 'working' || c.state === 'checking').map((c) => ({ it, c })));
    let first = true;
    body = `<div class="ibx">${need.length ? need.map((it) => `<h3><a href="${path(it.entry.slug)}/changes">${esc(label(it.entry.slug))}</a></h3>${it.need.map((c) => { const html = changeRow(it.info, c, now, first ? c.a.id : undefined).replace('<div class="chg ', `<div data-api="/api/p/${it.info.owner}/${it.info.name}" class="chg `); first = false; return html; }).join('')}`).join('')
      : `<div class="hello"><b>Nothing needs you.</b><p>When a change is ready to merge, needs a fix, or an agent has a question, it shows up here, from every project.</p></div>`}
${moving.length ? `<h3>In progress</h3>${moving.map(({ it, c }) => `<a class="mi" href="${path(it.entry.slug)}/changes"><span class="dot s-${c.state}"></span><span><b>${esc(c.title)}</b><span>${esc(label(it.entry.slug))}, ${c.word.toLowerCase()}</span></span></a>`).join('')}` : ''}</div>`;
  } else {
    title = 'Explore';
    body = `<div class="hrow"><span class="lede" style="flex:1;margin:0">Projects that run. Open one, fork it, ask for changes.</span>${me ? '<a class="chipbtn" href="/import">Import</a>' : ''}</div>
<div class="home-list">${others.map((e) => projRow(e, now, undefined, forks(e.slug))).join('') || '<p class="empty">Nothing here yet.</p>'}</div>`;
  }
  return shell2(nav as UI, title === 'qodebase' ? 'qodebase' : `${title} · qodebase`, `${nav === 'd' ? globalTop(tab, inboxN, me) : `
<header class="h3"><a class="home" href="/">qodebase</a><span class="htitle">${title}</span></header>`}
<main class="view" id="view"><div class="pad">${body}${tab === 'home' && nav === 'd' ? '' : legend(1)}${FOOT}</div></main>
${nav === 'd' ? '' : globalBar(tab, inboxN, me)}
<script>
// Inbox actions: each row knows its project's API.
document.addEventListener('click',async(e)=>{
 const o=!e.target.closest('.fresh')&&e.target.closest('[data-open]');if(o){const r=o.closest('.chg');r.classList.toggle('open');return;}
 const b=e.target.closest('[data-merge],[data-fix]');if(!b)return;const api=b.closest('[data-api]').dataset.api;const m=!!b.dataset.merge;
 b.disabled=true;b.textContent=m?'Merging':'Sending to its agent';
 const r=await fetch(api+'/'+(m?'merge':'fix'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:b.dataset.merge||b.dataset.fix})});
 if(!r.ok){const j=await r.json().catch(()=>({}));b.textContent=j.error||'Failed';return;}setTimeout(()=>location.reload(),1200);});
</script>`, V3_CSS + NAV_CSS + WORLD_CSS + CATALOG_CSS + LAND_CSS + `@media (min-width:900px){body.v3.dhome{display:flex;flex-direction:column}}`, `v3 nav-${nav}${nav === 'd' ? ' dhome' : ''}`);
}

/** The settings page under the site-wide bar (Account tab). */
export function withGlobal(html: string, tab: HomeTab, inbox: number, me: string, nav: Nav = 'a') {
  if (nav === 'd') {
    const css = `<style>${NAV_CSS}.gtop{margin:0 0 8px}</style>`;
    return html.replace('</head>', `${css}</head>`).replace(/<body([^>]*)>/, `<body$1>${globalTop(tab, inbox, me)}`);
  }
  const css = `<style>${V3_CSS.slice(V3_CSS.indexOf('/* Tab bar'))}${NAV_CSS}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30}
body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
@media (min-width:900px){.tabbar{right:auto;top:0;bottom:0;width:80px}body{padding-bottom:0;padding-left:80px}}
.badge{position:absolute}</style>`;
  return html.replace('</head>', `${css}</head>`).replace('</body>', `${globalBar(tab, inbox, me)}</body>`);
}


/** D: the site-wide tabs as a strip at the top: forq, then Projects, Inbox, Explore, Account. */
/** Which view a project URL really renders: a view the viewer may not see (Changes, More, Agents when signed out)
 *  falls back to Readme in projectV3, so the caller must load the README for it too (github-parity.md bug 2). */
export function viewShown(view: string | null, own: boolean, info: ProjectInfo): string {
  const id = view === 'about' ? 'readme' : view || 'readme';
  const c = { own, worker: info.kind === 'worker', info } as unknown as Ctx;
  return VIEWS.find((x) => x.id === id && x.when(c) && x.render) ? id : 'readme';
}
export function globalTop(active: HomeTab, inbox: number, me: string, ctx?: HeaderCtx) {
  // The site header (src/header.ts, qb3 2026-10-12): mark, owner / project or the section, +, avatar, ☰ sheet.
  return siteHeader({ active, inbox, me, ctx });
}

/** Costs (src/costs.ts): today's amount in the header; tap for 7 days, 30-day estimate, link. */
const COST_CHIP = `<button type="button" class="gcost" popovertarget="gcostpop" aria-label="Your costs"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M14.5 9.3c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.4.7-2.4 1.8 0 2.4 5 1.3 5 3.9 0 1.1-1.1 1.9-2.6 1.9-1.2 0-2.1-.5-2.6-1.3M12 6.5v1.6m0 7.8v1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span data-cost>…</span></button>
<div id="gcostpop" class="gmenupop gcostpop" popover><p class="gcl">Loading your costs</p></div>
<script>(function(){var b=document.querySelector('.gcost');if(!b||b.dataset.on)return;b.dataset.on=1;
var m=function(n){return n>0&&n<0.005?'<$0.01':'$'+n.toFixed(2)},L={boxes:'Agent boxes',claude:'Claude',voice:'Talk and voice'};
fetch('/api/costs',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(c){if(!c)return;
b.querySelector('[data-cost]').textContent=m(c.today.total.usd);
var row=function(l,v,s){return '<div class="gcr"><span>'+l+'</span><b>'+v+'</b></div>'+(s?'<p class="gcs">'+s+'</p>':'')};
var cov=function(t){var x=[];if(t.covered)x.push(m(t.covered)+' covered by qodebase');if(t.subTokens)x.push(Math.round(t.subTokens/1000)+'k tokens on your Claude plan');return x.join('. ')};
var kinds=Object.keys(L).filter(function(k){return c.week.byKind[k]}).map(function(k){var t=c.week.byKind[k];return row(L[k],m(t.usd),cov(t))}).join('');
document.getElementById('gcostpop').innerHTML=row('Today',m(c.today.total.usd),cov(c.today.total))+row('Last 7 days',m(c.week.total.usd),cov(c.week.total))+row('Next 30 days',m(c.month.usd),'Estimate at this week’s pace')+(kinds?'<p class="gch">Last 7 days by kind</p>'+kinds:'')+'<a class="gca" href="/costs">See all costs</a>';
}).catch(function(){});})();</script>`;
const MENU_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
/** The ☰ menu at the header's right end: the things every page can reach but no page leads with. */
function gmenu(me: string, active: HomeTab) {
  const item = (href: string, label: string, sub: string, on = false) => `<a href="${href}"${on ? ' aria-current="page"' : ''}><b>${label}</b><span>${sub}</span></a>`;
  return `<button type="button" class="gmenu" popovertarget="gmenupop" aria-label="Menu">${MENU_ICON}</button>
<div id="gmenupop" class="gmenupop" popover>
${me ? item('/settings', 'Account', `${esc(me)}: your name, API key, sign out`, active === 'account') : ''}
${item('/import', 'Import from GitHub', 'Bring a public repo in and change it with agents')}
${item('/cli', 'Command line', 'qb: qodebase from a terminal or an agent')}
${item('/how', 'How it works', 'Watch 6 agents change one app; what we measured')}
${item('/about', 'About', 'What qodebase is')}
${item('/feedback', 'Feedback', 'Something missing or broken? Tell us')}
</div>`;
}

/** A catalogue project's page (/gh/<owner>/<repo>) under D's top tabs. */
export function catalogV3(nav: Nav, full: string, entries: Entry[], me: string, inbox: number) {
  const pg = catalogPage(full, entries, me);
  if (!pg) return null;
  return shell2(nav as UI, `${pg.title} · qodebase`, `${globalTop('explore', inbox, me)}
<main class="view" id="view"><div class="pad">${pg.body}${legend(1)}${FOOT}</div></main>${SPECULATE}`, V3_CSS + NAV_CSS + WORLD_CSS + CATALOG_CSS + `@media (min-width:900px){body.v3.dhome{display:flex;flex-direction:column}}`, `v3 nav-${nav} dhome`);
}

/** The Build page under D's top tabs. */
export function buildV3(nav: Nav, me: string, inbox: number, needsKey: boolean, runDomain: string) {
  return shell2(nav as UI, 'Build · qodebase', `${globalTop('build', inbox, me)}
<main class="view" id="view"><div class="pad">${buildBody(me, needsKey, runDomain)}${FOOT}</div></main>`, V3_CSS + NAV_CSS + BUILD_CSS + `@media (min-width:900px){body.v3.dhome{display:flex;flex-direction:column}}`, `v3 nav-${nav} dhome`);
}

/** D's home (2026-10-06, Eyal: lead with Build; headline "Own your codebase." since the same day): the promise in one
 *  line, the build box above the fold, then three doors (your own qodebase, your own AI
 *  assistant, explore) and the try-changing row. */
function landBody(entries: Entry[], selfHost = false) {
  // Eyal (2026-10-12): the home page is the product: the build box first, nothing contest-y above it. The demo, the
  // lab and the simulation live on /how; one quiet link under the build box points there.
  const how = selfHost ? '' : '<p class="howlink"><a href="/how">How it works: watch 6 agents change one app</a></p>';
  return `<section class="land">
<h1>Own your codebase.</h1>
<p class="lede">Describe it. Agents build it. The code is yours to keep.</p>
<form class="landask" action="/build" method="get">
<div class="askbox"><textarea name="idea" rows="3" placeholder="What do you want to build?" aria-label="What do you want to build?" enterkeyhint="go" required></textarea>
<button type="button" class="askmic" id="askmic" hidden aria-label="Speak your idea" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button></div>
<div class="bsbox"><p class="bs-job" id="bsjob" hidden aria-live="polite"></p><button type="button" class="bstoggle" id="bsopen" hidden aria-expanded="false"><svg class="bst-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg><span class="bst-main"><span id="bschosen">Fastest: one Opus agent</span><span id="bsest" class="bst-est" aria-live="polite"></span></span><svg class="bst-c" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
<div id="bsheet" class="bsheet" hidden></div></div>
<button class="btn" type="submit">Build it</button>
</form>
${how}
<nav class="doors" aria-label="More">
${selfHost ? '' : `<a class="browse own" href="/own"><span>Get your own qodebase<small>Your own copy, in your own Cloudflare account.</small></span></a>
<a class="browse own" href="/personal-agents"><span>Your own AI assistant<small>An AI assistant that runs in your own Cloudflare account.</small></span></a>`}
<a class="browse own" href="/explore"><span>Explore public projects<small>Apps and code others have shared.</small></span></a>
</nav>
${tryRow(entries)}
</section>${SPECULATE}
<script>(function(){document.querySelectorAll('.land .browse').forEach((a)=>a.addEventListener('click',()=>a.classList.add('going')));
addEventListener('pageshow',()=>document.querySelectorAll('.land .browse.going').forEach((a)=>a.classList.remove('going')));
const f=document.querySelector('.landask'),t=f.querySelector('textarea');
// Focus diagnostics (Eyal, 2026-10-12: on Android the keyboard opened by itself after scrolling down to Build
// settings and back). Every focus/blur of the box: trusted?, the last touch/pointer events, a stack, the viewport;
// console + one row in Workers Logs via Talk's log route (tool 'focusdiag', signed-in only).
const last=[];['touchstart','touchend','pointerdown','pointerup','click','scroll'].forEach((k)=>addEventListener(k,(e)=>{last.push(k+(e.target&&e.target.id?'#'+e.target.id:e.target&&e.target.className&&typeof e.target.className==='string'?'.'+e.target.className.split(' ')[0]:'')+'@'+Math.round(performance.now()));if(last.length>8)last.shift();},{capture:true,passive:true}));
const diag=(ev,e)=>{const row={ts:new Date().toISOString(),module:'homefocus',event:ev,trusted:e.isTrusted,last:last.slice(),vv:window.visualViewport?Math.round(visualViewport.height):null,y:Math.round(scrollY),boxTop:Math.round(t.getBoundingClientRect().top),stack:(new Error().stack||'').split(String.fromCharCode(10)).slice(2,6).join(' | ')};try{console.log(JSON.stringify(row));}catch(x){}
try{fetch('/api/talk/log',{method:'POST',keepalive:true,credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({tool:'focusdiag',args:row,ok:true,path:location.pathname})}).catch(()=>{});}catch(x){}};
t.addEventListener('focus',(e)=>diag('focus',e));t.addEventListener('blur',(e)=>diag('blur',e));
// The box keeps focus after the keyboard is dismissed with Back; Android then re-shows the keyboard when it
// comes back into view. Once the box is fully off screen, let go of focus so only a real tap can bring it back.
if('IntersectionObserver' in window)new IntersectionObserver((es)=>{for(const x of es)if(!x.isIntersecting&&document.activeElement===t){diag('blur_offscreen',{isTrusted:false});t.blur();}},{threshold:0}).observe(t);
${JOIN_SPEECH}
(function(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition,m=document.getElementById('askmic');if(!SR||!m)return;m.hidden=false;let rec=null,base='';
m.addEventListener('click',()=>{if(rec){rec.stop();return;}rec=new SR();rec.interimResults=true;rec.continuous=!/Android/i.test(navigator.userAgent);rec.lang=document.documentElement.lang||navigator.language||'en-US';base=t.value.trim();
rec.onresult=(e)=>{const s=joinSpeech(e.results);t.value=(base?base+' ':'')+s;t.dispatchEvent(new Event('input',{bubbles:true}));};
rec.onend=()=>{rec=null;m.classList.remove('on');m.setAttribute('aria-pressed','false');m.setAttribute('aria-label','Speak your idea');};rec.onerror=()=>{};
try{rec.start();m.classList.add('on');m.setAttribute('aria-pressed','true');m.setAttribute('aria-label','Stop listening');}catch(e){rec=null;}});})();
if(document.body.dataset.buildSettings==='1'){const s=document.createElement('script');s.src='/lab/build-sheet.js';document.head.appendChild(s);}
t.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&matchMedia('(hover:hover)').matches){e.preventDefault();if(t.value.trim())f.requestSubmit();}});})();</script>`;
}

export const LAND_CSS = `
/* The mic sits inside the prompt box (Eyal, 2026-10-12): speaking fills the box. Talk's floating button is not
   shown on the home page, so it never covers the Build settings dock. */
.askbox{position:relative}
.askbox textarea{padding-right:56px}
.askmic{position:absolute;right:8px;bottom:8px;width:44px;height:44px;border:0;border-radius:10px;background:var(--chip);color:var(--fg);display:flex;align-items:center;justify-content:center;cursor:pointer}
.askmic svg{width:22px;height:22px}.askmic.on{background:var(--warn);color:#fff}
.askmic:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
body:has(.landask) #talk-fab{display:none!important}
body:has(.bsheet:not([hidden])) #talk-ver{display:none!important}
/* 'Need an idea?' (I3): size chips with each size's typical time and cost; the chosen idea's card carries its
   own estimate, kept in step with the settings. */
.ideas{margin:20px 0 4px}
.id-h{font-size:16px;font-weight:600;margin:0}.id-s{margin:2px 0 10px;font-size:14px;color:var(--dim)}
.id-sizes{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.id-size{display:flex;flex-direction:column;gap:1px;text-align:left;border:0;border-radius:10px;background:var(--chip);color:var(--fg);min-height:52px;padding:6px 12px;font:inherit;cursor:pointer}
.id-size b{font-size:15px;font-weight:600}.id-size small{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.id-size[aria-pressed="true"]{background:var(--fg);color:var(--bg)}.id-size[aria-pressed="true"] small{color:inherit;opacity:.75}
.id-card{margin-top:10px;padding:12px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);display:grid;gap:6px}
.id-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.id-title{font-size:16px}.id-src{font-size:12px;color:var(--dim)}
.id-est{margin:0;font-size:14px;font-variant-numeric:tabular-nums}
.id-again{justify-self:start;min-height:44px;padding:0 14px;border:0;border-radius:10px;background:var(--chip);color:var(--fg);font:inherit;font-size:14px;cursor:pointer}
.id-size:focus-visible,.id-again:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
@media (min-width:700px){.id-sizes{grid-template-columns:repeat(4,1fr)}}
/* Build settings (B2/B4, behind BUILD_SETTINGS): 'Adjust' expands a section in place under Build it (Eyal: no
   modal). Preset chips, sliders with touch-sized thumbs, a board switch, outcome bars that move while you drag. */
.bstoggle{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:6px 12px;border:0;border-radius:12px;background:var(--chip);color:var(--fg);font:inherit;text-align:left;cursor:pointer}
.bstoggle[hidden]{display:none}
.bs-job{margin:0 0 6px;font-size:14px;color:var(--dim)}.bs-job b{color:var(--fg);font-weight:600}
.bst-i{flex:none;width:20px;height:20px;color:var(--dim)}
.bst-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
#bschosen{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}
.bst-est{font-size:13px;color:var(--fg);opacity:.8;font-variant-numeric:tabular-nums}.bst-est:empty{display:none}
.bst-c{flex:none;width:20px;height:20px;color:var(--dim);transition:transform .15s}
.bstoggle[aria-expanded="true"] .bst-c{transform:rotate(90deg)}
/* Expanded, the row is the header of one container that holds the whole section (Eyal: make it obvious what
   belongs to it): card background, hairline, card radius; the header sticks under the 48 px top bar. */
.bsbox:has(>.bstoggle[aria-expanded="true"]){background:var(--card);border-radius:14px;box-shadow:inset 0 0 0 1px var(--line)}
.bsbox>.bstoggle[aria-expanded="true"]{position:sticky;top:var(--top-h,48px);z-index:3;border-radius:14px 14px 0 0;box-shadow:inset 0 0 0 1px var(--line),0 1px 0 var(--line)}
.bsbox>.bsheet{padding:12px 12px 8px}
.bstoggle:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.bst-c{transition:none}}
.bsheet{display:grid;gap:14px}
.bsheet[hidden]{display:none}
.bs-chips{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.bs-chip{display:flex;flex-direction:column;justify-content:center;gap:1px;text-align:left;border:0;cursor:pointer;background:var(--chip);color:var(--fg);border-radius:10px;min-height:52px;padding:6px 12px;font:inherit;font-size:14px}
.bs-chip b{font-weight:600;font-size:14px}.bs-chip small{font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.bs-chip[aria-checked="true"],.bs-custom{background:var(--fg);color:var(--bg)}.bs-chip[aria-checked="true"] small{color:inherit;opacity:.75}
.bs-chip:disabled{opacity:.6;cursor:default}
.bs-custom{grid-column:1/-1;cursor:default;font-weight:600;min-height:44px}
.bs-custom[hidden]{display:none}
@media (min-width:700px){.bs-chips{grid-template-columns:repeat(4,1fr)}}
.bs-why{margin:0;font-size:14px;color:var(--dim);min-height:1.45em}.bs-why b{color:var(--fg);font-weight:600}
.bs-sl{display:grid;gap:2px}
.bs-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:0 12px;padding-top:8px}
.bs-rl{font-size:15px}.bs-sub{font-size:13px;color:var(--dim);margin-left:4px}
.bs-rv{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.bs-hint{margin:0 0 6px;font-size:13px;color:var(--dim)}
.bs-row input[type=range]{grid-column:1/-1;-webkit-appearance:none;appearance:none;width:100%;height:44px;margin:0;background:transparent;cursor:pointer;touch-action:pan-y}
.bs-row input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(to right,var(--fg) 0 var(--p,0%),var(--line) var(--p,0%) 100%)}
.bs-row input[type=range]::-moz-range-track{height:6px;border-radius:3px;background:var(--line)}
.bs-row input[type=range]::-moz-range-progress{height:6px;border-radius:3px;background:var(--fg)}
.bs-row input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;margin-top:-11px;border-radius:50%;background:var(--bg);box-shadow:0 0 0 2px var(--fg),0 1px 3px rgba(0,0,0,.25)}
.bs-row input[type=range]::-moz-range-thumb{width:28px;height:28px;border:0;border-radius:50%;background:var(--bg);box-shadow:0 0 0 2px var(--fg),0 1px 3px rgba(0,0,0,.25)}
.bs-row input[type=range]:focus-visible{outline:none}
.bs-row:has(input[type=range]){touch-action:pan-y}
@media (pointer:coarse){.bs-row input[type=range]{pointer-events:none}}
.bs-row input[type=range]:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 2px var(--fg),0 0 0 5px var(--acc)}
.bs-sw{min-height:44px}
.bs-switch{position:relative;width:52px;height:32px;border:0;border-radius:16px;background:var(--chip);cursor:pointer;padding:0;transition:background-color .15s}
.bs-switch::before{content:'';position:absolute;inset:-6px}
.bs-switch i{position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .15s}
.bs-switch{box-shadow:inset 0 0 0 1px var(--line)}.bs-switch[aria-checked="true"]{background:var(--acc);box-shadow:none}.bs-switch[aria-checked="true"] i{transform:translateX(20px)}
.bs-switch:disabled{opacity:.4;cursor:default}
.bs-out{display:grid;gap:8px;padding:10px 12px;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line),0 0 0 8px var(--bg);position:sticky;bottom:8px;z-index:2}
.bs-build{min-height:44px;font-size:16px;margin-top:2px}
.bs-bar{display:grid;grid-template-columns:1fr auto;gap:4px 12px;align-items:baseline}
.bs-bl{font-size:13px;color:var(--dim)}.bs-bar b{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.bs-track{grid-column:1/-1;position:relative;height:6px;border-radius:3px;background:var(--line)}
.bs-track i{position:absolute;top:0;bottom:0;border-radius:4px;background:var(--fg);transition:left .12s,width .12s}
.bs-ends{grid-column:1/-1;display:flex;justify-content:space-between;font-size:12px;color:var(--dim)}
.bs-meter{grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.bs-meter.bs-unmeasured i{background:repeating-linear-gradient(45deg,var(--line) 0 4px,transparent 4px 8px)}
.bs-meter i{height:6px;border-radius:3px;background:var(--line);transition:background-color .12s}.bs-meter i.on{background:var(--fg)}
.bs-noest .bs-track,.bs-noest .bs-meter{display:none}
.bs-src{margin:0;font-size:13px;color:var(--dim)}
.bs-for{margin:0;font-size:12px;color:var(--dim)}
.bs-wait{margin:0;font-size:15px;color:var(--dim);text-align:center;padding:14px 12px}
.bsheet:not(.bs-empty) .bs-wait,.bs-empty .bs-est,.bs-empty .bs-src{display:none}
.bs-foot{margin:0}
.bs-link{border:0;background:none;padding:0;color:var(--dim);font:inherit;font-size:14px;text-decoration:underline;text-underline-offset:3px;cursor:pointer;min-height:44px}
.bs-chip:focus-visible,.bs-switch:focus-visible,.bs-link:focus-visible,.bstoggle:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.bs-track i,.bs-meter i,.bs-switch,.bs-switch i{transition:none}}
.watchtop{display:grid;gap:4px;margin:0 0 10px;padding:14px 16px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);color:var(--fg);text-decoration:none;transition:background-color .12s}
.watchtop b{font-size:19px;font-weight:600;letter-spacing:-.01em;line-height:1.25;color:var(--acc)}
.watchtop .wt1{font-size:13px;color:var(--dim)}
.watchtop .wt2{font-size:14px;color:var(--dim)}
.land .howlink{margin:4px 0 20px;font-size:15px}
.land .howlink a{display:inline-flex;align-items:center;min-height:44px;color:var(--acc);text-decoration:underline;text-underline-offset:3px}
/* Design pass (2026-10-12): the card looked like text; a visible button says it starts something. Chip, not accent: Build it is the page's one green button. */
.watchtop .wtgo{justify-self:start;display:inline-flex;align-items:center;min-height:44px;padding:0 16px;margin-top:8px;border-radius:10px;background:var(--chip);color:var(--fg);font-size:15px;font-weight:500;box-shadow:inset 0 0 0 1px var(--line)}
.watchmore{display:flex;flex-wrap:wrap;gap:0 16px;margin:0 0 28px}
.watchmore a{min-height:44px;display:inline-flex;align-items:center;font-size:14px;color:var(--acc);text-decoration:underline;text-underline-offset:3px}
@media (hover:hover){.watchtop:hover{background:var(--chip)}}
.land{max-width:560px;margin:0 auto;padding:5vh 0 24px}
.land h1{font-size:34px;line-height:1.15;font-weight:600;margin:0 0 10px;letter-spacing:-.01em;text-wrap:balance}
.land .lede{margin:0 0 24px;font-size:17px}
.landask{display:flex;flex-direction:column;gap:10px}
.landask textarea{width:100%;min-height:96px;font:17px/1.45 'Geist',sans-serif;padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:none}
.landask .btn{min-height:48px;font-size:16px}
.land .browse{display:flex;align-items:center;justify-content:space-between;margin:28px 0 0;padding:14px 0;border-top:1px solid var(--line);color:var(--fg);font-weight:500;text-decoration:none}
.land .browse .n{color:var(--dim);font-variant-numeric:tabular-nums;font-weight:400}
.land .browse+.browse{margin-top:0}
.doors{margin-top:28px}
.doors .browse{margin-top:0}
.doors .browse:last-child{border-bottom:1px solid var(--line)}
/* The three doors are cards. Tap feedback is the whole card: border darkens, a light fill,
   a slight press, held until the next page arrives (Eyal, 2026-10-07: "something in the
   overall section, not the right side only"; the spinner hid under the thumb). */
.doors{display:flex;flex-direction:column;gap:8px}
.land .doors .browse{margin:0;padding:14px 16px;border:1px solid var(--line);border-top:1px solid var(--line);border-radius:14px;transition:background-color .12s,border-color .12s,transform .12s;-webkit-tap-highlight-color:transparent}
.doors .browse:last-child{border-bottom:1px solid var(--line)}
.land .doors .browse{min-height:76px;box-sizing:border-box}
.land .doors .browse small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.land .doors .browse>span{min-width:0}
.land .doors .browse:active,.land .doors .browse.going{background:var(--chip);border-color:color-mix(in srgb,var(--fg) 55%,var(--line));transform:scale(.98)}
@media (hover:hover){.land .doors .browse:hover{border-color:color-mix(in srgb,var(--fg) 20%,var(--line))}}
.tryh{font-size:17px;font-weight:600;margin:32px 0 2px}
.trys{margin:0 0 12px;color:var(--dim);font-size:15px}
.tryrow{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding-inline:16px;margin:0 -16px;padding:2px 16px 6px;scrollbar-width:none}
.tryrow::-webkit-scrollbar{display:none}
.tcard{flex:none;width:148px;scroll-snap-align:start;color:var(--fg);text-decoration:none}
.tcard img{display:block;width:148px;height:197px;object-fit:cover;object-position:top;border-radius:10px;box-shadow:inset 0 0 0 1px var(--line);border:1px solid var(--line);background:var(--card)}
.tcard b{display:block;font-size:15px;font-weight:600;margin:8px 0 2px}
.tcard span{display:block;font-size:13px;line-height:1.35;color:var(--dim)}
@media (min-width:900px){.tryrow{margin:0;padding:2px 0 6px;scroll-padding-inline:0}}
.land .browse small{display:block;margin-top:2px;color:var(--dim);font-size:14px;font-weight:400;line-height:1.4}
.land~.foot3{max-width:560px;margin-left:auto;margin-right:auto}
/* One green button on the start page: the box's own Build it. */
body:has(.land) .gbuild{display:none}
@media (min-width:900px){.land{padding-top:16vh}.land h1{font-size:36px}}
`;

/** Small apps that run here, each with one change to ask for: the fastest way to see
 *  fork-and-change (Eyal, 2026-10-04: "hand-picked projects someone can easily fork
 *  and change, to demonstrate it"). The suggestion rides along (?ask=) into the
 *  copy's box after Fork. Thumbnails: public/_forq/thumbs/, 360x480 shots. */
const TRY: [string, string, string][] = [
  ['calculator', 'Calculator', 'Add a history of past results'],
  ['2048', '2048', 'Show the best score of all time'],
  ['javascript-tetris', 'Tetris', 'Add touch controls so it plays on a phone'],
  ['timer', 'Focus timer', 'Add a 90 minute option'],
  ['tipsplit', 'Tip split', 'Let each person pay a different share'],
  ['todo', 'To-do', 'Add due dates'],
];
function tryRow(entries: Entry[]) {
  // Only the ones this instance has (a self-hosted copy starts without forq's showcase).
  const have = new Set(entries.map((e) => e.slug));
  const items = TRY.filter(([n]) => have.has(`forq.${n}`));
  if (!items.length) return '';
  return `<h2 class="tryh">Or try changing one of these</h2>
<p class="trys">Open it, tap Fork, and send the change under it. Agents do the rest.</p>
<div class="tryrow">${items.map(([n, title, ask]) => `<a class="tcard" href="/p/forq/${n}/app?ask=${encodeURIComponent(ask)}">
<img src="/_forq/thumbs/${n}.webp" alt="" width="360" height="480" loading="lazy" decoding="async"><b>${esc(title)}</b><span>Try asking: ${esc(ask)}</span></a>`).join('')}</div>`;
}
