// Pages: explore (/) and project (/p/<owner>/<name>). Server-rendered; the
// project page polls one endpoint for its agents panel. Tokens: DESIGN.md.

import type { Entry } from './registry';
import type { Agent, ProjectInfo } from './project';
import { FRESH_CSS, freshHelp, freshLegend, freshTag } from './fresh';
import { markdown } from './md';
import { MAX_IMPORT_KB } from './github';
import { SHEET_CSS, SHEET_HTML, SHEET_JS, previewTabs, shortId } from './sheet';

export const esc = (s: string) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));
export const STEPS = [14 * 24, 3 * 24, 24, 3];   // freshbar horizon: empty after 14 days
export const path = (slug: string) => `/p/${slug.replace('.', '/')}`;
export const label = (slug: string) => slug.replace('.', ' / ');

const CSS = `
:root{--bg:#fff;--card:#f6f7f8;--chip:#eceef1;--line:#e2e5e9;--fg:#15171a;--dim:#5f6670;--acc:#17695a;--acc-fg:#fff;--busy:#b7791f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1112;--card:#171a1c;--chip:#202427;--line:#272b2f;--fg:#e8eaec;--dim:#9ba2a9;--acc:#4fbf9f;--acc-fg:#0f1112;--busy:#e0a948;color-scheme:dark}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
input:focus,textarea:focus{outline:none;border-color:var(--acc)!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--acc) 22%,transparent)}
a:focus-visible,button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 'Instrument Sans',sans-serif}
main{max-width:720px;margin:0 auto;padding:12px 16px calc(32px + env(safe-area-inset-bottom))}
a{color:var(--acc);text-decoration:none}
header.top{display:flex;align-items:center;justify-content:space-between;height:48px}
.mark{font-weight:600;font-size:20px;color:var(--fg);letter-spacing:-.01em}
.who{font-size:13px;color:var(--dim)}
.top .tr{display:flex;align-items:center;gap:12px}
.top .chipbtn{min-height:40px;font-size:14px;padding:0 12px}
.intro{color:var(--dim);margin:4px 0 24px;font-size:15px}
h1{font-size:24px;line-height:1.2;margin:8px 0 4px;font-weight:600;word-break:break-word}
h2{font-size:15px;font-weight:600;margin:32px 0 8px}
.owner{color:var(--dim);font-weight:400}
.rows{display:flex;flex-direction:column;gap:8px}
.row{position:relative;display:block;background:var(--card);border-radius:12px;padding:12px 14px;color:inherit}
.row .t{display:block;font-size:15px;color:var(--fg)}
/* The whole card is the link (stretched ::after); the freshbar sits above it so a tap on it opens the explainer instead. */
.stretch::after{content:'';position:absolute;inset:0;border-radius:12px}
.row button.fresh{position:relative;z-index:1}.row .t b{font-weight:600}
.row .d{color:var(--dim);font-size:14px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta .yours{color:var(--acc)}
.meta.one{flex-wrap:nowrap;overflow:hidden;white-space:nowrap}
.meta.one span:last-child{overflow:hidden;text-overflow:ellipsis}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font-size:13px;color:var(--dim);margin-top:8px}
.back{display:inline-flex;align-items:center;min-height:44px;font-size:15px}
.desc{color:var(--dim);margin:0}
.actions{display:flex;gap:8px;margin:16px 0}
.btn,.chipbtn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:8px;border:0;font:500 15px 'Instrument Sans',sans-serif;cursor:pointer;transition:background-color .12s}
.btn{background:var(--acc);color:var(--acc-fg)}
.chipbtn{background:var(--chip);color:var(--fg)}
.btn[disabled]{opacity:.6}
.preview{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card);height:min(560px,70dvh)}
.preview iframe{width:100%;height:100%;border:0;display:block;background:#fff}
.note{background:var(--card);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--dim);margin-top:16px}
.files{display:flex;flex-wrap:wrap;gap:6px}
.files span,.files a{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:6px 8px;color:var(--fg)}
.readme{background:var(--card);border-radius:12px;padding:4px 16px;font-size:15px;overflow-wrap:anywhere}
.readme h2,.readme h3,.readme h4{margin:16px 0 6px;font-size:17px}
.readme code{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:1px 4px}
.readme pre{overflow-x:auto;background:var(--chip);border-radius:8px;padding:10px}
.readme hr{border:0;border-top:1px solid var(--line);margin:16px 0}
.commit{display:flex;gap:8px;align-items:baseline;font-size:14px;padding:6px 0;border-bottom:1px solid var(--line)}
.commit .msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.commit code{font:12px 'JetBrains Mono',monospace;color:var(--dim)}
.composer textarea{width:100%;min-height:76px;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:vertical}
.composer .bar{display:flex;gap:8px;margin-top:8px;align-items:center}
.composer .bar .btn{flex:1}
.router{background:var(--card);border-radius:12px;padding:12px 14px;margin-top:12px;font-size:14px}
.router .rh{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-height:24px}
.router .who{font-weight:600;color:var(--fg)}
.router .phase{color:var(--dim);font-variant-numeric:tabular-nums}
.router.busy .phase{color:var(--fg)}
.router .phase .n{color:var(--fg)}
.router .phase .chipbtn{min-height:36px;padding:0 12px;font-size:14px;margin-left:4px}
.router .err{color:var(--fg)}
.router .you{margin-top:8px;color:var(--fg);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.router .you b{font-weight:600;margin-right:4px}
.router .acts{display:flex;gap:8px;margin-top:10px}
.router .acts .chipbtn{min-height:40px;padding:0 12px;font-size:14px}
.router .said{margin-top:8px;color:var(--dim);white-space:pre-wrap;word-break:break-word;max-height:9.5em;overflow:auto}
.card .h .st{font-variant-numeric:tabular-nums}
.card.busy .h .st{color:var(--fg)}
.cards{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.card{background:var(--card);border-radius:12px;padding:12px 14px}
.card .h{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dim)}
.card .h .st{margin-left:auto}
.dot{width:9px;height:9px;border-radius:50%;background:var(--line);flex:none}
.dot.idle{background:var(--acc)}.dot.busy{background:var(--busy)}
.io{margin:8px 0 0}
.io dt{font-size:12px;color:var(--dim);margin-top:8px}
.io dt:first-child{margin-top:0}
.io dd{margin:2px 0 0;font-size:15px;word-break:break-word}
.io dd.none{color:var(--dim);font-size:14px}
.io dd.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.io dd.clamp.open{-webkit-line-clamp:unset}
.io dd.rv b{font-weight:600}
.card .pv{margin:8px 0 0;font-size:14px;color:var(--dim)}
.card .pv.busy{color:var(--fg)}
.note.deploy b{color:var(--fg)}
.note.deploy .chipbtn{min-height:36px;padding:0 12px;font-size:14px;margin-left:4px}
.io dd.rv.approved b{color:var(--acc)}
.io dd.rv .rn{display:block;margin-top:2px;color:var(--fg)}
.router.reviewer{margin-top:8px}
.card .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.card .acts .chipbtn,.card .acts .btn{min-height:40px;padding:0 12px;font-size:14px}
.empty{color:var(--dim);font-size:14px}
.search input{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);margin:16px 0 12px}
.sugg{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:16px}
.sugg>span{color:var(--dim);font-size:14px}
.sugg[hidden]{display:none}
.sugg .chipbtn{min-height:40px;font-size:14px;padding:0 12px}
.row.gh .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}
.row.gh .acts .btn,.row.gh .acts .chipbtn{min-height:40px;font-size:14px;padding:0 14px}
@media (hover:hover){.row:hover{background:var(--chip)}.chipbtn:hover{background:var(--line)}}
${FRESH_CSS}${SHEET_CSS}`;

export const shell = (title: string, body: string, steps: number[] = STEPS) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><main>${body}</main>${freshHelp(steps)}</body></html>`;

const stars = (n: number) => `${n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : n} stars`;

function row(e: Entry, forks: number, now: number, mineFork?: Entry) {
  return `<div class="row"><a class="t stretch" href="${path(e.slug)}"><span class="owner">${esc(e.owner)} /</span> <b>${esc(e.name)}</b></a>
  ${e.description ? `<div class="d">${esc(e.description)}</div>` : ''}
  <div class="meta one">${freshTag(e.updatedAt, now, STEPS)}${mineFork ? `<span class="yours">you have a fork</span>` : ''}${forks ? `<span>${forks} fork${forks > 1 ? 's' : ''}</span>` : ''}${e.forkedFrom ? `<span>forked from ${esc(label(e.forkedFrom))}</span>` : e.importedFrom ? `<span>${stars(e.importedFrom.stars)} on GitHub</span>` : ''}</div></div>`;
}

export function explorePage(entries: Entry[], me: string) {
  const now = Date.now();
  const forks = (slug: string) => entries.filter((e) => e.forkedFrom === slug).length;
  const mine = entries.filter((e) => e.owner === me);
  const others = entries.filter((e) => e.owner !== me);
  return shell('forq', `<header class="top"><span class="mark">forq</span><span class="tr">${me ? `<a class="chipbtn" href="/import">Import from GitHub</a><a class="who" href="/settings">${esc(me)}</a>` : `<a class="chipbtn" href="/login">Sign in</a>`}</span></header>
<p class="intro">Projects that run. Open one, fork it, then tell its router agent what to change.${me ? '' : ' Reading is open to everyone; sign in with your email to fork and run agents with your own Anthropic API key.'}</p>
${mine.length ? `<h2>Yours</h2><p class="fresh-legend">Shaded dates: full today, empty after two weeks. Tap one for more.</p><div class="rows">${mine.map((e) => row(e, forks(e.slug), now)).join('')}</div>` : ''}
<h2>Explore</h2>${mine.length ? '' : '<p class="fresh-legend">Shaded dates: full today, empty after two weeks. Tap one for more.</p>'}<div class="rows">${others.map((e) => row(e, forks(e.slug), now, mine.find((m) => m.forkedFrom === e.slug))).join('') || '<p class="empty">Nothing here yet.</p>'}</div>
<p class="empty" style="margin-top:32px"><a href="/about">About</a>&nbsp;&nbsp; <a href="/privacy">Privacy</a></p>`);
}

export type Overview = { importing?: boolean; entry?: string | null; kind?: 'worker' | 'static'; app?: ProjectInfo['app']; commits: { hash: string; message: string; at: number; author: string }[]; files: { name: string; dir: boolean }[]; readme: string | null };

/** Worker projects: where the live app is, or what the builder is doing. */
function deployLine(info: ProjectInfo, d: ProjectInfo['app'], own: boolean) {
  const now = Date.now();
  const logLink = d?.log ? ` <a href="/p/${info.owner}/${info.name}/build-log">View build log</a>` : '';
  const again = own ? ` <button type="button" class="chipbtn" id="redeploy">Deploy again</button>` : '';
  const body = !d ? 'A Cloudflare Worker. Not deployed yet; it deploys when this page first loads.'
    : d.status === 'building' ? `<b>Deploying</b> <span data-since="${d.at}">0s</span>. forq's builder runs wrangler for it; the first deploy takes about a minute.`
    : d.status === 'failed' ? `<b>Deploy failed:</b> ${esc(d.error || 'unknown error')}.${logLink}${again}`
    : `Live as a Cloudflare Worker at <a href="${esc(d.url || '')}" target="_blank" rel="noopener">${esc((d.url || '').replace('https://', ''))}</a> ${freshTag(d.at, now, STEPS)}${logLink}${again}`;
  return `<p class="note deploy${d?.status === 'building' ? ' busy' : ''}">${body}</p>${d?.status === 'building' ? '<script>setTimeout(function(){location.reload()},6000)</script>' : ''}
<script>(function(){const b=document.getElementById('redeploy');if(b)b.onclick=async()=>{b.disabled=true;b.textContent='Queued';await fetch('/api/p/${info.owner}/${info.name}/deploy',{method:'POST'});location.reload();};
for(const el of document.querySelectorAll('.deploy [data-since]')){const t=Number(el.dataset.since);setInterval(()=>{el.textContent=Math.round((Date.now()-t)/1000)+'s'},1000);}})();</script>`;
}

export function projectPage(o: { info: ProjectInfo; entry: Entry; forks: Entry[]; overview: Overview; me: string; runBase: string; agentsHtml: string; needsKey?: boolean }) {
  const { info, entry, forks, overview, me, runBase } = o;
  const now = Date.now();
  const own = info.owner === me;
  const isWorker = (overview.kind ?? info.kind) === 'worker';
  const dep = overview.app ?? info.app;
  const webAt = isWorker ? '' : overview.entry ?? info.entry;   // folder of the web page; null = none
  const app = isWorker ? (dep?.url ? `${dep.url}/` : '') : `${runBase}/${info.repo}/${webAt || ''}`;
  const src = info.importedFrom;
  const myForks = forks.filter((e) => e.owner === me);
  return shell(`${info.owner}/${info.name} · forq`, `<a class="back" href="/">Explore</a>
<h1><span class="owner">${esc(info.owner)} /</span> ${esc(info.name)}</h1>
${info.description ? `<p class="desc">${esc(info.description)}</p>` : ''}
<div class="meta">${freshTag(entry.updatedAt, now, STEPS)}${forks.length ? `<span>${forks.length} fork${forks.length > 1 ? 's' : ''}</span>` : ''}${info.forkedFrom ? `<span>forked from <a href="${path(info.forkedFrom)}">${esc(label(info.forkedFrom))}</a></span>` : ''}${src && !info.forkedFrom ? `<span>imported from <a href="${esc(src.url)}" rel="noopener">GitHub ${esc(src.fullName)}</a></span>` : ''}${src ? `<span>${stars(src.stars)}</span>${src.license ? `<span>${esc(src.license)}</span>` : ''}` : ''}</div>
${own ? '' : myForks.length
    ? `<div class="actions"><a class="btn" href="${path(myForks[0].slug)}">Open your fork</a><button class="chipbtn" id="fork">Fork again</button></div>
<p class="desc">You forked it as <a href="${path(myForks[0].slug)}">${esc(label(myForks[0].slug))}</a>${myForks.length > 1 ? ` and ${myForks.length - 1} more` : ''}.</p>`
    : me ? `<div class="actions"><button class="btn" id="fork">Fork to ${esc(me)}</button></div>`
    : `<div class="actions"><a class="btn" href="/login?next=${encodeURIComponent(path(info.slug))}">Sign in to fork</a></div>`}
${overview.importing
    ? `<p class="note" id="importing">Importing from GitHub. This page refreshes when it is ready (usually a few seconds).</p>
<script>setTimeout(function(){location.reload()},3000)</script>`
    : isWorker
      ? `${deployLine(info, dep, own)}${dep?.url ? `<div class="pbar"><div class="ptabs" id="ptabs">${previewTabs(info, runBase)}</div><a class="pext" id="pext" href="${app}" target="_blank" rel="noopener">Open in new tab</a></div>
<div class="preview"><iframe src="${app}" title="${esc(info.name)} app" loading="lazy"></iframe></div>` : ''}`
    : webAt === null
      ? `<p class="note">No web page to show: forq looks for an index.html at the root and in demo/, docs/, public/, dist/, www/, site/ and examples/. The code is below, and agents can still work on it.</p>`
      : `<div class="pbar"><div class="ptabs" id="ptabs">${previewTabs(info, runBase)}</div><a class="pext" id="pext" href="${app}" target="_blank" rel="noopener">Open in new tab</a></div>
<div class="preview"><iframe src="${app}" title="${esc(info.name)} app" loading="lazy"></iframe></div>`}
${own && o.needsKey ? `<h2>Agents</h2><p class="note">Agents here run Claude Code with your own Anthropic API key. <a href="/settings">Add your key in Settings</a> to start one.</p>` : ''}${own && !o.needsKey ? `<h2>Agents</h2>
<form class="composer" id="ask"><textarea name="text" placeholder="Tell the router agent what to change. It splits the work and starts one agent per task." required enterkeyhint="send"></textarea>
<div class="bar"><button class="btn">Send</button></div></form>
<div id="agents">${o.agentsHtml}</div>${SHEET_HTML}` : ''}${own ? ''
    : `<p class="note">Fork it to change it: your copy gets its own page, its own live app and its own agents.</p>`}
<h2>Code</h2><div class="files">${overview.files.map((f) => `<a href="/p/${info.owner}/${info.name}/code/${esc(f.name)}${f.dir ? '/' : ''}">${esc(f.name)}${f.dir ? '/' : ''}</a>`).join('') || '<span>empty</span>'}</div>
<p style="margin:10px 0 0"><a class="chipbtn" href="/p/${info.owner}/${info.name}/code/">Browse and search the code</a></p>
${overview.readme ? `<h2>README</h2><div class="readme">${markdown(overview.readme)}</div>` : ''}
${forks.length ? `<h2>Forks</h2><div class="rows">${forks.map((e) => row(e, 0, now)).join('')}</div>` : ''}
<h2>Recent commits</h2>${src && !info.forkedFrom ? `<p class="empty">Imported with the latest commit only; full history stays on <a href="${esc(src.url)}" rel="noopener">GitHub</a>.</p>` : ''}${overview.commits.map((c) => `<div class="commit">${freshTag(c.at, now, STEPS)}<span class="msg">${esc(c.message)}</span><code>${esc(c.hash.slice(0, 7))}</code></div>`).join('') || '<p class="empty">No commits yet.</p>'}
<script>
const API='/api/p/${esc(info.owner)}/${esc(info.name)}';
const fork=document.getElementById('fork');
if(fork)fork.onclick=async()=>{fork.disabled=true;fork.textContent='Forking';
 const r=await fetch(API+'/fork',{method:'POST'});const j=await r.json();
 if(r.ok)location.href=j.path;else{fork.disabled=false;fork.textContent=j.error||'Fork failed';}};
const ask=document.getElementById('ask');
if(ask){
 const box=document.getElementById('agents');
 // Seconds since a phase began, ticking every second on every [data-since].
 const tick=()=>{for(const el of document.querySelectorAll('[data-since]')){const s=Math.max(0,Math.round((Date.now()-Number(el.dataset.since))/1000));el.textContent=s<60?s+'s':Math.floor(s/60)+'m '+(s%60)+'s';}};
 setInterval(tick,1000);
 const esc=(t)=>t.replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
 async function send(text){
  // Show it at once: the request, and a phase line that ticks while the server works.
  const rp=box.querySelector('.router');
  if(rp)rp.outerHTML='<div class="router busy"><div class="rh"><span class="dot busy"></span><span class="who">Router agent</span><span class="phase">Sending <span data-since="'+Date.now()+'">0s</span></span></div><div class="you"><b>You</b> '+esc(text)+'</div></div>';
  tick();
  const r=await fetch(API+'/router',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text})});
  if(!r.ok){const j=await r.json().catch(()=>({}));const ph=box.querySelector('.router .phase');if(ph)ph.textContent=j.error||'Could not send. Try again.';return false;}
  poll();return true;
 }
 ask.onsubmit=async(e)=>{e.preventDefault();const t=ask.text.value.trim();if(!t)return;ask.text.value='';
  if(!(await send(t)))ask.text.value=t;};
 box.addEventListener('click',async(e)=>{
  const retry=e.target.closest('[data-retry]');if(retry){retry.disabled=true;send(retry.dataset.retry);return;}
  const c=e.target.closest('dd.clamp');if(c){c.classList.toggle('open');return;}
  const fx=e.target.closest('[data-fix],[data-review]');if(fx){fx.disabled=true;const isFix=!!fx.dataset.fix;fx.textContent=isFix?'Sending to the agent':'Queueing review';
   const r=await fetch(API+(isFix?'/fix':'/review'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:fx.dataset.fix||fx.dataset.review})});
   if(!r.ok){const j=await r.json().catch(()=>({}));fx.textContent=j.error||'Failed';}poll();return;}
  const m=e.target.closest('[data-merge]');if(!m)return;
  m.disabled=true;m.textContent='Asking the router agent';
  const r=await fetch(API+'/merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:m.dataset.merge})});
  if(!r.ok){const j=await r.json().catch(()=>({}));m.textContent=j.error||'Failed';}poll();});
 let timer=null;
 async function poll(){clearTimeout(timer);
  if(!document.hidden){try{const r=await fetch(API+'/agents-html');if(r.ok){const j=await r.json();box.innerHTML=j.html;tick();
   const pt=document.getElementById('ptabs');if(pt&&j.tabs!==undefined){const cur=window.forqCurrentPreview&&window.forqCurrentPreview();pt.innerHTML=j.tabs;for(const b of pt.querySelectorAll('.ptab'))b.classList.toggle('on',b.dataset.src===cur);}}}catch{}}
  // Fast while anything is in progress, slow when all is quiet.
  timer=setTimeout(poll,box.querySelector('.busy')?2000:5000);}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
 tick();timer=setTimeout(poll,box.querySelector('.busy')?2000:5000);
}
</script><script>${SHEET_JS}</script>`);
}

export type BoxStatus = { awake: boolean; booting?: boolean; taskSent?: boolean; cc: string; said?: string };

/** Requests forq made on behalf of a Cloudflare Issues alert (index.ts issuesHook). */
const fromIssues = (t: string) => t.startsWith('Production error from Cloudflare Issues');
const BUSY = /busy|thinking|working|running|tool/;
const since = (t: number) => `<span data-since="${t}">0s</span>`;

/** One honest word for where an agent is: starting until its task has gone in. */
function agentPhase(a: Agent, s: BoxStatus): { word: string; dot: string; busy: boolean; since?: number } {
  if (a.state === 'pushed') return { word: 'pushed', dot: s.awake ? 'idle' : '', busy: false };
  if (a.state === 'blocked') return { word: 'blocked', dot: 'busy', busy: false };
  if (a.state === 'merged' || a.state === 'stopped') return { word: a.state, dot: '', busy: false };
  if (s.booting || (s.awake && !s.taskSent) || (!s.awake && !s.taskSent)) return { word: 'starting', dot: 'busy', busy: true, since: a.createdAt };
  if (s.awake && BUSY.test(s.cc)) return { word: 'working', dot: 'busy', busy: true };
  if (s.awake) return { word: 'waiting for you', dot: 'idle', busy: false };
  return { word: 'asleep', dot: '', busy: false };
}

/** The router agent panel: your last request, then where it is, then its reply. */
function routerPanel(info: ProjectInfo, r: BoxStatus) {
  const q = info.lastRequest;
  const now = Date.now();
  const started = q ? info.agents.filter((a) => a.createdAt >= q.at).length : 0;
  const startedTxt = started ? ` <span class="n">${started} agent${started > 1 ? 's' : ''} started</span>` : '';
  let phase = '', busy = false, said = '';
  if (q?.state === 'failed') {
    phase = `<span class="err">Could not reach it: ${esc(q.error || 'unknown error')}</span> <button class="chipbtn" data-retry="${esc(q.text)}">Retry</button>`;
  } else if (q?.state === 'waking') {
    busy = true;
    phase = !r.awake ? `Waking up ${since(q.at)}` : `Starting Claude Code ${since(q.at)}`;
  } else if (q?.state === 'sent' && (BUSY.test(r.cc) || now - (q.sentAt || 0) < 8000)) {
    // Claude Code reads idle for a moment after a message lands, so the first
    // 8 s after delivery count as working too.
    busy = true;
    phase = `Working on it ${since(q.sentAt || q.at)}${startedTxt}`;
  } else {
    said = r.said || '';
    phase = r.awake ? (said ? '' : 'Ready') : 'Asleep. It wakes when you send something.';
  }
  const dot = busy ? 'busy' : r.awake ? 'idle' : '';
  return `<div class="router${busy ? ' busy' : ''}"><div class="rh"><span class="dot ${dot}"></span><span class="who">Router agent</span>${phase ? `<span class="phase">${phase}</span>` : ''}</div>
<div class="acts"><button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="chat">Chat</button><button type="button" class="chipbtn" data-sheet="${info.slug}--router" data-name="Router agent" data-mode="term">Terminal</button></div>
${q ? `<div class="you"><b>${fromIssues(q.text) ? 'Cloudflare Issues' : 'You'}</b> ${esc(q.text)}</div>` : ''}${said ? `<div class="said">${esc(said)}</div>` : ''}</div>`;
}

const REVIEW_WORD: Record<string, string> = { queued: 'Waiting for the reviewer', reviewing: 'Reviewing now', approved: 'Approved', changes: 'Changes suggested', sent: 'Sent to the agent to fix' };

function previewLine(info: ProjectInfo, a: Agent) {
  const p = a.preview;
  if (!p) return '';
  if (p.status === 'building') return `<p class="pv busy">Building its preview <span data-since="${p.at}">0s</span></p>`;
  if (p.status === 'failed') return `<p class="pv">Preview build failed: ${esc(p.error || '')}. <a href="/p/${info.owner}/${info.name}/build-log?agent=${a.id.split('--')[1]}">Build log</a></p>`;
  return '';
}

function reviewBlock(a: Agent) {
  const r = a.review;
  if (!r) return '';
  const live = r.state === 'queued' || r.state === 'reviewing';
  return `<dt>Review</dt><dd class="rv ${r.state}${live ? ' busy' : ''}"><b>${REVIEW_WORD[r.state] || r.state}</b>${live ? ` <span data-since="${r.at}">0s</span>` : ''}${r.notes ? `<span class="rn">${esc(r.notes)}</span>` : ''}</dd>`;
}

function reviewerRow(info: ProjectInfo, s: BoxStatus) {
  const doing = info.agents.find((a) => a.review?.state === 'reviewing');
  const queued = info.agents.filter((a) => a.review?.state === 'queued').length;
  const word = doing ? `Reviewing ${shortId(doing.id)}${queued ? `, ${queued} waiting` : ''}` : s.awake ? 'Idle' : 'Asleep. It reviews every push before you merge.';
  return `<div class="router reviewer${doing ? ' busy' : ''}"><div class="rh"><span class="dot ${doing ? 'busy' : s.awake ? 'idle' : ''}"></span><span class="who">Reviewer agent</span><span class="phase">${esc(word)}</span></div>
<div class="acts"><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="chat">Chat</button><button type="button" class="chipbtn" data-sheet="${info.slug}--review" data-name="Reviewer agent" data-mode="term">Terminal</button></div></div>`;
}

export function agentsHtml(info: ProjectInfo, runBase: string, router: BoxStatus, status: Record<string, BoxStatus>, reviewer: BoxStatus = { awake: false, cc: 'asleep' }) {
  const now = Date.now();
  const card = (a: Agent) => {
    const s = status[a.id] || { awake: false, cc: 'asleep' };
    const ph = agentPhase(a, s);
    const reviewing = a.review?.state === 'queued' || a.review?.state === 'reviewing';
    return `<div class="card${ph.busy || reviewing ? ' busy' : ''}"><div class="h"><span class="dot ${ph.dot}"></span><span>${esc(a.id.split('--')[1])}</span>${freshTag(a.noteAt || a.createdAt, now, STEPS)}<span class="st">${ph.word}${ph.since ? ` ${since(ph.since)}` : ''}</span></div>
<dl class="io">
${a.request ? `<dt>${fromIssues(a.request) ? 'Reported by Cloudflare Issues' : 'You asked'}</dt><dd class="clamp">${esc(a.request)}</dd>` : ''}
<dt>${a.request ? 'Its task, from the router agent' : 'Its task'}</dt><dd class="clamp">${esc(a.task)}</dd>
<dt>Result</dt><dd${a.note ? '' : ' class="none"'}>${a.note ? esc(a.note) : ph.busy ? 'Not yet. It reports here when it pushes.' : 'No report yet.'}</dd>
${reviewBlock(a)}
</dl>
${info.kind === 'worker' ? previewLine(info, a) : ''}<div class="acts">${info.kind === 'worker' ? (a.preview?.url ? `<button type="button" class="chipbtn" data-preview="${esc(a.preview.url)}/">Preview</button>` : '') : `<button type="button" class="chipbtn" data-preview="${runBase}/${a.fork}/${info.entry || ''}">Preview</button>`}<a class="chipbtn" href="/p/${info.owner}/${info.name}/changes/${shortId(a.id)}">Changes</a><button type="button" class="chipbtn" data-sheet="${a.id}" data-name="Agent ${shortId(a.id)}" data-mode="chat">Chat</button><button type="button" class="chipbtn" data-sheet="${a.id}" data-name="Agent ${shortId(a.id)}" data-mode="term">Terminal</button>${a.review?.state === 'changes' ? `<button type="button" class="chipbtn" data-fix="${esc(a.id)}">Ask agent to fix</button>` : ''}${a.state === 'pushed' && !a.review ? `<button type="button" class="chipbtn" data-review="${esc(a.id)}">Review it</button>` : ''}${a.state === 'pushed' ? `<button class="btn" data-merge="${esc(a.id)}">Merge${a.review?.state === 'changes' ? ' anyway' : ''}</button>` : ''}</div></div>`;
  };
  const open = info.agents.filter((a) => a.state !== 'merged' && a.state !== 'stopped').reverse();
  const done = info.agents.filter((a) => a.state === 'merged').reverse().slice(0, 5);
  return `${routerPanel(info, router)}${reviewerRow(info, reviewer)}
<div class="cards">${open.map(card).join('') || '<p class="empty">No agents working. Ask the router agent for a change.</p>'}</div>
${done.length ? `<h2>Merged</h2><div class="cards">${done.map(card).join('')}</div>` : ''}`;
}

const REPO_STEPS = [365 * 24, 90 * 24, 30 * 24, 7 * 24];   // GitHub activity: empty after a year

export function importPage(me: string) {
  if (!me) return shell('Import from GitHub · forq', `<a class="back" href="/">Explore</a>
<h1>Import from GitHub</h1>
<p class="desc">Bring any public GitHub repository into forq: it runs here, you can fork it, and agents can work on it.</p>
<div class="actions"><a class="btn" href="/login?next=/import">Sign in with your email to import</a></div>`);
  return shell('Import from GitHub · forq', `<a class="back" href="/">Explore</a>
<h1>Import from GitHub</h1>
<p class="desc">Search public repositories, or paste a repo's URL. forq copies the latest commit, finds its web page if it has one, and the project is yours to fork and hand to agents.</p>
<form id="gq" class="search" role="search"><input id="q" type="search" name="q" placeholder="Search GitHub, or paste a URL" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"></form>
<div class="sugg" id="sugg"><span>Try</span>${['2048', 'reveal.js', 'particles.js', 'tetris javascript', 'https://github.com/SortableJS/Sortable'].map((t) => `<button type="button" class="chipbtn" data-q="${esc(t)}">${esc(t.replace('https://github.com/', ''))}</button>`).join('')}</div>
<p class="fresh-legend">Shaded dates: last push, full this week, empty after a year.</p>
<div id="res" class="rows" aria-live="polite"></div>
<script>
const $q=document.getElementById('q'),$res=document.getElementById('res');
const esc=(t)=>String(t||'').replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const stars=(n)=>(n>=1000?(n/1000).toFixed(n>=10000?0:1)+'k':n)+' stars';
const STEPS=${JSON.stringify(REPO_STEPS)};
function rel(ts){const s=Math.max(0,(Date.now()-ts)/1000);if(s<3600)return Math.floor(s/60)+' min ago';if(s<86400)return Math.floor(s/3600)+'h ago';if(s<86400*60)return Math.floor(s/86400)+'d ago';if(s<86400*730)return Math.floor(s/86400/30)+' mo ago';return Math.floor(s/86400/365)+'y ago';}
function fresh(ts){const age=Date.now()-ts;const l=STEPS.filter((h)=>age<h*3600000).length;return '<button type="button" class="fresh'+(l===4?' is-new':'')+'" style="--l:'+l+'" popovertarget="fresh-help">'+rel(ts)+'</button>';}
let seq=0,timer=null;
async function run(){const q=$q.value.trim();const my=++seq;
 document.getElementById('sugg').hidden=!!q;
 if(q.length<2){$res.innerHTML='';return;}
 $res.innerHTML='<p class="empty">Searching GitHub</p>';
 let j;try{const r=await fetch('/api/github/search?q='+encodeURIComponent(q));j=await r.json();if(!r.ok)throw new Error(j.error||r.status);}catch(e){if(my===seq)$res.innerHTML='<p class="empty">'+esc(e.message)+'</p>';return;}
 if(my!==seq)return;
 if(!j.repos.length){$res.innerHTML='<p class="empty">Nothing found. Try other words, or paste the repo URL.</p>';return;}
 $res.innerHTML=j.repos.map((r)=>{const big=r.sizeKb>${MAX_IMPORT_KB};
  return '<div class="row gh"><div class="t"><span class="owner">'+esc(r.fullName.split('/')[0])+' /</span> <b>'+esc(r.name)+'</b></div>'+
  (r.description?'<div class="d">'+esc(r.description)+'</div>':'')+
  '<div class="meta">'+(r.pushedAt?fresh(r.pushedAt):'')+'<span>'+stars(r.stars)+'</span>'+(r.license?'<span>'+esc(r.license)+'</span>':'<span>no license</span>')+'<span>'+(r.sizeKb>=1024?Math.round(r.sizeKb/1024)+' MB':r.sizeKb+' KB')+'</span>'+(r.archived?'<span>archived</span>':'')+'</div>'+
  '<div class="acts">'+(big?'<span class="empty">Too big to import (over ${MAX_IMPORT_KB / 1024} MB)</span>':'<button type="button" class="btn" data-import="'+esc(r.fullName)+'">Import</button>')+'<a class="chipbtn" href="'+esc(r.url)+'" target="_blank" rel="noopener">View on GitHub</a></div></div>';}).join('');}
$q.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,450);});
document.getElementById('gq').onsubmit=(e)=>{e.preventDefault();clearTimeout(timer);run();};
document.getElementById('sugg').onclick=(e)=>{const b=e.target.closest('[data-q]');if(b){$q.value=b.dataset.q;run();}};
$res.addEventListener('click',async(e)=>{const b=e.target.closest('[data-import]');if(!b)return;
 b.disabled=true;b.textContent='Importing';
 const r=await fetch('/api/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({repo:b.dataset.import})});
 const j=await r.json().catch(()=>({}));if(r.ok)location.href=j.path;else{b.disabled=false;b.textContent=j.error||'Import failed';}});
if(location.hash.length>1){$q.value=decodeURIComponent(location.hash.slice(1));run();}
</script>`, REPO_STEPS);
}

export function buildLogPage(info: ProjectInfo, label: string, d: { status: string; error?: string; log?: string; at: number; url?: string } | undefined) {
  return shell(`Build log · ${info.name} · forq`, `<a class="back" href="/p/${info.owner}/${info.name}">${esc(info.owner)} / ${esc(info.name)}</a>
<h1>Build log</h1><p class="desc">${esc(label)}${d ? `: ${esc(d.status)}${d.error ? `, ${esc(d.error)}` : ''}` : ': no build yet'}</p>
${d?.url ? `<p><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.url)}</a></p>` : ''}
<pre style="background:var(--card);border-radius:12px;padding:12px;overflow:auto;font:12px/1.5 'JetBrains Mono',monospace;white-space:pre-wrap;word-break:break-word">${esc(d?.log || 'No log.')}</pre>`);
}

export function settingsPage(u: { handle: string; email: string; apiKeyTail?: string; apiKeyCheckedAt?: number; model?: string }, owner: boolean, projects: number, welcome: boolean) {
  const keyBlock = owner
    ? `<p class="desc">Your agents run on this instance's Claude subscription. No API key needed.</p>`
    : `${u.apiKeyTail ? `<p class="desc">Key ending in <b>…${esc(u.apiKeyTail)}</b>, checked ${freshTag(u.apiKeyCheckedAt || 0, Date.now(), STEPS)}. Your agents run on it with ${esc(({ 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5': 'Sonnet 5' } as Record<string, string>)[u.model || 'claude-sonnet-5-5'] || u.model || 'Sonnet 5.5')}.</p>` : `<p class="desc">Agents run Claude Code with your own Anthropic API key. You pay Anthropic directly; forq measured about $1–2 per finished, reviewed change on Sonnet.</p>`}
<form class="composer" id="keyf"><input class="field" name="key" type="password" autocomplete="off" placeholder="sk-ant-…" aria-label="Anthropic API key">
<div class="bar"><button class="btn">${u.apiKeyTail ? 'Replace key' : 'Save key'}</button>${u.apiKeyTail ? '<button type="button" class="chipbtn" id="rmkey">Remove</button>' : ''}</div></form>
<p class="note">The key is checked with one call to Anthropic, stored encrypted, and only used to start Claude Code in your projects' boxes. Get one at <a href="https://console.anthropic.com/settings/keys" rel="noopener" target="_blank">console.anthropic.com</a>.</p>`;
  return shell('Settings · forq', `<a class="back" href="/">Explore</a>
<h1>${welcome ? 'Welcome to forq' : 'Settings'}</h1>
${welcome ? `<p class="desc">You are signed in. ${[projects ? '' : 'Pick the name your projects live under', owner ? '' : 'add your Anthropic API key', 'then fork something from Explore'].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}.</p>` : ''}
<h2>Your name</h2>
<form class="composer" id="hf"><input class="field" name="handle" value="${esc(u.handle)}" ${projects ? 'disabled' : ''} autocapitalize="none" spellcheck="false" aria-label="Handle">
${projects ? `<p class="note">You own ${projects} project${projects > 1 ? 's' : ''} under this name, so it stays.</p>` : '<div class="bar"><button class="btn">Save name</button></div>'}</form>
<h2>Anthropic API key</h2>${keyBlock}
<p class="err" id="msg" role="status"></p>
<h2>Account</h2><p class="desc">Signed in as ${esc(u.email)}.</p><div class="actions"><a class="chipbtn" href="/logout">Sign out</a></div>
<style>.field{width:100%;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg)}.err{min-height:1.4em;color:var(--dim);font-size:15px;margin:8px 0 0}.err.bad{color:var(--fg);font-weight:600}</style>
<script>
const msg=document.getElementById('msg');
// The message shows under the form that was used, not at the foot of the page
// (a refused key was easy to miss there, seen in the sign-up video).
async function call(url,method,body,form){if(form)form.after(msg);msg.classList.remove('bad');const r=await fetch(url,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));if(!r.ok){msg.textContent=j.error||'Failed';msg.classList.add('bad');return null;}return j;}
const hf=document.getElementById('hf');if(hf)hf.onsubmit=async(e)=>{e.preventDefault();msg.textContent='Saving';if(await call('/api/me/handle','POST',{handle:hf.handle.value},hf))location.reload();};
const kf=document.getElementById('keyf');if(kf)kf.onsubmit=async(e)=>{e.preventDefault();msg.textContent='Checking the key with Anthropic';if(await call('/api/me/key','POST',{key:kf.key.value},kf))location.reload();};
const rm=document.getElementById('rmkey');if(rm)rm.onclick=async()=>{if(await call('/api/me/key','DELETE'))location.reload();};
</script>`);
}

export function aboutPage() {
  return shell('About · forq', `<a class="back" href="/">Explore</a>
<h1>About forq</h1>
<p class="desc">forq is a git platform for the age of agents, built on Cloudflare (Artifacts, Containers, Durable Objects, Workers) and made for the phone. Every project runs; every fork comes with its own agents.</p>
<h2>How it works</h2>
<p class="desc">You tell a project's router agent what to change. It starts one agent per task, each in its own container on its own fork. A reviewer agent checks every push in a live preview before you merge. Errors from a deployed app can start a fix by themselves.</p>
<h2>Whose Claude</h2>
<p class="desc">Agents run Claude Code with your own Anthropic API key, which you add in Settings. You pay Anthropic directly. forq measured about $1–2 per finished, reviewed change on Sonnet.</p>
<h2>Contact</h2>
<p class="desc">hello@kapps.dev</p>`);
}

export function privacyPage() {
  return shell('Privacy · forq', `<a class="back" href="/">Explore</a>
<h1>Privacy</h1>
<p class="desc">What forq stores: your email address and the name you choose; your Anthropic API key, encrypted, used only to start Claude Code in your projects' containers; the projects, forks and agent conversations you create. Projects are public to read.</p>
<p class="desc">Sign-in is handled by Cloudflare Access with a one-time code sent to your email. forq sets one cookie, to keep you signed in. No analytics or ad trackers.</p>
<p class="desc">Your agents' requests go to Anthropic under your key and Anthropic's terms. To delete your account and data, write to hello@kapps.dev.</p>`);
}
