// Step-1 pages: a bare project page (agent list + "new agent" form) and the
// box starting page. Placeholder UI — step 3 replaces the project page with
// the designed phone UI (DESIGN.md first).

import type { ProjectInfo } from './project';

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

export function projectPage(info: ProjectInfo, status: Record<string, { awake: boolean; cc: string }>) {
  const cards = info.agents.slice().reverse().map((a) => {
    const s = status[a.id] || { awake: false, cc: 'asleep' };
    return `<a class="card" href="/a/${a.id}/agent/">
      <div class="row"><span class="dot ${s.awake ? (s.cc === 'busy' ? 'busy' : 'on') : ''}"></span><span class="id">${esc(a.id.split('--')[1])}</span><span class="st">${esc(a.state)} · ${esc(s.cc)}</span></div>
      <div class="task">${esc(a.task)}</div></a>`;
  }).join('') || '<p class="empty">No agents yet. Describe a task below.</p>';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(info.name)} · forq</title>
<style>
:root{--bg:#f6f6f4;--card:#fff;--fg:#1b1c1e;--mut:#6b6e73;--line:#e3e3df;--acc:#2f6f4f}
@media (prefers-color-scheme:dark){:root{--bg:#141516;--card:#1d1f21;--fg:#e8e8e6;--mut:#9a9da2;--line:#2c2e31;--acc:#5fb98a}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}
h1{font-size:22px;margin:4px 0 2px}.sub{color:var(--mut);font-size:13px;margin-bottom:16px;word-break:break-all}
.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;color:inherit;text-decoration:none}
.row{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--mut)}.id{font-weight:600;color:var(--fg)}.st{margin-left:auto}
.dot{width:9px;height:9px;border-radius:50%;background:var(--line)}.dot.on{background:var(--acc)}.dot.busy{background:#d89a2b}
.task{margin-top:6px}.empty{color:var(--mut)}
form{position:sticky;bottom:0;background:var(--bg);padding:12px 0 calc(12px + env(safe-area-inset-bottom))}
textarea{width:100%;box-sizing:border-box;font:16px system-ui;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);min-height:72px}
button{margin-top:8px;width:100%;padding:12px;border:0;border-radius:10px;background:var(--acc);color:#fff;font:600 16px system-ui}
</style>
<main><h1>${esc(info.name)}</h1><div class="sub">${info.agents.length} agents · main repo ${esc(info.repo)}</div>
${cards}
<form id="f"><textarea name="task" placeholder="What should a new agent do?" required></textarea><button>Start agent</button></form></main>
<script>
document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;b.textContent='Starting…';
const r=await fetch('/api/projects/${esc(info.name)}/agents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task:e.target.task.value})});
const j=await r.json();if(!r.ok){b.disabled=false;b.textContent=j.error||'Failed';return;}location.reload();};
setTimeout(()=>location.reload(),15000);
</script></html>`;
}

export const startingPage = (name: string, error?: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Starting ${esc(name)}</title>
<body style="margin:0;height:100dvh;display:flex;align-items:center;justify-content:center;background:#141516;color:#e8e8e6;font:15px system-ui;padding:0 16px">
<div style="text-align:center"><div style="font-weight:600">Starting ${esc(name)}…</div><div id="el" style="margin-top:8px;font-size:20px;font-variant-numeric:tabular-nums">0s</div>
<div id="sub" style="margin-top:6px;font-size:13px;color:#9a9da2">${error ? esc(error) : 'usually ready in a few seconds'}</div></div>
<script>const t0=Date.now(),el=document.getElementById('el'),sub=document.getElementById('sub');
setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000);el.textContent=s+'s';if(s>20&&!${JSON.stringify(!!error)})sub.textContent='the first start on a new host downloads the image (a couple of minutes)';},500);
(async function poll(){try{const r=await fetch(location.href,{cache:'no-store',headers:{accept:'text/html'}});if(r.ok){location.replace(location.href);return;}}catch{}setTimeout(poll,2500);})();</script></body>`,
  { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '2' } });
