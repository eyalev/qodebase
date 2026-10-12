// "Pick" on the App view (docs/board/TASKS.md S2): the run host adds this script to an app's HTML only when the
// page is loaded with ?__qbpick=1 (the App view's iframe in pick mode), never otherwise and never cached.
// Parent -> app: postMessage({type:'qb-pick', on:true|false}) from a UI origin only. App -> parent, to that same
// origin: {type:'qb-picked', selector, tag, text, html, rect, url}. The picked element keeps an outline.
// Static apps only (served by run.ts); a Worker project's app runs on its own Worker.

export function pickerScript(uiOrigins: string[]) {
  return `<script>(()=>{const UI=${JSON.stringify(uiOrigins)};let on=false,parent=null,last=null;
const st=document.createElement('style');st.textContent='.__qbpk{outline:3px solid #e8590c!important;outline-offset:2px!important}.__qbon,.__qbon *{cursor:crosshair!important}';(document.head||document.documentElement).appendChild(st);
const esc=(s)=>window.CSS&&CSS.escape?CSS.escape(s):s.replace(/[^\\w-]/g,'\\\\$&');
function sel(el){if(el.id)return'#'+esc(el.id);const parts=[];while(el&&el.nodeType===1&&el!==document.body&&parts.length<5){let p=el.tagName.toLowerCase();const cls=[...el.classList].filter(c=>!c.startsWith('__qb')).slice(0,2);if(cls.length)p+='.'+cls.map(esc).join('.');const par=el.parentElement;if(par){const same=[...par.children].filter(c=>c.tagName===el.tagName);if(same.length>1)p+=':nth-of-type('+(same.indexOf(el)+1)+')';}parts.unshift(p);if(el.id)break;el=par;}return parts.join(' > ')||'body';}
addEventListener('message',(e)=>{if(!UI.includes(e.origin)||!e.data||e.data.type!=='qb-pick')return;parent=e.origin;on=!!e.data.on;document.documentElement.classList.toggle('__qbon',on);if(!on&&last){last.classList.remove('__qbpk');last=null;}});
addEventListener('click',(e)=>{if(!on||!parent)return;e.preventDefault();e.stopPropagation();const el=e.target.closest('*');if(!el)return;if(last)last.classList.remove('__qbpk');el.classList.add('__qbpk');last=el;const r=el.getBoundingClientRect();
const html=el.outerHTML.replace(/ class="([^"]*)__qbpk([^"]*)"/,(m,a,b)=>{const c=(a+b).trim();return c?' class="'+c+'"':'';}).slice(0,600);
window.parent.postMessage({type:'qb-picked',selector:sel(el),tag:el.tagName.toLowerCase(),text:(el.innerText||el.value||el.alt||'').trim().replace(/\\s+/g,' ').slice(0,200),html,rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},url:location.href.replace(/[?&]__qbpick=1/,'')},parent);},true);
})();</script>`;
}

/** The run host's response, with the picker added when the page asked for it (?__qbpick=1). */
export function withPicker(request: Request, res: Response, uiOrigins: string[]): Response {
  if (!new URL(request.url).searchParams.has('__qbpick') || !(res.headers.get('content-type') || '').startsWith('text/html')) return res;
  const out = new HTMLRewriter().on('body', { element(e) { e.append(pickerScript(uiOrigins), { html: true }); } }).transform(res);
  const h = new Headers(out.headers); h.set('cache-control', 'no-store');
  return new Response(out.body, { status: out.status, headers: h });
}
