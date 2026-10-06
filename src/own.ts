// /own — "Get your own qodebase" (Eyal, 2026-10-06: "be your own GitHub"). The same
// qodebase, installed into the visitor's own Cloudflare account. Until the one-tap
// installer exists the button is the self-host guide; then it becomes
// /personal-agents/install/qodebase (src/install.ts).
import { shell } from './ui';

const PLAN = 'https://developers.cloudflare.com/workers/platform/pricing/';
const EXT = `<svg class="ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9 2h5v5M14 2 7.5 8.5M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function ownPage(installReady: boolean): string {
  const action = installReady
    ? `<a class="btn" href="/personal-agents/install/qodebase">Install in my Cloudflare</a>`
    : `<a class="btn" href="/p/forq/forq/readme?doc=SELF_HOST.md">Read the setup guide</a><p class="note">One-tap install into your Cloudflare account is being built.</p>`;
  return shell('Get your own qodebase · qodebase', `<a class="back" href="/">qodebase</a>
<h1>Get your own qodebase</h1>
<p class="desc">The same qodebase, in your own Cloudflare account. Your projects, your apps and your agents live there.</p>
<ul class="ownpts">
<li>Your code in your account, on Cloudflare's git storage</li>
<li>Agents run on your own Claude account or Anthropic API key</li>
<li>Locked to you by Cloudflare sign-in</li>
<li>Needs Cloudflare's Workers Paid plan: <a href="${PLAN}" target="_blank" rel="noopener">$5 a month for the whole account${EXT}</a></li>
</ul>
<div class="ownact">${action}</div>
<p class="desc small">It is open source: <a href="https://github.com/eyalev/qodebase" target="_blank" rel="noopener">github.com/eyalev/qodebase${EXT}</a></p>
<style>.ownpts{margin:16px 0 24px;padding-left:20px;line-height:1.5}.ownpts li{margin:6px 0}.ownact .btn{display:flex;justify-content:center;align-items:center;min-height:48px;width:100%}.ownact .note{color:var(--dim);font-size:14px;margin:8px 0 0}.small{font-size:14px;margin-top:24px}.ico{vertical-align:-1px;margin-left:3px}</style>`);
}
