// Build: start a new project from one sentence (Eyal, 2026-10-03: "a call to action to
// build something, frictionless, text or voice"). Two steps on one page:
//  1. "What do you want to build?" — typed, spoken (the browser's speech recognition),
//     or an example tapped;
//  2. the brief — a suggested name and the words, both editable, and what happens next;
//     signed out it ends in "Sign in to start building" (the draft survives the sign-in
//     in localStorage), signed in in "Start building".
// Starting forks the forq/blank starter (a placeholder page, so the project runs and
// forks from its first minute) and hands the words to the project's router agent.
// The brief is assembled on the page, not by a model: no paid call for visitors.

export const STARTER = 'forq.blank';

/** What the router agent is told, around the person's own words. */
export const buildPayload = (prompt: string) =>
  `This is a brand-new project: it only has a placeholder index.html and README.md. The person wants:\n\n${prompt}\n\n` +
  `Plan it as a web app that runs as plain static files (index.html at the root, no build step, no npm install) unless they asked for something else. ` +
  `Replace the placeholder page and the README. Split the work into a few tasks and start one agent per task.`;

const EXAMPLES = ['A shared shopping list for my family', 'A pomodoro timer with a daily streak', 'A quiz game for my class', 'A page that splits a restaurant bill', 'A habit tracker with three habits', 'A recipe box that scales servings'];

export const BUILD_CSS = `
.bld{max-width:640px;margin:0 auto}
.bld h1{font-size:24px;line-height:1.2;font-weight:600;margin:4px 0 6px}
.bld .lede{margin:0 0 16px}
.bld textarea{width:100%;min-height:120px;font:17px/1.45 'Instrument Sans',sans-serif;padding:14px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);resize:vertical}
.bld .row{display:flex;gap:8px;margin-top:10px}
.bld .row .btn{flex:1}
.bld .mic{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:52px}
.bld .mic.on{background:var(--warn);color:#fff}
.bld .mic svg{width:20px;height:20px}
.bld .ex{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0 0}
.bld .ex button{min-height:36px;padding:0 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:500 14px 'Instrument Sans',sans-serif;cursor:pointer}
.bld .exl{font-size:13px;color:var(--dim);margin:18px 0 0}
.brief{background:var(--card);border-radius:12px;padding:14px;margin:4px 0 14px}
.brief label{display:block;font-size:13px;color:var(--dim);margin:0 0 4px}
.brief input{width:100%;font:500 16px 'JetBrains Mono',monospace;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
.brief textarea{min-height:90px;background:var(--bg);font-size:16px}
.brief .fld+.fld{margin-top:12px}
.brief .url{font-size:13px;color:var(--dim);margin:4px 0 0;overflow-wrap:anywhere}
.steps3{margin:0 0 16px;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.steps3 li{display:flex;gap:10px;font-size:15px}
.steps3 li b{flex:none;width:22px;height:22px;border-radius:50%;background:var(--chip);display:flex;align-items:center;justify-content:center;font-size:12px}
.bld .err{color:var(--warn);font-size:14px;min-height:1.4em;margin:8px 0 0}
.bld .back4{background:none;border:0;color:var(--acc);font:500 15px 'Instrument Sans',sans-serif;padding:10px 0;cursor:pointer}
`;

const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`;

const esc = (s: string) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The Build page body. `me` = the signed-in handle ('' when signed out). */
export function buildBody(me: string, needsKey: boolean, runDomain: string) {
  return `<div class="bld">
<section id="s1"><h1>What do you want to build?</h1>
<p class="lede">Say it in a sentence. Agents build it as a web app with its own address, and you can keep changing it in plain words.</p>
<textarea id="idea" placeholder="A shared shopping list for my family…" enterkeyhint="next" aria-label="What do you want to build?"></textarea>
<div class="row"><button type="button" class="chipbtn mic" id="mic" hidden aria-label="Speak instead of typing">${MIC}<span>Speak</span></button><button type="button" class="btn" id="next">Next</button></div>
<p class="exl">Or start from one of these</p><div class="ex">${EXAMPLES.map((e) => `<button type="button" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div></section>
<section id="s2" hidden><button type="button" class="back4" id="back">Change the idea</button>
<h1>Here's what forq will build</h1>
<div class="brief"><div class="fld"><label for="pname">Project name</label><input id="pname" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="39">
<p class="url">It will live at <b id="purl"></b></p></div>
<div class="fld"><label for="pidea">What you asked for</label><textarea id="pidea"></textarea></div></div>
<ol class="steps3"><li><b>1</b>A new project is created${me ? ` under ${esc(me)}` : ''}, with a page that runs at once.</li>
<li><b>2</b>Its router agent plans the work and starts an agent for each part.</li>
<li><b>3</b>A reviewer agent checks every change in a preview before it goes live.</li>
<li><b>4</b>You watch it happen, try the result, and ask for more changes any time.</li></ol>
${needsKey ? `<p class="lede">Agents run on your own Anthropic API key. <a href="/settings">Add it in Settings</a> first; your idea stays here.</p>` : ''}
<button class="btn" id="go" style="width:100%"${needsKey ? ' disabled' : ''}>${me ? 'Start building' : 'Sign in to start building'}</button>
<p class="err" id="err" role="status"></p></section></div>
<script>
(function(){
 const KEY='forq.buildDraft',DOM=${JSON.stringify(runDomain)},ME=${JSON.stringify(me)};
 const $=(id)=>document.getElementById(id),idea=$('idea'),pname=$('pname'),pidea=$('pidea');
 const STOP=new Set('a an the for my our your with that which to of and in on at by from app web page website site tool simple small little i we me want need make build create please some lets let us like who what where when'.split(' '));
 const suggest=(t)=>(t.toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(/\\s+/).filter((w)=>w&&!STOP.has(w)).slice(0,3).join('-')||'my-app').slice(0,39);
 const clean=(n)=>n.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/-{2,}/g,'-').replace(/^-+|-+$/g,'').slice(0,39);
 const url=()=>{$('purl').textContent=(clean(pname.value)||'my-app')+'--'+(ME||'you')+'.'+DOM;};
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify({idea:pidea.value||idea.value,name:pname.value}))}catch{}};
 function brief(){const t=idea.value.trim();if(!t){idea.focus();return;}
  pidea.value=t;if(!pname.dataset.touched)pname.value=suggest(t);url();$('s1').hidden=true;$('s2').hidden=false;scrollTo(0,0);save();
  history.replaceState(null,'','/build?step=brief');}
 $('next').onclick=brief;
 idea.addEventListener('keydown',(e)=>{if(e.key==='Enter'&&!e.shiftKey&&matchMedia('(hover:hover)').matches){e.preventDefault();brief();}});
 for(const b of document.querySelectorAll('[data-ex]'))b.onclick=()=>{idea.value=b.dataset.ex;brief();};
 $('back').onclick=()=>{idea.value=pidea.value;$('s2').hidden=true;$('s1').hidden=false;history.replaceState(null,'','/build');idea.focus();};
 pname.addEventListener('input',()=>{pname.dataset.touched=1;url();save();});pidea.addEventListener('input',save);
 // Speak: the browser's own speech recognition (Chrome on Android and desktop); hidden where there is none.
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition,mic=$('mic');
 if(SR){mic.hidden=false;let rec=null,base='';
  mic.onclick=()=>{if(rec){rec.stop();return;}
   rec=new SR();rec.interimResults=true;rec.continuous=false;rec.lang=navigator.language||'en-US';base=idea.value?idea.value.trim()+' ':'';
   rec.onresult=(e)=>{let t='';for(const r of e.results)t+=r[0].transcript;idea.value=base+t;};
   rec.onend=()=>{rec=null;mic.classList.remove('on');mic.querySelector('span').textContent='Speak';};
   rec.onerror=()=>{};rec.start();mic.classList.add('on');mic.querySelector('span').textContent='Listening';};}
 // Back from sign-in (or a reload): the brief, filled in.
 try{const d=JSON.parse(localStorage.getItem(KEY)||'null');if(d&&d.idea&&new URLSearchParams(location.search).get('step')==='brief'){idea.value=d.idea;if(d.name){pname.value=d.name;pname.dataset.touched=1;}brief();}}catch{}
 $('go').onclick=async()=>{const name=clean(pname.value),prompt=pidea.value.trim(),err=$('err');
  if(!name){err.textContent='Give the project a name.';return;}if(!prompt){err.textContent='Say what to build.';return;}
  save();if(!ME){location.href='/login?next='+encodeURIComponent('/build?step=brief');return;}
  const b=$('go');b.disabled=true;b.textContent='Creating the project';err.textContent='';
  const r=await fetch('/api/build',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,prompt})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){b.disabled=false;b.textContent='Start building';err.textContent=j.error||'Could not start';return;}
  try{localStorage.removeItem(KEY)}catch{}location.href=j.path;};
})();
</script>`;
}
