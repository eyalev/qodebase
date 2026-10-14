// "Connect your Claude plan" (qb7, manager 2026-10-12, Eyal approved; rules: ~/.claude/docs/claude-subscription-policy.md).
// One block, used by /build (the first Build without a key) and Settings. The person runs the real `claude setup-token`
// on their own computer, signs in with their own Pro/Max plan, and pastes the token; qodebase checks it with one call
// through the unmodified claude binary (qb6, POST /api/me/key -> {ok, tail, kind:'plan'|'api'} or 400 {error}) and
// starts Claude Code with it in their own boxes. "Or use an API key" is the Console path (Max/Team monthly API credits
// reach only keys of a Console org linked in claude.ai billing). On success the block fires 'qb:connected' on document.
// Uses the page tokens only (--fg --dim --line --card --chip --acc --warn) and the shells' .btn/.chipbtn.

const esc = (s: string) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!));

export type KeyState = { kind?: 'plan' | 'api'; tail?: string; checkedAt?: number; failed?: { at: number; why: string } };

export const COVERAGE = "Your agents run the real Claude Code on your plan; it counts toward your Claude plan's limits, counted by Claude, not billed by qodebase. qodebase's own helpers (ideas, Suggest, Talk) run on Cloudflare at our cost.";

const COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`;

const CSS = `.cp{display:grid;gap:14px;margin:0 0 16px}
.cp[data-mode=build]{padding:16px;border-radius:14px;background:var(--card);box-shadow:inset 0 0 0 1px var(--frame,var(--line));margin:4px 0 20px}
.cp[data-mode=build] .cp-cmd,.cp[data-mode=build] input.cp-in{background:var(--bg)}
.cp[data-mode=build] .cp-cov,.cp[data-mode=build] .cp-on{padding:0;background:none;box-shadow:none}
.cp label code{white-space:nowrap}
.cp .cp-phone{display:none;gap:8px;padding:12px;border-radius:10px;background:var(--chip);font-size:14px;line-height:1.45}
.cp .cp-phone p{margin:0}
@media (pointer:coarse),(max-width:600px){.cp .cp-phone{display:grid}}
.cp h2.cp-h{font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0}
.cp .cp-sub{margin:-8px 0 0;color:var(--dim);font-size:15px}
.cp ol{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.cp li{display:grid;grid-template-columns:24px 1fr;gap:10px;align-items:start}
.cp li>b{width:24px;height:24px;border-radius:50%;background:var(--chip);display:grid;place-items:center;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.cp li>div{display:grid;gap:8px;min-width:0;font-size:15px;line-height:1.45}
.cp .cp-cmd{display:flex;align-items:stretch;border-radius:10px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.cp .cp-cmd code{flex:1;min-width:0;padding:12px;font:15px/1.3 'JetBrains Mono',ui-monospace,monospace;overflow-x:auto;white-space:nowrap}
.cp .cp-copy{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border:0;border-left:1px solid var(--line);background:transparent;color:var(--fg);font:500 14px 'Geist',sans-serif;cursor:pointer}
.cp .cp-copy svg{width:16px;height:16px}
.cp .cp-small{color:var(--dim);font-size:13px;margin:0}
.cp .cp-small code{font-size:12px}
.cp input.cp-in{width:100%;box-sizing:border-box;font:16px 'Geist',sans-serif;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.cp input.cp-in:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
.cp .cp-go{width:100%}
.cp .cp-msg{margin:0;min-height:1.4em;font-size:14px;color:var(--dim)}
.cp .cp-msg.bad{color:var(--warn);font-weight:500}
.cp .cp-cov{margin:0;padding:12px;border-radius:10px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line);font-size:14px;color:var(--dim);line-height:1.45}
.cp details{border-top:1px solid var(--line);padding-top:4px}
.cp summary{min-height:44px;display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:500;list-style:none}
.cp summary::-webkit-details-marker{display:none}
.cp summary::before{content:'';width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s}
.cp details[open] summary::before{transform:rotate(45deg)}
.cp .cp-api{display:grid;gap:10px;padding:4px 0 8px}
.cp .cp-on{display:grid;gap:10px;padding:14px;border-radius:12px;background:var(--card);box-shadow:inset 0 0 0 1px var(--line)}
.cp .cp-on p{margin:0}
.cp .cp-on .cp-st{display:flex;align-items:center;gap:8px;font-weight:600}
.cp .cp-on .cp-st i{width:8px;height:8px;border-radius:50%;background:var(--acc)}
.cp .cp-fail .cp-st{color:var(--warn)}.cp .cp-fail .cp-st i{background:var(--warn)}.cp .cp-why{font-size:14px}
.cp .cp-acts{display:flex;gap:8px;flex-wrap:wrap}
@media (min-width:900px){.cp .cp-go{width:auto;justify-self:start;padding:0 24px}}`;

const ago = (t?: number) => {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 3600 ? 'just now' : s < 86400 ? `${Math.floor(s / 3600)} h ago` : s < 2 * 86400 ? 'yesterday' : `${Math.floor(s / 86400)} days ago`;
};

/** mode 'build': shown on /build before the first Build; 'settings': the Settings section (connected state + replace). */
export function connectPlan(mode: 'build' | 'settings', k: KeyState = {}) {
  const on = !!k.tail;
  const kind = k.kind || (on ? 'api' : undefined);
  const steps = `<div class="cp-phone"><p>Step 1 needs a computer. Easiest: open Settings on your computer and connect there; this page notices when you come back. Or send the token to your phone and paste it in step 3.</p><button type="button" class="chipbtn" data-copy-link aria-label="Copy a link to this step">Copy a link to this step</button></div>
<ol>
<li><b>1</b><div><span>On your computer, run</span><div class="cp-cmd"><code>claude setup-token</code><button type="button" class="cp-copy" data-copy="claude setup-token" aria-label="Copy the command">${COPY}<span>Copy</span></button></div>
<p class="cp-small">No Claude Code there yet? <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noopener">Install it</a> first.</p></div></li>
<li><b>2</b><div><span>Sign in with your Claude Pro or Max plan in the browser that opens.</span></div></li>
<li><b>3</b><div><label for="cp-plan">Paste the token it prints here. It starts with <code>sk-ant-oat</code>.</label>
<input class="cp-in" id="cp-plan" aria-describedby="cp-msg" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="sk-ant-oat01-…" enterkeyhint="done">
<button type="button" class="btn cp-go" data-cp="plan">Connect my plan</button></div></li>
</ol>
<p class="cp-msg" id="cp-msg" role="status" aria-live="polite"></p>
<p class="cp-cov">${COVERAGE}</p>
<details class="cp-alt"><summary>Or use an API key</summary><div class="cp-api">
<label for="cp-api">A Claude API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. You pay for what your agents use on that key; qodebase does not bill it.</label>
<input class="cp-in" id="cp-api" aria-describedby="cp-msg" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="sk-ant-api03-…">
<button type="button" class="chipbtn cp-go" data-cp="api">Save the key</button>
<p class="cp-small">Max and Team plans' monthly API credits pay for a key only when it belongs to a Console organization linked in your claude.ai billing settings. A plan sign-in above uses your plan's limits instead.</p></div></details>`;
  const head = mode === 'build'
    ? `<h2 class="cp-h">Connect your Claude plan</h2><p class="cp-sub">Your agents need Claude to work. This takes about a minute, once.</p>`
    : '';
  const connected = on ? `<div class="cp-on${k.failed ? ' cp-fail' : ''}"><p class="cp-st"><i aria-hidden="true"></i>${k.failed ? (kind === 'plan' ? 'Your Claude sign-in stopped working' : 'Your API key stopped working') : kind === 'plan' ? 'Claude plan connected' : 'API key connected'}</p>${k.failed ? `<p class="cp-why">${esc(k.failed.why)}${k.failed.at ? `, ${ago(k.failed.at)}` : ''}. ${kind === 'plan' ? 'Run claude setup-token again and paste the new token with Replace.' : 'Replace it with a working key.'}</p>` : ''}
<p class="cp-small">${kind === 'plan' ? 'Token' : 'Key'} ending in …${esc(k.tail || '')}${k.checkedAt ? `, checked ${ago(k.checkedAt)}` : ''}. ${kind === 'plan' ? "Your agents run the real Claude Code on your plan's limits." : 'You pay for what your agents use on that key; qodebase does not bill it.'}</p>
<div class="cp-acts"><button type="button" class="chipbtn" data-cp="replace" aria-expanded="false">Replace</button><button type="button" class="chipbtn" data-cp="remove">Remove</button></div></div>` : '';
  return `<section class="cp" id="connect" data-mode="${mode}" aria-label="Connect your Claude plan">${head}${connected}<div class="cp-steps"${on ? ' hidden' : ''}>${steps}</div></section>
<style>${CSS}</style>
<script>(function(){const S=document.getElementById('connect');if(!S||S.dataset.wired)return;S.dataset.wired='1';
const msg=S.querySelector('.cp-msg'),log=(ev,x)=>{try{console.log(JSON.stringify(Object.assign({module:'connectplan',event:ev},x||{})));}catch(e){}};
const say=(t,bad)=>{msg.textContent=t;msg.classList.toggle('bad',!!bad);if(!bad)S.querySelectorAll('[aria-invalid]').forEach((x)=>x.removeAttribute('aria-invalid'));};
S.addEventListener('input',(e)=>{if(e.target.matches('.cp-in')){e.target.removeAttribute('aria-invalid');if(msg.classList.contains('bad'))say('');}});
// setup-token prints the token wrapped over lines in narrow terminals: drop every space and line break.
const clean=(v)=>String(v||'').replace(/\\s+/g,'');
async function save(kind,btn){const inp=S.querySelector(kind==='plan'?'#cp-plan':'#cp-api'),key=clean(inp.value);
 if(!key){say(kind==='plan'?'Paste the token from step 3 first.':'Paste the API key first.',true);inp.setAttribute('aria-invalid','true');inp.focus();return;}
 if(!/^sk-ant-/.test(key)){say(kind==='plan'?'That is not a Claude token: it starts with sk-ant-oat. Copy the whole line setup-token printed.':'That is not a Claude API key: it starts with sk-ant-.',true);inp.focus();return;}
 if(kind==='api'&&/^sk-ant-oat/.test(key)){say('That is a Claude plan token: paste it in step 3 above instead.',true);return;}
 if(kind==='plan'&&!/^sk-ant-oat/.test(key)){say('That looks like an API key: open "Or use an API key" below and paste it there.',true);return;}
 const label=btn.textContent;btn.disabled=true;btn.textContent='Checking…';say(kind==='plan'?'Checking the token with Claude Code. This can take up to 40 seconds the first time.':'Checking the key with Claude.');
 const t0=performance.now();let r,j={};
 try{r=await fetch('/api/me/key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key})});j=await r.json().catch(()=>({}));}catch(e){r={ok:false,status:0};}
 log('save',{kind,status:r.status,ok:!!r.ok,ms:Math.round(performance.now()-t0),got:j.kind||null});
 btn.disabled=false;btn.textContent=label;
 if(!r.ok){say(j.error||(r.status?'That did not work. Try again.':'Could not reach qodebase. Try again.'),true);inp.setAttribute('aria-invalid','true');inp.focus();return;}
 inp.value='';connected(j.kind||kind,j.tail);}
function connected(kind,tail){
 if(S.dataset.mode==='settings'){location.reload();return;}
 if(S.dataset.done)return;S.dataset.done='1';
 S.querySelector('.cp-steps').hidden=true;
 const done=document.createElement('div');done.className='cp-on';done.innerHTML='<p class="cp-st"><i aria-hidden="true"></i></p><p class="cp-small"></p>';
 done.querySelector('.cp-st').append(kind==='api'?'API key connected':'Claude plan connected');
 done.querySelector('.cp-small').textContent=(kind==='api'?'Key':'Token')+' ending in …'+(tail||'')+'. You can change it in Settings.';
 S.querySelector('.cp-sub')?.remove();S.querySelector('.cp-h')?.remove();S.append(done);done.setAttribute('tabindex','-1');done.focus({preventScroll:true});
 document.dispatchEvent(new CustomEvent('qb:connected',{detail:{kind,tail}}));}
// Connected on another device (step 1 is on a computer): look again when this tab comes back (qb6: GET /api/me/key).
document.addEventListener('visibilitychange',async()=>{if(document.hidden||S.dataset.done||S.querySelector('.cp-on'))return;
 try{const r=await fetch('/api/me/key',{cache:'no-store'});if(!r.ok)return;const j=await r.json();log('recheck',{kind:j.kind||null});if(j.kind)connected(j.kind,j.tail);}catch(e){}});
S.addEventListener('click',async(e)=>{const cl=e.target.closest('[data-copy-link]');
 if(cl){const u=location.origin+(S.dataset.mode==='build'?'/settings':location.pathname)+'#connect';try{if(navigator.share&&matchMedia('(pointer:coarse)').matches){await navigator.share({title:'Connect your Claude plan',url:u});}else{await navigator.clipboard.writeText(u);cl.textContent='Link copied';setTimeout(()=>{cl.textContent='Copy a link to this step';},1600);}}catch(x){}log('copy_link');return;}
 const c=e.target.closest('[data-copy]');
 if(c){try{await navigator.clipboard.writeText(c.dataset.copy);c.querySelector('span').textContent='Copied';setTimeout(()=>{c.querySelector('span').textContent='Copy';},1600);}catch(x){c.querySelector('span').textContent='Select it';}log('copy');return;}
 const b=e.target.closest('[data-cp]');if(!b)return;const a=b.dataset.cp;
 if(a==='plan'||a==='api')return save(a,b);
 if(a==='replace'){const st=S.querySelector('.cp-steps'),open=st.hidden;st.hidden=!open;b.setAttribute('aria-expanded',String(open));b.textContent=open?'Cancel':'Replace';if(open)S.querySelector('#cp-plan').focus();return;}
 if(a==='remove'){if(b.dataset.sure!=='1'){b.dataset.sure='1';b.textContent='Remove it? New agents cannot start';setTimeout(()=>{if(b.isConnected){b.dataset.sure='';b.textContent='Remove';}},6000);return;}
  b.disabled=true;let r;try{r=await fetch('/api/me/key',{method:'DELETE'});}catch(x){r={ok:false};}log('remove',{ok:!!r.ok});if(r.ok)location.reload();else{b.disabled=false;say('Could not remove it. Try again.',true);}}});
S.querySelector('#cp-plan')?.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();save('plan',S.querySelector('[data-cp="plan"]'));}});
S.querySelector('#cp-api')?.addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();save('api',S.querySelector('[data-cp="api"]'));}});
if(location.hash==='#connect')setTimeout(()=>S.scrollIntoView({block:'start'}),50);})();</script>`;
}
