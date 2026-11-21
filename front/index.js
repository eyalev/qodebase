// Forwards qodebase.app to forq (see wrangler.jsonc). Redirects and WebSocket
// upgrades pass through untouched; www goes to the apex.
// PAUSED (2026-11-03, Eyal): the forq Cloudflare account was emptied and its
// Workers Paid plan cancelled, so there is nothing to forward to. Every path
// answers the paused pages below; set PAUSED to "0" in wrangler.jsonc to forward again
// (after forq is redeployed: repos are bundled in ~/.local/share/forq-backup-2026-11-03).
// The paused front still carries the public-project baseline (2026-11-21, big push track C):
// /health.json and /version.json (no D1, nothing to check but the deploy), /about, /privacy,
// robots.txt + /sitemap.xml and an og:image (public/og.png, served as a static asset). Feedback
// is a Baseline skip in CLAUDE.md. Deploy with --tag "$(git rev-parse --short HEAD)" so the sha
// shows.
const CONTACT = 'hello@kapps.dev';
const HEAD = (title, desc, path) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="https://qodebase.app${path}">
<meta property="og:type" content="website"><meta property="og:site_name" content="qodebase">
<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
<meta property="og:url" content="https://qodebase.app${path}">
<meta property="og:image" content="https://qodebase.app/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="qodebase: a git platform for the age of agents, paused">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://qodebase.app/og.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#f7f7fa;--card:#fff;--line:#e4e4ec;--fg:#14121f;--dim:#646177;--acc:#6a2ff0}
@media (prefers-color-scheme:dark){:root{--bg:#0d0c12;--card:#16151e;--line:#2a2836;--fg:#eeedf3;--dim:#a3a0b3;--acc:#a585ff}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;background:var(--bg);color:var(--fg);font:16px/1.5 Geist,ui-sans-serif,sans-serif;padding:32px 16px}
main{max-width:520px;margin:12vh auto 0;background:var(--card);border-radius:14px;box-shadow:inset 0 0 0 1px var(--line);padding:24px}
h1{font-size:24px;font-weight:600;letter-spacing:-0.02em;margin:0 0 8px}
h2{font-size:17px;font-weight:600;margin:20px 0 4px}
p{margin:0 0 10px;color:var(--dim)}
a{color:var(--acc)}
footer{max-width:520px;margin:16px auto 0;padding:0 24px;font-size:14px;color:var(--dim)}
footer a{color:inherit}
</style></head><body><main>`;
const FOOT = `</main><footer><a href="/">qodebase</a> · <a href="/about">About</a> · <a href="/privacy">Privacy</a> · <a href="mailto:${CONTACT}">${CONTACT}</a></footer></body></html>`;

const PAGES = {
  '/': HEAD('qodebase is paused', 'qodebase, a git platform for the age of agents, is switched off for now. The code is open on GitHub.', '/') + `
<h1>qodebase is paused</h1>
<p>The hosted version is switched off for now. The code is open at <a href="https://github.com/eyalev/qodebase">github.com/eyalev/qodebase</a>.</p>
` + FOOT,
  '/about': HEAD('About qodebase', 'What qodebase was, why it is paused, and how to reach us.', '/about') + `
<h1>About qodebase</h1>
<p>qodebase is a git platform for the age of agents, built on Cloudflare and meant to be used from a phone: every project runs, and every fork comes with its own coding agents.</p>
<h2>Why it is paused</h2>
<p>The hosted version was switched off on 3 November 2026. Nothing is running here any more: there is no sign-in and no projects are served from this site.</p>
<h2>The code</h2>
<p>The source is open under the Apache 2.0 licence at <a href="https://github.com/eyalev/qodebase">github.com/eyalev/qodebase</a>, with notes on hosting it yourself.</p>
<h2>Contact</h2>
<p>Write to <a href="mailto:${CONTACT}">${CONTACT}</a>. A person reads every message.</p>
` + FOOT,
  '/privacy': HEAD('Privacy · qodebase', 'What this paused page keeps about you: nothing beyond standard request logs.', '/privacy') + `
<h1>Privacy</h1>
<p>Last updated 21 November 2026.</p>
<p>qodebase is paused. This site is a few static pages: there are no accounts, no sign-in, no forms, no cookies and no analytics.</p>
<h2>What is kept</h2>
<p>Cloudflare, which serves these pages, keeps short-lived request logs (time, page, a coarse location and the kind of browser) so we can see that the site works. They are not used for anything else and are deleted after a few days.</p>
<h2>Earlier accounts</h2>
<p>When the hosted version was switched off, its services and their data were removed from Cloudflare. A private backup of the hosted repositories was kept so the service can be restored. If you had an account and want to know what is held about you, or want it deleted, write to us.</p>
<h2>Contact</h2>
<p><a href="mailto:${CONTACT}">${CONTACT}</a></p>
` + FOOT,
};
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.keys(PAGES).map((p) => `  <url><loc>https://qodebase.app${p}</loc><lastmod>2026-11-21</lastmod></url>`).join('\n')}
</urlset>
`;

function pausedResponse(url, env) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const meta = env.CF_VERSION_METADATA || {};
  const sha = meta.tag || null;
  const built = meta.timestamp || null;
  const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  if (p === '/health.json') return json({ sha, built, paused: true, checks: [{ id: 'paused', label: 'Hosted version', status: 'ok', detail: 'paused since 2026-11-03; static pages only' }] });
  if (p === '/version.json') return json({ sha, branch: 'main', built });
  if (p === '/robots.txt') return new Response('User-agent: *\nAllow: /\n\nSitemap: https://qodebase.app/sitemap.xml\n', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (p === '/sitemap.xml') return new Response(SITEMAP, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  const html = PAGES[p];
  return new Response(html || PAGES['/'], { status: html ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.PAUSED === '1') {
      if (url.hostname === 'www.qodebase.app') return Response.redirect(`https://qodebase.app${url.pathname}${url.search}`, 301);
      return pausedResponse(url, env);
    }
    if (url.hostname === 'www.qodebase.app') return Response.redirect(`https://qodebase.app${url.pathname}${url.search}`, 301);
    const host = url.hostname;
    // Access guards ORIGIN/login at the edge, so the forward would only meet
    // Access's own redirect: send the browser to sign in there, handed back
    // to this host through /session (forq's handoff, src/index.ts loginRoute).
    if (url.pathname === '/login') {
      const next = url.searchParams.get('next');
      const q = new URLSearchParams({ to: host, next: next && /^\/[^/\\]/.test(next) ? next : '/' });
      return new Response(null, { status: 302, headers: { location: `https://${env.ORIGIN}/login?${q}`, 'cache-control': 'no-store' } });
    }
    url.hostname = env.ORIGIN;
    const req = new Request(url, request);
    const cf = request.cf || {};
    req.headers.set('x-qb-front', env.FRONT_SECRET);
    req.headers.set('x-qb-host', host);
    req.headers.set('x-qb-ip', request.headers.get('cf-connecting-ip') || '');
    req.headers.set('x-qb-cf', JSON.stringify({
      country: cf.country, asn: cf.asn, asOrganization: cf.asOrganization, colo: cf.colo,
      verifiedBotCategory: cf.verifiedBotCategory, botManagement: cf.botManagement ? { verifiedBot: cf.botManagement.verifiedBot } : undefined,
    }));
    const t0 = Date.now();
    try {
      const res = await fetch(req, { redirect: 'manual' });
      if (res.status >= 500) log('forward_5xx', { path: url.pathname, status: res.status, ms: Date.now() - t0 });
      return res;
    } catch (e) {
      log('forward_error', { path: url.pathname, ms: Date.now() - t0, err: String(e), stack: e?.stack });
      return new Response('qodebase could not be reached. Try again in a moment.', { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  },
};

function log(event, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: event === 'forward_error' ? 'error' : 'warn', module: 'front', event, ...data }));
}
