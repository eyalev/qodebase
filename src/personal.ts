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
.need{display:grid;gap:8px;margin:12px 0 0;padding:0;list-style:none}
.need li{background:var(--card);border-radius:8px;padding:12px 14px}
.need b{font-weight:600}
.cards{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.card{background:var(--card);border-radius:12px;padding:16px}
.card .head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.tag{font-size:13px;background:var(--chip);border-radius:4px;padding:2px 8px;white-space:nowrap;color:var(--fg)}
.tag.acc{background:color-mix(in srgb,var(--acc) 16%,transparent);color:var(--acc)}
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

export function personalAgentsPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Your own AI assistant · forq</title>
<meta name="description" content="Run a personal AI assistant in your own Cloudflare account: what it is, what it costs, and how to set one up without writing code.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><main>
<header><a class="mark" href="/">forq</a><a href="/about">About</a></header>

<h1>Your own AI assistant, in your own account</h1>
<p class="lede">Personal assistants from big companies keep your most private notes, messages and plans on their servers, with their model and their rules. You can run one yourself instead, on Cloudflare, in an account that belongs to you.</p>
<p class="dim">No computer has to stay on at home. You don't need to write code: you click a button, paste one key, and you have an assistant you can chat with from your phone.</p>

<h2>What "yours" means here</h2>
<ul class="need">
<li><b>Your data stays in your account.</b> Memory and files are saved in your own Cloudflare storage. You can download or delete them at any time.</li>
<li><b>You choose the AI model.</b> You bring your own key (Anthropic's Claude, or a free model from Cloudflare). If a better model comes out, you change a setting. You don't move house.</li>
<li><b>Nobody sits in the middle.</b> No ads and no company deciding what your assistant may do. The code is open source, so anyone can check what it does.</li>
<li><b>The honest part:</b> Cloudflare hosts it, so it is not as private as a computer in your own room. It is far more yours than an app that someone else runs for you.</li>
</ul>

<h2>Before you start</h2>
<ul class="need">
<li><b>A Cloudflare account.</b> Free to make at <a href="https://dash.cloudflare.com/sign-up" rel="noopener">dash.cloudflare.com/sign-up</a>. Some assistants need the $5/month Workers Paid plan; each one below says so.</li>
<li><b>An AI key</b> (only for some assistants). Anthropic keys come from <a href="https://console.anthropic.com/" rel="noopener">console.anthropic.com</a>; you pay Anthropic for what you use.</li>
<li><b>About 15 minutes.</b></li>
</ul>

<h2>Choose an assistant</h2>
<p class="dim">Not sure? Start with Personal Agent: it is free and the quickest to set up.</p>
<div class="cards">

<section class="card" id="personal-agent">
<div class="head"><h3>Personal Agent</h3><span class="tag acc">Start here</span></div>
<p>A simple assistant you chat with in your browser. It remembers what you tell it and can look things up on the web.</p>
<dl>
<dt>Cost</dt><dd>Free (fits Cloudflare's free plan with Cloudflare's own free models)</dd>
<dt>Chat from</dt><dd>A web page on your phone or computer</dd>
<dt>AI model</dt><dd>Free Cloudflare models, or your own key (OpenAI-compatible, OpenRouter, Groq)</dd>
<dt>Made by</dt><dd>An independent developer, open source (MIT)</dd>
</dl>
<div class="btns"><a class="btn pri" href="https://deploy.workers.dev/?url=https://github.com/DomWane/workers-personal-agent" rel="noopener">Deploy to my Cloudflare</a><a class="btn sec" href="https://github.com/DomWane/workers-personal-agent" rel="noopener">See the project</a></div>
<details><summary>Step by step</summary><ol>
<li>Tap <b>Deploy to my Cloudflare</b> and sign in to Cloudflare.</li>
<li>Cloudflare copies the assistant into your account. It also connects GitHub so you get your own copy of the code; accept that.</li>
<li>When it asks for settings, keep the defaults to use the free models.</li>
<li>Wait for "Deployed", then open the address it shows. That page is your assistant.</li>
<li>Lock it so only you can open it: in the Cloudflare dashboard, open <b>Zero Trust → Access</b> and add your email to that address. The project's page explains this under "Access".</li>
</ol></details>
</section>

<section class="card" id="openclaw">
<div class="head"><h3>OpenClaw</h3><span class="tag busy">Experimental</span></div>
<p>The popular open-source assistant (once called Moltbot), running in your Cloudflare account through Cloudflare's own "Moltworker". You talk to it on Telegram, Discord or Slack, and it can use a real web browser to do things for you.</p>
<dl>
<dt>Cost</dt><dd>$5/month Workers Paid plan, plus running time: about $5–6/month if it sleeps when not in use, about $35/month if it is awake around the clock. Plus your AI key's usage.</dd>
<dt>Chat from</dt><dd>Telegram, Discord, Slack, or its web page</dd>
<dt>AI model</dt><dd>Claude, with your Anthropic key</dd>
<dt>Made by</dt><dd>Cloudflare (Moltworker) and the OpenClaw community. Cloudflare calls it a proof of concept, not officially supported.</dd>
</dl>
<div class="btns"><a class="btn pri" href="https://deploy.workers.dev/?url=https://github.com/cloudflare/moltworker" rel="noopener">Deploy to my Cloudflare</a><a class="btn sec" href="https://github.com/cloudflare/moltworker" rel="noopener">See the project</a></div>
<details><summary>Step by step</summary><ol>
<li>In the Cloudflare dashboard, turn on the <b>Workers Paid</b> plan ($5/month). OpenClaw runs in a small container, which the free plan does not include.</li>
<li>Tap <b>Deploy to my Cloudflare</b>. When it asks for secrets, paste your Anthropic key and make up a long password for the gateway token. Write the password down.</li>
<li>Protect the admin page with Cloudflare Access (Zero Trust → Access, your email only). The project's page shows the exact settings.</li>
<li>Open your new address, go to the admin page, and approve your phone or computer when it asks to pair.</li>
<li>To chat on Telegram, create a bot with <a href="https://t.me/BotFather" rel="noopener">@BotFather</a> and add its token as a secret. Discord and Slack work the same way.</li>
<li>Save money: set it to go to sleep after a while without messages. It wakes up when you write to it, in a few seconds.</li>
</ol></details>
</section>

<section class="card" id="hermes">
<div class="head"><h3>Hermes Agent</h3><span class="tag">Hosted by Nous</span></div>
<p>An assistant from Nous Research that keeps learning the longer it runs. Their one-click setup runs it on Nous's own cloud, not in your account. It is here so you can compare.</p>
<dl>
<dt>Cost</dt><dd>Set by Nous Portal</dd>
<dt>Your data</dt><dd>On Nous's servers</dd>
<dt>Made by</dt><dd>Nous Research, open source</dd>
</dl>
<div class="btns"><a class="btn sec" href="https://portal.nousresearch.com/cloud" rel="noopener">Hermes on Nous Portal</a></div>
<p class="dim">A version for your own Cloudflare account is on our list. <a href="/feedback?from=/personal-agents">Tell us</a> if you want it.</p>
</section>
</div>

<h2>Side by side</h2>
<div class="cmpwrap"><table class="cmp">
<tr><th></th><th>Personal Agent</th><th>OpenClaw</th><th>Hermes</th></tr>
<tr><td>Runs in</td><td>Your account</td><td>Your account</td><td>Nous's cloud</td></tr>
<tr><td>Per month</td><td>Free</td><td>About $5–35</td><td>Nous pricing</td></tr>
<tr><td>Chat on</td><td>Web</td><td>Telegram, Discord, Slack, web</td><td>Web, chat apps</td></tr>
<tr><td>Setup</td><td>Easiest</td><td>Medium</td><td>Easiest</td></tr>
<tr><td>Stability</td><td>New project</td><td>Proof of concept</td><td>Product</td></tr>
</table></div>

<h2>Questions</h2>
<details><summary>Do I need to know how to code?</summary><p>No. You click, sign in and paste a key. If a step asks for a command, the button above does it for you.</p></details>
<details><summary>Can someone else talk to my assistant?</summary><p>Only if you skip the "lock it" step. Put your assistant's address behind Cloudflare Access with your email, and only you get in.</p></details>
<details><summary>How do I stop paying?</summary><p>In the Cloudflare dashboard, open Workers, choose the assistant and delete it. Download anything you want to keep from R2 storage first. Turn off Workers Paid if nothing else uses it.</p></details>
<details><summary>What does forq have to do with this?</summary><p>forq runs coding agents on Cloudflare, each in its own box with its own copy of a project. A personal assistant is the same idea pointed at your life instead of your code. Next: an assistant whose memory is a forq project, so you can see what it learned, undo it, and copy someone else's setup.</p></details>

<p class="foot"><a href="/">forq</a><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/feedback?from=/personal-agents">Feedback</a></p>
</main></body></html>`;
}
