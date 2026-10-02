// Design v3, "views" (variant C, 2026-10-02): a project is a set of views on
// the same thing, each at its own URL, switched from a bottom tab bar (a left
// rail on desktop). Views are a small registry: a new one is one entry here.
// Why: docs/design-v2.md ("Views").

import type { Entry } from './registry';
import type { ProjectInfo } from './project';
import type { BoxStatus, Overview } from './ui';
import { esc, path, label, STEPS } from './ui';
import { freshTag } from './fresh';
import { markdown } from './md';
import { SHEET_HTML, shortId } from './sheet';
import {
  type Change, type ProjectArgs, ORDER, OPEN_ICON_C as OPEN_ICON, SEND, VISIT, BUSY,
  accentOf, appUrl, changeRow, changesOf, fixtureData, forkAction, FORK_JS, fromIssues, isMerge, keyNote, legend,
  noApp, pageJs, planningHtml, planningOf, primary, shell2,
} from './v2';

export type ViewId = 'readme' | 'changes' | 'app' | 'code' | 'history' | 'more' | 'agents' | 'errors';
export const VIEW_IDS: ViewId[] = ['readme', 'changes', 'app', 'code', 'history', 'more', 'agents', 'errors'];

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
  id: ViewId; label: string; icon: string; tab?: boolean; desc?: string;
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
  more: I('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  agents: I('<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
  errors: I('<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>'),
  about: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
  readme: I('<path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M8.5 13h7M8.5 16.5h5"/>'),
};

const needsOf = (open: Change[]) => open.filter((c) => primary(c));

// ---- the views ---------------------------------------------------------------

/** Changes: what is in progress, as a conversation, newest at the bottom. */
function changesView(c: Ctx) {
  return {
    body: `<div class="thread"><div class="tin" id="live">${liveChanges(c)}</div></div>`,
    compose: c.needsKey ? `<div class="compose">${keyNote}</div>` : `<div class="compose"><form class="ask"><textarea rows="1" placeholder="Ask for a change" enterkeyhint="send" aria-label="Ask for a change"></textarea>${SEND}</form></div>`,
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
  const out = groups.map((g, i) => {
    const you = !g.text ? '' : fromIssues(g.text)
      ? `<div class="you sys"><b>Cloudflare Issues reported an error</b>${esc(g.text.replace(/^Production error from Cloudflare Issues:\s*/, '').slice(0, 220))}</div>`
      : `<div class="you">${esc(g.text)}</div>`;
    const last = i === groups.length - 1;
    const tail = last && !(q && isMerge(q.text)) ? `${planningHtml(plan, q)}${plan.said ? `<div class="said">${esc(plan.said)}</div>` : ''}` : '';
    return `${you}${g.changes.map((ch) => changeRow(info, ch, now, accent)).join('')}${tail}`;
  });
  if (q && isMerge(q.text)) out.push(planningHtml(plan, q));
  const merged = done.length ? `<a class="older" href="${c.base}/history">${done.length} merged change${done.length > 1 ? 's' : ''} in History</a>` : '';
  const empty = !out.join('').trim() ? `<div class="hello"><b>Nothing in progress.</b><p>Ask for a change in plain words. forq splits it into tasks, an agent does each one on its own fork, and a reviewer checks it before you merge.</p></div>` : '';
  return `<template id="needs" data-n="${needsOf(open).length}"></template>${merged}${empty}${out.join('')}${legend(open.length)}`;
}

/** App: the running app, with a picker for Live or any change you can try. */
function appView(c: Ctx) {
  const app = appUrl(c);
  const tryable = c.own ? c.open.filter((ch) => ch.tryUrl) : [];
  const sel = tryable.find((ch) => shortId(ch.a.id) === c.tryAgent);
  const src = sel?.tryUrl || app;
  const picker = tryable.length ? `<div class="pick" role="tablist"><button type="button" role="tab" data-pick="${esc(app)}" class="${sel ? '' : 'on'}">Live</button>${tryable.map((ch) =>
    `<button type="button" role="tab" data-pick="${esc(ch.tryUrl!)}" data-agent="${esc(shortId(ch.a.id))}" data-state="${ch.state}" data-id="${esc(ch.a.id)}" data-word="${esc(ch.word)}" class="${sel === ch ? 'on' : ''}"><span class="dot s-${ch.state}"></span>${esc(ch.title)}</button>`).join('')}</div>
<div class="pstrip" id="pstrip"${sel ? '' : ' hidden'}><span id="pword">${sel ? esc(sel.word) : ''}</span><button type="button" class="btn" id="pmerge"${sel?.state === 'ready' ? '' : ' hidden'}>Merge</button></div>` : '';
  return {
    full: true,
    action: app ? `<a class="hact" id="ext" href="${esc(src)}" target="_blank" rel="noopener" aria-label="Open the app in a new tab">${OPEN_ICON}</a>` : '',
    body: `${picker}${app ? `<iframe id="app" src="${esc(src)}" title="${esc(c.info.name)}"></iframe>` : noApp(c)}${c.own ? '' : `<div class="forkbar">${VISIT}${forkAction(c.info, c.me, c.forks.filter((e) => e.owner === c.me))}</div>`}`,
    js: `(function(){const f=document.getElementById('app'),x=document.getElementById('ext'),ps=document.getElementById('pstrip'),pm=document.getElementById('pmerge');let cur=null;
document.addEventListener('click',async(e)=>{const b=e.target.closest('[data-pick]');if(b){f.src=b.dataset.pick;if(x)x.href=b.dataset.pick;for(const o of document.querySelectorAll('[data-pick]'))o.classList.toggle('on',o===b);
 cur=b.dataset.id||null;if(ps){ps.hidden=!cur;document.getElementById('pword').textContent=b.dataset.word||'';pm.hidden=b.dataset.state!=='ready';}
 history.replaceState(null,'',location.pathname+(b.dataset.agent?'?try='+b.dataset.agent:''));return;}
 if(e.target===pm){pm.disabled=true;pm.textContent='Merging';try{await post('merge',{agent:cur});location.href=location.pathname;}catch(err){pm.textContent=err.message;}}});
if(${JSON.stringify(sel?.a.id || '')})cur=${JSON.stringify(sel?.a.id || '')};})();`,
  };
}

/** History: what happened to the project, newest first, by day. */
function historyView(c: Ctx) {
  const now = Date.now();
  type Item = { at: number; html: string };
  const items: Item[] = [];
  for (const ch of c.done) items.push({ at: ch.a.noteAt || ch.a.createdAt, html: `<span class="k">Merged</span><span class="t">${esc(ch.title)}</span><a class="sub" href="/p/${c.info.owner}/${c.info.name}/changes/${shortId(ch.a.id)}">See the code</a>` });
  for (const cm of c.overview.commits) if (!/^Merge /.test(cm.message)) items.push({ at: cm.at, html: `<span class="k">Commit</span><span class="t">${esc(cm.message)}</span><code class="sub">${esc(cm.hash.slice(0, 7))}</code>` });
  const dep = c.overview.app ?? c.info.app;
  if (dep?.status === 'live') items.push({ at: dep.at, html: `<span class="k">Deployed</span><span class="t"><a href="${esc(dep.url || '')}" target="_blank" rel="noopener">${esc((dep.url || '').replace('https://', ''))}</a></span>` });
  for (const f of c.forks) items.push({ at: f.createdAt, html: `<span class="k">Forked</span><span class="t"><a href="${path(f.slug)}">${esc(label(f.slug))}</a></span>` });
  items.push({ at: c.info.createdAt, html: `<span class="k">${c.info.forkedFrom ? 'Forked from' : c.info.importedFrom ? 'Imported' : 'Created'}</span><span class="t">${c.info.forkedFrom ? `<a href="${path(c.info.forkedFrom)}">${esc(label(c.info.forkedFrom))}</a>` : c.info.importedFrom ? `<a href="${esc(c.info.importedFrom.url)}" rel="noopener">${esc(c.info.importedFrom.fullName)}</a>` : esc(c.info.name)}</span>` });
  items.sort((a, b) => b.at - a.at);
  const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  let last = '';
  const rows = items.map((it) => { const d = day(it.at); const h = d !== last ? `<h3>${d}</h3>` : ''; last = d; return `${h}<div class="hi">${it.html}${freshTag(it.at, now, STEPS)}</div>`; }).join('');
  return { body: `<div class="pad">${rows}${legend(items.length)}</div>` };
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
${chips}${doc}${cur ? `<p class="srcl"><a href="/p/${info.owner}/${info.name}/code/${esc(cur)}">${esc(cur)} in Code</a></p>` : ''}</div>` };
}


/** More: the views that do not fit the tab bar, plus the account. */
function moreMenu(c: Ctx) {
  const extra = VIEWS.filter((v) => !v.tab && v.when(c));
  return `<div class="menu">${extra.map((v) => `<a class="mi" href="${c.base}/${v.id}">${v.icon}<span><b>${v.label}</b><span>${v.desc}</span></span></a>`).join('')}
<a class="mi" href="/settings">${ICONS.about}<span><b>Account</b><span>Your name${c.own ? '' : ', your Anthropic API key'}, sign out</span></span></a>
<a class="mi" href="/">${ICONS.app}<span><b>All projects</b><span>Your projects and Explore</span></span></a></div>`;
}
function moreView(c: Ctx) {
  return { body: `<div class="pad">${moreMenu(c)}</div>` };
}

const VIEWS: View[] = [
  { id: 'readme', label: 'Readme', icon: ICONS.readme, tab: true, when: () => true, render: readmeView },
  { id: 'changes', label: 'Changes', icon: ICONS.changes, tab: true, when: (c) => c.own, render: changesView },
  { id: 'app', label: 'App', icon: ICONS.app, tab: true, when: () => true, render: appView },
  { id: 'code', label: 'Code', icon: ICONS.code, tab: true, when: () => true, href: (c) => `/p/${c.info.owner}/${c.info.name}/code/` },
  { id: 'more', label: 'More', icon: ICONS.more, tab: true, when: (c) => c.own, render: moreView },
  { id: 'history', label: 'History', icon: ICONS.history, desc: 'Merged changes, commits, deploys and forks, by day', when: () => true, render: historyView },
  { id: 'agents', label: 'Agents', icon: ICONS.agents, desc: 'The router, the reviewer and each change\'s agent: chat or terminal', when: (c) => c.own, render: agentsView },
  { id: 'errors', label: 'Errors', icon: ICONS.errors, desc: 'Production errors from Cloudflare Issues and the fixes they started', when: (c) => c.worker, render: errorsView },
];

/** Tabs for this person: the owner's five, or a visitor's four (History instead of Changes and More). */
function tabsFor(c: Ctx) {
  return c.own ? VIEWS.filter((v) => v.tab && v.when(c)) : VIEWS.filter((v) => ['readme', 'app', 'code', 'history'].includes(v.id));
}

export function tabBar(c: Pick<Ctx, 'own' | 'base' | 'worker' | 'info'> & Partial<Ctx>, active: ViewId, needs: number) {
  const tabs = tabsFor(c as Ctx);
  return `<nav class="tabbar" aria-label="Views">${tabs.map((v) => {
    const on = v.id === active || (v.id === 'more' && !tabs.some((t) => t.id === active));
    const href = v.href ? v.href(c as Ctx) : `${c.base}/${v.id}`;
    // More opens a sheet over the current view; a second tap closes it (Eyal, 2026-10-02).
    if (v.id === 'more') return `<a href="${href}" class="tab${on ? ' on' : ''}" data-more aria-expanded="false" aria-controls="moresheet">${v.icon}<span>${v.label}</span></a>`;
    const badge = v.id === 'changes' && needs ? `<span class="badge" id="badge">${needs}</span>` : v.id === 'changes' ? '<span class="badge" id="badge" hidden></span>' : '';
    return `<a href="${href}" class="tab${on ? ' on' : ''}"${on ? ' aria-current="page"' : ''}>${v.icon}${badge}<span>${v.label}</span></a>`;
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
.pick button{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;max-width:min(70vw,280px);padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--dim);font:500 14px 'Instrument Sans',sans-serif;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
.docs a{flex:none;display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);color:var(--dim);font:500 14px 'Instrument Sans',sans-serif}
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
/* Tab bar: bottom on a phone, a left rail on a desktop. */
.tabbar{flex:none;display:flex;border-top:1px solid var(--line);background:var(--bg);padding-bottom:env(safe-area-inset-bottom)}
.tab{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:56px;color:var(--dim);font-size:12px;font-weight:500}
.tab.on{color:var(--fg)}
.tab.on svg{stroke-width:2.2}
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
`;

export function projectV3(o: ProjectArgs & { view: ViewId | null; status: Record<string, BoxStatus>; router: BoxStatus; reviewer: BoxStatus; tryAgent?: string; base?: string; docs?: Docs }) {
  const { info, me } = o;
  const own = info.owner === me;
  const worker = (o.overview.kind ?? info.kind) === 'worker';
  const { open, done } = changesOf(info, o.status, o.runBase);
  const c: Ctx = { ...o, own, worker, base: o.base || `/p/${info.owner}/${info.name}`, status: o.status, router: o.router, reviewer: o.reviewer, open, done, plan: planningOf(info, o.router), tryAgent: o.tryAgent, docs: o.docs };
  // The page opens where the work is: the owner on Changes, a visitor on the app.
  // Every project opens on its README (Eyal, 2026-10-02).
  let id: ViewId = o.view || 'readme';
  let v = VIEWS.find((x) => x.id === id && x.when(c) && x.render);
  if (!v) { id = 'readme'; v = VIEWS.find((x) => x.id === id)!; }
  const r = v.render!(c);
  const needs = own ? needsOf(open).length : 0;
  return shell2('c', `${v.label} · ${info.owner}/${info.name} · forq`, `
<header class="h3"><a class="home" href="/" aria-label="All projects">forq</a><a class="nm" href="${c.base}" style="color:inherit"><span class="o">${esc(info.owner)} /</span> <b>${esc(info.name)}</b></a>${r.action || ''}</header>
<main class="view${r.full ? ' full' : ''}" id="view">${r.body}</main>${r.compose || ''}
${tabBar(c, id, needs)}
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
document.addEventListener('focusout',()=>document.body.classList.remove('typing'));
${r.js || ''}
</script>`, V3_CSS, 'v3');
}

/** The polled part of a view (Changes, Agents). */
export function liveV3(view: string, o: ProjectArgs & { status: Record<string, BoxStatus>; router: BoxStatus; reviewer: BoxStatus }) {
  const own = o.info.owner === o.me;
  const { open, done } = changesOf(o.info, o.status, o.runBase);
  const c: Ctx = { ...o, own, worker: o.info.kind === 'worker', base: `/p/${o.info.owner}/${o.info.name}`, open, done, plan: planningOf(o.info, o.router) };
  return view === 'agents' ? liveAgents(c) : liveChanges(c);
}

/** Wrap a code-browser page (an older full page) with the tab bar on the Code tab. */
export function withTabs(html: string, info: ProjectInfo, me: string) {
  const own = info.owner === me;
  const { open } = changesOf(info, {}, '');
  const bar = tabBar({ own, base: `/p/${info.owner}/${info.name}`, worker: info.kind === 'worker', info }, 'code', own ? needsOf(open).length : 0);
  const css = `<style>${V3_CSS.slice(V3_CSS.indexOf('/* Tab bar'))}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:30}
body{padding-bottom:calc(64px + env(safe-area-inset-bottom))}
@media (min-width:900px){.tabbar{right:auto;top:0;bottom:0;width:80px}body{padding-bottom:0;padding-left:80px}}
.badge{position:absolute}</style>`;
  return html.replace('</head>', `${css}</head>`).replace('</body>', `${bar}</body>`);
}

/** Sample data for /design-fixture on the views host. */
export function fixtureV3(runBase: string, mode: string, view: ViewId | null, tryAgent?: string) {
  const f = fixtureData(runBase, mode);
  const docs: Docs = { list: ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'docs/sharing.md', 'LICENSE'].map((p) => ({ path: p, label: docLabel(p) })), current: 'README.md', text: f.overview.readme };
  return projectV3({ info: f.info, entry: f.entry, forks: [], overview: f.overview, me: 'eyal', runBase, liveHtml: '', view, status: f.status, router: f.router, reviewer: { awake: true, cc: 'idle' }, tryAgent, base: '/design-fixture', docs });
}
