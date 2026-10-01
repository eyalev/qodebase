// The project page's two in-place surfaces:
//  - preview tabs: Live (main) + one tab per agent fork, switching the inline
//    iframe, with "Open in new tab" for whichever is showing;
//  - the agent sheet: slides up from the bottom over the page, Chat (web
//    view of the agent's Claude Code conversation) | Terminal (mobile-agent),
//    half or full height, closable. Opened from the router agent panel and
//    from every agent card, so nothing navigates away from the project.

import type { Agent, ProjectInfo } from './project';

const esc = (s: string) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));
export const shortId = (id: string) => id.split('--')[1] || id;

export function previewTabs(info: ProjectInfo, runBase: string, current?: string) {
  const at = info.entry || '';
  const worker = info.kind === 'worker';
  const live = worker ? (info.app?.url ? `${info.app.url}/` : 'about:blank') : `${runBase}/${info.repo}/${at}`;
  const forks = info.agents.filter((a) => a.state !== 'merged' && a.state !== 'stopped' && (!worker || a.preview?.url));
  const tab = (src: string, label: string, title: string) =>
    `<button type="button" class="ptab${(current || live) === src ? ' on' : ''}" data-src="${esc(src)}" title="${esc(title)}">${esc(label)}</button>`;
  return `${tab(live, 'Live', 'main, what everyone sees')}${forks.map((a: Agent) => tab(worker ? `${a.preview!.url}/` : `${runBase}/${a.fork}/${at}`, shortId(a.id), `agent ${shortId(a.id)}'s fork`)).join('')}`;
}

export const SHEET_HTML = `<div class="sheet" id="sheet" aria-hidden="true">
<button type="button" class="grab" id="sh-grab" aria-label="Drag to resize, tap for full height"><span></span></button>
<div class="sh-h"><b id="sh-name"></b><div class="seg" role="tablist"><button type="button" data-m="chat" role="tab">Chat</button><button type="button" data-m="term" role="tab">Terminal</button></div><button type="button" class="x" id="sh-x" aria-label="Close">×</button></div>
<div class="sh-body">
 <div class="chatv" id="sh-chat"><div class="log" id="sh-log"></div>
  <form class="sh-send" id="sh-send"><textarea name="text" rows="1" placeholder="Message this agent" enterkeyhint="send"></textarea><button class="btn">Send</button></form></div>
 <iframe id="sh-term" title="Terminal" hidden></iframe>
</div></div>`;

export const SHEET_CSS = `
.pbar{display:flex;align-items:center;gap:8px;margin:16px 0 8px}
.ptabs{flex:1;min-width:0;display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}
.ptabs::-webkit-scrollbar{display:none}
.ptab{flex:none;min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--dim);font:500 14px 'Instrument Sans',sans-serif;cursor:pointer}
.ptab.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.pext{flex:none;margin-left:auto;font-size:14px;padding:8px 4px;white-space:nowrap}
.sheet{position:fixed;left:0;right:0;bottom:0;z-index:20;max-width:720px;margin:0 auto;height:72dvh;display:flex;flex-direction:column;
 background:var(--bg);border:1px solid var(--line);border-bottom:0;border-radius:16px 16px 0 0;box-shadow:0 -8px 32px rgb(0 0 0 / .18);
 transform:translateY(105%);transition:transform .22s ease,height .22s ease;visibility:hidden}
.sheet.open{transform:none;visibility:visible}
.sheet.full{height:calc(100dvh - 8px)}
.grab{display:flex;justify-content:center;align-items:center;height:28px;border:0;background:none;cursor:ns-resize;flex:none;touch-action:none;width:100%}
.grab span{width:44px;height:5px;border-radius:3px;background:var(--dim);opacity:.45}
.sheet.dragging{transition:none}
.sheet.dragging iframe{pointer-events:none}
.sh-h{display:flex;align-items:center;gap:8px;padding:0 12px 8px 16px;border-bottom:1px solid var(--line);flex:none}
.sh-h b{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seg{display:flex;background:var(--chip);border-radius:8px;padding:2px}
.seg button{min-height:36px;padding:0 12px;border:0;border-radius:6px;background:none;color:var(--dim);font:500 14px 'Instrument Sans',sans-serif;cursor:pointer}
.seg button.on{background:var(--bg);color:var(--fg)}
.x{width:44px;height:44px;border:0;background:none;color:var(--dim);font-size:24px;cursor:pointer}
.sh-body{flex:1;min-height:0;display:flex;flex-direction:column}
.sh-body iframe{flex:1;width:100%;border:0;background:#0d1117}
.chatv{flex:1;min-height:0;display:flex;flex-direction:column}
.chatv[hidden],.sh-body iframe[hidden]{display:none}
.log{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
.m-u{align-self:flex-end;max-width:85%;background:var(--acc);color:var(--acc-fg);border-radius:12px 12px 4px 12px;padding:8px 12px;white-space:pre-wrap;word-break:break-word}
.m-a{max-width:95%;white-space:pre-wrap;word-break:break-word;font-size:15px}
.m-s{font-size:13px;color:var(--dim);background:var(--card);border-radius:8px;padding:6px 10px;align-self:flex-start;cursor:pointer}
.m-s .names{display:none;margin-top:4px}
.m-s.open .names{display:block}
.m-q{background:var(--card);border-radius:12px;padding:10px 12px;font-size:14px}
.m-x{color:var(--dim);font-size:14px;text-align:center;padding:24px 0}
.sh-send{display:flex;gap:8px;padding:8px 12px calc(8px + env(safe-area-inset-bottom));border-top:1px solid var(--line);flex:none}
.sh-send textarea{flex:1;font:16px 'Instrument Sans',sans-serif;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:none;max-height:30dvh}
.sh-send .btn{min-height:44px}
body.sheet-open{overflow:hidden}
`;

/** Page script for the tabs and the sheet. API is the project API base. */
export const SHEET_JS = String.raw`
(function(){
 const frame=document.querySelector('.preview iframe'),ptabs=document.getElementById('ptabs'),pext=document.getElementById('pext');
 function showPreview(src){if(!frame)return;frame.src=src;pext.href=src;
  for(const b of ptabs.querySelectorAll('.ptab'))b.classList.toggle('on',b.dataset.src===src);}
 if(ptabs)ptabs.addEventListener('click',(e)=>{const b=e.target.closest('.ptab');if(b)showPreview(b.dataset.src);});
 window.forqShowPreview=(src)=>{showPreview(src);document.querySelector('.preview').scrollIntoView({behavior:'smooth',block:'center'});};
 window.forqCurrentPreview=()=>frame&&frame.src;

 const sheet=document.getElementById('sheet');if(!sheet)return;
 const log=document.getElementById('sh-log'),term=document.getElementById('sh-term'),chat=document.getElementById('sh-chat'),form=document.getElementById('sh-send');
 let cur=null,mode='chat',timer=null,lastKey='',busy=false,touched=Date.now();
 const esc=(t)=>String(t||'').replace(/[<>&"]/g,(c)=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
 function setMode(m){mode=m;
  for(const b of sheet.querySelectorAll('.seg button'))b.classList.toggle('on',b.dataset.m===m);
  chat.hidden=m!=='chat';term.hidden=m!=='term';
  if(m==='term'){const src='/a/'+cur.id+'/agent/?ui=minimal';if(term.dataset.for!==cur.id){term.src=src;term.dataset.for=cur.id;}}
  else poll();}
 window.forqOpenSheet=(id,name,m)=>{
  if(!cur||cur.id!==id){log.innerHTML='<div class="m-x">Loading…</div>';lastKey='';term.removeAttribute('src');term.dataset.for='';}
  cur={id,name};document.getElementById('sh-name').textContent=name;
  applySaved();sheet.classList.add('open');sheet.setAttribute('aria-hidden','false');document.body.classList.add('sheet-open');touched=Date.now();
  setMode(m||'chat');};
 function close(){sheet.classList.remove('open','full');sheet.style.height='';sheet.setAttribute('aria-hidden','true');document.body.classList.remove('sheet-open');clearTimeout(timer);}
 document.getElementById('sh-x').onclick=close;
 // The handle: drag to any height (remembered per viewer), tap to switch
 // half/full, drag below a fifth of the screen to close.
 const grab=document.getElementById('sh-grab'),HKEY='forq.sheetH';
 const clampH=(h)=>Math.max(160,Math.min(innerHeight-8,h));
 function applySaved(){try{const f=Number(localStorage.getItem(HKEY));if(f>0.2&&f<=1)sheet.style.height=clampH(f*innerHeight)+'px';}catch{}}
 let drag=null;
 grab.addEventListener('pointerdown',(e)=>{drag={y:e.clientY,h:sheet.getBoundingClientRect().height,moved:false};try{grab.setPointerCapture(e.pointerId)}catch{}sheet.classList.add('dragging');});
 grab.addEventListener('pointermove',(e)=>{if(!drag)return;const dy=drag.y-e.clientY;if(Math.abs(dy)>4)drag.moved=true;
  if(drag.moved){sheet.classList.remove('full');sheet.style.height=clampH(drag.h+dy)+'px';}});
 grab.addEventListener('pointerup',(e)=>{if(!drag)return;sheet.classList.remove('dragging');const d=drag;drag=null;
  if(!d.moved){const full=sheet.getBoundingClientRect().height>innerHeight*0.85;sheet.style.height=full?'':(innerHeight-8)+'px';try{localStorage.removeItem(HKEY)}catch{}return;}
  const h=sheet.getBoundingClientRect().height;
  if(e.clientY>innerHeight*0.8&&h<innerHeight*0.25){close();return;}
  try{localStorage.setItem(HKEY,String(h/innerHeight))}catch{}});
 grab.addEventListener('pointercancel',()=>{drag=null;sheet.classList.remove('dragging');});
 sheet.querySelector('.seg').onclick=(e)=>{const b=e.target.closest('button');if(b)setMode(b.dataset.m);};

 function render(j){
  if(j.asleep){log.innerHTML='<div class="m-x">Asleep. Send a message and it wakes up (a few seconds).</div>';busy=false;return;}
  const msgs=j.messages||[];const key=msgs.length+':'+(msgs.length?JSON.stringify(msgs[msgs.length-1]).length:0)+':'+j.status;
  busy=/busy|thinking|working|running|tool/.test(j.status||'');
  if(key===lastKey)return;lastKey=key;
  const near=log.scrollHeight-log.scrollTop-log.clientHeight<80;
  const out=[];let steps=[];
  const flush=()=>{if(steps.length){out.push('<div class="m-s">'+steps.length+' step'+(steps.length>1?'s':'')+'<div class="names">'+steps.map(esc).join('<br>')+'</div></div>');steps=[];}};
  for(const m of msgs){
   if(m.type==='tool_use'){steps.push(m.toolName||m.name||m.text||'tool');continue;}
   if(m.type==='user'){const t=(m.text||'').trim();if(!t)continue;flush();out.push('<div class="m-u">'+esc(t)+'</div>');continue;}
   if(m.type==='assistant_text'||m.type==='recap'){const t=(m.text||'').trim();if(!t)continue;flush();out.push('<div class="m-a">'+esc(t)+'</div>');continue;}
   if(m.type==='question_prompt'||m.type==='plan_prompt'){flush();out.push('<div class="m-q">'+esc(m.text||'')+'<br><i>Answer in the Terminal tab.</i></div>');}
  }
  flush();
  if(busy)out.push('<div class="m-x">Working…</div>');
  log.innerHTML=out.join('')||'<div class="m-x">No messages yet.</div>';
  if(near||lastKey.startsWith(msgs.length+':'))log.scrollTop=log.scrollHeight;}
 async function poll(){clearTimeout(timer);
  if(!cur||mode!=='chat'||!sheet.classList.contains('open'))return;
  if(!document.hidden&&Date.now()-touched<10*60000){
   try{const r=await fetch('/api/agents/'+cur.id+'/conversation');if(r.ok)render(await r.json());}catch{}}
  timer=setTimeout(poll,busy?1500:3000);}
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
 form.onsubmit=async(e)=>{e.preventDefault();const t=form.text.value.trim();if(!t||!cur)return;form.text.value='';touched=Date.now();
  log.insertAdjacentHTML('beforeend','<div class="m-u">'+esc(t)+'</div><div class="m-x">Sending…</div>');log.scrollTop=log.scrollHeight;
  const r=await fetch('/api/agents/'+cur.id+'/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:t})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok===false){log.insertAdjacentHTML('beforeend','<div class="m-x">Not sent: '+esc(j.error||r.status)+'</div>');form.text.value=t;}
  lastKey='';busy=true;poll();};
 form.text.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&matchMedia('(hover:hover)').matches){e.preventDefault();form.requestSubmit();}});
 // Every [data-sheet] / [data-preview] button on the page, including ones the poll re-renders.
 document.addEventListener('click',(e)=>{
  const s=e.target.closest('[data-sheet]');if(s){window.forqOpenSheet(s.dataset.sheet,s.dataset.name,s.dataset.mode);return;}
  const p=e.target.closest('[data-preview]');if(p)window.forqShowPreview(p.dataset.preview);});
})();
`;
