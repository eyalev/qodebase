// The site header (qb3, 2026-10-12). Eyal: "I want to always know which project I'm in, and if I'm signed in, see
// my picture or initial; like GitHub: owner / repo, truncated with … when tight; move stuff into a hamburger on the
// right." One 48 px row: the mark, the context (owner / project on a project page, else the section name), a compact
// Build, the avatar (or Sign in) carrying the Inbox count, and the ☰ sheet with every section and the costs.
// Mobbin refs (design-log forq-20261012-4): GitHub (avatar in the header, + as an icon), Insight Timer and Claude
// (initial avatar, sections in the menu), Perplexity (initial circle when there is no picture).
// Pure: no imports from the Worker, so the preview Worker can bundle it on its own.

export type HeaderCtx = { owner: string; ownerLabel?: string; name: string; href: string; private?: boolean; action?: string };
export type HeaderOpts = { active: string; inbox: number; me: string; ctx?: HeaderCtx; selfHost?: boolean };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const SECTION: Record<string, string> = { explore: 'Explore', inbox: 'Inbox', mine: 'Yours', projects: 'Yours', build: 'Build', account: 'Account' };
const MARK = `<svg viewBox="0 0 256 256" width="26" height="26" aria-hidden="true"><rect width="256" height="256" rx="56" fill="var(--acc)"/><circle cx="121" cy="110" r="48" fill="none" stroke="var(--acc-fg)" stroke-width="30"/><path d="M154 58h30v138h-30z" fill="var(--acc-fg)"/></svg>`;
const LOCK = `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
const MENU = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const PLUS = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

export function siteHeader(o: HeaderOpts) {
  const active = o.active === 'projects' ? 'mine' : o.active;
  const c = o.ctx;
  const ctx = c
    ? `<a class="hctx${(c.ownerLabel || c.owner).length + c.name.length > 22 ? ' hlong' : ''}" href=""${esc(c.href)}" title="${esc(`${c.ownerLabel || c.owner} / ${c.name}`)}"><span class="ho">${esc(c.ownerLabel || c.owner)}</span><span class="hs">/</span><b class="hn">${esc(c.name)}</b>${c.private ? `<span class="hp" title="Private: only you">${LOCK}</span>` : ''}</a>`
    : SECTION[active] ? `<span class="hctx hsec">${SECTION[active]}</span>` : '';
  const initial = o.me ? esc(o.me.slice(0, 1).toUpperCase()) : '';
  const who = o.me
    ? `<button type="button" class="hav" popovertarget="gmenupop" aria-label="Menu and account: ${esc(o.me)}${o.inbox ? `, ${o.inbox} in your inbox` : ''}">${initial}${o.inbox ? `<span class="hbadge">${o.inbox > 99 ? '99+' : o.inbox}</span>` : ''}</button>`
    : `<a class="hsignin" href="/login">Sign in</a>`;
  const item = (href: string, label: string, sub: string, on = false, extra = '') => `<a href="${href}"${on ? ' aria-current="page"' : ''}><b>${label}${extra}</b>${sub ? `<span>${sub}</span>` : ''}</a>`;
  const sheet = `<div id="gmenupop" class="gmenupop hsheet" popover>
${o.me ? `<a class="hme" href="/settings"><span class="hav big" aria-hidden="true">${initial}</span><span><b>${esc(o.me)}</b><span>Account, API key, sign out</span></span></a>` : `<a class="hme" href="/login"><span><b>Sign in</b><span>With Google or an emailed code</span></span></a>`}
${item('/explore', 'Explore', '', active === 'explore')}
${o.me ? item('/inbox', 'Inbox', 'What needs you', active === 'inbox', o.inbox ? ` <span class="hcount">${o.inbox}</span>` : '') : ''}
${o.me ? item('/mine', 'Yours', '', active === 'mine') : ''}
${item('/build', 'Build', '', active === 'build')}
${o.me && !o.selfHost ? `<a href="/costs" class="hcost"><b>Costs</b><span>Today <span data-hcost>…</span></span></a>` : ''}
<hr>
${item('/import', 'Import from GitHub', '')}
${item('/cli', 'Command line', '')}
${o.selfHost ? '' : item('/how', 'How it works', '')}
${item('/about', 'About', '')}
${item('/feedback', 'Feedback', '')}
</div>`;
  const costJs = o.me && !o.selfHost ? `<script>(function(){var e=document.querySelector('[data-hcost]');if(!e||e.dataset.on)return;e.dataset.on=1;fetch('/api/costs',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(c){if(!c)return;var n=c.today.total.usd;e.textContent=n>0&&n<0.005?'<$0.01':'$'+n.toFixed(2)}).catch(function(){})})();</script>` : '';
  return `<nav class="gtop gtop2" aria-label="qodebase"><a class="mark" href="/" aria-label="qodebase home">${MARK}</a>${ctx}<span class="hsp"></span>${c?.action || ''}${active === 'build' || c ? '' : `<a class="hplus" href="/build" aria-label="Build something new">${PLUS}</a>`}${who}${o.me ? '' : `<button type="button" class="gmenu" popovertarget="gmenupop" aria-label="Menu">${MENU}</button>`}${sheet}</nav><style>${HEADER_CSS}</style>${costJs}`;
}

export const HEADER_CSS = `
:root{--top-h:48px}
.gtop.gtop2{display:flex;align-items:center;gap:2px;height:var(--top-h);padding:0 4px 0 6px;overflow:visible}
.gtop2 .mark{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:0}
.gtop2 .hctx{flex:0 1 auto;min-width:0;display:flex;align-items:baseline;gap:4px;min-height:44px;align-items:center;padding:0 6px;font-size:15px;color:var(--fg);text-decoration:none;white-space:nowrap}
.gtop2 .ho{flex:0 3 auto;min-width:1.5em;overflow:hidden;text-overflow:ellipsis;color:var(--dim)}
.gtop2 .hs{flex:none;color:var(--dim)}
.gtop2 .hn{flex:0 1 auto;min-width:3em;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.gtop2 .hctx:focus-visible{outline:2px solid var(--acc);outline-offset:-2px;border-radius:8px}
@media (max-width:430px){.gtop2 .hlong .ho,.gtop2 .hlong .hs{display:none}}
.gtop2 .hp{flex:none;display:inline-flex;color:var(--dim);margin-left:2px}
.gtop2 .hsec{font-weight:600;letter-spacing:-.01em}
.gtop2 .hsp{flex:1 1 0;min-width:4px}
.gtop2 .hplus,.gtop2 .gmenu{flex:none;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border:0;border-radius:10px;background:none;color:var(--fg);cursor:pointer;-webkit-tap-highlight-color:transparent}
.gtop2 .hav{flex:none;position:relative;display:inline-grid;place-items:center;width:32px;height:32px;margin:0 10px 0 6px;padding:0;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent;border-radius:50%;background:var(--chip);color:var(--fg);font:600 14px 'Geist',sans-serif;text-decoration:none;box-shadow:inset 0 0 0 1px var(--line)}
.gtop2 .hav::after{content:'';position:absolute;inset:-6px}
.gtop2 .hbadge{position:absolute;top:-5px;right:-8px;min-width:18px;height:18px;padding:0 5px;border-radius:4px;background:var(--warn);color:var(--acc-fg);font-size:11px;font-weight:600;line-height:18px;text-align:center;box-shadow:0 0 0 2px var(--bg)}
.gtop2 .hsignin{flex:none;display:inline-flex;align-items:center;min-height:44px;padding:0 8px;font-size:15px;color:var(--fg);text-decoration:none}
.gmenupop.hsheet{max-height:calc(100dvh - var(--top-h) - 16px);overflow-y:auto;overscroll-behavior:contain}
.hsheet a{min-height:44px;justify-content:center}
.hsheet hr{border:0;border-top:1px solid var(--line);margin:4px 0}
.hsheet .hme{flex-direction:row!important;align-items:center;gap:12px}
.hsheet .hme>span:last-child{display:flex;flex-direction:column;gap:2px}
.hsheet .hav.big{flex:none;display:inline-grid;place-items:center;width:40px;height:40px;border-radius:50%;background:var(--chip);font-weight:600;font-size:17px;box-shadow:inset 0 0 0 1px var(--line)}
.hsheet .hcount{display:inline-block;min-width:18px;height:18px;margin-left:6px;padding:0 5px;border-radius:4px;background:var(--warn);color:var(--acc-fg);font-size:11px;font-weight:600;line-height:18px;text-align:center;vertical-align:1px}
@media (hover:hover){.gtop2 .hplus:hover,.gtop2 .gmenu:hover{background:var(--chip)}.gtop2 .hctx:hover .hn{text-decoration:underline}}
@media (min-width:900px){.gtop2 .hctx{font-size:16px}}
`;
