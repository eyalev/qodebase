// Pages: explore (/) and project (/p/<owner>/<name>). Server-rendered; the
// project page polls one endpoint for its agents panel. Tokens: DESIGN.md.

import type { Entry } from './registry';
import type { Agent, ProjectInfo } from './project';
import { FRESH_CSS, freshHelp, freshLegend, freshTag } from './fresh';
import { markdown } from './md';

const esc = (s: string) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));
const STEPS = [14 * 24, 3 * 24, 24, 3];   // freshbar horizon: empty after 14 days
const path = (slug: string) => `/p/${slug.replace('.', '/')}`;
const label = (slug: string) => slug.replace('.', ' / ');

const CSS = `
:root{--bg:#fff;--card:#f6f7f8;--chip:#eceef1;--line:#e2e5e9;--fg:#15171a;--dim:#5f6670;--acc:#17695a;--acc-fg:#fff;--busy:#b7791f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1112;--card:#171a1c;--chip:#202427;--line:#272b2f;--fg:#e8eaec;--dim:#9ba2a9;--acc:#4fbf9f;--acc-fg:#0f1112;--busy:#e0a948;color-scheme:dark}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 'Instrument Sans',sans-serif}
main{max-width:720px;margin:0 auto;padding:12px 16px calc(32px + env(safe-area-inset-bottom))}
a{color:var(--acc);text-decoration:none}
header.top{display:flex;align-items:center;justify-content:space-between;height:48px}
.mark{font-weight:600;font-size:20px;color:var(--fg);letter-spacing:-.01em}
.who{font-size:13px;color:var(--dim)}
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
.files span{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:3px 7px}
.readme{background:var(--card);border-radius:12px;padding:4px 16px;font-size:15px}
.readme h2,.readme h3,.readme h4{margin:16px 0 6px;font-size:17px}
.readme code{font:13px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:1px 4px}
.readme pre{overflow-x:auto;background:var(--chip);border-radius:8px;padding:10px}
.commit{display:flex;gap:8px;align-items:baseline;font-size:14px;padding:6px 0;border-bottom:1px solid var(--line)}
.commit .msg{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.commit code{font:12px 'JetBrains Mono',monospace;color:var(--dim)}
.composer textarea{width:100%;min-height:76px;font:16px 'Instrument Sans',sans-serif;padding:12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:vertical}
.composer .bar{display:flex;gap:8px;margin-top:8px;align-items:center}
.composer .bar .btn{flex:1}
.router{display:flex;gap:10px;align-items:flex-start;background:var(--card);border-radius:12px;padding:12px 14px;margin-top:12px;font-size:14px}
.router .who{flex:none;font-weight:600;color:var(--fg)}
.router .said{color:var(--dim);white-space:pre-wrap;word-break:break-word;max-height:9.5em;overflow:auto}
.cards{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.card{background:var(--card);border-radius:12px;padding:12px 14px}
.card .h{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dim)}
.card .h .st{margin-left:auto}
.dot{width:9px;height:9px;border-radius:50%;background:var(--line);flex:none}
.dot.idle{background:var(--acc)}.dot.busy{background:var(--busy)}
.card .task{margin-top:6px;font-size:15px}
.card .said{margin-top:6px;font-size:14px;color:var(--dim)}
.card .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.card .acts .chipbtn,.card .acts .btn{min-height:40px;padding:0 12px;font-size:14px}
.empty{color:var(--dim);font-size:14px}
@media (hover:hover){.row:hover{background:var(--chip)}.chipbtn:hover{background:var(--line)}}
${FRESH_CSS}`;

const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><main>${body}</main>${freshHelp(STEPS)}</body></html>`;

function row(e: Entry, forks: number, now: number) {
  return `<div class="row"><a class="t stretch" href="${path(e.slug)}"><span class="owner">${esc(e.owner)} /</span> <b>${esc(e.name)}</b></a>
  ${e.description ? `<div class="d">${esc(e.description)}</div>` : ''}
  <div class="meta">${freshTag(e.updatedAt, now, STEPS)}${forks ? `<span>${forks} fork${forks > 1 ? 's' : ''}</span>` : ''}${e.forkedFrom ? `<span>forked from ${esc(label(e.forkedFrom))}</span>` : ''}</div></div>`;
}

export function explorePage(entries: Entry[], me: string) {
  const now = Date.now();
  const forks = (slug: string) => entries.filter((e) => e.forkedFrom === slug).length;
  const mine = entries.filter((e) => e.owner === me);
  const others = entries.filter((e) => e.owner !== me);
  return shell('forq', `<header class="top"><span class="mark">forq</span><span class="who">${esc(me)}</span></header>
<p class="intro">Projects that run. Open one, fork it, then tell its router what to change.</p>
${freshLegend(STEPS)}
${mine.length ? `<h2>Yours</h2><div class="rows">${mine.map((e) => row(e, forks(e.slug), now)).join('')}</div>` : ''}
<h2>Explore</h2><div class="rows">${others.map((e) => row(e, forks(e.slug), now)).join('') || '<p class="empty">Nothing here yet.</p>'}</div>`);
}

export type Overview = { commits: { hash: string; message: string; at: number; author: string }[]; files: { name: string; dir: boolean }[]; readme: string | null };

export function projectPage(o: { info: ProjectInfo; entry: Entry; forks: Entry[]; overview: Overview; me: string; runBase: string; agentsHtml: string }) {
  const { info, entry, forks, overview, me, runBase } = o;
  const now = Date.now();
  const own = info.owner === me;
  const app = `${runBase}/${info.repo}/`;
  return shell(`${info.owner}/${info.name} · forq`, `<a class="back" href="/">Explore</a>
<h1><span class="owner">${esc(info.owner)} /</span> ${esc(info.name)}</h1>
${info.description ? `<p class="desc">${esc(info.description)}</p>` : ''}
<div class="meta">${freshTag(entry.updatedAt, now, STEPS)}${forks.length ? `<span>${forks.length} fork${forks.length > 1 ? 's' : ''}</span>` : ''}${info.forkedFrom ? `<span>forked from <a href="${path(info.forkedFrom)}">${esc(label(info.forkedFrom))}</a></span>` : ''}</div>
<div class="actions">${own ? `<a class="btn" href="${app}" target="_blank" rel="noopener">Open app</a>` : `<button class="btn" id="fork">Fork to ${esc(me)}</button><a class="chipbtn" href="${app}" target="_blank" rel="noopener">Open app</a>`}</div>
<div class="preview"><iframe src="${app}" title="${esc(info.name)} app" loading="lazy"></iframe></div>
${own ? `<h2>Agents</h2>
<form class="composer" id="ask"><textarea name="text" placeholder="Tell the router what to change. It splits the work and starts one agent per task." required enterkeyhint="send"></textarea>
<div class="bar"><button class="btn">Send to router</button><a class="chipbtn" href="/a/${info.slug}--router/agent/">Router chat</a></div></form>
<div id="agents">${o.agentsHtml}</div>`
    : `<p class="note">Fork it to change it: your copy gets its own page, its own live app and its own agents.</p>`}
<h2>Files</h2><div class="files">${overview.files.map((f) => `<span>${esc(f.name)}${f.dir ? '/' : ''}</span>`).join('') || '<span>empty</span>'}</div>
${overview.readme ? `<h2>README</h2><div class="readme">${markdown(overview.readme)}</div>` : ''}
${forks.length ? `<h2>Forks</h2><div class="rows">${forks.map((e) => row(e, 0, now)).join('')}</div>` : ''}
<h2>Recent commits</h2>${overview.commits.map((c) => `<div class="commit">${freshTag(c.at, now, STEPS)}<span class="msg">${esc(c.message)}</span><code>${esc(c.hash.slice(0, 7))}</code></div>`).join('') || '<p class="empty">No commits yet.</p>'}
<script>
const API='/api/p/${esc(info.owner)}/${esc(info.name)}';
const fork=document.getElementById('fork');
if(fork)fork.onclick=async()=>{fork.disabled=true;fork.textContent='Forking…';
 const r=await fetch(API+'/fork',{method:'POST'});const j=await r.json();
 if(r.ok)location.href=j.path;else{fork.disabled=false;fork.textContent=j.error||'Fork failed';}};
const ask=document.getElementById('ask');
if(ask){
 ask.onsubmit=async(e)=>{e.preventDefault();const b=ask.querySelector('.btn');b.disabled=true;b.textContent='Sending…';
  const r=await fetch(API+'/router',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:ask.text.value})});
  const j=await r.json().catch(()=>({}));b.disabled=false;b.textContent=r.ok?'Send to router':(j.error||'Failed, try again');
  if(r.ok){ask.text.value='';poll();}};
 document.getElementById('agents').addEventListener('click',async(e)=>{const m=e.target.closest('[data-merge]');if(!m)return;
  m.disabled=true;m.textContent='Asking the router…';
  const r=await fetch(API+'/merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent:m.dataset.merge})});
  if(!r.ok){const j=await r.json().catch(()=>({}));m.textContent=j.error||'Failed';}poll();});
 async function poll(){if(document.hidden)return;try{const r=await fetch(API+'/agents-html');if(r.ok)document.getElementById('agents').innerHTML=(await r.json()).html;}catch{}}
 setInterval(poll,5000);document.addEventListener('visibilitychange',poll);
}
</script>`);
}

export type BoxStatus = { awake: boolean; cc: string; said?: string };

export function agentsHtml(info: ProjectInfo, runBase: string, router: BoxStatus, status: Record<string, BoxStatus>) {
  const now = Date.now();
  const dot = (s: BoxStatus) => !s.awake ? '' : /busy|thinking|working|running/.test(s.cc) ? 'busy' : 'idle';
  const word = (s: BoxStatus) => !s.awake ? 'asleep' : /busy|thinking|working|running/.test(s.cc) ? 'working' : 'idle';
  const card = (a: Agent) => {
    const s = status[a.id] || { awake: false, cc: 'asleep' };
    return `<div class="card"><div class="h"><span class="dot ${dot(s)}"></span><span>${esc(a.id.split('--')[1])}</span>${freshTag(a.noteAt || a.createdAt, now, STEPS)}<span class="st">${a.state === 'working' ? word(s) : esc(a.state)}</span></div>
<div class="task">${esc(a.task)}</div>${a.note ? `<div class="said">${esc(a.note)}</div>` : ''}
<div class="acts"><a class="chipbtn" href="${runBase}/${a.fork}/" target="_blank" rel="noopener">Preview</a><a class="chipbtn" href="/a/${a.id}/agent/">Chat</a>${a.state === 'pushed' ? `<button class="btn" data-merge="${esc(a.id)}">Merge</button>` : ''}</div></div>`;
  };
  const open = info.agents.filter((a) => a.state !== 'merged' && a.state !== 'stopped').reverse();
  const done = info.agents.filter((a) => a.state === 'merged').reverse().slice(0, 5);
  return `<div class="router"><span class="dot ${dot(router)}"></span><span class="who">Router</span><span class="said">${router.said ? esc(router.said) : router.awake ? 'Ready.' : 'Asleep. It wakes when you send something.'}</span></div>
<div class="cards">${open.map(card).join('') || '<p class="empty">No agents working. Ask the router for a change.</p>'}</div>
${done.length ? `<h2>Merged</h2><div class="cards">${done.map(card).join('')}</div>` : ''}`;
}
