// Requests (qb7, manager 2026-10-13, Eyal approved): anyone signed in can send a public project's owner a request (one
// text box, an optional screenshot, an optional link to their fork); the owner sends it to the agents (as the owner's own
// request, on the owner's budget: only the owner can), replies, or closes it (done / not doing). Not now: threads,
// votes, labels. Server (qb6): GET/POST /api/p/<o>/<n>/requests, …/requests/shot, …/requests/<id>/{send,reply,close},
// …/requests/settings {accepting}, GET /api/me/requests. Every text from a person is escaped (textContent in the page).
export type RequestsCtx = { info: { owner: string; name: string; private?: boolean }; base: string; own?: boolean; me?: string; forks?: { slug: string; owner: string; name: string }[] };

const apiOf = (c: RequestsCtx) => `/api/p/${encodeURIComponent(c.info.owner)}/${encodeURIComponent(c.info.name)}`;
const escA = (s: string) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
export const REQ_MAX = 1000, REPLY_MAX = 500;

/** The Requests view: the owner's inbox for this project, or a visitor's own requests to it plus the form. */
export function requestsView(c: RequestsCtx) {
  const forks = (c.forks || []).filter((f) => c.me && f.owner === c.me).map((f) => ({ slug: f.slug, label: `${f.owner} / ${f.name}` }));
  const cfg = { api: apiOf(c), own: !!c.own, me: c.me || '', forks, max: REQ_MAX, rmax: REPLY_MAX, priv: !!c.info.private };
  return {
    body: `<div class="pad rq" id="rq" data-cfg="${escA(JSON.stringify(cfg))}"><h2 class="rq-h">Requests</h2>
<p class="lede">${c.own ? 'What people asked you to change. Send one to your agents, reply, or close it.' : `Ask ${escA(c.info.owner)} for a change. They decide what happens with it.`}</p>
<div id="rq-top"></div><ul class="rq-l" id="rq-l"><li class="rq-empty">Loading…</li></ul></div><style>${REQ_CSS}</style>`,
    js: REQ_JS,
  };
}

/** The 'Request a change' button for a signed-in visitor on a public project (in the project's fork bar). */
export function requestButton(c: RequestsCtx & { accepts?: boolean }) {
  if (c.own || c.info.private || c.accepts === false) return '';
  return c.me ? `<a class="chipbtn rq-btn" href="${escA(c.base)}/requests#new">Request a change</a>` : `<a class="chipbtn rq-btn" href="/login?next=${encodeURIComponent(c.base + '/requests#new')}">Sign in to request a change</a>`;
}

export const REQ_CSS = `.rq .rq-h{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:4px 0 6px}
.rq-form{display:grid;gap:10px;padding:14px;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);margin:12px 0 16px}
.rq-form label{font-size:14px;font-weight:500}
.rq-form textarea{width:100%;box-sizing:border-box;min-height:120px;font:16px/1.45 Geist,sans-serif;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);resize:vertical}
.rq-form textarea:focus-visible,.rq-form select:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
.rq-form select{min-height:44px;font:15px Geist,sans-serif;padding:0 10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.rq-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.rq-count{margin-left:auto;font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
.rq-shot{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dim)}
.rq-shot img{width:56px;height:56px;object-fit:cover;border-radius:8px;box-shadow:inset 0 0 0 1px var(--line)}
.rq-msg{margin:0;min-height:1.2em;font-size:14px;color:var(--dim)}.rq-msg.bad{color:var(--warn)}
.rq-sw{display:flex;align-items:center;gap:12px;min-height:56px;margin:4px 0 8px;border-bottom:1px solid var(--line)}
.rq-sw span{flex:1;display:grid;gap:2px}.rq-sw b{font-weight:500}.rq-sw small{font-size:13px;color:var(--dim)}
.rq-sw button{flex:none;position:relative;width:52px;height:32px;border-radius:16px;border:0;background:var(--line);box-shadow:inset 0 0 0 1px var(--dim);cursor:pointer;padding:0}
.rq-sw button i{position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:50%;background:var(--dim);transition:transform .15s}
.rq-sw button[aria-checked=true]{background:var(--acc);box-shadow:none}.rq-sw button[aria-checked=true] i{transform:translateX(20px);background:var(--bg)}
.rq-sw button::after{content:'';position:absolute;inset:-6px}
.rq-fil{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px}
.rq-fil button{min-height:44px;padding:0 12px;border:0;border-radius:10px;background:var(--chip);color:var(--fg);font:500 14px Geist,sans-serif;cursor:pointer}
.rq-fil button[aria-pressed=true]{background:var(--fg);color:var(--bg)}
.rq-l{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.rq-empty{font-size:14px;color:var(--dim);padding:8px 0}
.rq-i{display:grid;gap:8px;padding:14px;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line)}
.rq-i.open{box-shadow:inset 0 0 0 1px var(--line),inset 3px 0 0 var(--warn)}
.rq-meta{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dim)}
.rq-meta b{color:var(--fg);font-weight:600}
.rq-st{margin-left:auto;display:inline-flex;align-items:center;gap:6px;color:var(--fg);font-weight:500}
.rq-st i{width:8px;height:8px;border-radius:50%;background:var(--dim)}
.rq-i.open .rq-st i{background:var(--warn)}.rq-i.sent .rq-st i{background:var(--busy)}.rq-i.done .rq-st i{background:var(--acc)}
.rq-t{margin:0;font-size:15px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.rq-x{display:flex;flex-wrap:wrap;gap:8px;font-size:13px}
.rq-x a{color:var(--acc)}
.rq-img{max-width:100%;max-height:260px;border-radius:10px;box-shadow:inset 0 0 0 1px var(--line);display:block}
.rq-reply{margin:0;padding:10px 12px;border-radius:10px;background:var(--chip);font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.rq-reply b{display:block;font-size:12px;font-weight:600;color:var(--dim);margin-bottom:2px}
.rq-acts{display:flex;flex-wrap:wrap;gap:8px}
.rq-acts .btn,.rq-acts .chipbtn{min-height:44px}
.rq-rf{display:grid;gap:8px}
.rq-rf textarea{width:100%;box-sizing:border-box;min-height:80px;font:16px/1.45 Geist,sans-serif;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.rq-btn{width:100%}`;

// The page script: everything a person typed goes into the DOM with textContent, never innerHTML.
const REQ_JS = `(function(){const R=document.getElementById('rq');if(!R)return;const C=JSON.parse(R.dataset.cfg),L=document.getElementById('rq-l'),T=document.getElementById('rq-top');
const log=(ev,x)=>{try{console.log(JSON.stringify(Object.assign({module:'requests',event:ev},x||{})));}catch(e){}};
const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;};
const ago=(t)=>{const s=Math.max(0,(Date.now()-t)/1000);return s<60?'just now':s<3600?Math.floor(s/60)+' min ago':s<86400?Math.floor(s/3600)+' h ago':s<172800?'yesterday':Math.floor(s/86400)+' days ago';};
const STATE={open:'New',sent:'With the agents',closed:'Closed'};
let data=null,show='open',shotId=null,replying=null,sentMsg='';
async function call(path,method,body){const r=await fetch(C.api+path,{method:method||'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'}).catch(()=>({ok:false,status:0}));const j=r.json?await r.json().catch(()=>({})):{};return {ok:r.ok,status:r.status,j};}
async function load(){const r=await call('/requests');if(!r.ok){L.replaceChildren(el('li','rq-empty',r.status===404?'Requests are not available here yet.':'Could not load the requests.'));return;}data=r.j;draw();}
function form(){
 if(C.own||C.priv)return null;
 if(data&&data.accepting===false){return el('p','rq-msg','The owner is not taking requests right now.');}
 const f=el('form','rq-form');f.id='new';
 const lab=el('label',null,'What should change?');lab.htmlFor='rq-text';
 const ta=el('textarea');ta.id='rq-text';ta.maxLength=C.max;ta.placeholder='Say what you would like and why. Plain words are fine.';
 const cnt=el('span','rq-count','0 / '+C.max);ta.addEventListener('input',()=>{cnt.textContent=ta.value.length+' / '+C.max;});
 const row=el('div','rq-row');
 const pick=el('label','chipbtn','Add a screenshot');const fi=el('input');fi.type='file';fi.accept='image/*';fi.hidden=true;pick.append(fi);pick.tabIndex=0;
 const sh=el('span','rq-shot');
 fi.addEventListener('change',async()=>{const file=fi.files&&fi.files[0];if(!file)return;sh.replaceChildren(el('span',null,'Uploading…'));
  const r=await fetch(C.api+'/requests/shot',{method:'POST',headers:{'content-type':file.type||'image/png'},body:file,credentials:'same-origin'}).catch(()=>({ok:false}));const j=r.json?await r.json().catch(()=>({})):{};
  if(!r.ok||!j.id){shotId=null;sh.replaceChildren(el('span',null,j.error||'Could not add the screenshot.'));return;}
  shotId=j.id;const img=el('img');img.alt='Your screenshot';img.src=URL.createObjectURL(file);const rm=el('button','chipbtn','Remove');rm.type='button';rm.onclick=()=>{shotId=null;sh.replaceChildren();fi.value='';};sh.replaceChildren(img,rm);});
 row.append(pick,sh,cnt);
 let sel=null;
 if(C.forks.length){sel=el('select');sel.setAttribute('aria-label','Link one of your forks (optional)');sel.append(new Option('No fork linked',''));for(const k of C.forks)sel.append(new Option('My fork: '+k.label,k.slug));}
 const msg=el('p','rq-msg',sentMsg);msg.setAttribute('role','status');
 const go=el('button','btn','Send the request');go.type='submit';
 f.append(lab,ta,row);if(sel)f.append(sel);f.append(go,msg);
 f.addEventListener('submit',async(e)=>{e.preventDefault();const text=ta.value.trim();if(!text){msg.textContent='Write what should change first.';msg.className='rq-msg bad';ta.focus();return;}
  go.disabled=true;msg.className='rq-msg';msg.textContent='Sending…';
  const r=await call('/requests','POST',{text:text.slice(0,C.max),shot:shotId||undefined,fork:sel&&sel.value||undefined});log('send',{ok:r.ok,status:r.status,chars:text.length,shot:!!shotId});go.disabled=false;
  if(!r.ok){msg.className='rq-msg bad';msg.textContent=r.j.error||(r.status===429?'That is enough requests to this project for today. Try again tomorrow.':r.status===401?'Sign in first.':'Could not send it. Try again.');return;}
  shotId=null;sentMsg='Sent. You will see the owner\\u2019s answer here and in your Inbox.';load();});
 if(location.hash==='#new')setTimeout(()=>{f.scrollIntoView({block:'start'});ta.focus();},50);
 return f;}
function sw(){if(!C.own||!data)return null;const w=el('div','rq-sw');const s=el('span');s.append(el('b',null,'Take requests'),el('small',null,'Anyone signed in can ask for a change, a few a day each.'));
 const b=el('button');b.type='button';b.setAttribute('role','switch');b.setAttribute('aria-checked',String(data.accepting!==false));b.setAttribute('aria-label','Take requests');b.append(el('i'));
 b.onclick=async()=>{const on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',String(on));const r=await call('/requests/settings','POST',{accepting:on});log('accepting',{on,ok:r.ok});if(!r.ok)b.setAttribute('aria-checked',String(!on));else data.accepting=on;};
 w.append(s,b);return w;}
function filters(){if(!C.own)return null;const f=el('div','rq-fil');f.setAttribute('role','group');f.setAttribute('aria-label','Show');
 for(const [k,l] of [['open','New'],['sent','With the agents'],['closed','Closed']]){const n=(data.requests||[]).filter((r)=>r.state===k).length;const b=el('button',null,l+' '+n);b.type='button';b.setAttribute('aria-pressed',String(show===k));b.onclick=()=>{show=k;draw();};f.append(b);}return f;}
function item(q){
 const li=el('li','rq-i '+(q.state==='closed'?(q.closedAs==='done'?'done':'closed'):q.state));
 const m=el('div','rq-meta');const who=el('b',null,C.own?(q.by||'someone'):'You');m.append(who,el('span',null,ago(q.at)));
 const st=el('span','rq-st');st.append(el('i'),document.createTextNode(q.state==='closed'?(q.closedAs==='done'?'Done':'Not doing it'):STATE[q.state]||q.state));m.append(st);
 li.append(m,el('p','rq-t',q.text||''));
 const x=el('div','rq-x');if(q.fork){const a=el('a',null,(C.own?'Their fork: ':'Your fork: ')+String(q.fork).replace('.',' / '));a.href='/p/'+String(q.fork).replace('.','/');x.append(a);}if(q.sentAt){x.append(el('span',null,'Sent to the agents '+ago(q.sentAt)));}if(x.childNodes.length)li.append(x);
 if(q.shotUrl){const img=el('img','rq-img');img.alt='Screenshot from the request';img.loading='lazy';img.onerror=()=>img.remove();img.src=q.shotUrl;li.append(img);}
 if(q.reply){const p=el('p','rq-reply');p.append(el('b',null,C.own?'Your reply':'Reply from the owner'),document.createTextNode(q.reply));li.append(p);}
 if(C.own&&q.state!=='closed'){
  if(replying===q.id){const rf=el('div','rq-rf');const ta=el('textarea');ta.maxLength=C.rmax;ta.placeholder='A short answer they will see.';ta.setAttribute('aria-label','Your reply');ta.value=q.reply||'';
   const row=el('div','rq-acts');const ok=el('button','btn','Send reply');ok.type='button';const no=el('button','chipbtn','Cancel');no.type='button';no.onclick=()=>{replying=null;draw();};
   ok.onclick=async()=>{const t=ta.value.trim();if(!t){ta.focus();return;}ok.disabled=true;const r=await call('/requests/'+encodeURIComponent(q.id)+'/reply','POST',{text:t.slice(0,C.rmax)});log('reply',{ok:r.ok});ok.disabled=false;if(r.ok){replying=null;load();}else{ok.textContent='Try again';}};
   row.append(ok,no);rf.append(ta,row);li.append(rf);setTimeout(()=>ta.focus(),20);}
  else{const a=el('div','rq-acts');
   if(q.state==='open'){const s=el('button','btn','Send to agents');s.type='button';s.onclick=async()=>{s.disabled=true;s.textContent='Sending…';const r=await call('/requests/'+encodeURIComponent(q.id)+'/send','POST',{});log('send_to_agents',{ok:r.ok,status:r.status});if(r.ok)load();else{s.disabled=false;s.textContent=r.j.error||'Try again';}};a.append(s);}
   const rp=el('button','chipbtn',q.reply?'Edit reply':'Reply');rp.type='button';rp.onclick=()=>{replying=q.id;draw();};a.append(rp);
   for(const [as,l] of [['done','Close: done'],['not-doing','Close: not doing it']]){const b=el('button','chipbtn',l);b.type='button';b.onclick=async()=>{b.disabled=true;const r=await call('/requests/'+encodeURIComponent(q.id)+'/close','POST',{as});log('close',{as,ok:r.ok});if(r.ok)load();else b.disabled=false;};a.append(b);}
   li.append(a);}}
 return li;}
function draw(){if(!data)return;const top=[sw(),form(),filters()].filter(Boolean);T.replaceChildren(...top);
 const list=(data.requests||[]).filter((r)=>!C.own||r.state===show).sort((a,b)=>b.at-a.at);
 L.replaceChildren(...(list.length?list.map(item):[el('li','rq-empty',C.own?(show==='open'?'No new requests.':'Nothing here.'):'You have not asked for anything here yet.')]));}
load();})();`;
