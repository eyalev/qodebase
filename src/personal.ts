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

<h1>Your own AI assistant</h1>
<ul class="pts">
<li>Runs in <b>your</b> Cloudflare account</li>
<li>Your data, your AI model, no ads</li>
<li>No code: tap Deploy, paste a key</li>
</ul>

<div class="cards">
<section class="card" id="personal-agent">
<div class="head"><h3>Personal Agent</h3><span class="tag acc">Start here</span></div>
<ul class="facts"><li>Free</li><li>Chat on the web</li><li>2 minutes</li></ul>
<div class="btns"><a class="btn pri" href="https://deploy.workers.dev/?url=https://github.com/DomWane/workers-personal-agent" rel="noopener">Deploy</a><a class="btn sec" href="https://github.com/DomWane/workers-personal-agent" rel="noopener">Details</a></div>
<details><summary>Steps</summary><ol>
<li>Tap Deploy, sign in to Cloudflare</li>
<li>Keep the defaults</li>
<li>Open the address it gives you</li>
</ol></details>
</section>

<section class="card" id="openclaw">
<div class="head"><h3>OpenClaw</h3><span class="tag busy">Experimental</span></div>
<ul class="facts"><li>From $5/month</li><li>Telegram, Discord, Slack</li><li>Browses the web for you</li></ul>
<div class="btns"><a class="btn pri" href="https://deploy.workers.dev/?url=https://github.com/cloudflare/moltworker" rel="noopener">Deploy</a><a class="btn sec" href="https://github.com/cloudflare/moltworker" rel="noopener">Details</a></div>
<details><summary>Steps</summary><ol>
<li>Turn on Workers Paid ($5/month)</li>
<li>Tap Deploy, paste your <a href="https://console.anthropic.com/" rel="noopener">Anthropic key</a></li>
<li>Add a Telegram bot from <a href="https://t.me/BotFather" rel="noopener">@BotFather</a></li>
<li>Set it to sleep when idle (keeps it near $5)</li>
</ol></details>
</section>

<section class="card" id="hermes">
<div class="head"><h3>Hermes</h3><span class="tag">Not in your account</span></div>
<ul class="facts"><li>Hosted by Nous Research</li><li>Your account version: <a href="/feedback?from=/personal-agents">ask for it</a></li></ul>
<div class="btns"><a class="btn sec" href="https://portal.nousresearch.com/cloud" rel="noopener">Details</a></div>
</section>
</div>

<p class="foot"><a href="/">forq</a><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/feedback?from=/personal-agents">Feedback</a></p>
</main></body></html>`;
}
