// /personal-agents: a plain-language guide to running your own AI assistant in
// your own Cloudflare account. Facts checked 2026-10-04 against each project's
// README (moltworker, workers-personal-agent, Nous Portal); re-check before
// changing a cost or a claim.

const CSS = `
:root{--bg:#fff;--card:#f6f7f8;--chip:#eceef1;--line:#e2e5e9;--fg:#15171a;--dim:#5f6670;--acc:#17695a;--acc-fg:#fff;--busy:#b7791f;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0f1112;--card:#171a1c;--chip:#202427;--line:#272b2f;--fg:#e8eaec;--dim:#9ba2a9;--acc:#4fbf9f;--acc-fg:#0f1112;--busy:#e0a948;color-scheme:dark}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 'Instrument Sans',sans-serif}
main{max-width:720px;margin:0 auto;padding:12px 16px calc(40px + env(safe-area-inset-bottom))}
a{color:var(--acc);text-decoration:none}
header{display:flex;align-items:center;justify-content:space-between;height:48px}
.mark{font-weight:600;font-size:20px;color:var(--fg)}
h1{font-size:28px;line-height:1.15;margin:16px 0 8px;font-weight:600;letter-spacing:-.01em}
h2{font-size:20px;font-weight:600;margin:40px 0 8px}
h3{font-size:17px;font-weight:600;margin:0}
p{margin:8px 0}
.lede{font-size:17px;color:var(--fg)}
.dim{color:var(--dim)}
.pts{margin:8px 0 20px;padding-left:20px;font-size:17px}.pts li{margin:4px 0}
.facts{margin:8px 0 0;padding-left:18px;color:var(--dim);font-size:15px}.facts li{margin:2px 0}
.need{display:grid;gap:8px;margin:12px 0 0;padding:0;list-style:none}
.need li{background:var(--card);border-radius:8px;padding:12px 14px}
.need b{font-weight:600}
.cards{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.card{background:var(--card);border-radius:12px;padding:16px}
.card .head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.tag{font-size:13px;background:var(--chip);border-radius:4px;padding:2px 8px;white-space:nowrap;color:var(--fg)}
.tag.acc{background:color-mix(in srgb,var(--acc) 16%,transparent);color:var(--acc)}
a.tag{text-decoration:none}
.ico{width:.95em;height:.95em;vertical-align:-.12em;margin-left:.25em;flex:none}
button.tag{border:0;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;min-height:28px}
.linkish{background:none;border:0;padding:0;font:inherit;color:var(--acc);cursor:pointer;display:inline-flex;align-items:center}
.planpop{max-width:min(420px,calc(100vw - 32px));border:0;border-radius:12px;padding:20px;background:var(--bg);color:var(--fg);box-shadow:0 12px 40px rgba(0,0,0,.25),inset 0 0 0 1px var(--line)}
.planpop::backdrop{background:rgba(0,0,0,.35)}
.planpop h3{margin:0 0 8px;font-size:18px}.planpop p{font-size:15px;color:var(--dim);margin:8px 0}.planpop p b{color:var(--fg)}
.planpop .btns{margin-top:16px}
.planline{font-size:14px;color:var(--dim);margin:-8px 0 16px}
.tag.busy{background:color-mix(in srgb,var(--busy) 18%,transparent);color:var(--busy)}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:12px 0;font-size:15px}
dt{color:var(--dim)}dd{margin:0}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:8px;font-weight:600;font-size:15px}
.btn.pri{background:var(--acc);color:var(--acc-fg)}
.btn.sec{background:var(--chip);color:var(--fg)}
details{border-top:1px solid var(--line);margin-top:12px}
summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:500;color:var(--acc);list-style:none}
summary::-webkit-details-marker{display:none}
details[open] summary{color:var(--fg)}
ol{margin:0 0 4px;padding-left:22px}ol li{margin:6px 0}
code{font:14px 'JetBrains Mono',monospace;background:var(--chip);border-radius:4px;padding:1px 5px;word-break:break-all}
.cmp{width:100%;border-collapse:collapse;font-size:14px;margin-top:12px}
.cmpwrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.cmp th,.cmp td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.cmp th{font-weight:600}.cmp td:first-child{color:var(--dim);white-space:nowrap}
.foot{display:flex;gap:16px;margin-top:48px;font-size:14px}
@media (hover:hover){.btn.pri:hover{filter:brightness(1.08)}.btn.sec:hover{background:var(--line)}}
`;

const shell = (title: string, body: string, extraCss = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${CSS}${INSTALL_CSS}${extraCss}</style></head><body><main>
<header><a class="mark" href="/">qodebase</a><a href="/personal-agents">Assistants</a></header>
${body}
</main></body></html>`;

const INSTALL_CSS = `
.field{display:flex;flex-direction:column;gap:6px;margin:16px 0}
.field label{font-weight:600;font-size:15px}
.field input,.field select{font:16px 'Instrument Sans',sans-serif;min-height:48px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)}
.field .hint{font-size:13px;color:var(--dim)}
.addr{font:14px 'JetBrains Mono',monospace;color:var(--dim);word-break:break-all}
button.btn{border:0;cursor:pointer;font:600 15px 'Instrument Sans',sans-serif;width:100%;justify-content:center}
.btn.wide{width:100%;justify-content:center}
.err{background:color-mix(in srgb,#b42d1f 12%,transparent);color:var(--fg);border-radius:8px;padding:12px 14px;margin:12px 0}
.steps{list-style:none;padding:0;margin:20px 0;display:flex;flex-direction:column;gap:2px}
.steps li{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
.dot{flex:0 0 12px;height:12px;border-radius:50%;margin-top:5px;background:var(--chip);box-shadow:inset 0 0 0 1px var(--line)}
.dot.doing{background:var(--busy);animation:pulse 1s ease-in-out infinite alternate}.dot.done{background:var(--acc)}.dot.failed{background:#b42d1f}
@keyframes pulse{to{opacity:.35}}
@media (prefers-reduced-motion:reduce){.dot.doing{animation:none}}
.steps .t{font-size:15px}.steps .n{font-size:13px;color:var(--dim)}
.small{font-size:13px;color:var(--dim)}
.linkbtn{background:none;border:0;color:var(--acc);font:inherit;padding:0;cursor:pointer;min-height:44px}
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Tpl = { id: string; title: string };
export type InstallPageState =
  | { kind: 'connect'; template: Tpl; startHref: string }
  | { kind: 'form'; template: Tpl; accounts: { id: string; name: string }[]; name: string; error?: string }
  | { kind: 'error'; text: string; next: string };

export function installPage(st: InstallPageState): string {
  if (st.kind === 'error') return shell('Could not connect · qodebase', `<h1>That did not work</h1><p class="err">${esc(st.text)}</p><div class="btns"><a class="btn pri wide" href="${esc(st.next)}">Back</a></div>`);
  if (st.kind === 'connect') return shell(`Install ${st.template.title} · qodebase`, `<h1>Install ${esc(st.template.title)}</h1>
<ul class="pts"><li>It goes into <b>your</b> Cloudflare account</li><li>qodebase asks Cloudflare for permission once</li><li>No GitHub, no keys to copy</li></ul>
<div class="btns"><a class="btn pri wide" href="${esc(st.startHref)}">Sign in with Cloudflare</a></div>
<p class="small">No account yet? You can make one on the same screen. You can take qodebase's access back any time in your Cloudflare profile.</p>`);
  const many = st.accounts.length > 1;
  return shell(`Install ${st.template.title} · qodebase`, `<h1>Install ${esc(st.template.title)}</h1>
${st.error ? `<p class="err">${esc(st.error)}</p>` : ''}
<form method="post">
<div class="field"><label for="name">Name</label>
<input id="name" name="name" value="${esc(st.name)}" required pattern="[a-z][a-z0-9\-]{1,38}[a-z0-9]" autocapitalize="none" autocomplete="off" spellcheck="false" inputmode="url">
<span class="hint">Lowercase letters, numbers and dashes. It becomes the address.</span></div>
${many ? `<div class="field"><label for="account">Cloudflare account</label><select id="account" name="account">${st.accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></div>`
       : `<input type="hidden" name="account" value="${esc(st.accounts[0]?.id || '')}"><p class="small">Into ${esc(st.accounts[0]?.name || '')}</p>`}
<div class="btns"><button class="btn pri" type="submit">Install</button></div>
</form>
<form method="post" action="/connect/cf/disconnect?next=/personal-agents"><button class="linkbtn" type="submit">Disconnect Cloudflare</button></form>`);
}

export type InstallView = { id: string; title: string; name: string; accountName: string; steps: { key: string; label: string; state: string; note?: string }[]; url?: string; error?: string; fix?: { text: string; href: string }; log?: string; wakes?: boolean; extra?: { text: string; href: string } };

export function installProgressPage(v: InstallView): string {
  const body = `<h1 id="h">${v.url ? `${esc(v.name)} is ready` : v.error ? 'Install stopped' : `Installing ${esc(v.name)}`}</h1>
<p class="small">${esc(v.title)} into ${esc(v.accountName)}</p>
${v.url || v.error ? '' : `<p class="small">Usually under a minute. You can leave this page; it keeps going.</p>`}
<ul class="steps" id="steps">${v.steps.map((s) => `<li><span class="dot ${esc(s.state)}"></span><div><div class="t">${esc(s.label)}</div>${s.note ? `<div class="n">${esc(s.note)}</div>` : ''}</div></li>`).join('')}</ul>
<div id="end">${v.url ? `<div class="btns"><a class="btn pri wide" href="${esc(v.url)}">Open ${esc(v.title)}</a></div><p class="addr">${esc(v.url)}</p><p class="small">It is locked to you, so the first time you open it Cloudflare asks you to sign in once more. Choose <b>Cloudflare</b> (quickest if this browser is signed in to the Cloudflare dashboard) or <b>get a code by email</b>.</p>${v.extra ? `<div class="btns"><a class="btn sec wide" href="${esc(v.extra.href)}">${esc(v.extra.text)}</a></div>` : ''}<p class="small">Only you can open it. The first visit asks you to sign in with Cloudflare.${v.wakes ? ' The first start takes about a minute; after that it sleeps when idle and wakes in seconds.' : ''}</p>`
  : v.error ? `<p class="err">${esc(v.error)}</p>${v.fix ? `<div class="btns"><a class="btn pri wide" href="${esc(v.fix.href)}">${esc(v.fix.text)}</a></div>` : ''}<div class="btns"><a class="btn sec wide" href="/personal-agents">Back</a></div>${v.log ? `<details><summary>Details</summary><pre class="addr" style="white-space:pre-wrap">${esc(v.log)}</pre></details>` : ''}` : ''}</div>`;
  const poll = v.url || v.error ? '' : `<script>
(function(){var t=setInterval(function(){fetch(location.pathname+'.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(v){
if(v.url||v.error){clearInterval(t);location.reload();return}
var ul=document.getElementById('steps');ul.innerHTML=v.steps.map(function(s){return '<li><span class="dot '+s.state+'"></span><div><div class="t">'+s.label+'</div>'+(s.note?'<div class="n">'+s.note.replace(/[<>&]/g,'')+'</div>':'')+'</div></li>'}).join('')
}).catch(function(){})},2000)})();</script>`;
  return shell(`${v.name} · qodebase`, body + poll);
}

export function personalAgentsPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Your own AI assistant · qodebase</title>
<meta name="description" content="Run a personal AI assistant in your own Cloudflare account: what it is, what it costs, and how to set one up without writing code.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><main>
<header><a class="mark" href="/">qodebase</a><a href="/about">About</a></header>

<h1>Your own AI assistant</h1>
<ul class="pts">
<li>Runs in <b>your</b> Cloudflare account</li>
<li>Your data, your AI model, no ads</li>
<li>No code, no GitHub: sign in with Cloudflare, tap Install</li>
</ul>
<p class="planline">Cloudflare Agent fits Cloudflare's free plan (as of Oct 2026). The others need Cloudflare's Workers Paid plan: <b>$5 a month for your whole Cloudflare account</b>, not per assistant. One plan covers all of them. <button class="linkish" type="button" popovertarget="planinfo">What you get <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></p>

<div id="planinfo" popover class="planpop">
<h3>One plan for all your assistants</h3>
<p>Cloudflare's Workers Paid plan costs <b>$5 a month per Cloudflare account</b>, not per assistant. Install OpenClaw, Hermes, T3 Code, Mobile Agent and Pi in the same account and you still pay $5.</p>
<p>It includes a monthly amount of use (requests, compute, AI). Most personal use stays inside it; anything above is billed by Cloudflare to your account. Assistants sleep when idle to keep it low.</p>
<p>You pay Cloudflare directly. qodebase never sees your card.</p>
<div class="btns"><a class="btn sec" href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Cloudflare's plan page<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a><button class="btn pri" type="button" popovertarget="planinfo" popovertargetaction="hide">Got it</button></div>
</div>
<div class="cards">
<section class="card" id="agents-starter">
<div class="head"><h3>Cloudflare Agent</h3><span class="tag acc">Cloudflare free plan</span></div>
<ul class="facts"><li>Cloudflare's official <a href="https://github.com/cloudflare/agents-starter" target="_blank" rel="noopener">agents starter<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> (1.3k ★)</li><li>Chat, images, weather, reminders, scheduled tasks</li><li>Fits Cloudflare's free plan as of Oct 2026: <a href="https://developers.cloudflare.com/workers-ai/platform/pricing/" target="_blank" rel="noopener">10,000 AI units a day<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a>, about 50–100 messages</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/agents-starter">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/agents-starter">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Sign in with Cloudflare (a free account is enough)</li>
<li>Name it, tap Install</li>
<li>Open it and chat</li>
</ol></details>
</section>


<section class="card" id="openclaw">
<div class="head"><h3>OpenClaw</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>The popular open-source assistant</li><li>Chat on the web, add Telegram later</li><li>Sleeps when idle and keeps your chats</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/openclaw">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/container-agents">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>First open installs it (a few minutes, once)</li>
</ol></details>
</section>

<section class="card" id="pi">
<div class="head"><h3>Pi</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>Pi, the popular coding agent (113k ★ on GitHub), as Pi Durable in <a href="https://github.com/cloudflare/agents/tree/main/examples/next/harnesses/pi" target="_blank" rel="noopener">Cloudflare's official example<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> (beta)</li><li>Reads and writes files, runs JavaScript, clones git repos</li><li>Close the tab mid-answer: it keeps working and picks up where it was</li><li>No container: always on, nothing to wake</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/pi">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/pi-durable">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>Open it and ask for an app</li>
</ol></details>
</section>

<section class="card" id="t3code">
<div class="head"><h3>T3 Code</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>Coding agents from your phone</li><li>OpenCode with a free model built in; sign in to Claude Code too</li><li>Keeps your projects; wakes in about 30 seconds</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/t3code">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/container-agents">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>First open installs it (a few minutes, once)</li>
</ol></details>
</section>

<section class="card" id="mobile-agent">
<div class="head"><h3>Mobile Agent</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>A terminal made for the phone: keys, input and chat in front</li><li>Claude Code and Codex built in, on your own Claude or ChatGPT plan</li><li>Keeps your work; sleeps when idle</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/mobile-agent">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/container-agents">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>First open installs it (a few minutes, once)</li>
<li>Sign in to Claude from its menu (needs a Claude Pro or Max plan)</li>
</ol></details>
</section>

<section class="card" id="hermes">
<div class="head"><h3>Hermes</h3><button class="tag busy" type="button" popovertarget="planinfo" aria-label="Needs the Cloudflare $5 a month plan. What this means">Cloudflare $5/mo plan <svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
<ul class="facts"><li>Nous Research's agent that learns as it goes</li><li>Web dashboard, add Telegram later</li><li>Sleeps when idle and keeps what it learned</li></ul>
<div class="btns"><a class="btn pri" href="/personal-agents/install/hermes">Install in my Cloudflare</a><a class="btn sec" href="/p/forq/container-agents">Code</a></div>
<details><summary>What happens</summary><ol>
<li>Your Cloudflare account needs the <a href="https://www.cloudflare.com/plans/developer-platform/" target="_blank" rel="noopener">Workers Paid plan<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></a> ($5/month for your whole account)</li>
<li>Sign in with Cloudflare, name it, tap Install</li>
<li>First open installs it (a few minutes, once)</li>
</ol></details>
</section>
</div>

<p class="foot"><a href="/">qodebase</a><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/feedback?from=/personal-agents">Feedback</a></p>
</main></body></html>`;
}
